// What a deposit's numbers mean to a player: how full it is, whether it lies dormant, and how long it lasts. The core owns the rules (a used-up deposit goes dormant and regrows,
// see `Deposit::grow` in terrain.rs); this only words them. No DOM in here, so it is tested on its own.

/** A dormant deposit wakes at this share of its maximum (the core's WAKE_PCT). */
export const WAKE_PCT = 15;

export interface DepositState { rem: number; max: number; asleep: boolean }

/** How full the deposit is, 0 to 100 (0 for a cleared one). */
export function fillPercent(d: DepositState): number { return d.max > 0 ? Math.max(0, Math.min(100, Math.round(d.rem * 100 / d.max))) : 0; }

/** How far a dormant deposit has come back towards waking, 0 to 100 (it wakes when this reaches 100). */
export function wakeProgress(d: DepositState): number { return d.asleep ? (d.max > 0 ? Math.min(100, Math.round(d.rem * 10000 / (d.max * WAKE_PCT))) : 0) : 100; }

/** In-game days until the deposit is empty at `perDay` taken, or Infinity when nothing is taken. */
export function daysUntilEmpty(d: DepositState, perDay: number): number { return perDay > 0 ? d.rem / perDay : Infinity; }

export function fmtDays(days: number): string { return !isFinite(days) ? 'never' : days < 1 ? 'under a day' : days < 10 ? `${days.toFixed(1)} days` : `${Math.round(days)} days`; }

/** The short text of a map label or tooltip. */
export function depositLabel(name: string, d: DepositState): string {
  if (d.max <= 0) return `${name} · cleared`;
  return d.asleep ? `${name} · dormant, recovering ${fillPercent(d)}%` : `${name} · ${Math.round(d.rem)} / ${d.max}`;
}

/** Read the core's `building_deposit()`: [deposit index, remaining, maximum, dormant 0/1, taken per day], or null for a building that needs no deposit. */
export function parseBuildingDeposit(a: ArrayLike<number>): (DepositState & { perDay: number; index: number }) | null {
  return a.length >= 5 ? { index: a[0], rem: a[1], max: a[2], asleep: a[3] === 1, perDay: a[4] } : null;
}

/** The lines of a mine's or quarry's panel. */
export function depositPanel(d: DepositState & { perDay: number }): { fill: number; headline: string; detail: string } {
  const fill = fillPercent(d);
  if (d.asleep) return { fill, headline: `Dormant, regrowing: ${fill}%`, detail: `The deposit is used up and rests. It wakes at ${WAKE_PCT}% and work starts again by itself; it recovers faster when nobody works it.` };
  return { fill, headline: `${Math.round(d.rem)} / ${d.max} left`, detail: d.perDay > 0 ? `Empty in about ${fmtDays(daysUntilEmpty(d, d.perDay))} at the present rate (${Math.round(d.perDay)} a day). It slowly regrows, and rests when used up.` : 'It slowly regrows, and rests when used up.' };
}
