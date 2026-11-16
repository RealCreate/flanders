// Heavy work that must not freeze the page: replaying a long history, building the army navigation grid. Both run in slices of a few milliseconds and hand the
// thread back between them, so the browser keeps painting (and never shows its "page unresponsive" warning). A slice only decides WHEN work happens, never what
// it computes: a world replayed in slices is the same world, down to the state hash, as one replayed in a single blocking loop (see tests/loader.test.mjs).
import type { World } from './wasm/game_core.js';

/** Give the thread back to the browser so it can paint and handle input. */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise(r => setTimeout(r, 0));
}

export interface SliceOpts {
  /** How long to work before handing the thread back (default 12 ms: under a frame). */
  budgetMs?: number;
  now?: () => number;
  yieldFn?: () => Promise<void>;
  /** Called after each slice with how far it is, 0..1. */
  onProgress?: (fraction: number) => void;
  /** Return true to abandon the work (a newer history arrived, the player left). */
  cancelled?: () => boolean;
}

class Slicer {
  private t0: number; private budget: number; private now: () => number; private y: () => Promise<void>;
  longest = 0; slices = 0;
  constructor(o: SliceOpts) { this.budget = o.budgetMs ?? 12; this.now = o.now ?? (() => performance.now()); this.y = o.yieldFn ?? yieldToMain; this.t0 = this.now(); }
  /** Yield when the budget is spent; true when it did. */
  async maybe(): Promise<boolean> {
    const n = this.now(), d = n - this.t0;
    if (d < this.budget) return false;
    this.longest = Math.max(this.longest, d); this.slices++;
    await this.y(); this.t0 = this.now(); return true;
  }
}

export interface SliceStats { slices: number; longestMs: number }

/** Step a world to `target`, yielding as the budget runs out. A tick is cheap, so the clock is looked at only every 128. */
async function stepSliced(w: World, target: number, s: Slicer, o: SliceOpts): Promise<boolean> {
  let n = 0; const goal = BigInt(target);
  while (w.tick() < goal && n < 2_000_000) {
    w.step(); n++;
    if ((n & 127) === 0 && await s.maybe() && o.cancelled?.()) return false;
  }
  return true;
}

/**
 * Play a history onto a world exactly as the blocking loop `for (c of cmds) { stepTo(w, c.tick); apply(w, c) }` does (then on to `finalTick`), but in slices.
 * Resolves `ok: false` when `cancelled` said stop.
 */
export async function replayInSlices<C extends { tick: number }>(w: World, cmds: readonly C[], apply: (w: World, c: C) => void, finalTick = 0, o: SliceOpts = {}): Promise<SliceStats & { ok: boolean }> {
  const s = new Slicer(o);
  const end = Math.max(finalTick, cmds.length ? cmds[cmds.length - 1].tick : 0, 1);
  const report = () => o.onProgress?.(Math.min(1, Number(w.tick()) / end));
  const done = (ok: boolean) => ({ ok, slices: s.slices, longestMs: s.longest });
  for (const c of cmds) {
    if (!(await stepSliced(w, c.tick, s, o))) return done(false);
    apply(w, c);
    if (await s.maybe()) { report(); if (o.cancelled?.()) return done(false); }   // (one command can cost tens of ms: look at the clock after every one)
  }
  if (!(await stepSliced(w, finalTick, s, o))) return done(false);
  report();
  return done(true);
}

/** Build the army navigation grid (about five seconds of work in one go) a slice at a time. `step(seed, rows)` is `warm_navigation_step` from the core. */
export async function warmNavigationInSlices(step: (seed: bigint, rows: number) => number, seed: bigint, o: SliceOpts & { rowsPerCall?: number } = {}): Promise<SliceStats> {
  const s = new Slicer(o), rows = o.rowsPerCall ?? 4;
  let p = 0;
  while ((p = step(seed, rows)) < 1) { o.onProgress?.(p); if (await s.maybe() && o.cancelled?.()) break; }
  o.onProgress?.(1);
  return { slices: s.slices, longestMs: s.longest };
}

/** Run `rows(a, b)` over `0..total` in pieces of about `perCall` rows, handing the thread back as the budget runs out, and join the pieces (they come out exactly as one call over everything). */
export async function collectInSlices(total: number, rows: (a: number, b: number) => Float32Array, perCall: number, o: SliceOpts = {}): Promise<Float32Array> {
  const s = new Slicer(o), parts: Float32Array[] = []; let len = 0;
  for (let a = 0; a < total; a += perCall) {
    const p = rows(a, Math.min(total, a + perCall)); parts.push(p); len += p.length;
    if (await s.maybe()) o.onProgress?.(a / total);
  }
  const out = new Float32Array(len); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  o.onProgress?.(1);
  return out;
}
