// Restart: start the village again from nothing. The rules are in docs/RESTART.md; this file is the part that needs no game and no browser (tests/restart.test.mjs).
//
// A village's history is cut into EPOCHS. Epoch 0 is the history every village starts with. A restart is a signed command, `restart`, with epoch k+1, tick 0 and number 0: it
// is the first command of the new epoch, and the active history (what is saved, sent to other players and replayed) is only that epoch from then on. The history of the epoch
// that ended is ARCHIVED (kept in this browser, once) so that the player can bring it back; it is never sent to anybody again.

import type { Cmd, Signed } from './net/p2p.ts';

/** After a restart another one is refused for this long: the button is far from the busy ones, and the only way to change one's mind is the archive, which keeps just one life. */
export const RESTART_COOLDOWN_MS = 5 * 60_000;

/** The first command of epoch `epoch` (>= 1). */
export function restartCmd(epoch: number): Cmd { return { op: 'restart', tick: 0, n: 0, e: epoch }; }

/** The epoch a command belongs to. */
export const epochOfCmd = (c: { e?: number }) => c.e ?? 0;

/** What the active history of a village is: its epoch is the epoch of its first command, and it holds only that epoch. Returns the epoch, or null when the history mixes epochs or
 *  starts a later epoch without its restart command. */
export function epochOfHistory(cmds: readonly { op: string; e?: number }[]): number | null {
  if (!cmds.length) return 0;
  const e = epochOfCmd(cmds[0]);
  for (let i = 0; i < cmds.length; i++) {
    if (epochOfCmd(cmds[i]) !== e) return null;
    if ((cmds[i].op === 'restart') !== (i === 0 && e > 0)) return null;
  }
  return e;
}

/** What is kept of a village's history before it is replaced by a restart. */
export interface Archive {
  format: 'flanders-archive'; version: 1;
  /** The epoch the archived history was (0 for a village that was never restarted). */
  epoch: number;
  log: Signed[];
  site: number; name: string; savedAt: number; tick: number;
  /** When it was archived (the restart), and the day of the village then (so the menu can say what would come back). */
  archivedAt: number; days: number; buildings: number;
  v?: number; rules?: string;
}

const ARCHIVE_MAX = 60000;
/** Check an archive read from storage (damaged or edited data must not crash the game). */
export function validArchive(raw: unknown): Archive | null {
  const a = raw as Partial<Archive> | null;
  if (!a || typeof a !== 'object' || a.format !== 'flanders-archive' || a.version !== 1) return null;
  if (!Number.isInteger(a.epoch) || (a.epoch as number) < 0 || !Array.isArray(a.log) || a.log.length < 1 || a.log.length > ARCHIVE_MAX) return null;
  if (a.log.some(e => !e || typeof e.cmd !== 'string' || typeof e.sig !== 'string' || e.cmd.length > 65536 || e.sig.length > 200)) return null;
  if (!Number.isInteger(a.site) || typeof a.name !== 'string' || typeof a.savedAt !== 'number' || typeof a.tick !== 'number' || typeof a.archivedAt !== 'number') return null;
  return { ...(a as Archive), days: Number.isFinite(a.days) ? a.days as number : 0, buildings: Number.isFinite(a.buildings) ? a.buildings as number : 0 };
}

/** The commands that bring an archived village back as the new epoch `epoch`: the restart command, then every command of the archive with its number counted again and its
 *  epoch changed. (Nothing else about a command changes: replayed from the restart, they build the village the archive held.) The result has to be signed again. */
export function rebaseLog(old: readonly Cmd[], epoch: number): Cmd[] {
  const start = restartCmd(epoch);
  if (old[0]?.op === 'restart' && old[0].kind === 1) start.kind = 1;
  const out: Cmd[] = [start];
  let n = 1;
  for (const c of old) {
    if (c.op === 'restart') continue;   // (the archived epoch's own start is replaced by the new one)
    const { e: _e, ...rest } = c; void _e;
    out.push({ ...rest, e: epoch, n: n++ });
  }
  return out;
}

/** How long until another restart is allowed (ms; 0 = allowed). */
export function cooldownLeft(lastRestartAt: number | null | undefined, now: number): number {
  if (!lastRestartAt) return 0;
  return Math.max(0, lastRestartAt + RESTART_COOLDOWN_MS - now);
}

/** What the game knows when asked to restart. */
export interface Facts {
  /** Watching a replay of a history: the village on screen is not the real one. */
  replaying: boolean;
  /** A history is still being loaded or commands are waiting for their signature. */
  busy: boolean;
  battle: boolean;
  /** Field armies out of the village (marching, raiding, away). */
  armiesAway: boolean;
  lastRestartAt?: number | null; now: number;
  /** For the list of what will be lost. */
  days: number; buildings: number; population: number; soldiers: number; terrainEdits: number;
}

/** Why a restart cannot happen right now (a sentence for the player), or null. */
export function restartBlocker(f: Facts): string | null {
  if (f.replaying) return 'Leave the replay first: the village on screen is not your real village.';
  if (f.busy) return 'Your village is still saving or loading. Try again in a moment.';
  if (f.battle) return 'A battle is going on. Win it or lose it first: a village cannot start again in the middle of a fight.';
  if (f.armiesAway) return 'Your armies are out of the village. Bring them home (or let them return) first.';
  const left = cooldownLeft(f.lastRestartAt, f.now);
  if (left > 0) return `You restarted a moment ago. Wait ${Math.ceil(left / 60000)} more minute${Math.ceil(left / 60000) === 1 ? '' : 's'} before doing it again.`;
  return null;
}

/** What the confirmation modal says is lost. Plain sentences: nothing is promised that the core does not do (see World::restart). */
export function lossLines(f: Pick<Facts, 'days' | 'buildings' | 'population' | 'soldiers' | 'terrainEdits'>): string[] {
  return [
    `Every building (${f.buildings}), road, wall, field and bridge.`,
    f.terrainEdits > 0 ? `All changes to the land: raised, lowered and levelled ground, ditches, moats and the felled trees.` : 'All changes to the land (raised and lowered ground, ditches, felled trees).',
    'Every resource in store, and the market stock.',
    `Your people (${f.population}), your soldiers${f.soldiers ? ` (${f.soldiers})` : ''}, your armies and your lord.`,
    'Treaties, marriages and what other villages think of you; caravans and envoys on the road.',
    'The ore, stone and clay deposits: they come back at their first size.',
    `The calendar: ${f.days > 0 ? `all ${f.days} days of this village` : 'the day count'} start again from day 1.`,
  ];
}
/** What stays. */
export const KEPT_LINES = [
  'Your name, your key and your flag, and the place of your village on the map.',
  'Your settings (sound, graphics, controls) and the tutorial you may show again.',
  'A copy of this village, kept in this browser: you can bring it back once from the same menu.',
];

/** The word to type when the village has no good name to type. */
export const CONFIRM_WORD = 'RESTART';

/** Does the typed text confirm? The village's name or the word RESTART, in any case, ignoring spaces at the ends. */
export function confirms(typed: string, villageName: string): boolean {
  const t = typed.trim().toLowerCase();
  if (!t) return false;
  return t === CONFIRM_WORD.toLowerCase() || (villageName.trim().length > 0 && t === villageName.trim().toLowerCase());
}

export type FlowState = 'closed' | 'asking' | 'working' | 'blocked';

/** How long the modal has to be open before its red button works (so a stray Enter or double click cannot do it). */
export const ARM_MS = 2500;

/** The state machine of the confirmation modal. The red button does nothing unless `canConfirm()`: the village's name or the word RESTART typed, the modal open for a moment, and
 *  nothing in the way (opening it refuses when the game cannot restart now). */
export class RestartFlow {
  state: FlowState = 'closed';
  typed = ''; error = ''; blockedBy = ''; backedUp = false; openedAt = 0;
  villageName: string;
  constructor(villageName: string) { this.villageName = villageName; }
  open(f: Facts): FlowState {
    this.typed = ''; this.error = ''; this.backedUp = false; this.openedAt = f.now;
    const b = restartBlocker(f);
    if (b) { this.blockedBy = b; this.state = 'blocked'; } else { this.blockedBy = ''; this.state = 'asking'; }
    return this.state;
  }
  type(text: string) { if (this.state === 'asking') { this.typed = text.slice(0, 40); this.error = ''; } }
  armed(now: number) { return now - this.openedAt >= ARM_MS; }
  canConfirm(now: number): boolean { return this.state === 'asking' && this.armed(now) && confirms(this.typed, this.villageName); }
  /** The player pressed the red button. True when the restart may start now. */
  confirm(now: number): boolean { if (!this.canConfirm(now)) return false; this.state = 'working'; return true; }
  /** The restart could not be done (the archive could not be kept, the history is being saved): back to the question, with the reason. */
  fail(message: string) { this.state = 'asking'; this.error = message; }
  cancel() { if (this.state !== 'working') { this.state = 'closed'; this.typed = ''; this.error = ''; } }
  done() { this.state = 'closed'; this.typed = ''; this.error = ''; }
}
