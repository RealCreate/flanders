// The command screen: while a battle is on, the interface can be swapped for an army view: the strength of both sides, each troop type with its hit points and morale,
// and the orders at hand. The numbers come from `World.battle_roster()` (stride ROSTER_STRIDE: alive, hit points, most hit points, running, steady, veterans, morale).
export const ROSTER_STRIDE = 7;
export const ROSTER_KINDS = 7;   // spearman, archer, swordsman, knight, catapult, ram, militia
export const KIND_NAMES = ['Spearmen', 'Archers', 'Swordsmen', 'Knights', 'Catapults', 'Rams', 'Militia'] as const;

export interface RosterRow { kind: number; name: string; alive: number; hp: number; maxHp: number; running: number; steady: number; veterans: number; morale: number }
export interface SideSummary { rows: RosterRow[]; alive: number; hp: number; maxHp: number; running: number; morale: number }

/** One side's troop types that still have men in the field, with the side's totals (morale is the average over its men). */
export function sideSummary(flat: ArrayLike<number>, side: number): SideSummary {
  const rows: RosterRow[] = [];
  let alive = 0, hp = 0, maxHp = 0, running = 0, moraleSum = 0;
  for (let kind = 0; kind < ROSTER_KINDS; kind++) {
    const o = (side * ROSTER_KINDS + kind) * ROSTER_STRIDE;
    if (o + ROSTER_STRIDE > flat.length || !(flat[o] > 0)) continue;
    const row: RosterRow = { kind, name: KIND_NAMES[kind], alive: flat[o], hp: flat[o + 1], maxHp: flat[o + 2], running: flat[o + 3], steady: flat[o + 4], veterans: flat[o + 5], morale: flat[o + 6] };
    rows.push(row);
    alive += row.alive; hp += row.hp; maxHp += row.maxHp; running += row.running; moraleSum += row.morale * row.alive;
  }
  return { rows, alive, hp, maxHp, running, morale: alive > 0 ? moraleSum / alive : 0 };
}

const pct = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100);
const tone = (f: number) => f > 0.6 ? 'ok' : f > 0.3 ? 'warn' : 'bad';
const bar = (label: string, f: number) => `<span class="cs-bar ${tone(f)}" title="${label} ${pct(f)}%"><i style="width:${pct(f)}%"></i></span>`;

/** The roster of one side as HTML (the caller supplies a unit icon; every other string here is ours). */
export function rosterHtml(s: SideSummary, icon: (kind: number) => string): string {
  if (!s.rows.length) return '<p class="cs-empty">No soldiers in the field.</p>';
  return s.rows.map(r => `<div class="cs-row" data-kind="${r.kind}">
    <span class="cs-name">${icon(r.kind)} ${r.name}${r.veterans ? ` <small title="Veterans">★${r.veterans}</small>` : ''}</span>
    <b class="cs-n">${r.alive}</b>
    <span class="cs-meters">${bar('Health', r.maxHp > 0 ? r.hp / r.maxHp : 0)}${bar('Morale', r.morale)}</span>
    <small class="cs-flags">${r.running ? `${r.running} fleeing` : r.steady ? `${r.steady} rallied` : ''}</small>
  </div>`).join('');
}

/** The strength line: both sides' men, health and morale. Labels are escaped by the caller. */
export function strengthHtml(mine: SideSummary, theirs: SideSummary, myLabel: string, theirLabel: string): string {
  const side = (label: string, s: SideSummary, cls: string) => `<div class="cs-side ${cls}"><b>${label}</b><span>${s.alive} men</span>${bar('Health', s.maxHp > 0 ? s.hp / s.maxHp : 0)}${bar('Morale', s.morale)}${s.running ? `<small>${s.running} fleeing</small>` : ''}</div>`;
  return `${side(myLabel, mine, 'mine')}<span class="cs-vs">vs</span>${side(theirLabel, theirs, 'theirs')}`;
}

/** The command screen: a layer over the battlefield. Everything but its panels lets clicks through to the field, so orders are still given there. */
export class CommandScreen {
  private el: HTMLElement;
  private on = false;
  private icon: (kind: number) => string;
  constructor(icon: (kind: number) => string) {
    this.icon = icon;
    this.el = document.createElement('div');
    this.el.id = 'cmd-screen'; this.el.hidden = true;
    this.el.innerHTML = '<div id="cs-top"></div><div id="cs-left"><h3>Your troops</h3><div id="cs-mine"></div></div><div id="cs-right"><h3>The enemy</h3><div id="cs-theirs"></div></div>';
    document.body.appendChild(this.el);
  }
  get active() { return this.on; }
  set(on: boolean) { this.on = on; this.el.hidden = !on; document.body.classList.toggle('cmd-mode', on); }
  toggle() { this.set(!this.on); return this.on; }
  /** Redraw from a roster (`battle_roster`). `mySide` is 0 when we defend and 1 when we attack. */
  update(flat: ArrayLike<number>, mySide: number, labels: { mine: string; theirs: string }) {
    if (!this.on) return;
    const mine = sideSummary(flat, mySide), theirs = sideSummary(flat, 1 - mySide);
    const put = (id: string, html: string) => { const e = this.el.querySelector<HTMLElement>(id)!; if (e.innerHTML !== html) e.innerHTML = html; };
    put('#cs-top', strengthHtml(mine, theirs, labels.mine, labels.theirs));
    put('#cs-mine', rosterHtml(mine, this.icon));
    put('#cs-theirs', rosterHtml(theirs, this.icon));
  }
}
