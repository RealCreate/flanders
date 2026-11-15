// Resource flow made readable: the core keeps a ledger of where each resource came from and went to over the last day (derived display data, never part of
// the game state), and this turns it into a steady rate per day, a days-of-supply figure and the rows of the breakdown panel. No DOM in here, so it is tested on its own.

export const DAY_TICKS = 240;
/** Fewer ticks than this are not trusted to scale up to a day (a replica that has only just started shows a rate once it has seen a little). */
export const MIN_TICKS = 30;

export interface Line { cat: number; res: number; gain: number; loss: number }
export interface FlowData { covered: number; nk: number; extras: string[]; lines: Line[] }

/** Read what the core's `ledger_flat()` returns: `[ticks covered, building kinds, extra categories]` then `[category, resource, gained, lost]` per entry. */
export function parseLedger(flat: ArrayLike<number>, extras: string[]): FlowData {
  const lines: Line[] = [];
  for (let i = 3; i + 3 < flat.length; i += 4) lines.push({ cat: flat[i], res: flat[i + 1], gain: flat[i + 2], loss: flat[i + 3] });
  return { covered: flat.length ? flat[0] : 0, nk: flat.length > 1 ? flat[1] : 0, extras, lines };
}

/** Scale an amount seen over `covered` ticks to a whole day. */
export function perDay(amount: number, covered: number): number { return covered < MIN_TICKS ? 0 : amount * DAY_TICKS / covered; }

/** One-off and player-driven changes that would make a steady rate jump: raids, loot, deals and the player's own spending. */
export const ONE_OFF = ['orders', 'other'];

export function categoryKey(d: FlowData, cat: number): string { return cat < d.nk ? 'b' + cat : (d.extras[cat - d.nk] ?? '?'); }

/** Net change per day of one resource over the last day, without the one-offs (so a raid or a building does not make the figure jump). */
export function steadyRate(d: FlowData, res: number): number {
  let net = 0;
  for (const l of d.lines) if (l.res === res && !ONE_OFF.includes(categoryKey(d, l.cat))) net += l.gain - l.loss;
  return Math.round(perDay(net, d.covered));
}

export function fmtRate(perDayN: number): string {
  const n = Math.round(perDayN);
  return n === 0 ? '±0/day' : `${n > 0 ? '+' : '−'}${Math.abs(n)}/day`;
}

/** Days the stock lasts at this rate (null when it is not shrinking). */
export function daysLeft(stock: number, rate: number): number | null { return rate < 0 && stock > 0 ? stock / -rate : null; }
export function fmtDaysLeft(days: number): string {
  if (days < 0.1) return 'less than a tenth of a day';
  if (days < 10) return `about ${days.toFixed(1)} days`;
  return `about ${Math.round(days)} days`;
}

export interface Row { key: string; cat: number; perDay: number; count: number }
export interface Breakdown { sources: Row[]; sinks: Row[]; steady: number; net: number; covered: number }

/** The rows of the panel for one resource: what makes it and what uses it, each per day, biggest first. `count(cat)` says how many buildings stand behind a category (0 for the rest). */
export function breakdown(d: FlowData, res: number, count: (cat: number) => number = () => 0): Breakdown {
  const sources: Row[] = [], sinks: Row[] = []; let net = 0;
  for (const l of d.lines) {
    if (l.res !== res) continue;
    const key = categoryKey(d, l.cat), c = count(l.cat);
    if (l.gain) sources.push({ key, cat: l.cat, perDay: perDay(l.gain, d.covered), count: c });
    if (l.loss) sinks.push({ key, cat: l.cat, perDay: perDay(l.loss, d.covered), count: c });
    net += l.gain - l.loss;
  }
  sources.sort((a, b) => b.perDay - a.perDay); sinks.sort((a, b) => b.perDay - a.perDay);
  return { sources, sinks, steady: steadyRate(d, res), net: Math.round(perDay(net, d.covered)), covered: d.covered };
}

/** Labels and icon names (see ui/icons.ts) of the categories that are not building kinds. */
export const EXTRA_INFO: Record<string, { label: string; icon: string; hint: string }> = {
  villagers: { label: 'Villagers eating', icon: 'pop', hint: 'Everyone in the village eats a little every tick.' },
  soldiers: { label: 'Soldiers eating', icon: 'army', hint: 'Soldiers, guards in the field and armies away from home eat too.' },
  winter: { label: 'Winter firewood', icon: 'cold', hint: 'In winter the village burns wood to keep warm.' },
  backup: { label: 'Town hall reserve', icon: 'townhall', hint: 'The town hall adds a little wood and grain while the stores are low.' },
  doves: { label: 'Dovecotes', icon: 'grain', hint: 'Doves on the house roofs bring in grain.' },
  tax: { label: 'Taxes', icon: 'gold', hint: 'The villagers pay a little coin now and then.' },
  tithe: { label: 'Church tithe', icon: 'chapel', hint: 'The church service every seventh day.' },
  toll: { label: 'Toll posts', icon: 'tollpost', hint: 'Travellers on the roads pay at the toll posts.' },
  port: { label: 'Port trade', icon: 'port', hint: 'The port sells what there is most of, and buys grain when it runs short.' },
  harvest: { label: 'Bountiful harvests', icon: 'grain', hint: 'Now and then a good year brings extra grain.' },
  merchants: { label: 'Passing merchants', icon: 'caravan', hint: 'Travelling merchants leave some coin.' },
  orders: { label: 'Your orders', icon: 'worker', hint: 'Building, upgrading, demolishing, hiring soldiers and sending caravans. Not counted in the steady rate.' },
  other: { label: 'Raids, events and other', icon: 'raid', hint: 'Loot taken or won, and anything else that happens once. Not counted in the steady rate.' },
};

/** All the foods as one: meals in store and the steady rate in meals a day. `table` is the core's `food_table()`: `[resource, quarter meals]` pairs (a meal is four quarters). */
export function foodTotals(stocks: ArrayLike<number>, rates: ArrayLike<number>, table: ArrayLike<number>): { meals: number; rate: number } {
  let meals = 0, rate = 0;
  for (let k = 0; k + 1 < table.length; k += 2) { const r = table[k], q = table[k + 1]; meals += (stocks[r] ?? 0) * q / 4; rate += (rates[r] ?? 0) * q / 4; }
  return { meals, rate };
}
