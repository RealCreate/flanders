import { cleanWorld, withWorld } from '../worldname';
import { dayPhase, clockText, nightFactor } from '../daycycle';
import { HALF } from '../render/terrain';
import { CATS, RES, defs, units, fmtCost, resIcon, KIND_ICON, LEVEL_TOOL, TIER_NAMES, tierName, type BuildingDef } from '../data';
import { buildSearch } from '../buildsearch';
import { ORDER_NAMES, TROOP_GROUPS } from '../battlefield';
import type { BribeOffer } from '../bribe';
import { stewardRisks, WATCH_MESSAGES, type StewardAction, type StewardMode, type WatchReport } from '../steward';
import { foodTotals, breakdown, daysLeft, fmtDaysLeft, fmtRate, DAY_TICKS, EXTRA_INFO, type FlowData, type Row } from '../flowrate';
import { icon, kindIcon, unitIcon, type IconName } from './icons';
import { group, workNote, verdict, understaffed, kindOutputs, FILTERS, SORTS, type WorkRow, type WorkTotals, type Filter, type Sort } from '../workview';

/** A one-colour icon for a button or label (takes the text colour). Names are fixed ids from icons.ts, never user text. */
const FOOD_KEYS = ['grain', 'fish', 'bread', 'meat'];
const FOOD_ID = -2, CLOSED = -1;   // (the breakdown panel shows resource `i`, or all the foods at once)
const bi = (name: string, size = 16) => icon(name, size, { mono: true });
import { ACTIONS, keys, prettyKey, type Action } from '../keys';
import { mountFlagDesigner, paintFlag } from './flagdesigner';
import { mountSettings } from './settingsui';
import { mountRestart, type RestartHooks } from './restartui';
import { downloadBackup } from '../backup';
import { loadFlag, saveFlag } from '../flag';
import { versionLabel } from '../version';
import { renderNotes } from '../releasenotes';

/** The keys bound to an action, as they are now (after any rebinding), e.g. "W / Z / ↑". */
export const keyNames = (a: Action) => keys.binds[a].map(k => `<kbd>${prettyKey(k).toUpperCase()}</kbd>`).join(' ');
/** What the controls are, written from the real bindings, so the home screen and the help screen can never disagree with the game. */
export function controlsHtml() {
  return `<b>Left-click</b> builds and selects · <b>left-drag</b> draws a box round armies · <b>right-click</b> sends the selected army there · <b>right-drag</b> turns the camera · <b>middle-drag</b> or <b>Shift-drag</b> grabs the ground · <b>wheel</b> zooms towards the pointer.<br>Move the camera: ${keyNames('panUp')} forward, ${keyNames('panLeft')} left, ${keyNames('panDown')} back, ${keyNames('panRight')} right · turn: ${keyNames('rotLeft')} ${keyNames('rotRight')} · tilt: ${keyNames('tiltUp')} ${keyNames('tiltDown')} · zoom: ${keyNames('zoomIn')} ${keyNames('zoomOut')} · cancel: ${keyNames('cancel')} · help: ${keyNames('help')}.`;
}

/** Names come from other players: never put them into HTML unescaped. */
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => { /* refused: ignore */ });
}
export const WORLDS = ['flanders', 'brabant', 'hainaut', 'limburg', 'ardennes', 'zeeland', 'holland', 'friesland'];
const worldOptions = (cur: string) => [...new Set([...WORLDS, cur])].map(w => `<option value="${esc(w)}" ${w === cur ? 'selected' : ''}>${esc(w.charAt(0).toUpperCase() + w.slice(1))}</option>`).join('') + '<option value="__custom">Custom…</option>';

export interface Handlers {
  /** Start the village again (see restart.ts): what the dialog shows, doing it, and bringing the archived village back. */
  restartInfo: RestartHooks['info']; restartRun: RestartHooks['run']; restartRestore: RestartHooks['restore'];
  start(world: string, name: string): void;
  select(kind: number | null): void;
  act(name: string): void;
  upgradeHover(on: boolean): void;
  /** The pointer is on (sign 1 / -1) or has left (0) the rate of these resources: light up the buildings behind it. */
  stockHover(res: number[], sign: number): void;
  /** One tooltip line per building kind behind the rate, plus the non-building sources. */
  stockInfo(res: number[], sign: number): { kind: number; html: string }[];
  /** Centre the camera on the next building behind the rate (of one kind, or of any). Returns false when there is none. */
  stockGo(res: number[], sign: number, kind?: number): boolean;
  speed(n: number): void;
  steward(action: StewardAction): void;
  toggleResources(): void;
  toggleCoverage(): void;
  minimapClick(x: number, z: number): void;
  train(kind: number, n: number): void;
  research(id: number): void;
  bridgeShortcuts(on: boolean): void;
  attack(peerKey: string, units: number[]): void;
  /** March the armies that are selected on the map on a rival village. */
  attackSelected(peerKey: string): void;
  trade(peerKey: string, action: string, res: number, amount: number, escort: number): void;
  focusPeer(key: string): void;
  /** Watch a player's history ('' = your own). */
  watch(key: string): void;
  copyLink(): void;
  cheat(action: number, a: number, b: number): void;
  toggleMute(): void;
  muster(units: number[]): void;
  detAction(action: string, id: number): void;
  /** Set how many workers a building should have (-1 auto, 0 paused). */
  setWorkers(idx: number, n: number): void;
  /** Bulk changes from the work overview: 'auto' every building, 'auto:K' / 'pause:K' every building of kind K. */
  workAll(action: string): void;
  /** Centre the camera on a building and select it. */
  goBuilding(idx: number): void;
}

export interface Hud {
  tick: number; stocks: number[]; rates: number[]; flow?: FlowData; kinds?: number[]; food?: number[]; pop: number; cap: number; sick: number; joy: number; eff: number; jobs: number;
  radius: number; buildings: number; storage: number;
  vitals?: number[]; beds?: number; devotion?: number;
  /** Everybody's work, only filled while the work overview is open. */
  work?: { rows: WorkRow[]; totals: WorkTotals };
  winter?: number[];   // the core's winter_numbers()
  army: number[]; queued: number[]; away: number[]; guards: number; barracks: number; wildlife: number;
  militaryTech: number; bridgeShortcuts: boolean;
}

interface MilitaryUpgrade { id: number; name: string; desc: string; tier: number; prereq: number; cost: [number, number][] }
interface BattleAction { label: string; title: string; run: () => void; icon?: string; disabled?: boolean }
interface RaidBribe { greed: number; offer?: BribeOffer; pay?: () => void }

const BATTLE_TARGET_HINTS: Record<number, string> = {
  1: 'Right-click the position to hold',
  2: 'Right-click the enemy or position to attack',
  3: 'Right-click a safe position to regroup',
  4: 'Right-click a point around the enemy to flank',
};

export interface PeerRow { key: string; name: string; where?: string; online?: boolean; pop: number; buildings: number; sync: string; busy: boolean; rel?: number; married?: boolean; treaties?: number }
const relWord = (r: number) => r >= 80 ? 'devoted' : r >= 50 ? 'friendly' : r >= 20 ? 'warm' : r > -20 ? 'neutral' : r > -50 ? 'cool' : r > -80 ? 'hostile' : 'sworn enemies';

import { parseWinter, winterTip, winterWarning, winterLines } from '../winter';
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const BUILDABLE = defs.filter(d => d.id !== 15).sort((a, b) => a.cat - b.cat || a.id - b.id);
const LEVEL_DESC = 'Levels a round patch of ground to a Target height you choose in the bar (or Auto: the land just outside it): fills pits and cuts bumps, and takes away any ditch or earthworks inside. R changes the size. Buildings in the patch must already stand at that height.';
const findBuildCards = buildSearch([
  ...BUILDABLE.map(d => {
    const category = d.id === 37 || d.id === 38 ? 7 : d.cat;
    return { id: d.id, category, name: d.name,
      outputs: [...d.outputs, ...(d.alternateRecipe?.outputs ?? [])].map(([r]) => RES[r].name),
      keywords: [...(TIER_NAMES[d.id] ?? []), ...(d.id === 35 ? ['harbor', 'dock'] : [])],
      description: `${CATS[category].name} ${d.desc}` };
  }),
  { id: LEVEL_TOOL, category: defs[33].cat, name: 'Level Ground', keywords: ['flatten', 'terrain'], description: `Land ${LEVEL_DESC}` },
]);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  canvas!: HTMLCanvasElement;
  minimap!: HTMLCanvasElement;
  private cards = new Map<number, HTMLElement>();
  private pills: HTMLElement[] = [];
  private filter = -1;
  private buildResults: number[] = [];
  private tab = 'build';
  private logCount = 0;
  private peers: PeerRow[] = [];
  private armyShown = '';
  private militaryUpgrades: MilitaryUpgrade[] = [];

  constructor(private h: Handlers, world: string, name: string) {
    document.getElementById('app')!.innerHTML = this.template(world, name);
    this.canvas = $('gl') as HTMLCanvasElement;
    this.minimap = $('minimap') as HTMLCanvasElement;
    this.bind();
    this.buildCards();
    this.buildCheats();
    this.buildMuster();
    this.initPanels();
    this.buildKeyTable();
    keys.onChange(() => this.buildKeyTable());
    this.buildStock();
    this.buildPills();
    this.buildUnits();
  }

  private template(world: string, name: string) {
    return `
<div id="stage"><canvas id="gl"></canvas><div class="vignette"></div><div id="labels"></div></div>
<header class="topbar" hidden id="topbar">
  <div class="brand"><h1>Flanders</h1><span class="sub" id="sub">Day 1 · Spring</span></div>
  <div class="treasury" id="treasury"></div>
  <div class="vitals">
    <span class="pill" id="v-pop" title="Villagers / housing"><span class="ic">${icon('pop', 16)}</span><b>0</b></span>
    <span class="pill" id="v-army" title="Soldiers in your army"><span class="ic">${icon('army', 16)}</span><b>0</b></span>
    <span class="pill" id="v-sick" title="Villagers sick with plague"><span class="ic">${icon('plague', 16)}</span><b>0</b></span>
    <span class="pill" id="v-joy" title="Happiness: gardens, parks, chapels, markets and courts lift it; hunger, plague and overcrowding lower it. Happy villages grow faster and pay more tax."><span class="ic">${icon('happy', 16)}</span><b>50</b></span>
    <span class="pill" id="v-work" title="Workforce efficiency: jobs vs. available workers. Click for the work overview, where you can assign villagers."><span class="ic">${icon('work', 16)}</span><b>100%</b></span>
  </div>
  <div class="tools">
  <div class="speed" id="speed">
    <button class="btn" data-s="0" title="Pause"><svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.6" height="12" rx=".6"/><rect x="9.4" y="2" width="3.6" height="12" rx=".6"/></svg></button>
    <button class="btn on" data-s="1" title="Normal speed (calm)"><svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6z"/></svg></button>
    <button class="btn" data-s="2" title="Fast x2"><svg viewBox="0 0 16 16"><path d="M1 2l7 6-7 6zM8 2l7 6-7 6z"/></svg></button>
    <button class="btn" data-s="4" title="Very fast x4"><svg viewBox="0 0 16 16"><path d="M0 3l5.4 5L0 13zM5.3 3l5.4 5-5.4 5zM10.6 3L16 8l-5.4 5z"/></svg></button></div>
  <button class="btn" id="btn-mp" title="Players in this world">${bi('globe')} <span id="mp-count">Online</span></button>
  <button class="btn" id="btn-steward" title="Away policy and village recovery">${bi('townhall')} <span id="watch-label">Steward</span></button>
  <button class="btn" id="btn-map" title="Full-screen map (M)">${bi('map')} Map</button>
  <button class="btn" id="btn-cov" aria-pressed="false" title="Show how far wells and towers reach, and what they leave unprotected (C)">${bi('coverage')} Show coverage</button>
  <div class="menuwrap">
    <button class="btn" id="btn-menu" title="Menu: display settings, sound, deposits, full screen, help" aria-haspopup="true" aria-expanded="false">${bi('menu')} Menu</button>
    <div id="menu" hidden>
      <button class="btn" id="btn-display" title="Quality, shadows, anti-aliasing…">${bi('gear')} Display settings</button>
  <button class="btn" id="btn-sound" title="Sound on / off"><svg viewBox="0 0 16 16" id="snd-on"><path d="M2 6h3l4-3v10l-4-3H2z"/><path d="M11 5.2a4 4 0 0 1 0 5.6M12.8 3.6a6.3 6.3 0 0 1 0 8.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><svg viewBox="0 0 16 16" id="snd-off" hidden><path d="M2 6h3l4-3v10l-4-3H2z"/><path d="M11 6l4 4M15 6l-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span class="ml">Sound on / off</span></button>
      <button class="btn" id="btn-res" aria-pressed="false" title="Show ore and stone deposits (V)">${bi('pick')} Show deposits</button>
      <button class="btn" id="btn-full" title="Full-screen mode (F11)">${bi('fullscreen')} Full screen</button>
      <button class="btn" id="btn-help">? Help and keys</button>
      <button class="btn" id="btn-cheat" hidden title="Testing tools">${bi('tools')} Test tools</button>
    </div>
  </div>
  </div>
</header>
<div id="battle" hidden>
  <div id="battle-text"></div>
  <div id="battle-bribe" hidden>
    <button type="button" id="battle-pay" class="pbtn">${bi('gold')} <span id="battle-pay-label"></span></button>
    <span class="raid-greed" title="Higher greed makes future raids earlier, stronger and more expensive to pay off. It fades each day.">Greed <b id="battle-greed" aria-live="polite">0</b></span>
  </div>
</div>
<button id="hall-exit" class="btn go" hidden>← Leave the test hall</button>
<aside id="ledger" hidden>
  <div class="tabs" id="tabs">
    <button class="tab on" data-t="build">Build</button><button class="tab" data-t="army">Army</button><button class="tab" data-t="village">Village</button><button class="tab" data-t="stock">Stock</button><button class="tab" data-t="sel" id="tab-sel" hidden>Selected</button><button class="tabmin" id="ledger-min" title="Hide the panel (H)">▸</button>
  </div>
  <section class="pane on" id="pane-build">
    <div class="build-find" role="search" aria-label="Building catalog">
      <div class="build-search">
        ${bi('search', 18)}
        <input id="build-search" type="search" placeholder="Search buildings, tools or outputs…" aria-label="Search buildings, tools or outputs" aria-controls="cards" autocomplete="off">
        <button type="button" id="build-clear" aria-label="Clear search" title="Clear search" hidden>${bi('close', 14)}</button>
      </div>
      <div class="chips" id="cats" role="group" aria-label="Building categories"></div>
      <p id="build-count" class="muted tiny" role="status"></p>
    </div>
    <div id="build-results">
      <div class="cards" id="cards"></div>
      <div id="build-empty" hidden><p class="muted">No matching buildings or tools.</p><button type="button" id="build-reset" class="chip">Clear filters</button></div>
      <p id="build-help" class="muted">Pick a building, then click the ground. <b>R</b> rotates, <b>Esc</b> cancels. Buildings level the ground beneath them and clear the trees.</p>
    </div>
  </section>
  <section class="pane" id="pane-army">
    <div><div class="eyebrow">Military</div><h2>Army</h2></div>
    <div class="stats five" id="army-stats"></div>
    <p class="muted" id="army-info"></p>
    <div class="sect"><h3>Field armies</h3>
      <div id="det-list" class="armies"></div>
      <p class="muted tiny">Click an army's banner (or press <b>Tab</b>) to select it, then <b>right-click</b> the ground to march. <b>G</b> halts it, <b>B</b> sends it home. Armies walk round buildings, fell trees in their way and bridge or ferry over water.</p>
      <label class="tiny" title="Armies may spend planks to shorten new routes across water. With shortcuts off, they build only if no route over land or an existing bridge is available."><input id="army-bridging" type="checkbox"> Allow automatic bridge shortcuts</label>
    </div>
    <div class="sect" id="attack-box"><h3>Rival villages</h3><div id="attack-form"></div></div>
    <details class="sect" id="muster-box"><summary>Muster a new army</summary>
      <p class="muted tiny">Take soldiers out of the barracks into a field army.</p>
      <div class="mrows" id="muster-row"></div>
      <div class="btnrow"><button class="pbtn" id="muster-go">${bi('muster')} Muster</button><button class="pbtn primary" id="muster-all">Everyone <span class="key">F</span></button></div>
    </details>
    <details class="sect" open><summary>Train soldiers</summary><div class="cards" id="unit-cards"></div></details>
    <details class="sect"><summary>Armory upgrades</summary><div class="cards" id="military-upgrades"></div></details>
    <p class="muted tiny">Towers, the hall and your standing army defend the village. Bandits raid from time to time: stone buildings resist fire, wells and walls help too.</p>
  </section>
  <section class="pane" id="pane-village">
    <div><div class="eyebrow" id="v-sub">Your settlement</div><h2>The Village</h2></div>
    <div class="btnrow"><button class="pbtn" data-steward="open">${bi('townhall')} Village steward</button></div>
    <div class="stats"><div class="stat"><b id="s-pop">0</b><span>Villagers</span></div><div class="stat"><b id="s-cap">0</b><span>Housing</span></div><div class="stat"><b id="s-sick">0</b><span>Sick</span></div></div>
    <div class="stats"><div class="stat"><b id="s-eff">0%</b><span>Workforce</span></div><div class="stat"><b id="s-bld">0</b><span>Buildings</span></div><div class="stat"><b id="s-rad">0</b><span>Border radius</span></div></div>
    <div><h3>Health &amp; death care</h3><div class="stats" id="care-stats"></div><p class="muted" id="care-info"></p></div>
    <div><div class="eyebrow">Housing used</div><div class="bar"><i id="b-house" style="width:0"></i></div></div>
    <div><div class="eyebrow">Storage (per resource)</div><div class="bar"><i id="b-store" style="width:0"></i></div><p class="muted" id="t-store"></p></div>
    <div><h3>Your flag</h3><div id="flag-design"></div></div>
    <div><h3>Neighbours</h3><ul class="log" id="peer-list"><li class="muted">Nobody else is here yet.</li></ul></div>
    <div><h3>Chronicle</h3><ul class="log" id="log"><li><small>Day 1</small> Your people have arrived. Build houses and farms, and find stone, clay, iron and gold nearby.</li></ul></div>
  </section>
  <section class="pane" id="pane-stock">
    <div><div class="eyebrow">Warehouse</div><h2>Stock &amp; Industry</h2></div>
    <table class="res" id="restable"></table>
    <div><h3>Production chains</h3><div class="chain">
      ${icon('wood', 16)} Wood <span class="arrow">→</span> Sawmill <span class="arrow">→</span> ${icon('planks', 16)} Planks<br>
      ${icon('wood', 16)} Wood <span class="arrow">→</span> Charcoal Burner <span class="arrow">→</span> ${icon('charcoal', 16)} Charcoal<br>
      ${icon('clay', 16)} Clay + ${icon('charcoal', 16)} <span class="arrow">→</span> Brickworks <span class="arrow">→</span> ${icon('bricks', 16)} Bricks<br>
      ${icon('ironore', 16)} Iron ore + ${icon('charcoal', 16)} <span class="arrow">→</span> Smelter <span class="arrow">→</span> ${icon('iron', 16)} Iron<br>
      ${icon('iron', 16)} Iron + ${icon('charcoal', 16)} <span class="arrow">→</span> Blacksmith <span class="arrow">→</span> ${icon('tools', 16)} Tools<br>
      ${icon('goldore', 16)} Gold ore + ${icon('charcoal', 16)} <span class="arrow">→</span> Mint <span class="arrow">→</span> ${icon('gold', 16)} Gold<br>
      ${icon('deer', 16)} Hunters <span class="arrow">→</span> Hunter's Lodge <span class="arrow">→</span> ${icon('meat', 16)} Meat<br>
      Fishing Hut <span class="arrow">→</span> ${icon('fish', 16)} Fish + ${icon('wood', 16)} <span class="arrow">→</span> Smokehouse <span class="arrow">→</span> ${icon('smokedfish', 16)} Smoked fish (or ${icon('meat', 16)} Meat + ${icon('wood', 16)} <span class="arrow">→</span> ${icon('smokedmeat', 16)} Smoked meat, when set to meat)<br>
      Farm <span class="arrow">→</span> ${icon('grain', 16)} Grain + ${icon('wood', 16)} <span class="arrow">→</span> Bakery <span class="arrow">→</span> ${icon('bread', 16)} Bread. Cooked food fills more than raw: the village eats from all its stores together.</div>
      <p class="muted" style="margin-top:6px">Mines and quarries must stand beside a deposit — press <b>V</b> to reveal them. Rates are per minute.</p></div>
  </section>
  <section class="pane" id="pane-sel"></section>
</aside>
<div id="minimap-card" hidden><div class="cap" id="mm-cap" title="Hide / show the minimap (M)"><span>REALM</span><span id="mm-hint">click to travel</span><i id="mm-full" title="Full-screen map (M)">${bi('fullscreen', 14)}</i><b id="mm-chev">▾</b></div><canvas id="minimap" width="190" height="190"></canvas></div>
<div id="goals" hidden><div class="gh" id="goals-head" title="Collapse"><b>Goals</b><span id="goals-count"></span><b id="goals-chev">▾</b></div><ul id="goal-list"></ul></div>
<button id="ledger-open" hidden title="Show the panel (H)">◂</button>
<div class="overlay clear" id="worldmap" hidden><div class="mapwrap"><div class="maphead"><b>The Realm</b><span class="muted">Click anywhere to travel there · Esc to close</span><button class="btn" data-close="worldmap">${bi('close', 14)}</button></div><canvas id="bigmap" width="900" height="900"></canvas></div></div>
<div id="ctxmenu" hidden></div><div id="selbox" hidden></div>
<div id="toasts"></div>
<div id="tool-dock">
  <div id="hint" hidden></div>
  <section id="battle-controls" class="tool-panel" aria-label="Battle controls" hidden>
    <div id="battle-orders" class="tool-row">
      <label class="tool-select">
        <select id="battle-group" aria-label="Troop group"><option value="4">All troops</option><option value="0">Infantry</option><option value="1">Archers</option><option value="2">Knights</option><option value="3">Siege</option></select>
      </label>
      <button type="button" class="tool-action" data-order="1" aria-pressed="false" title="Hold this point. Spearmen brace against enemies in front of them.">Hold line</button>
      <button type="button" class="tool-action" data-order="2" aria-pressed="false" title="Advance and focus on enemies near the point">Attack here</button>
      <button type="button" class="tool-action" data-order="3" aria-pressed="false" title="Break contact and regroup at a point">Fall back</button>
      <button type="button" class="tool-action" data-order="4" aria-pressed="false" title="Move around the enemy to the selected flank before engaging">Flank</button>
      <button type="button" class="tool-action" data-order="0" title="Clear the selected troop group's order">Clear order</button>
    </div>
    <div id="battle-acts" class="tool-row"></div>
    <div id="battle-current-orders" hidden></div>
    <div id="battle-target-hint" role="status" hidden></div>
  </section>
</div>
<div id="tooltip" hidden></div>

<div class="overlay" id="loader" hidden>
  <div class="sheet loading"><h1>Flanders</h1><div class="tag" id="ltext">Preparing the world…</div><div class="lbar"><i id="lbar-i"></i></div><p class="muted" id="ltip"></p></div>
</div>
<div class="overlay" id="intro">
  <div class="sheet">
    <h1>Flanders</h1>
    <div class="tag">One shared medieval world. Found a village, raise a castle, defend it — or march on your neighbours.</div>
    <hr>
    <div class="userfield"><div><label for="username">Your name</label><input id="username" value="${esc(name)}" maxlength="20" spellcheck="false" autocomplete="off"></div><div><label for="world">World</label><select id="world">${worldOptions(world)}</select><input id="world-custom" placeholder="Name your world" maxlength="30" spellcheck="false" autocomplete="off" hidden></div></div>
    <p class="muted">Everyone who enters the same world shares the same lands. Other players see your name over your town hall.</p>
    <div class="flagrow"><button type="button" class="flagmini" id="flag-mini" title="Design your flag"><canvas width="60" height="40"></canvas></button><div><b>Your flag</b><div class="muted">Click it to design your own.</div></div></div>
    <div class="btnrow"><button class="pbtn primary" id="found">Enter the world</button></div>
    <p class="muted">There is no game server: every player runs a copy of the game and your browsers connect to each other. Your village is saved in this browser and keeps growing while you are away.</p>
    <div class="btnrow"><button class="pbtn" id="home-keys-btn">${bi('keys')} Controls and keybindings</button><button class="pbtn" id="home-display-btn">${bi('gear')} Display settings</button></div>
    <p class="muted tiny verline"><span id="home-version" title="The build you are running. The rules fingerprint to compare with other players is under The shared world, once you are in.">${esc(versionLabel())}</span> · <a href="#" id="home-notes-btn">Release notes</a></p>
  </div>
</div>
<div class="overlay" id="notes" hidden style="z-index:21">
  <div class="sheet wide"><h2>Release notes</h2><p class="muted tiny">${esc(versionLabel())}</p><div id="notes-body">${renderNotes()}</div>
    <div class="btnrow"><button class="pbtn primary" data-close="notes">Back</button></div></div>
</div>
<div class="overlay" id="flag-page" hidden style="z-index:21">
  <div class="sheet"><h2>Design your flag</h2><p class="muted">It flies over your town hall, your towers and your banners. You can change it later from the Village tab.</p><div id="intro-flag"></div>
    <div class="btnrow"><button class="pbtn primary" id="flag-done">Done</button></div></div>
</div>
<div class="overlay clear" id="display" hidden>
  <div class="sheet wide"><h2>Display settings</h2><p class="muted">Saved in this browser. These only change how the game looks on your screen, never the game itself.</p>
    <div id="display-body"></div>
    <div class="btnrow"><button class="pbtn primary" data-close="display">Done</button></div></div>
</div>
<div class="overlay" id="restart" hidden style="z-index:39">
  <div class="sheet wide"></div>
</div>
<div class="overlay" id="confirm" hidden style="z-index:40">
  <div class="sheet"><h2 id="confirm-title">Are you sure?</h2><p id="confirm-text"></p>
    <div class="btnrow"><button class="pbtn" id="confirm-no">Cancel</button><button class="pbtn primary" id="confirm-yes">Yes</button></div></div>
</div>
<div class="overlay clear" id="help" hidden>
  <div class="sheet">
    <h2>How to rule</h2>
    <div class="keytable" id="keytable"></div>
    <p class="muted" id="help-mouse"></p>
    <div class="btnrow"><button class="pbtn" id="keys-reset">Reset keys to default</button></div>
    <p class="muted">Feed your people, then dig for stone, clay, iron and gold. Hunters keep the larder full. Build a barracks, train soldiers and man your towers: bandits will come, and fire spreads fast through thatch. Siege engines scar the land with craters; stone and wells keep fires small.</p>
    <div class="btnrow"><button class="pbtn primary" data-close="help">Done</button></div>
  </div>
</div>
<div class="overlay clear" id="cheats" hidden>
  <div class="sheet">
    <h2>Testing tools</h2>
    <p class="muted">For testing only. These actions are signed and sent to other players like any other command. They appear because you are running locally (or added <b>?cheats=1</b> to the address).</p>
    <div id="cheat-res" class="cheatgrid"></div>
    <div class="btnrow" style="flex-wrap:wrap">
      <button class="pbtn" data-ch="3,0,0">Fill every store</button><button class="pbtn" data-ch="1,10,0">+10 villagers</button><button class="pbtn" data-ch="6,0,0">Cure plague</button><button class="pbtn" data-ch="9,0,0">Start plague</button>
    </div>
    <h3>Soldiers</h3><div class="btnrow" style="flex-wrap:wrap" id="cheat-army"></div>
    <h3>Village</h3><div class="btnrow"><button class="pbtn primary" data-ch="100,0,0">${bi('house')} Build a model village</button><button class="pbtn" data-ch="103,0,0" title="Every building at every tier, plus the design options">${bi('townhall')} Test hall: all buildings</button></div>
    <h3>Ground</h3><div class="btnrow" style="flex-wrap:wrap"><label class="muted" for="flat-height">Target height</label><input id="flat-height" type="number" min="0" max="24" step="0.5" value="5" style="width:76px"><button class="pbtn" data-flat-radius="30">${bi('pen-rect')} Level 30</button><button class="pbtn" data-flat-radius="50">${bi('pen-rect')} Level 50</button><button class="pbtn" data-flat-radius="72">${bi('pen-rect')} Level 72</button></div><small class="muted">Levels the ground around your town hall to this height. No materials required.</small>
    <h3>Repair</h3><div class="btnrow" style="flex-wrap:wrap"><button class="pbtn" data-ch="7,0,0">${bi('water')} Extinguish all fires</button><button class="pbtn" data-ch="8,0,0">${bi('raiseground')} Reset terrain</button><button class="pbtn danger" data-ch="101,0,0">${bi('reset')} Full reset (all villages)</button></div>
    <h3>Trouble</h3>
    <div class="btnrow" style="flex-wrap:wrap"><button class="pbtn danger" data-ch="4,90,200">Small raid</button><button class="pbtn danger" data-ch="4,200,700">Big raid</button><button class="pbtn danger" data-ch="5,-1,0">Burn selected building</button></div>
    <div class="btnrow"><button class="pbtn primary" data-close="cheats">Close</button></div>
  </div>
</div>
<div class="overlay clear" id="flow" hidden>
  <div class="sheet flowsheet"><h2 id="flow-title"></h2><div id="flow-body"></div>
    <div class="btnrow"><button class="pbtn primary" data-close="flow">Close</button></div></div>
</div>
<div class="overlay clear" id="work" hidden>
  <div class="sheet flowsheet worksheet"><h2 id="work-title">${icon('work', 26)} Work</h2><div id="work-body"></div>
    <div class="btnrow"><button class="pbtn primary" data-close="work">Close</button></div></div>
</div>
<div class="overlay clear" id="winter" hidden>
  <div class="sheet flowsheet"><h2 id="winter-title"></h2><div id="winter-body"></div>
    <div class="btnrow"><button class="pbtn primary" data-close="winter">Close</button></div></div>
</div>
<div class="overlay clear" id="steward" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="steward-title">
    <h2 id="steward-title" tabindex="-1">${bi('townhall', 26)} Village steward</h2>
    <p id="watch-report" role="status" hidden></p>
    <div>
      <h3>When you step away</h3>
      <p class="muted">This applies in a hidden tab or after two minutes without input. Closing the game saves and stops the village.</p>
      <div class="btnrow wrap" role="group" aria-label="Away policy">
        <button class="pbtn" data-steward="pause" aria-pressed="true">Pause village</button>
        <button class="pbtn" data-steward="steward" aria-pressed="false">Let steward work</button>
      </div>
      <p class="muted" id="watch-policy"></p>
    </div>
    <div>
      <h3>Village report</h3>
      <p id="watch-stores"></p>
      <ul class="watch-risks" id="watch-risks" hidden></ul>
      <div class="btnrow wrap" aria-label="Recovery">
        <button class="pbtn" data-steward="food">${bi('grain')} Food supply</button>
        <button class="pbtn" data-steward="wood">${bi('cold')} Winter supplies</button>
        <button class="pbtn" data-steward="work">${bi('work')} Workers</button>
        <button class="pbtn" data-steward="market" hidden>${bi('gold')} Visit market</button>
        <button class="pbtn" data-steward="ruins" hidden>${bi('tools')} Find a ruin</button>
      </div>
    </div>
    <div class="btnrow">
      <button class="pbtn" id="watch-close">Close</button>
      <button class="pbtn primary" data-steward="resume" hidden>Resume village</button>
    </div>
  </div>
</div>
<div class="overlay clear" id="mp" hidden>
  <div class="sheet">
    <h2>The shared world</h2>
    <p class="muted">Everyone who enters world <b id="mp-world"></b> lives on the same map. Your browser connects directly to the other players — nothing is stored on a server, and commands are signed so nobody can forge your moves.</p>
    <p class="muted tiny" id="mp-build" title="Players with a different rules fingerprint run different game rules and will see different villages for each other">${esc(versionLabel())}</p>
    <div class="netstat" id="net-status">Looking for other players…</div>
    <ul class="log" id="mp-peers"></ul>
    <div class="btnrow"><button class="pbtn" id="mp-copy">${bi('copy')} Copy invite link</button><button class="pbtn primary" data-close="mp">Close</button></div>
    <p class="muted">To invite someone, send them the link. To keep a private world, enter a different world name on the title screen.</p>
  </div>
</div>`;
  }

  private bind() {
    const wsel = $('world') as HTMLSelectElement, wcus = $('world-custom') as HTMLInputElement;
    // the chosen map is kept in the address bar, so copying the address (or the invite button) always gives friends the same map
    const showWorld = () => { const w = wsel.value === '__custom' ? wcus.value.trim() : wsel.value; if (w) history.replaceState(null, '', withWorld(location.href, w)); };
    wsel.onchange = () => { wcus.hidden = wsel.value !== '__custom'; if (!wcus.hidden) wcus.focus(); showWorld(); };
    wcus.addEventListener('input', showWorld); showWorld();
    // the flag is chosen before the village exists and flown as soon as it does; the start screen only shows a small flag, and a click opens the designer page
    const mini = $('flag-mini').querySelector('canvas') as HTMLCanvasElement; paintFlag(mini, loadFlag());
    mountFlagDesigner($('intro-flag'), loadFlag(), f => { saveFlag(f); paintFlag(mini, f); });
    $('flag-mini').onclick = () => { $('flag-page').hidden = false; }; $('flag-done').onclick = () => { $('flag-page').hidden = true; };
    $('home-notes-btn').onclick = e => { e.preventDefault(); this.modal('notes', true); };
    $('home-keys-btn').onclick = () => this.modal('help', true); $('home-display-btn').onclick = () => this.modal('display', true);   // separate pages, also before the game starts
    // rebinding a key must work on the start page too, before the game's own key handler exists
    document.addEventListener('keydown', e => { this.captureKey(e); }, true);
    { const h = () => { $('help-mouse').innerHTML = controlsHtml() + ' Number keys <b>1-9</b> pick a building on any keyboard layout.'; }; h(); keys.onChange(h); }
    $('found').onclick = () => { const s = cleanWorld(wsel.value === '__custom' ? wcus.value : wsel.value), n = ($('username') as HTMLInputElement).value.replace(/[<>]/g, '').trim().slice(0, 20) || 'Traveller'; this.h.start(s, n); };
    ($('username') as HTMLInputElement).onkeydown = wcus.onkeydown = e => { if (e.key === 'Enter') $('found').click(); };
    $('tabs').onclick = e => { const t = (e.target as HTMLElement).dataset.t; if (t) this.setTab(t); };
    $('cats').innerHTML = `<button type="button" class="chip" data-c="-1">All</button>` + CATS.map((c, i) => `<button type="button" class="chip" data-c="${i}">${bi(c.icon, 15)} ${c.name}</button>`).join('');
    $('cats').onclick = e => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c; if (c === undefined) return;
      this.filter = Number(c);
      this.updateBuildResults();
    };
    const search = $<HTMLInputElement>('build-search');
    search.oninput = () => this.updateBuildResults();
    const clearSearch = () => { search.value = ''; this.updateBuildResults(); search.focus(); };
    $('build-clear').onclick = clearSearch;
    $('build-reset').onclick = () => { this.filter = -1; clearSearch(); };
    search.onkeydown = e => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (search.value) clearSearch(); else search.blur(); }
      if (e.key === 'Enter' && /[\p{L}\p{N}]/u.test(search.value) && this.buildResults.length) {
        e.preventDefault(); this.cards.get(this.buildResults[0])?.click(); search.blur();
      }
    };
    $('army-bridging').onchange = e => this.h.bridgeShortcuts((e.target as HTMLInputElement).checked);
    $('military-upgrades').onclick = e => { const id = (e.target as HTMLElement).closest('button')?.dataset.research; if (id !== undefined) this.h.research(Number(id)); };
    $('speed').onclick = e => { const s = (e.target as HTMLElement).dataset.s; if (s !== undefined) this.h.speed(Number(s)); };
    { const menu = $('menu'), btn = $('btn-menu'), close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
      btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); };
      menu.addEventListener('click', e => { if ((e.target as HTMLElement).closest('.btn') && !(e.target as HTMLElement).closest('#btn-sound,#btn-res')) close(); });   // choosing something closes the menu (sound and deposits are toggles: it stays)
      document.addEventListener('pointerdown', e => { if (!menu.hidden && !(e.target as HTMLElement).closest('.menuwrap')) close(); });
      addEventListener('keydown', e => { if (e.key === 'Escape') close(); }); }
    $('btn-res').onclick = () => this.h.toggleResources();
    $('btn-cov').onclick = () => this.h.toggleCoverage();
    $('btn-sound').onclick = () => this.h.toggleMute();
    this.initTitleTips();
    $('sub').onclick = () => { this.modal('winter', true); if (this.lastHud) this.renderWinter(this.lastHud); };
    $('btn-help').onclick = () => this.modal('help', true);
    const restart = mountRestart($('restart'), { info: () => this.h.restartInfo(), run: () => this.h.restartRun(), restore: () => this.h.restartRestore(), backup: () => downloadBackup(), toast: (t, k) => this.toast(t, k) });
    $('btn-display').onclick = () => { this.modal('display', true); void restart.drawSection($('restart-section')); };
    mountSettings($('display-body'), () => this.toast('Anti-aliasing is chosen when the page loads: reload to apply it.', 'info'), () => { this.modal('display', false); this.h.watch(''); });
    $('btn-mp').onclick = () => this.modal('mp', true);
    $('btn-steward').onclick = () => this.h.steward('open');
    document.querySelectorAll<HTMLButtonElement>('[data-steward]').forEach(button => {
      button.onclick = () => this.h.steward(button.dataset.steward as StewardAction);
    });
    const closeWatch = () => { this.modal('steward', false); $('btn-steward').focus(); };
    $('watch-close').onclick = closeWatch;
    $('steward').onkeydown = e => {
      if (e.key === 'Escape') { e.stopPropagation(); closeWatch(); }
    };
    $('v-work').onclick = () => this.openWork();
    $('work-body').onclick = e => this.workClick(e); $('work-body').onchange = e => this.workChange(e);
    for (const id of ['work-body', 'pane-sel']) $(id).addEventListener('pointerdown', e => { if ((e.target as HTMLElement).matches?.('input[type=range]')) this.sliding = true; });
    addEventListener('pointerup', () => { setTimeout(() => (this.sliding = false), 0); });
    $('pane-sel').oninput = e => { const t = e.target as HTMLInputElement; if (t.dataset.wk !== undefined) { const o = t.parentElement?.querySelector('.wkval'); if (o) o.textContent = t.value; } };
    $('pane-sel').addEventListener('change', e => { const t = e.target as HTMLInputElement; if (t.dataset.wk !== undefined) this.h.act(`wk:set:${t.value}`); });
    $('flow-body').onclick = e => {   // "Show on map": close the breakdown and look at the next building of that kind
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-show]'); if (!b) return;
      const [res, sign, kind] = b.dataset.show!.split(':').map(Number);
      this.modal('flow', false); this.h.stockGo([res], sign, kind);
    };
    document.querySelectorAll<HTMLElement>('[data-close]').forEach(b => b.onclick = () => this.modal(b.dataset.close!, false));
    $('mp-copy').onclick = () => { this.h.copyLink(); $('mp-copy').innerHTML = `${bi('check')} Copied`; setTimeout(() => ($('mp-copy').innerHTML = `${bi('copy')} Copy invite link`), 1800); };
    { const up = (e: Event) => this.h.upgradeHover(!!(e.target as HTMLElement).closest('[data-act="upgrade"]'));   // hovering Upgrade outlines the bigger building
      $('pane-sel').onmouseover = up; $('pane-sel').onmouseleave = () => this.h.upgradeHover(false); }
    $('pane-sel').onclick = e => { const a = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (a && !(a as HTMLButtonElement).disabled) this.h.act(a.dataset.act!); };
    $('btn-map').onclick = () => this.toggleMap(); $('btn-full').onclick = () => toggleFullscreen(); $('mm-full').onclick = e => { e.stopPropagation(); this.toggleMap(); };
    $('bigmap').onclick = e => { const r = $('bigmap').getBoundingClientRect(); this.h.minimapClick(((e.clientX - r.left) / r.width - 0.5) * HALF * 2, ((e.clientY - r.top) / r.height - 0.5) * HALF * 2); this.toggleMap(false); };
    // the browser's own context menu never shows: right-click belongs to the game
    addEventListener('contextmenu', e => e.preventDefault(), true);
    addEventListener('selectstart', e => { if (!(e.target as Node).parentElement?.closest('input,textarea')) e.preventDefault(); });
    addEventListener('dragstart', e => e.preventDefault());
    addEventListener('pointerdown', e => { if (!(e.target as HTMLElement).closest?.('#ctxmenu')) this.closeCtx(); }, true);
    addEventListener('wheel', () => this.closeCtx(), { passive: true }); addEventListener('blur', () => this.closeCtx());
    addEventListener('keydown', e => { if (e.key === 'Escape') this.closeCtx(); });
    document.addEventListener('fullscreenchange', () => { $('btn-full').innerHTML = document.fullscreenElement ? `${bi('windowed')} Leave full screen` : `${bi('fullscreen')} Full screen`; });
    $('minimap').onclick = e => {
      const r = this.minimap.getBoundingClientRect();
      this.h.minimapClick(((e.clientX - r.left) / r.width - 0.5) * HALF * 2, ((e.clientY - r.top) / r.height - 0.5) * HALF * 2);
    };
    $('pane-village').onclick = $('mp').onclick = e => { const wb = (e.target as HTMLElement).closest<HTMLElement>('[data-watch]'); if (wb) { this.modal('mp', false); this.h.watch(wb.dataset.watch!); return; } const b = (e.target as HTMLElement).closest<HTMLElement>('[data-peer]'); if (b) { this.h.focusPeer(b.dataset.peer!); this.modal('mp', false); } };
    addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.matches?.('input,textarea')) return;
      if (e.key === 'Escape') { document.querySelectorAll('.overlay.clear').forEach(o => ((o as HTMLElement).hidden = true)); }
    });
    // a click on the dimmed backdrop (outside the sheet) closes any pop-up
    document.querySelectorAll<HTMLElement>('.overlay.clear').forEach(o => o.addEventListener('pointerdown', e => { if (e.target === o) o.hidden = true; }));
  }

  // ---- loading screen ----
  private tips = ['Hunters keep the larder full if a forest is near.', 'Stone buildings shrug off fire; thatch does not.', 'Wells and chapels keep the plague away. When it comes it lasts 10 to 20 days: it spreads, peaks and fades, and a hospital, a chapel, a graveyard and a quarantine save lives.', 'Paths appear on their own between your buildings.', 'Press V to reveal ore and stone deposits.', 'Your village pauses while you are away. The steward can oversee a day of routine work if you choose.', 'Walls link up by themselves when placed close together.'];
  private lastPhase = '';   // (each phase of the loading screen leaves a performance mark, so a slow start can be read off the timeline)
  beginLoading() { $('intro').hidden = true; $('loader').hidden = false; $('ltip').textContent = this.tips[Math.floor(Math.random() * this.tips.length)]; this.progress(1, 'Preparing the world…'); }
  progress(p: number, text: string) { if (text !== this.lastPhase) { this.lastPhase = text; performance.mark('load: ' + text); } ($('lbar-i') as HTMLElement).style.width = p + '%'; $('ltext').textContent = text; }
  private finishLoading() { ($('lbar-i') as HTMLElement).style.width = '100%'; const l = $('loader'); l.style.transition = 'opacity .5s'; l.style.opacity = '0'; setTimeout(() => { l.hidden = true; l.style.opacity = ''; l.style.transition = ''; }, 520); }

  // ---- collapsible panels (remembered between visits) ----
  private pref: { ledger?: boolean; map?: boolean; goals?: boolean } = {};
  private initPanels() {
    try { this.pref = JSON.parse(localStorage.getItem('flanders:ui') ?? '{}'); } catch { this.pref = {}; }
    $('ledger-min').onclick = () => this.toggleLedger(); $('ledger-open').onclick = () => this.toggleLedger();
    $('mm-cap').onclick = () => this.toggleMinimap(); $('goals-head').onclick = () => this.toggleGoals();
    this.applyPanels();
  }
  private savePrefs() { try { localStorage.setItem('flanders:ui', JSON.stringify(this.pref)); } catch { /* ignore */ } this.applyPanels(); }
  private applyPanels() {
    const shut = !!this.pref.ledger && !this.tempOpen;
    $('ledger').classList.toggle('min', shut); $('ledger-open').hidden = !shut || $('ledger').hidden;
    $('minimap-card').classList.toggle('min', !!this.pref.map); $('mm-chev').textContent = this.pref.map ? '▸' : '▾';
    $('goals').classList.toggle('min', !!this.pref.goals); $('goals-chev').textContent = this.pref.goals ? '▸' : '▾';
  }
  /** Set while the panel is folded away but opened for a selected building; it folds away again when the selection ends. */
  private tempOpen = false;
  /** The button that leaves the test hall, shown while inside it. */
  hallExit(on: boolean, leave: () => void) { const b = $('hall-exit'); b.hidden = !on; b.onclick = leave; }
  toggleLedger() { if (this.tempOpen) { this.tempOpen = false; this.applyPanels(); return; } this.pref.ledger = !this.pref.ledger; this.savePrefs(); }
  toggleMinimap() { this.pref.map = !this.pref.map; this.savePrefs(); }
  get bigmap() { return $('bigmap') as HTMLCanvasElement; }
  mapOpen() { return !$('worldmap').hidden; }
  toggleMap(show = $('worldmap').hidden) { $('worldmap').hidden = !show; }

  /** The in-game right-click menu. `items` with no `run` are headings; '-' is a divider. */
  ctxMenu(x: number, y: number, title: string, items: ({ label: string; sub?: string; disabled?: boolean; run?: () => void } | '-')[]) {
    const m = $('ctxmenu');
    m.innerHTML = `<div class="ctx-title">${esc(title)}</div>` + items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" ${it.disabled ? 'disabled' : ''}><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('');
    m.hidden = false;
    m.onclick = e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]'); if (!b || b.disabled) return; const it = items[Number(b.dataset.i)]; this.closeCtx(); if (it !== '-') it.run?.(); };
    const w = m.offsetWidth, h = m.offsetHeight; m.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + 'px'; m.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + 'px';
  }
  closeCtx() { const m = document.getElementById('ctxmenu'); if (m) m.hidden = true; }
  ctxOpen() { return !$('ctxmenu').hidden; }

  /** The rubber band for drag-selecting armies (screen pixels), or null to hide it. */
  selBox(r: { x0: number; y0: number; x1: number; y1: number } | null) {
    const b = $('selbox'); b.hidden = !r; if (!r) return;
    b.style.left = Math.min(r.x0, r.x1) + 'px'; b.style.top = Math.min(r.y0, r.y1) + 'px'; b.style.width = Math.abs(r.x1 - r.x0) + 'px'; b.style.height = Math.abs(r.y1 - r.y0) + 'px';
  }

  toggleGoals() { this.pref.goals = !this.pref.goals; this.savePrefs(); }
  setMuteIcon(muted: boolean) { $('snd-on').hidden = muted; $('snd-off').hidden = !muted; }

  /** The "what next?" card. */
  setGoals(list: { text: string; done: boolean; detail?: string }[]) {
    const done = list.filter(g => g.done).length, open = list.filter(g => !g.done).slice(0, 3);
    $('goals').hidden = false; $('goals-count').textContent = `${done}/${list.length}`;
    const html = open.length ? open.map(g => `<li><span class="box"></span><div>${esc(g.text)}${g.detail ? `<small>${esc(g.detail)}</small>` : ''}</div></li>`).join('') : '<li class="all">All goals complete — rule well!</li>';
    if ($('goal-list').dataset.h !== html) { $('goal-list').dataset.h = html; $('goal-list').innerHTML = html; }
  }

  // ---- field armies ----
  private buildMuster() {
    $('muster-row').innerHTML = units.slice(0, 6).map(u => `<div class="mrow"><span class="mi">${unitIcon(u.id, 24)}</span><span class="mn">${u.name}<small id="mav-${u.id}"></small></span>
      <span class="step"><button type="button" data-step="-5" data-u="${u.id}" title="Five fewer">−5</button><button type="button" data-step="-1" data-u="${u.id}">−</button><input type="number" min="0" value="0" id="mus-${u.id}" aria-label="${u.name}"><button type="button" data-step="1" data-u="${u.id}">+</button><button type="button" data-step="5" data-u="${u.id}" title="Five more">+5</button></span></div>`).join('');
    $('muster-row').onclick = e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-step]'); if (!b) return;
      const input = $(`mus-${b.dataset.u}`) as HTMLInputElement, max = Number(input.max) || 0, v = Math.max(0, Math.min(max, (Number(input.value) || 0) + Number(b.dataset.step)));
      input.value = String(v);
    };
    $('muster-all').onclick = () => { const u = units.slice(0, 6).map(x => this.armyNow[x.id] ?? 0); if (u.some(n => n > 0)) this.h.muster(u); };
    $('muster-go').onclick = () => { const u = units.slice(0, 6).map(x => Number(($(`mus-${x.id}`) as HTMLInputElement).value) || 0); if (u.some(n => n > 0)) { this.h.muster(u); units.slice(0, 6).forEach(x => (($(`mus-${x.id}`) as HTMLInputElement).value = '0')); } };
    $('det-list').onclick = e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-da]'); if (b) this.h.detAction(b.dataset.da!, Number(b.dataset.id)); };
  }
  private detSig = '';
  /** The field armies of your village. */
  setDets(list: { id: number; units: number[]; text: string; selected: boolean; leftWp: number }[]) {
    const sig = JSON.stringify(list);
    if (sig === this.detSig) return; this.detSig = sig;
    $('det-list').innerHTML = list.length ? list.map(d => {
      const n = d.units.reduce((s, v) => s + v, 0), mix = d.units.map((c, i) => (c ? `<span class="uc" title="${units[i].name}">${unitIcon(i, 16)} <b>${c}</b></span>` : '')).join('');
      return `<div class="army ${d.selected ? 'sel' : ''}">
        <div class="army-h"><span class="army-n">${bi('muster')} Army ${d.id}</span><span class="badge">${n} soldier${n === 1 ? '' : 's'}</span></div>
        <div class="army-u">${mix}</div>
        <div class="army-s">${esc(d.text)}</div>
        <div class="army-b"><button class="pbtn ${d.selected ? 'primary' : ''}" data-da="select" data-id="${d.id}">${d.selected ? bi('check') + ' Selected' : 'Select'}</button>
          <button class="pbtn" data-da="halt" data-id="${d.id}" title="Stop where it stands (G)">${bi('halt')} Halt</button><button class="pbtn" data-da="recall" data-id="${d.id}" title="Send it home (B)">${bi('home')} Home</button>
          <button class="pbtn" data-da="split" data-id="${d.id}" title="Split the army in two halves">${bi('split')} Split</button><button class="pbtn" data-da="merge" data-id="${d.id}" title="Join the army next to it">${bi('merge')} Merge</button></div></div>`;
    }).join('') : '<p class="muted">No field armies yet. Muster one below.</p>';
  }

  private listening: Action | null = null;
  private buildKeyTable() {
    const t = $('keytable'); let group = ''; let html = '';
    for (const a of ACTIONS) {
      if (a.group !== group) { group = a.group; html += `<div class="grp">${group}</div>`; }
      html += `<span>${a.label}</span><span>${keys.binds[a.id].map(k => `<kbd>${prettyKey(k)}</kbd>`).join('')}</span><button data-bind="${a.id}" class="${this.listening === a.id ? 'listening' : ''}">${this.listening === a.id ? 'Press a key…' : 'Change'}</button>`;
    }
    t.innerHTML = html;
    t.onclick = e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bind]'); if (b) { this.listening = b.dataset.bind as Action; this.buildKeyTable(); } };
    $('keys-reset').onclick = () => { keys.reset(); };
  }

  /** While rebinding, the next key press becomes the binding. Returns true if the event was consumed. */
  captureKey(e: KeyboardEvent): boolean {
    if (!this.listening) return false;
    e.preventDefault(); e.stopPropagation();
    const k = e.key.toLowerCase(), a = this.listening; this.listening = null;
    if (k !== 'escape') { const cur = keys.binds[a]; keys.set(a, cur.includes(k) ? cur : [k, ...cur].slice(0, 3)); } else this.buildKeyTable();
    return true;
  }

  private buildCheats() {
    const enabled = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || new URLSearchParams(location.search).has('cheats');
    $('btn-cheat').hidden = !enabled; if (!enabled) return;
    $('btn-cheat').onclick = () => this.modal('cheats', true);
    $('cheat-res').innerHTML = RES.map((r, i) => `<span>${resIcon(i)} ${r.name}</span><button class="pbtn" data-ch="0,${i},100">+100</button><button class="pbtn" data-ch="0,${i},1000">+1000</button>`).join('');
    $('cheat-army').innerHTML = units.slice(0, 6).map(u => `<button class="pbtn" data-ch="2,${u.id},10">${unitIcon(u.id, 16)} +10 ${u.name}</button>`).join('');
    $('cheats').onclick = e => { const target = e.target as HTMLElement; const flat = target.closest<HTMLElement>('[data-flat-radius]'); if (flat) { const radius = Number(flat.dataset.flatRadius); const height = Number(($('flat-height') as HTMLInputElement).value); if (Number.isFinite(height) && height >= 0 && height <= 24) this.h.cheat(102, radius, Math.round(height * 10)); return; } const b = target.closest<HTMLElement>('[data-ch]'); if (!b) return; const [a, x, y] = b.dataset.ch!.split(',').map(Number); this.h.cheat(a, x, y); };
  }

  /** Show the rules fingerprint (the hash other players compare) next to the build in The shared world and in the home page tooltip. */
  setRules(fp: string) { const t = `${versionLabel()} · rules ${fp}`; $('mp-build').textContent = t; $('home-version').title = `Rules fingerprint ${fp}: players with the same one play by the same rules.`; }
  modal(id: string, show: boolean) { $(id).hidden = !show; }

  openSteward() {
    this.modal('steward', true);
    $('steward-title').focus({ preventScroll: true });
  }
  stewardOpen() { return !$('steward').hidden; }
  setSteward(info: { mode: StewardMode; report: WatchReport | null; paused: boolean; playerBattle: boolean; status?: ArrayLike<number>; market: boolean }) {
    const { mode, report, paused, playerBattle, status, market } = info;
    $('watch-label').textContent = report && !playerBattle ? 'Village paused' : 'Steward';
    $('btn-steward').classList.toggle('on', !!report && !playerBattle);
    if (!status) return;
    const box = $('steward');
    for (const modeButton of box.querySelectorAll<HTMLButtonElement>('[data-steward="pause"], [data-steward="steward"]')) {
      const active = modeButton.dataset.steward === mode;
      modeButton.classList.toggle('on', active);
      modeButton.setAttribute('aria-pressed', String(active));
    }
    const hours = (report?.ticks ?? 0) * 24 / DAY_TICKS;
    const summary = report?.closed ? 'Welcome back. Your village is waiting at its last saved moment.'
      : hours ? `The steward oversaw ${hours >= 1 ? `${Math.round(hours)} village hours` : 'a short shift'}.`
      : 'The village clock stopped while you were away.';
    const reportLine = playerBattle ? 'The player battle underway continues at normal speed.'
      : report ? `${summary}${report.stop ? ` ${WATCH_MESSAGES[report.stop]}` : ''}` : '';
    const message = $('watch-report');
    message.hidden = !reportLine;
    if (message.textContent !== reportLine) message.textContent = reportLine;
    $('watch-policy').textContent = mode === 'pause'
      ? 'The village waits for your return. Player battles already underway finish at normal speed.'
      : 'Routine work continues at normal speed for up to one village day. The steward stops for trouble or decisions.';
    $('watch-stores').textContent = `${status[1]} meals in stores · ${status[2]} firewood · ${status[3]} ${status[3] === 1 ? 'ruin' : 'ruins'}`;
    const risks = stewardRisks(status[0]).filter(r => r !== report?.stop && (!playerBattle || r !== 'battle'));
    $('watch-risks').hidden = risks.length === 0;
    const alerts = risks.map(r => `<li>${esc(WATCH_MESSAGES[r])}</li>`).join('');
    if ($('watch-risks').innerHTML !== alerts) $('watch-risks').innerHTML = alerts;
    box.querySelector<HTMLElement>('[data-steward="market"]')!.hidden = !market;
    box.querySelector<HTMLElement>('[data-steward="ruins"]')!.hidden = status[3] === 0;
    box.querySelector<HTMLElement>('[data-steward="resume"]')!.hidden = !paused || playerBattle;
  }

  /** The game's own yes/no question (in place of the browser's confirm box). Resolves true on yes; Esc, the backdrop and Cancel mean no. */
  confirm(text: string, yes = 'Yes', title = 'Are you sure?', no = 'Cancel'): Promise<boolean> {
    return new Promise(resolve => {
      const box = $('confirm'); $('confirm-title').textContent = title; $('confirm-text').textContent = text; $('confirm-yes').textContent = yes; $('confirm-no').textContent = no; box.hidden = false;
      const done = (v: boolean) => { box.hidden = true; box.removeEventListener('pointerdown', back); removeEventListener('keydown', key, true); resolve(v); };
      const back = (e: Event) => { if (e.target === box) done(false); }, key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } else if (e.key === 'Enter') { e.stopPropagation(); done(true); } };
      $('confirm-yes').onclick = () => done(true); $('confirm-no').onclick = () => done(false); box.addEventListener('pointerdown', back); addEventListener('keydown', key, true);
      ($('confirm-yes') as HTMLButtonElement).focus();
    });
  }

  /** Browser tooltips (the title attribute) look out of place: show them in the game's own style instead. */
  private initTitleTips() {
    let timer = 0, cur: HTMLElement | null = null;
    const hide = () => { clearTimeout(timer); cur = null; if ($('tooltip').dataset.from === 'title') { this.tip(null); $('tooltip').dataset.from = ''; } };
    document.addEventListener('mouseover', e => {
      const t = (e.target as HTMLElement).closest?.('[title],[data-tip]') as HTMLElement | null;
      if (!t || t === cur || t.closest('#tooltip')) return;
      const title = t.getAttribute('title'); if (title) { t.dataset.tip = title; t.removeAttribute('title'); }   // take the title over so the browser does not draw its own
      const text = t.dataset.tip; if (!text) return;
      hide(); cur = t;
      timer = window.setTimeout(() => { const r = t.getBoundingClientRect(); this.tip(`<small style="color:#f3ead2">${esc(text)}</small>`, Math.max(8, Math.min(innerWidth - 280, r.left)) - 16, r.bottom > innerHeight - 80 ? r.top - 56 : r.bottom - 6); $('tooltip').dataset.from = 'title'; }, 380);
    });
    document.addEventListener('mouseout', e => { if (cur && !cur.contains(e.relatedTarget as Node)) hide(); });
    document.addEventListener('pointerdown', hide, true); document.addEventListener('wheel', hide, { passive: true });
  }

  enterGame() {
    document.getElementById('data-replay')?.removeAttribute('hidden');   // watching your history needs a village: the start screen's Display settings do not offer it
    $('intro').hidden = true; $('topbar').hidden = false; $('ledger').hidden = false; $('minimap-card').hidden = false; this.applyPanels(); this.finishLoading();
    // keep the ledger below the top bar however many rows the bar wraps to
    const bar = $('topbar'), set = () => document.documentElement.style.setProperty('--top-h', bar.offsetHeight + 'px');
    set(); new ResizeObserver(set).observe(bar);
  }
  private hoverPill = -1;
  private owner = '';
  setOwner(name: string) { this.owner = name; }

  setTab(t: string) {
    this.tab = t;
    $('tabs').querySelectorAll('.tab').forEach(x => x.classList.toggle('on', (x as HTMLElement).dataset.t === t));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + t));
  }

  private buildCards() {
    const el = $('cards');
    BUILDABLE.forEach((d, i) => {
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'card'; c.dataset.id = String(d.id); c.setAttribute('aria-label', d.name); c.setAttribute('aria-pressed', 'false');
      c.innerHTML = `<span class="ico">${kindIcon(d.id, 30)}</span><span><span class="nm"><span>${d.name}</span>${i < 9 ? `<span class="key">${i + 1}</span>` : ''}</span>
        <span class="ds">${d.desc}</span><span class="cost">${d.cost.map(([r, n]) => `<span data-r="${r}" data-n="${n}">${resIcon(r)} ${n}</span>`).join('') || '<span>Free</span>'}</span>${this.io(d)}</span>`;
      c.onclick = () => this.h.select(d.id);
      el.appendChild(c); this.cards.set(d.id, c);
    });
    // Level Ground belongs with the terrain tools, even though it has no building definition.
    const lc = document.createElement('button');
    lc.type = 'button'; lc.className = 'card'; lc.dataset.id = String(LEVEL_TOOL); lc.setAttribute('aria-label', 'Level Ground'); lc.setAttribute('aria-pressed', 'false');
    lc.innerHTML = `<span class="ico">${icon('levelground', 30)}</span><span><span class="nm">Level Ground</span>
      <span class="ds">${LEVEL_DESC}</span><span class="cost level-cost"></span></span>`;
    lc.onclick = () => this.h.select(LEVEL_TOOL);
    el.appendChild(lc); this.cards.set(LEVEL_TOOL, lc);
    this.updateBuildResults();
  }

  private updateBuildResults() {
    const query = $<HTMLInputElement>('build-search').value;
    const ids = this.buildResults = findBuildCards(query, this.filter);
    const visible = new Set(ids), cards = $('cards');
    $('cats').querySelectorAll<HTMLButtonElement>('[data-c]').forEach(chip => {
      const active = Number(chip.dataset.c) === this.filter;
      chip.classList.toggle('on', active); chip.setAttribute('aria-pressed', String(active));
    });
    this.cards.forEach((card, id) => { card.hidden = !visible.has(id); });
    for (const id of ids) cards.appendChild(this.cards.get(id)!);
    $('build-clear').hidden = !query;
    $('build-empty').hidden = ids.length > 0;
    $('build-help').hidden = ids.length === 0;
    $('build-count').textContent = query.trim() || this.filter >= 0 ? `${ids.length} ${ids.length === 1 ? 'match' : 'matches'}` : '';
    $('build-results').scrollTop = 0;
  }

  focusBuildSearch(): boolean {
    const ledger = $('ledger');
    if (ledger.hidden || document.querySelector('.overlay:not([hidden])')) return false;
    if (ledger.classList.contains('min')) this.toggleLedger();
    this.setTab('build');
    const search = $<HTMLInputElement>('build-search'); search.focus(); search.select();
    return true;
  }

  /** The cost line of the level-ground card for the patch size now chosen: flat [resource, amount, ...]. */
  setLevelCost(flat: number[]) {
    const c = this.cards.get(LEVEL_TOOL)?.querySelector('.cost'); if (!c) return;
    const parts: string[] = []; for (let i = 0; i + 1 < flat.length; i += 2) parts.push(`<span data-r="${flat[i]}" data-n="${flat[i + 1]}">${resIcon(flat[i])} ${flat[i + 1]}</span>`);
    c.innerHTML = parts.join('');
  }

  private buildUnits() {
    const el = $('unit-cards');
    units.slice(0, 6).forEach(u => {
      const c = document.createElement('div'); c.className = 'card unit'; c.dataset.u = String(u.id);
      c.innerHTML = `<div class="ico">${unitIcon(u.id, 30)}</div><div><div class="nm"><span>${u.name}</span><span class="key">tier ${u.tier + 1}</span></div>
        <div class="ds">${u.desc}</div><div class="io">${bi('heart', 14)} ${u.hp} · ${bi('attack', 14)} ${u.dmg} · ${bi('archer', 14)} range ${u.range} · ${bi('shield', 14)} ${u.armor}</div>
        <div class="cost">${u.cost.map(([r, n]) => `<span data-r="${r}" data-n="${n}">${resIcon(r)} ${n}</span>`).join('')}</div>
        <div class="btnrow" style="margin-top:6px"><button class="pbtn" data-train="1">Train 1</button><button class="pbtn" data-train="5">Train 5</button></div></div>`;
      c.onclick = e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-train]'); if (b) this.h.train(u.id, Number(b.dataset.train)); };
      el.appendChild(c);
    });
  }

  setMilitaryUpgrades(upgrades: MilitaryUpgrade[]) {
    this.militaryUpgrades = upgrades;
    $('military-upgrades').innerHTML = upgrades.map(u => `<div class="card"><div><div class="nm">${esc(u.name)}</div><div class="ds">${esc(u.desc)}</div><div class="cost">${u.cost.map(([r, n]) => `<span>${resIcon(r)} ${n}</span>`).join('')}</div></div><button class="pbtn" data-research="${u.id}">Research</button></div>`).join('');
  }

  private io(d: BuildingDef) {
    if (!d.cycle) return d.housing ? `<div class="io">Houses ${d.housing} villagers</div>` : '';
    const f = (a: [number, number][]) => a.map(([r, n]) => `${resIcon(r)}${n}`).join(' ');
    const recipe = ({ inputs, outputs }: Pick<BuildingDef, 'inputs' | 'outputs'>) => `${inputs.length ? f(inputs) + ' → ' : ''}${f(outputs)}`;
    return `<span class="io">${recipe(d)}${d.alternateRecipe ? '<br>' + recipe(d.alternateRecipe) : ''} every ${d.cycle}s · ${d.jobs} workers</span>`;
  }

  hotkeyKind(n: number): number | null { return BUILDABLE[n]?.id ?? null; }
  markSelected(kind: number | null) { this.cards.forEach((el, id) => { el.classList.toggle('sel', id === kind); el.setAttribute('aria-pressed', String(id === kind)); }); }

  updateAffordability(stocks: number[]) {
    const mark = (el: HTMLElement) => {
      let no = false;
      el.querySelectorAll<HTMLElement>('.cost span[data-r]').forEach(s => { const short = stocks[Number(s.dataset.r)] < Number(s.dataset.n); s.classList.toggle('short', short); no ||= short; });
      el.classList.toggle('no', no);
    };
    this.cards.forEach(mark);
    document.querySelectorAll<HTMLElement>('#unit-cards .card').forEach(mark);
  }

  private buildPills() {
    const t = $('treasury');
    RES.forEach((r, i) => {
      const p = document.createElement('span'); p.className = 'pill'; p.dataset.i = String(i);
      p.innerHTML = `<span class="ic">${icon(r.key, 18)}</span><b>0</b><span class="d"></span>`;
      p.onmouseenter = () => { this.hoverPill = i; this.stockOn(i); this.tipFor(i); };
      p.onclick = e => { if (this.rateClick(e, i)) return; this.openFlow(i); }; p.title = '';
      p.onmouseleave = () => { this.hoverPill = -1; this.stockOff(); this.lastTip = ''; $('tooltip').hidden = true; };
      t.appendChild(p); this.pills.push(p);
      if (FOOD_KEYS.includes(r.key)) p.hidden = true;
    });
    const fp = document.createElement('span'); fp.className = 'pill'; fp.dataset.i = String(RES.length);
    fp.innerHTML = `<span class="ic">${icon('food', 18)}</span><b>0</b><span class="d"></span>`;
    fp.onmouseenter = () => { this.hoverPill = RES.length; this.stockOn(RES.length); this.tipFor(RES.length); }; fp.onclick = e => { if (this.rateClick(e, RES.length)) return; this.openFlow(FOOD_ID); };
    fp.onmouseleave = () => { this.hoverPill = -1; this.stockOff(); this.lastTip = ''; $('tooltip').hidden = true; };
    t.insertBefore(fp, this.pills[RES.findIndex(r => r.key === 'grain')]); this.pills.push(fp);
  }
  /** The resources behind a pill (the Food pill stands for all the foods) and the side of the rate the pointer is on: what makes it (+) or what uses it (-). */
  private pillRes(i: number): number[] { return i === RES.length ? Array.from({ length: Math.floor((this.lastHud?.food?.length ?? 0) / 2) }, (_, k) => this.lastHud!.food![k * 2]) : [i]; }
  private pillSign(_i: number): number { return 2; }   // the pill stands for both sides: what makes the resource and what uses it
  private stockOn(i: number) { this.h.stockHover(this.pillRes(i), this.pillSign(i)); }
  private stockOff() { this.h.stockHover([], 0); }
  /** A click on the number or the rate steps the camera through the buildings behind it; elsewhere on the pill it opens the breakdown. */
  private rateClick(e: MouseEvent, i: number): boolean {
    if (!(e.target as HTMLElement).closest('.d, b')) return false;
    this.h.stockGo(this.pillRes(i), this.pillSign(i)); return true;
  }
  private sliding = false;
  private workFilter: Filter = 'all'; private workSort: Sort = 'kind';
  /** True while the work overview is showing (the game then hands it the workers every update). */
  get workOpen() { return !$('work').hidden; }
  openWork() { this.modal('work', true); this.h.act('wk:refresh'); }
  private workClick(e: Event) {
    const t = e.target as HTMLElement;
    const f = t.closest<HTMLElement>('[data-wf]'); if (f) { this.workFilter = f.dataset.wf as Filter; if (this.lastHud) this.renderWork(this.lastHud); return; }
    const s = t.closest<HTMLElement>('[data-ws]'); if (s) { this.workSort = s.dataset.ws as Sort; if (this.lastHud) this.renderWork(this.lastHud); return; }
    const a = t.closest<HTMLButtonElement>('[data-wa]'); if (a && !a.disabled) { this.h.workAll(a.dataset.wa!); return; }
    const b = t.closest<HTMLButtonElement>('[data-wset]'); if (b && !b.disabled) { const [i, n] = b.dataset.wset!.split(':').map(Number); this.h.setWorkers(i, n); return; }
    const g = t.closest<HTMLElement>('[data-wgo]'); if (g && !t.closest('button, input')) { this.modal('work', false); this.h.goBuilding(Number(g.dataset.wgo)); }
  }
  private workChange(e: Event) { const t = e.target as HTMLInputElement; if (t.dataset.wslide !== undefined) this.h.setWorkers(Number(t.dataset.wslide), Number(t.value)); }
  /** The work overview: every workplace by kind with who works there, the totals of the village's hands, and the controls to assign them. */
  private renderWork(h: Hud) {
    if (!h.work || this.sliding) return;
    const { rows, totals: t } = h.work, flow = h.flow;
    const producesOf = (k: number) => (defs[k]?.cycle ?? 0) > 0;
    const groups = group(rows, this.workFilter, this.workSort, producesOf);
    const chips = (list: { id: string; label: string }[], cur: string, attr: string) => list.map(c => `<button class="pbtn chip ${c.id === cur ? 'on' : ''}" data-${attr}="${c.id}">${c.label}</button>`).join('');
    const stat = (n: number | string, label: string, tip = '') => `<div class="stat" title="${esc(tip)}"><b>${n}</b><span>${label}</span></div>`;
    const housekeeping = Math.max(0, t.adults - t.sick - t.workers);
    let html = `<div class="stats">${stat(t.adults, 'Adults')}${stat(t.workers, 'Workers', 'Seven in ten healthy adults work (fewer under quarantine)')}${stat(t.jobs, 'Jobs')}${stat(t.placed, 'At work')}${stat(t.idle, 'Idle workers')}${stat(t.jobs ? `${t.eff}%` : '–', 'Efficiency')}</div>
      <p class="muted">Not working: ${t.children} children, ${t.elders} elders, ${t.sick} sick and ${housekeeping} adults who keep house. ${esc(workNote(t))}</p>
      <div class="btnrow wrap"><button class="pbtn" data-wa="auto" title="Hand every building back to automatic staffing">Auto-assign all</button></div>
      <div class="btnrow wrap chips">${chips(FILTERS, this.workFilter, 'wf')}</div><div class="btnrow wrap chips">${chips(SORTS, this.workSort, 'ws')}</div>`;
    if (!groups.length) html += `<p class="muted">${rows.length ? 'Nothing matches that filter.' : 'No workplaces yet.'}</p>`;
    for (const g of groups) {
      const out = flow ? kindOutputs(flow.lines, flow.covered, g.kind) : [];
      const outs = out.length ? out.map(([r, n]) => `${resIcon(r, 14)} +${n}/day`).join(' ') : '';
      const nm = esc(defs[g.kind]?.name ?? '?');
      html += `<h3 class="workh">${kindIcon(g.kind, 18)} ${nm} <span class="muted">× ${g.rows.length} · ${g.staff}/${g.max} workers${outs ? ` · ${outs}` : ''}</span></h3>
        <div class="btnrow wrap workacts"><button class="pbtn" data-wa="auto:${g.kind}">Auto</button><button class="pbtn" data-wa="pause:${g.kind}" ${g.paused === g.rows.length ? 'disabled' : ''} title="Pause every ${nm}: nobody works there">Pause all</button></div>`;
      for (const r of g.rows) {
        const v = verdict(r, producesOf(r.kind)), wanted = r.want < 0 ? r.max : Math.min(r.want, r.max);
        html += `<div class="workrow ${understaffed(r) ? 'short' : ''} ${v === 'paused' ? 'paused' : ''}" data-wgo="${r.idx}" title="Click to look at it on the map">
          <span class="wn">${esc(tierName(r.kind, r.tier) ?? nm)}</span>
          <span class="wc"><button class="pbtn" data-wset="${r.idx}:${Math.max(0, wanted - 1)}" ${wanted <= 0 ? 'disabled' : ''} aria-label="Fewer workers">−</button><input type="range" min="0" max="${r.max}" value="${wanted}" data-wslide="${r.idx}" aria-label="Workers"><button class="pbtn" data-wset="${r.idx}:${Math.min(r.max, wanted + 1)}" ${wanted >= r.max ? 'disabled' : ''} aria-label="More workers">+</button>
          <button class="pbtn ${r.want < 0 ? 'on' : ''}" data-wset="${r.idx}:-1" title="Let the village decide">Auto</button></span>
          <span class="wt"><b>${r.staff}</b> / ${wanted}${r.want < 0 ? '' : ` of ${r.max}`}${r.scaled ? ' <span class="neg" title="Not enough workers: scaled back">▾</span>' : ''}</span>
          <span class="ws ${v === 'working' ? 'ok' : 'bad'}">${v}</span></div>`;
      }
    }
    const body = $('work-body'), keep = body.parentElement!.scrollTop; body.innerHTML = html; body.parentElement!.scrollTop = keep;
  }
  private flowOpen = CLOSED; private lastHud: Hud | null = null;
  /** The breakdown of one resource: what makes it and what uses it, per day (from the core's ledger of the last day). */
  openFlow(i: number) { this.flowOpen = i; this.modal('flow', true); if (this.lastHud) this.renderFlow(this.lastHud); }
  private flowTables(h: Hud, i: number) {
    const rows = (list: Row[], sign: string) => list.length ? list.map(r => {
      const k = /^b\d+$/.test(r.key) ? Number(r.key.slice(1)) : -1;
      const x = k >= 0 ? { label: defs[k]?.name ?? '?', ic: KIND_ICON[k], hint: defs[k]?.desc ?? '' } : { label: EXTRA_INFO[r.key]?.label ?? r.key, ic: EXTRA_INFO[r.key]?.icon ?? 'unknown', hint: EXTRA_INFO[r.key]?.hint ?? '' };
      return `<tr title="${esc(x.hint)}"><td>${icon(x.ic as IconName, 18)}</td><td>${esc(x.label)}${r.count > 1 ? ` <span class="muted">× ${r.count}</span>` : ''}</td><td class="r">${sign}${Math.round(r.perDay)}/day</td></tr>`;
    }).join('') : `<tr><td></td><td class="muted">Nothing</td><td></td></tr>`;
    const b = breakdown(h.flow!, i, c => (c < h.flow!.nk ? h.kinds?.[c] ?? 0 : 0));
    const mine = (sign: number) => this.h.stockInfo([i], sign).filter(l => l.kind >= 0).map(l => `<tr><td></td><td>${l.html}</td><td class="r"><button class="pbtn" data-show="${i}:${sign}:${l.kind}">Show on map</button></td></tr>`).join('');
    const sb = mine(1), kb = mine(-1);
    return { b, html: `<h3>Comes in</h3><table class="flowtab">${rows(b.sources, '+')}</table>${sb ? `<table class="flowtab flowbld">${sb}</table>` : ''}<h3>Goes out</h3><table class="flowtab">${rows(b.sinks, '\u2212')}</table>${kb ? `<table class="flowtab flowbld">${kb}</table>` : ''}` };
  }
  private renderFlow(h: Hud) {
    const i = this.flowOpen; if (i === CLOSED || !h.flow) return;
    const foot = (covered: number, net: number, steady: number) => `<p class="muted">All figures are per day (${DAY_TICKS} ticks), taken over the last ${Math.round(covered / 24) / 10} days of play. The steady rate leaves out your own orders and one-off events, so a raid or a new building does not make it jump.${net !== steady ? ` Counting everything the stock changed by ${fmtRate(net)}.` : ''}</p>`;
    if (i === FOOD_ID) {   // all the foods together, then each one's own breakdown
      const table = h.food ?? [], t = foodTotals(h.stocks, h.rates, table), left = daysLeft(t.meals, t.rate);
      $('flow-title').innerHTML = `${icon('food', 26)} Food`;
      let body = `<p class="muted">${Math.floor(t.meals)} meals in store · steady rate <b class="${t.rate < 0 ? 'neg' : t.rate > 0 ? 'pos' : ''}">${fmtRate(t.rate)}</b> (in meals)${left !== null ? ` · <b class="neg">runs out in ${fmtDaysLeft(left)}</b>` : ''}</p><p class="muted">The village eats from all its stores together, taking from whichever holds the most food. Raw grain and raw fish fill less than bread and smoked fish, so cooked food feeds more mouths.</p>`;
      let covered = 0;
      for (let k = 0; k + 1 < table.length; k += 2) {
        const r = table[k], q = table[k + 1], { b, html } = this.flowTables(h, r); covered = b.covered;
        body += `<h2 class="foodh">${resIcon(r, 20)} ${RES[r].name} <span class="muted">${h.stocks[r]} stored · fills ${q / 4}× a meal · ${fmtRate(b.steady)}</span></h2>${html}`;
      }
      $('flow-body').innerHTML = body + foot(covered, t.rate, t.rate);
      return;
    }
    const { b, html } = this.flowTables(h, i), v = h.stocks[i], left = daysLeft(v, b.steady);
    $('flow-title').innerHTML = `${resIcon(i, 26)} ${RES[i].name}`;
    $('flow-body').innerHTML = `<p class="muted">${v} / ${h.storage} stored · steady rate <b class="${b.steady < 0 ? 'neg' : b.steady > 0 ? 'pos' : ''}">${fmtRate(b.steady)}</b>${left !== null ? ` · <b class="neg">runs out in ${fmtDaysLeft(left)}</b>` : ''}</p>${html}${foot(b.covered, b.net, b.steady)}`;
  }
  private warnedDay = '';
  /** What winter does here, with this village's numbers (the panel behind the season in the top bar). */
  private renderWinter(h: Hud) {
    if (!h.winter) return;
    const season = Math.floor((Math.floor(h.tick / 240)) / 10) % 4, lines = winterLines(parseWinter(h.winter), h.pop, season);
    $('winter-title').innerHTML = `${icon('cold', 26)} Winter`;
    $('winter-body').innerHTML = `<table class="flowtab winter">${lines.map(l => `<tr><td>${icon(l.icon as IconName, 22)}</td><td><b class="${l.tone === 'bad' ? 'neg' : l.tone === 'good' ? 'pos' : ''}">${esc(l.title)}</b><div class="muted">${esc(l.text)}</div></td></tr>`).join('')}</table>`;
  }
  private lastTip = '';
  private pillText: string[] = [];
  /** Show the resource tooltip under its pill. The DOM is only touched when the text really changed, so it never flickers. */
  private tipFor(i: number) {
    const el = $('tooltip');
    let html = this.pillText[i] ?? '';
    if (!html) return;
    for (const sg of [1, -1]) {
      const lines = this.h.stockInfo(this.pillRes(i), sg);
      if (lines.length) html += `<small class="hlhead">${sg > 0 ? 'Made by' : 'Used by'}${sg > 0 ? ' (lit on the map; click the number to look at each)' : ''}</small>` + lines.map(l => `<small class="hlline">${l.html}</small>`).join('');
    }
    if (html !== this.lastTip || el.hidden) { this.lastTip = html; el.innerHTML = html; el.hidden = false; }
    const r = this.pills[i].getBoundingClientRect(); el.style.left = Math.min(innerWidth - 280, r.left) + 'px'; el.style.top = (r.bottom + 6) + 'px';
  }

  private buildStock() {
    $('restable').innerHTML = RES.map((r, i) => `<tr title="${r.hint}"><td>${resIcon(i, 18)}</td><td>${r.name}</td><td class="r" id="rs-${i}">0</td><td class="r" id="rr-${i}"></td></tr>`).join('');
  }

  update(h: Hud) {
    const day = Math.floor(h.tick / 240) + 1, season = SEASONS[Math.floor((day - 1) / 10) % 4];
    const ph = dayPhase(h.tick);
    $('sub').textContent = `${this.owner ? this.owner + ' · ' : ''}Day ${day} · ${season} · ${clockText(ph)} `; $('sub').insertAdjacentHTML('beforeend', icon(nightFactor(ph) > 0.5 ? 'moon' : 'sun', 14));
    if (h.winter) {
      const wn = parseWinter(h.winter), si = Math.floor((day - 1) / 10) % 4; $('sub').title = winterTip(wn, si);
      const key = `${Math.floor((day - 1) / 40)}:${day}`; if (key !== this.warnedDay) { this.warnedDay = key; const m = winterWarning(wn, si, (day - 1) % 10 + 1); if (m) this.toast(m.text, m.tone, 'cold'); }
      if (!$('winter').hidden) this.renderWinter(h);
    }
    this.lastHud = h; if (this.flowOpen >= 0 && !$('flow').hidden) this.renderFlow(h);
    if (!$('work').hidden) this.renderWork(h);
    if (h.food) {
      const t = foodTotals(h.stocks, h.rates, h.food), p = this.pills[RES.length], left = daysLeft(t.meals, t.rate);
      p.querySelector('b')!.textContent = String(Math.floor(t.meals));
      const d = p.querySelector('.d') as HTMLElement; d.textContent = Math.abs(t.rate) >= 1 ? fmtRate(t.rate) : ''; d.classList.toggle('neg', t.rate < 0);
      p.classList.toggle('low', t.meals < 25);
      this.pillText[RES.length] = `<b>${icon('food', 18)} Food</b><small>${Math.floor(t.meals)} meals across all foods</small><small>${fmtRate(t.rate)} meals (steady, over the last day)</small>${left !== null ? `<small class="warn">Runs out in ${fmtDaysLeft(left)}</small>` : ''}<small class="muted">Click for what makes it and what uses it</small>`;
      if (this.hoverPill === RES.length) this.tipFor(RES.length);
    }
    h.stocks.forEach((v, i) => {
      const p = this.pills[i], rate = h.rates[i], left = daysLeft(v, rate);
      p.querySelector('b')!.textContent = String(v);
      const d = p.querySelector('.d') as HTMLElement; d.textContent = Math.abs(rate) >= 1 ? fmtRate(rate) : ''; d.classList.toggle('neg', rate < 0);
      
      p.classList.toggle('full', v >= h.storage);
      this.pillText[i] = `<b>${resIcon(i)} ${RES[i].name}</b><small>${v} / ${h.storage} stored</small><small>${fmtRate(rate)} (steady, over the last day)</small>${left !== null ? `<small class="warn">Runs out in ${fmtDaysLeft(left)}</small>` : ''}<small>${RES[i].hint}</small><small class="muted">Click for what makes it and what uses it</small>`;
      if (this.hoverPill === i) this.tipFor(i);
      $(`rs-${i}`).textContent = String(v);
      const rr = $(`rr-${i}`); rr.textContent = Math.abs(rate) >= 0.5 ? fmtRate(rate) : '–'; rr.className = 'r ' + (rate > 0.5 ? 'pos' : rate < -0.5 ? 'neg' : '');
    });
    const soldiers = h.army.reduce((a, b) => a + b, 0);
    ($('v-pop').querySelector('b') as HTMLElement).textContent = `${h.pop}/${h.cap}`;
    ($('v-army').querySelector('b') as HTMLElement).textContent = String(soldiers + h.guards);
    ($('v-sick').querySelector('b') as HTMLElement).textContent = String(h.sick);
    ($('v-joy').querySelector('.ic') as HTMLElement).innerHTML = icon(h.joy >= 70 ? 'happy' : h.joy >= 40 ? 'content' : h.joy >= 20 ? 'neutral' : 'sad', 16); ($('v-joy').querySelector('b') as HTMLElement).textContent = String(h.joy);
    ($('v-work').querySelector('b') as HTMLElement).textContent = h.jobs ? `${h.eff}%` : '–';
    $('v-sick').style.opacity = h.sick ? '1' : '.5';
    $('s-pop').textContent = String(h.pop); $('s-cap').textContent = String(h.cap); $('s-sick').textContent = String(h.sick);
    $('s-eff').textContent = h.jobs ? `${h.eff}%` : '–'; $('s-bld').textContent = String(h.buildings); $('s-rad').textContent = String(h.radius);
    ($('b-house') as HTMLElement).style.width = `${Math.min(100, (h.pop / Math.max(1, h.cap)) * 100)}%`;
    const maxStock = Math.max(...h.stocks);
    ($('b-store') as HTMLElement).style.width = `${Math.min(100, (maxStock / h.storage) * 100)}%`;
    $('b-store').parentElement!.classList.toggle('red', maxStock >= h.storage * 0.95);
    $('t-store').textContent = `Each resource holds up to ${h.storage}. Upgrade the Town Hall to store more.`;
    if (h.vitals) {
      const v = h.vitals, died = v[4] + v[5] + v[6] + v[7] + v[8];
      $('care-stats').innerHTML = [[v[0], 'Born'], [v[1], 'Arrived'], [died, 'Died'], [v[9], 'Unburied'], [`${v[12]}/${v[11]}`, 'Grave plots'], [h.beds ?? 0, 'Hospital beds'], [h.devotion ?? 0, 'Devotion']].map(([n, l]) => `<div class="stat${l === 'Unburied' && v[9] >= 3 ? ' bad' : ''}"><b>${n}</b><span>${l}</span></div>`).join('');
      $('care-info').textContent = `Deaths: ${v[4]} of old age, ${v[5]} plague, ${v[6]} hunger, ${v[7]} cold, ${v[8]} in battle. ${v[10]} have been laid to rest. ` + (v[9] >= 3 ? 'Unburied dead spread sickness: build a Graveyard or a Chapel.' : v[11] === 0 ? 'No graveyard yet: only a few can be buried in the fields each day.' : 'A Hospital cures the sick; a Chapel holds a service every seventh day.');
    }
    this.updateAffordability(h.stocks);
    // army tab
    $('army-stats').innerHTML = h.army.map((n, i) => `<div class="stat"><b>${n}</b><span>${unitIcon(i, 16)} ${units[i].name}${h.queued[i] ? ` (+${h.queued[i]})` : ''}${h.away[i] ? ` · ${h.away[i]} away` : ''}</span></div>`).join('');
    $('army-info').innerHTML = `${h.guards} guards defend your towers and hall for free. ` + (h.barracks < 0 ? '<b>Build a Barracks to train soldiers.</b>' : `Your barracks is tier ${h.barracks + 1}.`) + ` Soldiers eat grain.`;
    ($('army-bridging') as HTMLInputElement).checked = h.bridgeShortcuts;
    $('military-upgrades').querySelectorAll<HTMLButtonElement>('[data-research]').forEach(btn => {
      const u = this.militaryUpgrades[Number(btn.dataset.research)];
      const done = (h.militaryTech & (1 << u.id)) !== 0;
      const lock = h.barracks < u.tier ? `Barracks tier ${u.tier + 1} required` : (h.militaryTech & u.prereq) !== u.prereq ? 'Requires Padded armor' : u.cost.some(([r, n]) => h.stocks[r] < n) ? 'Insufficient supplies' : '';
      btn.disabled = done || !!lock; btn.textContent = done ? 'Researched' : 'Research'; btn.title = done ? 'Upgrade equipped' : lock;
    });
    document.querySelectorAll<HTMLElement>('#unit-cards .card').forEach(c => { const u = units[Number(c.dataset.u)]; c.classList.toggle('locked', h.barracks < u.tier); });
  }

  /** Rival villages in the shared world. */
  setPeers(rows: PeerRow[], world: string) {
    this.peers = rows;
    $('mp-count').textContent = rows.length ? `${rows.length + 1} players` : 'Online';
    $('mp-world').textContent = world;
    const list = rows.length ? rows.map(r => `<li><b>${esc(r.name)}</b> — ${r.pop} villagers, ${r.buildings} buildings · ${r.sync} <button class="chip" data-peer="${esc(r.key)}">Visit</button> <button class="chip" data-watch="${esc(r.key)}" title="Replay this player's history">Watch history</button></li>`).join('') : '<li class="muted">Nobody else is here yet.</li>';
    $('peer-list').innerHTML = list; $('mp-peers').innerHTML = list;
    const form = $('attack-form');
    const sig = rows.map(r => r.key + r.busy + r.name + r.where).join(',');
    if (sig !== this.armyShown) {
      this.armyShown = sig;
      form.innerHTML = rows.length
        ? `<select id="atk-target">${rows.map(r => `<option value="${esc(r.key)}">${esc(r.name)}${r.where ? ' · ' + esc(r.where) : ''} · ${r.buildings} buildings</option>`).join('')}</select>
           <button class="pbtn danger" id="atk-sel" hidden></button>
           <p class="muted" id="atk-hint"></p>
           <h4>Trade</h4><p class="muted">Everything travels the road between the two cities and works when it arrives.</p>
           <div class="trade-row"><select id="trd-res" aria-label="Goods">${RES.map((r, i) => `<option value="${i}">${r.name}</option>`).join('')}</select><label class="tfield" title="Amount"><span>#</span><input type="number" min="1" max="500" value="50" id="trd-amt"></label><label class="tfield" title="Spearmen as escort"><span>${bi('shield', 14)}</span><input type="number" min="0" value="0" id="trd-esc"></label></div>
           <div class="btnrow"><button class="pbtn" id="trd-send">${bi('caravan')} Send caravan</button><button class="pbtn" id="trd-pact">${bi('pact')} Trade pact</button><button class="pbtn" id="trd-peace">${bi('peace')} Peace</button></div>
           <h4>Diplomacy</h4><p class="muted" id="dip-rel"></p>
           <div class="btnrow"><button class="pbtn" id="dip-envoy" title="Send an envoy with gifts (20 gold, once every 3 days): relations improve when he arrives">${bi('envoy')} Envoy</button><button class="pbtn" id="dip-ally" title="An alliance needs a trade pact and warm relations">${bi('alliance')} Alliance</button><button class="pbtn" id="dip-marry" title="Marry into their house: 150 gold, needs good relations. The wedding party takes the road and the marriage binds on arrival">${bi('marriage')} Marriage</button><button class="pbtn danger" id="dip-war" title="A herald rides to them; when he arrives treaties end and relations collapse">${bi('war')} Declare war</button></div>`
        : '<p class="muted">No other villages to attack yet — invite someone, or wait for neighbours to arrive.</p>';
      const trade = (action: string) => { const key = ($('atk-target') as HTMLSelectElement).value; this.h.trade(key, action, Number(($('trd-res') as HTMLSelectElement).value), Number(($('trd-amt') as HTMLInputElement).value) || 0, Number(($('trd-esc') as HTMLInputElement).value) || 0); };
      for (const [id, a] of [['trd-send', 'caravan'], ['trd-pact', 'pact'], ['trd-peace', 'peace'], ['dip-envoy', 'envoy'], ['dip-ally', 'alliance'], ['dip-marry', 'marriage'], ['dip-war', 'war']] as const) { const b = document.getElementById(id); if (b) b.onclick = () => trade(a); }
      const goSel = document.getElementById('atk-sel');
      if (goSel) goSel.onclick = () => this.h.attackSelected(($('atk-target') as HTMLSelectElement).value);
    }
    this.showAttackMode();
    const sel = document.getElementById('atk-target') as HTMLSelectElement | null, rel = document.getElementById('dip-rel');
    if (sel && rel) {
      const show = () => { const r = rows.find(x => x.key === sel.value); rel.textContent = r ? `${r.name}: ${relWord(r.rel ?? 0)} (${r.rel ?? 0})${r.married ? ' · married into our house' : ''}${(r.treaties ?? 0) & 4 ? ' · allies' : ''}${(r.treaties ?? 0) & 2 ? ' · at peace' : ''}${(r.treaties ?? 0) & 1 ? ' · trade pact' : ''}` : ''; };
      sel.onchange = show; show();
    }
  }

  private selectedArmies = 0;
  /** How many armies are selected on the map: with one or more, the attack box marches those; without, it musters soldiers from the barracks. */
  setSelectedArmies(n: number) { this.selectedArmies = n; this.showAttackMode(); }
  private showAttackMode() {
    const go = document.getElementById('atk-sel') as HTMLButtonElement | null, hint = document.getElementById('atk-hint');
    if (!go || !hint) return;
    const n = this.selectedArmies;
    go.hidden = n === 0; go.innerHTML = `${bi('attack')} ${n > 1 ? `March the ${n} selected armies` : 'March the selected army'}`;
    hint.textContent = n ? 'Pick the village above, then march. The army goes on its own and attacks when it arrives.' : 'Select an army on the map (or in the Army tab) first, then pick a village here to send it.';
  }

  /** Battle status, the click-to-focus shortcut, and the local bandits' payment details. */
  battle(text: string | null, onClick?: () => void, bribe?: RaidBribe) {
    const b = $('battle'); b.hidden = !text;
    $('battle-bribe').hidden = !bribe || !text;
    const pay = $<HTMLButtonElement>('battle-pay');
    const offer = bribe?.offer;
    pay.hidden = !text || !offer?.show;
    pay.disabled = !bribe?.pay || !offer || offer.disabled;
    pay.onclick = pay.disabled ? null : bribe?.pay ?? null;
    if (bribe && text) {
      const greed = $('battle-greed'), count = String(bribe.greed);
      if (greed.textContent !== count) greed.textContent = count;
      if (offer?.show) {
        const label = $('battle-pay-label');
        if (label.textContent !== offer.label) label.textContent = offer.label;
        pay.title = offer.title;
      }
    }
    if (!text) return;
    const body = $('battle-text');
    body.innerHTML = text;
    b.classList.toggle('clickable', !!onClick); body.onclick = onClick ?? null; body.title = onClick ? 'Click to look at the attackers' : '';
  }

  battleControls(actions: BattleAction[] = [], order?: (group: number, mode: number) => void, issued?: Uint8Array) {
    $('battle-controls').hidden = !order && actions.length === 0;
    const bar = $('battle-acts'), orders = $('battle-orders'), group = $('battle-group') as HTMLSelectElement;
    orders.hidden = !order;
    const current = $('battle-current-orders');
    const modes = Array.from(issued ?? []);
    const active = modes.flatMap((mode, i) => mode ? [`${TROOP_GROUPS[i]} · ${ORDER_NAMES[mode]}`] : []);
    current.hidden = !order || active.length === 0;
    current.textContent = modes.length === 4 && active.length === 4 && modes.every(mode => mode === modes[0])
      ? `All troops · ${ORDER_NAMES[modes[0]]}` : active.join(' / ');
    const sig = actions.map(a => a.label + (a.disabled ? '!' : '')).join('|');
    if (bar.dataset.sig !== sig) {
      bar.dataset.sig = sig; bar.innerHTML = '';
      for (const a of actions) { const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'tool-action'; btn.innerHTML = `${a.icon ? bi(a.icon) + ' ' : ''}${esc(a.label)}`; btn.title = a.title; btn.disabled = !!a.disabled; btn.dataset.label = a.label; bar.appendChild(btn); }
    }
    bar.onclick = e => { const label = (e.target as HTMLElement).closest('button')?.dataset.label; const act = actions.find(a => a.label === label); if (act && !act.disabled) act.run(); };
    orders.onclick = e => { const mode = (e.target as HTMLElement).closest('button')?.dataset.order; if (mode !== undefined) order?.(Number(group.value), Number(mode)); };
    group.onchange = () => {
      const mode = orders.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.dataset.order;
      if (mode !== undefined) order?.(Number(group.value), Number(mode));
    };
  }

  setBattleTarget(mode: number | null) {
    const text = mode === null ? '' : BATTLE_TARGET_HINTS[mode];
    const hint = $('battle-target-hint');
    hint.innerHTML = text ? `${text} · ${keyNames('cancel')} cancels` : ''; hint.hidden = !text;
    $('battle-orders').querySelectorAll<HTMLButtonElement>('button[aria-pressed]').forEach(btn => btn.setAttribute('aria-pressed', String(Number(btn.dataset.order) === mode)));
  }
  private armyNow: number[] = [];
  maxAttack(army: number[]) { this.armyNow = army; units.slice(0, 6).forEach(u => { for (const p of ['atk', 'mus']) { const i = document.getElementById(`${p}-${u.id}`) as HTMLInputElement | null; if (i) { i.max = String(army[u.id]); if (Number(i.value) > army[u.id]) i.value = String(army[u.id]); } } const av = document.getElementById(`mav-${u.id}`); if (av) av.textContent = `${army[u.id]} in the barracks`; }); }

  setSelectedPane(html: string | null) {
    const tab = $('tab-sel');
    if (html === null) { tab.hidden = true; if (this.tab === 'sel') this.setTab('build'); if (this.tempOpen) { this.tempOpen = false; this.applyPanels(); } return; }
    if (this.sliding) return;   // a slider is being dragged: do not pull it from under the pointer
    $('pane-sel').innerHTML = html; tab.hidden = false;
  }
  showSelectedTab() { if (this.pref.ledger && !this.tempOpen) { this.tempOpen = true; this.applyPanels(); } this.setTab('sel'); }
  get currentTab() { return this.tab; }

  log(text: string, tone: string, tick: number) {
    const li = document.createElement('li'); li.className = tone;
    li.innerHTML = `<small>Day ${Math.floor(tick / 240) + 1}</small> ${text}`;
    const ul = $('log'); ul.prepend(li); if (++this.logCount > 40) ul.lastElementChild?.remove();
  }
  toast(text: string, tone = 'info', iconName?: string) {
    const t = document.createElement('div'); t.className = 'toast ' + tone; if (iconName) t.innerHTML = `${icon(iconName, 16, { mono: true })} ${esc(text)}`; else t.textContent = text; $('toasts').appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .5s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 6000);
  }
  hint(text: string | null, bad = false) { const h = $('hint'); h.hidden = !text; if (text) { h.innerHTML = esc(text).replace(/&lt;kbd&gt;(.*?)&lt;\/kbd&gt;/g, '<kbd>$1</kbd>'); h.classList.toggle('bad', bad); } }   // key names come as <kbd> tags: keep those, escape the rest
  tip(html: string | null, x = 0, y = 0) {
    const t = $('tooltip'); t.hidden = !html; if (!html) return;
    t.innerHTML = html; t.style.left = Math.min(innerWidth - 280, x + 16) + 'px'; t.style.top = (y + 18) + 'px';
  }
  setSpeed(n: number) { $('speed').querySelectorAll('.btn').forEach(b => b.classList.toggle('on', Number((b as HTMLElement).dataset.s) === n)); }
  setCoverageToggle(on: boolean) { $('btn-cov').setAttribute('aria-pressed', String(on)); $('btn-cov').classList.toggle('on', on); }
  setResourcesToggle(on: boolean) { $('btn-res').setAttribute('aria-pressed', String(on)); $('btn-res').classList.toggle('on', on); }
  netStatus(s: string) { $('net-status').textContent = s; }
  get labels() { return $('labels'); }
  /** The market's stall list: `goods` is `World.market_goods()` (resource, left, cap, refill a day, unit price x100, days until full each); `tick` the clock and `day` the ticks in a day. */
  marketHtml(goods: ArrayLike<number>, stocks: number[], tick: number, day: number, room: number) {
    const toDawn = day - (tick % day), rows: string[] = [];
    for (let i = 0; i + 5 < goods.length; i += 6) {
      const [r, left, cap, refill, p100, days] = [goods[i], goods[i + 1], goods[i + 2], goods[i + 3], goods[i + 4], goods[i + 5]];
      const unit = (n: number) => Math.ceil(p100 * n / 100), canNow = (n: number) => left >= n && stocks[8] >= unit(n) && stocks[r] + n <= room;
      const most = Math.max(0, Math.min(left, room - stocks[r], Math.floor(stocks[8] * 100 / Math.max(1, p100))));
      const when = left >= cap ? 'full' : `full in ${days} day${days === 1 ? '' : 's'}`;
      rows.push(`<div class="mkt-row"><span class="mkt-good">${resIcon(r)} <b>${RES[r].name}</b></span><span class="mkt-left" title="Refills ${refill} a day">${left} / ${cap} left<small> · ${when}</small></span>
        <span class="mkt-price">${icon('gold', 14)} ${(p100 / 100).toFixed(p100 % 100 ? 2 : 0)} each</span>
        <span class="btnrow"><button class="pbtn" data-act="buy:${r}:10" ${canNow(10) ? '' : 'disabled'}>+10</button><button class="pbtn" data-act="buy:${r}:50" ${canNow(50) ? '' : 'disabled'}>+50</button><button class="pbtn" data-act="buy:${r}:${most}" ${most < 1 ? 'disabled' : ''} title="As many as the stall has, you can pay for and the stores hold">All${most > 0 ? ` (${most}, ${unit(most)})` : ''}</button></span></div>`);
    }
    return `<div><h3>Market</h3><div class="mkt">${rows.join('')}</div><p class="muted">Buy with gold at a markup. The stalls restock at the turn of every day (next in ${Math.ceil(toDawn / day * 24)} hours); a grander market, or a second one, stocks more.</p></div>`;
  }
  costHtml(c: [number, number][], stocks: number[]) { return c.map(([r, n]) => `<span class="${stocks[r] < n ? 'short' : ''}">${resIcon(r)} ${n}</span>`).join(' '); }
  fmt = fmtCost;
}
