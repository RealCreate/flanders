// The work overview: who works where, read from the core's `staffing_flat()` / `staffing_totals()` and the buildings list. Pure logic (grouping, sorting, filters, totals) with no DOM, so it is tested on its own.

/** One workplace. `want` is -1 for auto, else the number of workers the player asked for. */
export interface WorkRow { idx: number; kind: number; tier: number; max: number; want: number; staff: number; scaled: boolean; status: number }
export interface WorkTotals { adults: number; workers: number; children: number; elders: number; sick: number; jobs: number; placed: number; idle: number; eff: number; promised: number }

/** Building status codes of the core (`buildings_flat`, offset 6). */
export const ST = { working: 0, wait: 1, exhausted: 2, full: 3, passive: 4, dormant: 7, reserve: 8 } as const;

/** Read `staffing_flat()` (five numbers per building: kind, max, wanted (-1 auto), assigned, scaled) together with `buildings_flat()` (stride 10) into rows. Buildings that employ nobody are left out. */
export function parseRows(staffing: ArrayLike<number>, buildings: ArrayLike<number>, stride = 10): WorkRow[] {
  const rows: WorkRow[] = [];
  for (let i = 0; i * 5 + 4 < staffing.length; i++) {
    const o = i * 5, max = staffing[o + 1]; if (max <= 0) continue;
    rows.push({ idx: i, kind: staffing[o], tier: buildings[i * stride + 1] ?? 0, max, want: staffing[o + 2], staff: staffing[o + 3], scaled: staffing[o + 4] === 1, status: buildings[i * stride + 6] ?? 0 });
  }
  return rows;
}

export function parseTotals(t: ArrayLike<number>): WorkTotals {
  return { adults: t[0] ?? 0, workers: t[1] ?? 0, children: t[2] ?? 0, elders: t[3] ?? 0, sick: t[4] ?? 0, jobs: t[5] ?? 0, placed: t[6] ?? 0, idle: t[7] ?? 0, eff: t[8] ?? 0, promised: t[9] ?? 0 };
}

export type Verdict = 'paused' | 'unstaffed' | 'no input' | 'store full' | 'no deposit' | 'dormant' | 'stock reserved' | 'working' | 'idle';
/** What the building is doing, in a word. Paused and unstaffed win over whatever the production status says. */
export function verdict(r: WorkRow, produces = true): Verdict {
  if (r.want === 0) return 'paused';
  if (r.staff === 0) return 'unstaffed';
  if (!produces) return 'working';
  switch (r.status) { case ST.wait: return 'no input'; case ST.exhausted: return 'no deposit'; case ST.full: return 'store full'; case ST.dormant: return 'dormant'; case ST.reserve: return 'stock reserved'; case ST.passive: return 'idle'; default: return 'working'; }
}

export type Filter = 'all' | 'problems' | 'understaffed' | 'paused' | 'manual';
export const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'problems', label: 'Problems' }, { id: 'understaffed', label: 'Understaffed' }, { id: 'paused', label: 'Paused' }, { id: 'manual', label: 'Set by hand' }];

/** Fewer hands than the building could use (a paused one is on purpose, not short). */
export const understaffed = (r: WorkRow) => r.want !== 0 && r.staff < (r.want < 0 ? r.max : Math.min(r.want, r.max));
export function keep(r: WorkRow, f: Filter, produces = true): boolean {
  switch (f) {
    case 'all': return true;
    case 'understaffed': return understaffed(r);
    case 'paused': return r.want === 0;
    case 'manual': return r.want >= 0;
    case 'problems': { const v = verdict(r, produces); return understaffed(r) || v === 'no input' || v === 'store full' || v === 'no deposit' || v === 'unstaffed' || v === 'stock reserved'; }
  }
}

export type Sort = 'kind' | 'workers' | 'short';
export const SORTS: { id: Sort; label: string }[] = [{ id: 'kind', label: 'By kind' }, { id: 'short', label: 'Most short' }, { id: 'workers', label: 'Most workers' }];

export interface Group { kind: number; rows: WorkRow[]; staff: number; max: number; manual: number; paused: number }

/** Group the rows by kind, after filtering. Kinds come in building-catalog order, or by how many hands they lack / employ; rows inside a group keep the order they were built in. */
export function group(rows: WorkRow[], filter: Filter = 'all', sort: Sort = 'kind', producesOf: (kind: number) => boolean = () => true): Group[] {
  const by = new Map<number, Group>();
  for (const r of rows) {
    if (!keep(r, filter, producesOf(r.kind))) continue;
    let g = by.get(r.kind); if (!g) by.set(r.kind, g = { kind: r.kind, rows: [], staff: 0, max: 0, manual: 0, paused: 0 });
    g.rows.push(r); g.staff += r.staff; g.max += r.max; if (r.want >= 0) g.manual++; if (r.want === 0) g.paused++;
  }
  const gs = [...by.values()];
  const shortOf = (g: Group) => g.rows.reduce((s, r) => s + Math.max(0, (r.want < 0 ? r.max : Math.min(r.want, r.max)) - r.staff), 0);
  gs.sort((a, b) => sort === 'workers' ? b.staff - a.staff || a.kind - b.kind : sort === 'short' ? shortOf(b) - shortOf(a) || a.kind - b.kind : a.kind - b.kind);
  return gs;
}

/** The note under the totals that says what is going on with the hands. */
export function workNote(t: WorkTotals): string {
  if (t.jobs === 0) return 'There are no workplaces yet.';
  if (t.promised > t.workers) return `You asked for ${t.promised} workers by hand but only ${t.workers} are available: every building you set is scaled back, and the buildings left on auto get nothing.`;
  if (t.workers < t.jobs) return `${t.jobs - t.workers} jobs have nobody to do them. Food and wood workplaces are staffed first.`;
  if (t.idle > 0) return `${t.idle} workers have nothing to do: build more workplaces.`;
  return 'Every job is filled.';
}

/** What a kind makes per day, from the ledger: `[resource, per day]` pairs for the gains of that building kind (steady ones; the ledger covers `covered` ticks). */
export function kindOutputs(lines: { cat: number; res: number; gain: number }[], covered: number, kind: number, dayTicks = 240, minTicks = 30): [number, number][] {
  if (covered < minTicks) return [];
  return lines.filter(l => l.cat === kind && l.gain > 0).map(l => [l.res, Math.round(l.gain * dayTicks / covered)] as [number, number]).sort((a, b) => b[1] - a[1]);
}

/** One step of the +/- buttons: from auto, "-" goes to one less than the most, "+" stays auto; clamped to 0..max. Returns the new wanted value (-1 auto). */
export function stepWant(r: Pick<WorkRow, 'want' | 'max' | 'staff'>, d: number): number {
  const cur = r.want < 0 ? r.staff : Math.min(r.want, r.max);
  const n = Math.max(0, Math.min(r.max, cur + d));
  return r.want < 0 && n === r.max ? -1 : n;
}
