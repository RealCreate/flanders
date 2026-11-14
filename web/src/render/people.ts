import * as THREE from 'three';
import type { Terrain } from './terrain';
import { HAT, TOOL, type Crowd, type Draw } from './crowd';

const S = 10;
const MAX = 260;

export interface Huntable { x: number; z: number; alive: boolean }
export interface WildLike { nearest(x: number, z: number, r: number): Huntable | null; kill(a: Huntable): void; remove(a: Huntable): void }
export interface Hooks { wild: WildLike | null; arrow(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void; splash(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void }

/** Workplaces whose workers haul goods to the storehouse, and the colour of what they carry. */
const HAULS: Record<number, boolean> = { 1: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true, 12: true, 13: true, 14: true, 29: true, 30: true };
const LOAD: Record<number, number> = { 1: 0xd9b95a, 4: 0x7a5230, 5: 0xc9a56a, 6: 0x9a9a9a, 7: 0xb5693a, 8: 0xa4553b, 9: 0x6a5a50, 10: 0xb0902a, 11: 0x2a2a2a, 12: 0x8a8a90, 13: 0x777777, 14: 0xe0b030, 29: 0xc9a56a, 30: 0x6a9a3a };

const SKIN = [0xe8c4a0, 0xd9a877, 0xc68e63, 0xf0d2b4, 0xb98055];
const PLAIN = [0x8c3b2f, 0x3b5f8c, 0x5f7a3b, 0x8c7a3b, 0x6b4a7a, 0x7a5a3b, 0x4a6b6b, 0xb08a4a, 0x7a3b4a];
const DRESS = [0x9a4a5a, 0x4a6a9a, 0x6a8a4a, 0xa88a4a, 0x7a5a8a, 0xb0706a];

/** Appearance by workplace: [hat, tool, clothes]. */
const LOOKS: Record<number, [number | undefined, number, number[]]> = {
  1: [HAT.STRAW, TOOL.FORK, [0x8a7a4a, 0x6b7a3a, 0x9a8a5a]],
  4: [HAT.CAP, TOOL.AXE, [0x5a6b3a, 0x7a4a2a, 0x6a5a3a]],
  5: [HAT.CAP, TOOL.HAMMER, [0x8a6b4a, 0x7a5a3a]],
  6: [HAT.KETTLE, TOOL.PICK, [0x7a7a7a, 0x8a8070]],
  7: [HAT.STRAW, TOOL.PICK, [0x9a6a3a, 0x8a5a2a]],
  8: [HAT.CAP, TOOL.HAMMER, [0x9a4a3a, 0x7a3a2a]],
  9: [HAT.HELM, TOOL.PICK, [0x5a5a60, 0x4a4a52]],
  10: [HAT.HELM, TOOL.PICK, [0x8a7a4a, 0x6a6030]],
  11: [HAT.BANDIT, TOOL.FORK, [0x3a3a3a, 0x2f2a26]],
  12: [HAT.CAP, TOOL.HAMMER, [0x4a3a30, 0x3a2a22]],
  13: [HAT.CAP, TOOL.HAMMER, [0x4a3a30, 0x3a2a22]],
  14: [HAT.CAP, TOOL.STAFF, [0x7a6a2a, 0x6a5a20]],
  18: [HAT.HOOD, TOOL.BOW, [0x3f5a30, 0x4a6a38]],
  20: [HAT.CAP, TOOL.HAMMER, [0x8a6b4a, 0x7a5a3a, 0x6a5a40]],
};

interface Agent {
  x: number; z: number; yaw: number;
  home: number; work: number;
  route: THREE.Vector2[]; at: number;
  dwell: number; goingToWork: boolean;
  seed: number;
  hat?: number; tool: number; body: number; skin: number; dress: boolean; scale: number;
  hunter: boolean; stage: number; shift: number; target: Huntable | null; carry: boolean; aim: boolean;
  fight: boolean; fs: number; fsT: number; fireTo: { x: number; z: number; r: number } | null;   // firefighting duty
  crew: boolean; cs: number; cT: number; job: { x: number; z: number; r: number } | null;          // builders on a repair job
  base: number;   // this person's own walking pace (units/s): children and the old are slower, some stride out
  gait: number;   // gait angle, advances with distance walked so feet never slide
  pace: number;   // current ground speed
  haul: number; store: number; cartYaw: number;   // pulling a cart of goods from the workplace to the storehouse
}

/** Villagers who live in houses, walk the village paths to their workplace and back. Hunters leave the lodge to stalk game. */
export class People {
  private agents: Agent[] = [];
  private sig = '';
  private parent: number[] = [];
  private link: Map<number, [number, number][]> = new Map();   // child building -> its walkable route to its parent (doorstep to doorstep, over drawbridges)
  private bld: { kind: number; x: number; z: number }[] = [];
  private radii: number[] = [];
  private t = 0;
  /** Workers per workplace, from the village state. */
  private staffAt = new Map<number, number>();
  /** For each building, the direction its paths leave in. */
  private doorAngle = new Map<number, number>();
  hidden = false;           // villagers shelter indoors during a battle
  /** Hand carts that carry goods from workplaces to the storehouse (or the hall). */
  group = new THREE.Group();
  private cartBody: THREE.InstancedMesh; private cartLoad: THREE.InstancedMesh; private cartWheel: THREE.InstancedMesh; private cartShaft: THREE.InstancedMesh;
  private tm = new THREE.Matrix4(); private tq = new THREE.Quaternion(); private tq2 = new THREE.Quaternion(); private tp = new THREE.Vector3(); private ts = new THREE.Vector3(1, 1, 1); private tc = new THREE.Color();
  hooks: Hooks = { wild: null, arrow: () => {}, splash: () => {} };
  private fires: { x: number; z: number; r: number }[] = [];
  private wells: { x: number; z: number }[] = [];
  private jobs: { x: number; z: number; r: number }[] = [];
  /** Damaged buildings and ruins the builders should visit. */
  setJobs(list: { x: number; z: number; r: number }[]) { this.jobs = list; }
  /** Burning buildings, as given by World.fires_flat(). */
  setFires(flat: Float32Array) { this.fires = []; for (let i = 0; i < flat.length; i += 4) if (flat[i] === 0) this.fires.push({ x: flat[i + 1], z: flat[i + 2], r: flat[i + 3] }); }

  constructor(private terrain: Terrain) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }), load = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, n: number) => { const q = new THREE.InstancedMesh(g, m, n); q.castShadow = true; q.frustumCulled = false; q.count = 0; this.group.add(q); return q; };
    this.cartBody = mk(new THREE.BoxGeometry(1.1, 0.3, 1.6), wood, 100); this.cartLoad = mk(new THREE.BoxGeometry(0.95, 0.5, 1.35), load, 100);
    this.cartWheel = mk(new THREE.CylinderGeometry(0.38, 0.38, 0.1, 10).rotateZ(Math.PI / 2), dark, 200); this.cartShaft = mk(new THREE.BoxGeometry(0.08, 0.08, 1.5), dark, 100);
    this.cartLoad.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(100 * 3), 3);
  }

  private rand(a: Agent, k: number) { const x = Math.sin(a.seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); }

  sync(buildings: Float32Array, paths: Float32Array, radii: number[], population: number) {
    const n = buildings.length / S;
    this.radii = radii; this.bld = []; this.parent = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) this.bld.push({ kind: buildings[i * S], x: buildings[i * S + 2], z: buildings[i * S + 3] });
    this.wells = this.bld.filter(b => b.kind === 16).map(b => ({ x: b.x, z: b.z }));
    this.link.clear();
    for (let o = 0; o < paths.length;) { const c = paths[o], p = paths[o + 1], m = paths[o + 2], pts: [number, number][] = []; for (let k = 0; k < m; k++) pts.push([paths[o + 3 + 2 * k], paths[o + 4 + 2 * k]]); this.parent[c] = p; this.link.set(c, pts); o += 3 + 2 * m; }
    // the side of each building its paths leave from: where people stand when they arrive. (A random spot all round the building could be on the far side of a wall that stands beside it.)
    this.doorAngle.clear();
    for (const [c, pts] of this.link) {
      const p = this.parent[c], B = this.bld[c], P = this.bld[p];
      if (B && pts.length >= 2 && !this.doorAngle.has(c)) this.doorAngle.set(c, Math.atan2(pts[1][1] - B.z, pts[1][0] - B.x));
      if (P && pts.length >= 2) { const q = pts[pts.length - 2]; if (!this.doorAngle.has(p)) this.doorAngle.set(p, Math.atan2(q[1] - P.z, q[0] - P.x)); }
    }

    const homes: number[] = [], works: number[] = [];
    for (let i = 0; i < n; i++) {
      const res = buildings[i * S + 9], staff = buildings[i * S + 8];
      for (let k = 0; k < res; k++) homes.push(i);
      if (this.bld[i].kind !== 15 && this.bld[i].kind !== 19) for (let k = 0; k < staff; k++) works.push(i);
    }
    // every workplace with workers: the number of them, so each can be shown at its building (see `draw`)
    this.staffAt.clear();
    for (const b of works) this.staffAt.set(b, (this.staffAt.get(b) ?? 0) + 1);
    const total = Math.min(MAX, population, Math.max(homes.length, 0));
    const roster: { home: number; work: number }[] = [];
    for (let i = 0; i < total; i++) roster.push({ home: homes[(i * 7) % Math.max(1, homes.length)] ?? 0, work: i < works.length ? works[i] : 0 });
    const sig = roster.map(r => r.home * 64 + r.work).join(',') + '|' + n + '|' + paths.length;
    if (sig === this.sig) return;
    this.sig = sig;

    while (this.agents.length > roster.length) this.agents.pop();
    roster.forEach((r, i) => {
      let a = this.agents[i];
      if (!a) {
        const h = this.bld[r.home];
        a = { x: h?.x ?? 0, z: h?.z ?? 0, yaw: 0, home: r.home, work: r.work, route: [], at: 0, dwell: 0, goingToWork: false, seed: i * 1.7 + 3, tool: 0, body: 0, skin: 0, dress: false, scale: 1, hunter: false, stage: 0, shift: 0, target: null, carry: false, aim: false, base: 1.4, gait: 0, pace: 0, fight: false, fs: 0, fsT: 0, fireTo: null, crew: false, cs: 0, cT: 0, job: null, haul: 0, store: 0, cartYaw: 0 };
        a.dwell = this.rand(a, 1) * 12; a.gait = this.rand(a, 11) * 6.28; this.agents[i] = a;
      }
      const changed = a.home !== r.home || a.work !== r.work;
      a.home = r.home; a.work = r.work;
      if (changed) { a.route = []; a.dwell = this.rand(a, 2) * 3; a.stage = 0; a.target = null; a.carry = false; a.haul = 0; }
      this.dress(a);
    });
  }

  /** Pick the look of an agent from where they work. */
  private dress(a: Agent) {
    const kind = this.bld[a.work]?.kind ?? 15, look = LOOKS[kind];
    const r = (k: number) => this.rand(a, k);
    a.skin = SKIN[Math.floor(r(6) * SKIN.length)];
    a.hunter = kind === 18;
    if (look) {
      a.hat = look[0]; a.tool = look[1]; a.body = look[2][Math.floor(r(5) * look[2].length)]; a.dress = false; a.scale = 1 + (r(9) - 0.5) * 0.1;
    } else {
      // unemployed: villagers, women and children going about their day
      const woman = r(7) < 0.5, kid = r(8) < 0.18;
      a.dress = woman && !kid; a.tool = 0; a.hat = woman ? (r(4) < 0.5 ? HAT.COIF : undefined) : (r(4) < 0.4 ? HAT.CAP : r(4) < 0.6 ? HAT.STRAW : undefined);
      a.body = woman ? DRESS[Math.floor(r(5) * DRESS.length)] : PLAIN[Math.floor(r(5) * PLAIN.length)]; a.scale = kid ? 0.68 : 1 + (r(9) - 0.5) * 0.1;
    }
    // everyone walks at their own pace: about 1.0 to 1.7 units/s, children trot a little faster on short legs, hunters stride out
    const kidScale = a.scale < 0.8;
    a.base = (1.0 + r(12) * 0.7) * (kidScale ? 1.1 : 1) * (a.hunter ? 1.12 : 1);
  }

  private chain(i: number) { const c = [i]; let g = 0; while (this.parent[c[c.length - 1]] >= 0 && g++ < 200) c.push(this.parent[c[c.length - 1]]); return c; }

  private route(from: number, to: number, fromPos: THREE.Vector2): THREE.Vector2[] {
    if (from === to || !this.bld[from] || !this.bld[to]) return [this.spot(to, 1)];
    const ca = this.chain(from), cb = this.chain(to), setB = new Set(cb);
    const lca = ca.find(x => setB.has(x));
    if (lca === undefined) return [fromPos.clone()];   // no path joins them (a house behind a moat with no drawbridge): nobody wades through
    const nodes = [...ca.slice(0, ca.indexOf(lca) + 1), ...cb.slice(0, cb.indexOf(lca)).reverse()];
    const out: THREE.Vector2[] = [fromPos.clone()];
    const door = (b: number, dx: number, dz: number, extra = 1.0) => { const r = this.radii[this.bld[b].kind] + extra, l = Math.hypot(dx, dz) || 1; return new THREE.Vector2(this.bld[b].x + (dx / l) * r, this.bld[b].z + (dz / l) * r); };
    for (let i = 0; i < nodes.length - 1; i++) {
      const A = this.bld[nodes[i]], B = this.bld[nodes[i + 1]], dx = B.x - A.x, dz = B.z - A.z;
      // the walkable route between the two linked buildings (it goes through gates and over drawbridges, never across water)
      const fwd = this.parent[nodes[i]] === nodes[i + 1], raw = (fwd ? this.link.get(nodes[i]) : this.link.get(nodes[i + 1])) ?? [[A.x, A.z], [B.x, B.z]];
      const pts = fwd ? raw : [...raw].reverse(), mid = pts.slice(1, -1);
      const exit = door(nodes[i], (pts[1]?.[0] ?? B.x) - A.x, (pts[1]?.[1] ?? B.z) - A.z), enter = door(nodes[i + 1], (pts[pts.length - 2]?.[0] ?? A.x) - B.x, (pts[pts.length - 2]?.[1] ?? A.z) - B.z);
      if (i > 0) {
        const prev = out[out.length - 1], c = new THREE.Vector2(A.x, A.z), a1 = Math.atan2(prev.y - c.y, prev.x - c.x), a2 = Math.atan2(exit.y - c.y, exit.x - c.x);
        let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        const R = this.radii[A.kind] + 1.0, steps = Math.floor(Math.abs(d) / 0.5);
        for (let k = 1; k <= steps; k++) out.push(new THREE.Vector2(c.x + Math.cos(a1 + (d * k) / (steps + 1)) * R, c.y + Math.sin(a1 + (d * k) / (steps + 1)) * R));
      }
      out.push(exit); for (const q of mid) out.push(new THREE.Vector2(q[0], q[1])); out.push(enter);
    }
    out.push(this.spot(to, 1));
    return out;
  }

  private spot(b: number, salt: number): THREE.Vector2 {
    const B = this.bld[b]; if (!B) return new THREE.Vector2();
    const door = this.doorAngle.get(b), jitter = (Math.sin(b * 91.7 + salt * 17.3) * 43758.5453 % 1), a = door !== undefined ? door + jitter * 1.2 : jitter * Math.PI * 2, r = this.radii[B.kind] + 1.3 + Math.abs(Math.sin(b * 3.1 + salt)) * 0.8;
    return new THREE.Vector2(B.x + Math.cos(a) * r, B.z + Math.sin(a) * r);
  }

  /** Hunters: walk out, shoot an animal, fetch it, come back. */
  private hunt(a: Agent, step: number, speed: number) {
    const w = this.hooks.wild, L = this.bld[a.work];
    if (!w || !L) { a.dwell = 5; return; }
    a.shift -= step * Math.max(1, speed);
    if (a.shift <= 0 && a.stage === 0) { a.goingToWork = false; a.route = this.route(a.work, a.home, new THREE.Vector2(a.x, a.z)); a.at = 1; return; }
    if (a.stage === 0) {
      const t = w.nearest(L.x, L.z, 55);
      if (!t) { a.dwell = 4; return; }
      a.target = t; a.stage = 1;
      const dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz) || 1, stop = Math.max(0, d - 13);
      a.route = [new THREE.Vector2(a.x, a.z), new THREE.Vector2(a.x + (dx / d) * stop, a.z + (dz / d) * stop)]; a.at = 1;
    } else if (a.stage === 1) { a.stage = 2; a.dwell = 1.0; a.aim = true; }
    else if (a.stage === 2) {
      a.aim = false;
      const t = a.target;
      if (t && t.alive) {
        this.hooks.arrow(a.x, this.terrain.walkAt(a.x, a.z) + 1.4, a.z, t.x, this.terrain.walkAt(t.x, t.z) + 0.6, t.z);
        w.kill(t); a.stage = 3; a.route = [new THREE.Vector2(a.x, a.z), new THREE.Vector2(t.x, t.z)]; a.at = 1;
      } else a.stage = 0;
    } else if (a.stage === 3) {
      if (a.target) w.remove(a.target); a.target = null; a.carry = true; a.stage = 4;
      a.route = [new THREE.Vector2(a.x, a.z), this.spot(a.work, 3)]; a.at = 1;
    } else { a.carry = false; a.stage = 0; a.dwell = 1.5; }
  }

  /** Bucket brigade: some villagers fetch water from the nearest well and throw it on burning buildings. */
  private duty(a: Agent, step: number) {
    if (a.route.length && a.at < a.route.length) return;                 // still walking
    const well = (x: number, z: number) => this.wells.reduce((b, w) => (Math.hypot(w.x - x, w.z - z) < Math.hypot(b.x - x, b.z - z) ? w : b), this.wells[0]);
    switch (a.fs) {
      case 0: { const f = this.fires[Math.floor(this.rand(a, 20) * this.fires.length) % this.fires.length], w = well(f.x, f.z), ang = this.rand(a, 21) * 6.28; a.fireTo = f; a.route = [new THREE.Vector2(a.x, a.z), new THREE.Vector2(w.x + Math.cos(ang) * 1.6, w.z + Math.sin(ang) * 1.6)]; a.at = 1; a.fs = 1; return; }
      case 1: a.fs = 2; a.fsT = 0.9; a.carry = false; return;                                         // fill the bucket
      case 2: { a.fsT -= step; if (a.fsT > 0) return; const f = a.fireTo ?? this.fires[0], ang = Math.atan2(a.z - f.z, a.x - f.x) + (this.rand(a, 22) - 0.5) * 1.4, d = f.r + 2.4;
        a.carry = true; a.route = [new THREE.Vector2(a.x, a.z), new THREE.Vector2(f.x + Math.cos(ang) * d, f.z + Math.sin(ang) * d)]; a.at = 1; a.fs = 3; return; }
      case 3: { const f = a.fireTo ?? this.fires[0]; a.yaw = Math.atan2(f.x - a.x, f.z - a.z); a.fs = 4; a.fsT = 0.7;
        this.hooks.splash(a.x, this.terrain.walkAt(a.x, a.z) + 1.3, a.z, f.x, this.terrain.walkAt(f.x, f.z) + 2.4, f.z); return; }
      default: a.fsT -= step; if (a.fsT <= 0) { a.carry = false; a.fs = 0; }
    }
  }

  /** Builders walk to the nearest job, hammer away for a few seconds, then move on to the next. */
  private crewDuty(a: Agent, step: number) {
    if (a.route.length && a.at < a.route.length) return;
    const L = this.bld[a.work]; if (!L) return;
    switch (a.cs) {
      case 0: {
        let best: { x: number; z: number; r: number } | null = null, bd = 70;
        for (const j of this.jobs) { const d = Math.hypot(j.x - L.x, j.z - L.z) + this.rand(a, 30) * 6; if (d < bd) { bd = d; best = j; } }
        if (!best) { a.crew = false; a.route = []; a.dwell = 1; return; }
        const ang = this.rand(a, 31 + Math.floor(this.t)) * 6.28, d = best.r + 1.3; a.job = best;
        a.route = [new THREE.Vector2(a.x, a.z), new THREE.Vector2(best.x + Math.cos(ang) * d, best.z + Math.sin(ang) * d)]; a.at = 1; a.cs = 1; return;
      }
      case 1: a.cs = 2; a.cT = 3.5 + this.rand(a, 33) * 3; if (a.job) a.yaw = Math.atan2(a.job.x - a.x, a.job.z - a.z); return;
      default: a.cT -= step; if (a.cT <= 0) a.cs = 0;
    }
  }

  update(dt: number, speed: number) {
    this.t += dt;
    // builders from a Builders' Yard go to work on damaged buildings and ruins while there is something to mend
    for (const a of this.agents) {
      const isBuilder = this.bld[a.work]?.kind === 20 && !a.fight;
      if (isBuilder && this.jobs.length && !a.crew) { a.crew = true; a.cs = 0; a.route = []; a.haul = 0; }
      else if (a.crew && (!isBuilder || !this.jobs.length)) { a.crew = false; a.cs = 0; a.route = []; a.dwell = 1; }
    }
    // who is on fire duty? up to eight villagers, but only if there is a well to draw from
    const wantFight = this.fires.length > 0 && this.wells.length > 0, need = wantFight ? Math.min(8, Math.floor(this.agents.length / 2)) : 0;
    let have = 0; for (const a of this.agents) if (a.fight) have++;
    if (have < need) for (const a of this.agents) { if (have >= need) break; if (!a.fight && !a.hunter) { a.fight = true; a.fs = 0; a.route = []; a.carry = false; a.haul = 0; have++; } }
    else if (have > need) for (const a of this.agents) { if (have <= need) break; if (a.fight) { a.fight = false; a.fs = 0; a.route = []; a.carry = false; a.dwell = 1 + this.rand(a, 23) * 3; have--; } }
    // the village clock runs slowly now; people move a little faster when the clock is sped up, but never absurdly
    const vs = Math.min(2.5, 0.8 + 0.35 * Math.max(0.5, speed || 1)), step = Math.min(dt, 0.1);
    for (const a of this.agents) {
      const mvSp = a.base * vs * (a.hunter && a.stage >= 1 ? 1.35 : 1) * (a.carry ? 0.85 : 1) * (a.fight ? 1.7 : 1);
      if (a.fight) this.duty(a, step); else if (a.crew) this.crewDuty(a, step);
      a.pace = 0;
      if (a.route.length && a.at < a.route.length) {
        const w = a.route[a.at], dx = w.x - a.x, dz = w.y - a.z, d = Math.hypot(dx, dz), mv = mvSp * step;
        const stride = 0.55 + 0.13 * mvSp;                  // faster walkers take longer steps
        if (d <= mv) { a.x = w.x; a.z = w.y; a.at++; a.gait += Math.PI * d / stride; } else {
          a.x += (dx / d) * mv; a.z += (dz / d) * mv; a.gait += Math.PI * mv / stride;
          const want = Math.atan2(dx, dz); let da = want - a.yaw; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          a.yaw += da * Math.min(1, step * 9);                // turn smoothly instead of snapping
        }
        a.pace = mvSp;
        if (a.at >= a.route.length) {
          a.route = [];
          if (a.haul === 1) { a.haul = 0; a.route = this.route(a.store, a.home, new THREE.Vector2(a.x, a.z)); a.at = 1; }   // unloaded: now home
          else if (a.hunter && a.goingToWork && a.stage > 0) a.dwell = 0.05;
          else { a.dwell = (a.goingToWork ? 18 : 8) * (0.6 + this.rand(a, 4)) / Math.max(1, speed); if (a.hunter && a.goingToWork) { a.shift = 40 + this.rand(a, 8) * 30; a.stage = 0; a.dwell = 0.5; } }
        }
      } else if (!a.fight && !a.crew) {
        a.dwell -= step * Math.max(1, speed);
        if (a.hunter && a.goingToWork && a.shift > 0 && a.dwell <= 0) { this.hunt(a, step, speed); continue; }
        if (a.dwell <= 0 && this.bld.length) {
          a.goingToWork = !a.goingToWork;
          const from = a.goingToWork ? a.home : a.work, to = a.goingToWork ? a.work : a.home;
          a.route = this.route(from, to, new THREE.Vector2(a.x, a.z)); a.at = 1;
          if (a.hunter && !a.goingToWork) { a.stage = 0; a.carry = false; a.target = null; }
          // leaving work with a full cart: take it to the nearest storehouse (or the hall) before going home
          if (!a.goingToWork && !a.hunter && !a.crew && HAULS[this.bld[a.work]?.kind]) {
            let best = 0, bd = 1e9; this.bld.forEach((q, i) => { if (q.kind === 25 || (i === 0 && best === 0)) { const d = Math.hypot(q.x - this.bld[a.work].x, q.z - this.bld[a.work].z); if (q.kind === 25 ? d < bd : bd === 1e9) { bd = d; best = i; } } });
            if (best !== a.work && bd > 7) { a.haul = 1; a.store = best; a.route = this.route(a.work, best, new THREE.Vector2(a.x, a.z)); a.at = 1; }
          }
        }
      }
    }
  }

  /** Carts behind the villagers who are hauling goods. */
  private drawCarts(cx: number, cz: number, r2: number) {
    let n = 0, w = 0;
    for (const a of this.agents) {
      if (a.haul !== 1 || n >= 100) continue;
      if ((a.x - cx) ** 2 + (a.z - cz) ** 2 > r2) continue;
      let dy = a.yaw - a.cartYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; a.cartYaw += dy * 0.12;
      const sx = Math.sin(a.cartYaw), sz = Math.cos(a.cartYaw), px = a.x - sx * 2.1, pz = a.z - sz * 2.1, y = this.terrain.walkAt(px, pz);
      this.tq.setFromAxisAngle(this.ty, a.cartYaw);
      this.tp.set(px, y + 0.55, pz); this.tm.compose(this.tp, this.tq, this.ts); this.cartBody.setMatrixAt(n, this.tm);
      this.tp.set(px, y + 0.9, pz); this.tm.compose(this.tp, this.tq, this.ts); this.cartLoad.setMatrixAt(n, this.tm); this.cartLoad.setColorAt(n, this.tc.setHex(LOAD[this.bld[a.work]?.kind] ?? 0x9a7a4a));
      this.tp.set(a.x - sx * 1.0, this.terrain.walkAt(a.x, a.z) + 0.85, a.z - sz * 1.0); this.tm.compose(this.tp, this.tq, this.ts); this.cartShaft.setMatrixAt(n, this.tm);
      this.tq2.setFromAxisAngle(this.tx, a.gait * 0.5); this.tq2.premultiply(this.tq);
      for (const s of [-1, 1]) { this.tp.set(px + sz * 0.6 * s, y + 0.38, pz - sx * 0.6 * s); this.tm.compose(this.tp, this.tq2, this.ts); this.cartWheel.setMatrixAt(w++, this.tm); }
      n++;
    }
    this.cartBody.count = this.cartLoad.count = this.cartShaft.count = n; this.cartWheel.count = w;
    for (const q of [this.cartBody, this.cartLoad, this.cartShaft, this.cartWheel]) q.instanceMatrix.needsUpdate = true;
    if (this.cartLoad.instanceColor) this.cartLoad.instanceColor.needsUpdate = true;
  }
  private ty = new THREE.Vector3(0, 1, 0); private tx = new THREE.Vector3(1, 0, 0);

  /** Queue everyone for drawing. */
  /** Queue everyone near the view for drawing (people far outside the screen are skipped). */
  draw(crowd: Crowd, cx = 0, cz = 0, radius = 1e9) {
    if (this.hidden) { this.cartBody.count = this.cartLoad.count = this.cartShaft.count = this.cartWheel.count = 0; return; }
    const r2 = radius * radius; this.drawCarts(cx, cz, r2); this.drawStations(crowd, cx, cz, r2);
    for (const a of this.agents) {
      if ((a.x - cx) ** 2 + (a.z - cz) ** 2 > r2) continue;
      const walking = a.route.length > 0 && a.at < a.route.length;
      const pose: Draw['pose'] = walking ? 1 : a.fight && a.fs === 4 ? 3 : a.aim ? 3 : a.fight ? 0 : a.crew ? (a.cs === 2 ? 2 : 0) : a.goingToWork && a.tool && !a.hunter ? 2 : 0;
      crowd.add({
        x: a.x, y: this.terrain.walkAt(a.x, a.z), z: a.z, yaw: a.yaw + (walking ? 0 : Math.sin(this.t * 0.9 + a.seed) * 0.35), pose, phase: walking ? a.gait : this.t + a.seed, speed: walking ? a.pace : 0,
        body: a.body, skin: a.skin, hat: a.hat, tool: a.fight ? TOOL.BUCKET : a.tool || undefined, dress: a.dress, scale: a.scale, swing: a.aim ? 0 : a.fight && a.fs === 4 ? Math.max(0.05, a.fsT / 0.7) : undefined,
        legs: a.dress ? a.body : 0x4a3a2a,
      });
    }
  }

  /** Workers stand at their workplace for only part of the day (the rest they walk or are at home), and there are fewer walking villagers than workers, so a busy building could look
   *  empty. Every workplace with workers always shows at least one (up to two) of them at work beside it, in addition to any who are really there. */
  drawStations(crowd: Crowd, cx: number, cz: number, r2: number) {
    const present = new Map<number, number>();
    for (const a of this.agents) {
      if (a.route.length && a.at < a.route.length) continue;
      const B = this.bld[a.work]; if (!B || Math.hypot(a.x - B.x, a.z - B.z) > this.radii[B.kind] + 4.5) continue;
      present.set(a.work, (present.get(a.work) ?? 0) + 1);
    }
    for (const [b, staff] of this.staffAt) {
      const B = this.bld[b]; if (!B || (B.x - cx) ** 2 + (B.z - cz) ** 2 > r2) continue;
      const need = Math.min(2, staff) - (present.get(b) ?? 0);
      for (let k = 0; k < need; k++) {
        const p = this.spot(b, 7 + k * 5), look = LOOKS[B.kind], seed = b * 13 + k * 7, r = (j: number) => { const x = Math.sin(seed * 12.9898 + j * 78.233) * 43758.5453; return x - Math.floor(x); };
        const woman = !look && r(1) < 0.5;
        crowd.add({
          x: p.x, y: this.terrain.walkAt(p.x, p.y), z: p.y, yaw: Math.atan2(B.x - p.x, B.z - p.y) + Math.sin(this.t * 0.7 + seed) * 0.25, pose: 2, phase: this.t * 1.1 + seed, speed: 0,
          body: look ? look[2][Math.floor(r(2) * look[2].length)] : woman ? DRESS[Math.floor(r(2) * DRESS.length)] : PLAIN[Math.floor(r(2) * PLAIN.length)], skin: SKIN[Math.floor(r(3) * SKIN.length)],
          hat: look?.[0], tool: look ? look[1] || undefined : undefined, dress: woman, scale: 1 + (r(4) - 0.5) * 0.1, legs: woman ? DRESS[0] : 0x4a3a2a,
        });
      }
    }
  }

  get count() { return this.agents.length; }
  positions() { return this.agents.map(a => ({ x: a.x, z: a.z })); }
}
