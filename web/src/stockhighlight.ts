// Hover a resource's rate in the top bar and the buildings behind it light up. This is the pure part (no DOM, no three.js), tested on its own:
// which building kinds make or use a resource (read from the core's ledger, so mode-dependent buildings such as the smokehouse and the farm fields are right),
// how many stand, their tiers, how many can be upgraded now and how many are held up, the tooltip text, and the hover/cycle state.

import { categoryKey, perDay, type FlowData } from './flowrate.ts';

export const STRIDE = 10;   // buildings_flat: kind, tier, x, z, _, pad height, status, cycle %, workers, residents
/** The status codes that mean "held up": waiting for materials, resource exhausted, storage full. */
export const ST_WAIT = 1, ST_EXHAUSTED = 2, ST_FULL = 3;

export interface Source { kinds: { kind: number; perDay: number }[]; extras: { key: string; perDay: number }[] }

/** What makes (`sign` > 0) or uses (`sign` < 0) a resource over the last day, from the ledger: building kinds and non-building categories (villagers, taxes...). */
export function stockSources(d: FlowData | undefined, res: number, sign: number): Source {
  const out: Source = { kinds: [], extras: [] };
  if (!d) return out;
  const byKind = new Map<number, number>(), byKey = new Map<string, number>();
  for (const l of d.lines) {
    if (l.res !== res) continue;
    const amt = sign > 0 ? l.gain : l.loss; if (!amt) continue;
    if (l.cat < d.nk) byKind.set(l.cat, (byKind.get(l.cat) ?? 0) + amt);
    else { const key = categoryKey(d, l.cat); byKey.set(key, (byKey.get(key) ?? 0) + amt); }
  }
  for (const [kind, a] of byKind) out.kinds.push({ kind, perDay: perDay(a, d.covered) });
  for (const [key, a] of byKey) out.extras.push({ key, perDay: perDay(a, d.covered) });
  out.kinds.sort((a, b) => b.perDay - a.perDay); out.extras.sort((a, b) => b.perDay - a.perDay);
  return out;
}

/** Add the kinds the catalogue says make (`sign` > 0) or use a resource, even when the ledger has not seen them work yet (a new farm, a kiln waiting for wood). Rate 0 until the ledger knows. */
type Recipe = { inputs: [number, number][]; outputs: [number, number][] };
export function addCatalogKinds(src: Source, defs: ArrayLike<Recipe & { alternateRecipe?: Recipe }>, res: number, sign: number): Source {
  const side = sign > 0 ? 'outputs' : 'inputs';
  for (let k = 0; k < defs.length; k++) {
    const d = defs[k], makesOrUses = (recipe: Recipe) => recipe[side].some(([r]) => r === res);
    if ((makesOrUses(d) || (d.alternateRecipe && makesOrUses(d.alternateRecipe))) && !src.kinds.some(x => x.kind === k)) src.kinds.push({ kind: k, perDay: 0 });
  }
  return src;
}

/** Several resources as one (the Food pill): the same kind or category counts once, with its rates added. */
export function mergeSources(list: Source[]): Source {
  const kinds = new Map<number, number>(), extras = new Map<string, number>();
  for (const s of list) { for (const k of s.kinds) kinds.set(k.kind, (kinds.get(k.kind) ?? 0) + k.perDay); for (const e of s.extras) extras.set(e.key, (extras.get(e.key) ?? 0) + e.perDay); }
  return { kinds: [...kinds].map(([kind, perDay]) => ({ kind, perDay })).sort((a, b) => b.perDay - a.perDay), extras: [...extras].map(([key, perDay]) => ({ key, perDay })).sort((a, b) => b.perDay - a.perDay) };
}

export interface KindSummary {
  kind: number; count: number; perDay: number;
  tiers: number[];            // how many stand at each tier
  upgradable: number;         // below the top tier and the upgrade is affordable right now
  maxed: number;
  noWorkers: number; waiting: number; exhausted: number; full: number;   // held up, and why
  idx: number[];              // building indices, in list order
}
export interface KindInfo { maxTier: number; jobs: number }

/** Count the buildings of the given kinds in the core's flat list. `canUpgrade(kind, tier)` says whether the next tier can be paid for. */
export function summarize(f: ArrayLike<number>, sources: Source['kinds'], info: (kind: number) => KindInfo, canUpgrade: (kind: number, tier: number) => boolean, include = (_idx: number, _kind: number) => true): KindSummary[] {
  const by = new Map<number, KindSummary>();
  for (const s of sources) by.set(s.kind, { kind: s.kind, count: 0, perDay: s.perDay, tiers: [], upgradable: 0, maxed: 0, noWorkers: 0, waiting: 0, exhausted: 0, full: 0, idx: [] });
  for (let i = 0, n = Math.floor(f.length / STRIDE); i < n; i++) {
    const o = i * STRIDE, k = by.get(f[o]); if (!k || !include(i, k.kind)) continue;
    const tier = f[o + 1], status = f[o + 6], inf = info(k.kind);
    k.count++; k.idx.push(i); k.tiers[tier] = (k.tiers[tier] ?? 0) + 1;
    if (tier >= inf.maxTier) k.maxed++; else if (canUpgrade(k.kind, tier)) k.upgradable++;
    if (inf.jobs > 0 && f[o + 8] === 0) k.noWorkers++;
    else if (status === ST_WAIT) k.waiting++; else if (status === ST_EXHAUSTED) k.exhausted++; else if (status === ST_FULL) k.full++;
  }
  return sources.map(s => by.get(s.kind)!).filter(k => k.count > 0);
}

export const idleTotal = (k: KindSummary) => k.noWorkers + k.waiting + k.exhausted + k.full;

/** "3 can be upgraded; idle: ..." as short plain text, shared by the tooltip and the breakdown panel. */
export function kindNote(k: KindSummary): string {
  const bits: string[] = [];
  if (k.upgradable) bits.push(`${k.upgradable} can be upgraded`);
  else if (k.maxed === k.count) bits.push('fully upgraded');
  else bits.push('none affordable to upgrade yet');
  const why: string[] = [];
  if (k.noWorkers) why.push(`${k.noWorkers} no workers`);
  if (k.waiting) why.push(`${k.waiting} short of materials`);
  if (k.exhausted) why.push(`${k.exhausted} resource exhausted`);
  if (k.full) why.push(`${k.full} store full`);
  if (why.length) bits.push('idle: ' + why.join(', '));
  return bits.join('; ');
}
/** "3 at tier 1, 4 at tier 2". */
export function tierText(k: KindSummary): string {
  const t: string[] = []; k.tiers.forEach((n, i) => { if (n) t.push(`${n} at tier ${i + 1}`); });
  return t.join(', ');
}
/** The tooltip line for one kind: "Farm x7: +120/day, 3 can be upgraded". */
export function kindLine(name: string, k: KindSummary, sign: number): string {
  return `${name}${k.count > 1 ? ' x' + k.count : ''}: ${sign > 0 ? '+' : '−'}${Math.round(k.perDay)}/day, ${kindNote(k)}`;
}

export type Hover = { res: number; sign: number };

/** Which resource rate the pointer is on, and the round-robin through its buildings that a click advances. No allocation per query. */
export class HighlightState {
  active: Hover | null = null;
  private cursor = 0;
  private lastKey = '';
  enter(res: number, sign: number) { const key = res + ':' + sign; if (key !== this.lastKey) { this.cursor = 0; this.lastKey = key; } this.active = { res, sign }; }
  leave() { this.active = null; }
  /** The next building to look at among `idx` (all the highlighted buildings), wrapping round. -1 when there are none. */
  next(idx: ArrayLike<number>): number {
    if (!idx.length) return -1;
    if (this.cursor >= idx.length) this.cursor = 0;
    return idx[this.cursor++];
  }
  /** Whether a building should get a highlight ring: the selected building keeps its own selection ring instead of a second one. */
  ringed(i: number, selected: number | null): boolean { return this.active !== null && i !== selected; }
}
