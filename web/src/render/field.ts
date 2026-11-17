import * as THREE from 'three';
import type { Terrain } from './terrain';
import { HAT, TOOL, ARM_REST, buildCatapult, buildRam, type Crowd, type Draw } from './crowd';

export interface Obstacle { x: number; z: number; r: number }
export interface TreeQuery { countTrees(x: number, z: number, r: number): number; nearTrees(x: number, z: number, r: number, out: { x: number; z: number }[]): void }

interface Member { kind: number; x: number; z: number; px: number; pz: number; yaw: number; gait: number; spd: number; seed: number; row: number;
  /** Its velocity: soldiers speed up and turn gradually, so every change of plan is a smooth curve. */
  vx?: number; vz?: number;
  /** Seconds it has been held up by the water's edge while trying to keep its place. */
  stuck?: number;
  /** Position before the soldiers were pushed apart this frame. */
  qx?: number; qz?: number;
  /** The height it is drawn at: follows the ground or a deck, but never faster than a person could climb. */
  dy?: number }
interface Det {
  route: number[] | null; id: number; x: number; z: number; tx: number; tz: number; sx: number; sz: number; segT: number; segD: number; lastSync: number; heading: number; yaw: number; units: number[]; state: number; mode: number; prog: number; speed: number;
  members: Member[]; sig: string; siege: THREE.Group[]; rams: THREE.Group[]; banner: THREE.Group; total: number; boats: THREE.Group | null;
  /** Recent centre positions (x, z pairs, oldest first): soldiers use this invisible route as a guide. */
  trail: number[];
  /** The centre's own speed, smoothed. */
  cspd: number;
  /** Whether the centre is moving along its route. */
  marching: boolean;
  /** Where the centre was a frame ago (NaN before the first). */
  lx: number; lz: number;
  /** Where the army has been ordered to go and the waypoints on the way (x, z pairs), for the dotted line and the flag. */
  dest: [number, number] | null; wps: number[];
  /** Where the core had the army and when it was seen there (newest last): the army is drawn a moment behind, between two of these, so it moves at a steady pace whatever the tick rate. */
  snaps: { t: number; x: number; z: number }[];
  dots: THREE.InstancedMesh | null; flag: THREE.Group | null;
  /** Knights (g3) and engines (g4) that march apart from the army at their own pace (see World.det_groups_flat): where they are drawn, where the core has them, and how they are heading. */
  g3?: Cluster | null; g4?: Cluster | null;
}
interface Cluster { x: number; z: number; tx: number; tz: number; yaw: number; spd: number; tied: boolean }

export const STATE_TEXT = ['Waiting for orders', 'Marching', 'Felling trees', 'Building a bridge', 'Crossing by boat', 'Arrived — ready to attack', 'Waiting for materials', 'Returning home', 'Fighting in the battle'];

import { trailAt, dotsAlong, nearestOnTrail } from './trail';
const TREE_R = 0.9;                     // soldiers keep this far from a trunk
const MAX_SHOWN = 70;
/** Siege engine dimensions used for ground clearance and wheel placement. */
export const SIEGE_LEN = 3.2;

/** Field armies on the map. The core plans the route for the army as a whole; here every soldier finds its own way along it:
 *  files up in dense forest and spreads out in the open, steps round trees and buildings, never walks into water. */
export class FieldView {
  group = new THREE.Group();
  private dets = new Map<number, Det>();
  private selected = new Set<number>();
  private ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.15, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, depthTest: false }));
  private t = 0;
  private rings: THREE.Mesh[] = [this.ring];
  private bridgeSeg: number[] = [];
  private tmp: { x: number; z: number }[] = [];
  friend = 0x2f5fa8;
  obstacles: () => Obstacle[] = () => [];

  constructor(private terrain: Terrain, private trees: TreeQuery) { this.ring.renderOrder = 11; this.ring.visible = false; this.group.add(this.ring); }

  select(ids: number[]) { this.selected = new Set(ids); }
  get(id: number) { return this.dets.get(id); }
  ids() { return [...this.dets.keys()]; }
  position(id: number) { const d = this.dets.get(id); return d ? { x: d.x, z: d.z } : null; }

  setBridges(flat: Float32Array) { this.bridgeSeg = Array.from(flat); }

  /** Read det_groups_flat() (stride 8: army id, kind, count, x, z, heading, speed, tied): riders and engines on their own march. */
  setGroups(flat: ArrayLike<number>) {
    const set = new Map<string, number>();
    for (let o = 0; o + 7 < flat.length; o += 8) set.set(flat[o] + ':' + flat[o + 1], o);
    for (const d of this.dets.values()) for (const kind of [3, 4] as const) {
      const o = set.get(d.id + ':' + kind), key = kind === 3 ? 'g3' : 'g4';
      if (o === undefined) { d[key] = null; continue; }
      const old = d[key], tx = flat[o + 3], tz = flat[o + 4];
      d[key] = { x: old ? old.x : tx, z: old ? old.z : tz, tx, tz, yaw: Math.PI / 2 - flat[o + 5], spd: flat[o + 6], tied: flat[o + 7] > 0 };
    }
  }

  /** Read det_flat() (stride 16). `path(id)` gives the army's remaining route [x, z, mode, ...], which is rounded off and then followed exactly. */
  sync(flat: Float32Array, path?: (id: number) => ArrayLike<number>) {
    const seen = new Set<number>();
    for (let o = 0; o < flat.length; o += 17) {
      const id = flat[o]; seen.add(id);
      let d = this.dets.get(id);
      const units = [flat[o + 3], flat[o + 4], flat[o + 5], flat[o + 6], flat[o + 7], flat[o + 16]], sig = units.join(',');
      if (!d) {
        const banner = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6), new THREE.MeshStandardMaterial({ color: 0x4a3420 })); pole.position.y = 2.1; pole.castShadow = true;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), new THREE.MeshStandardMaterial({ color: this.friend, side: THREE.DoubleSide, roughness: 0.8 })); cloth.position.set(0.8, 3.6, 0);
        banner.add(pole, cloth); banner.userData.detId = id; pole.userData.detId = id; cloth.userData.detId = id;
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 4.4, 8), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 2.2; hit.userData.detId = id; banner.add(hit);
        this.group.add(banner);
        d = { trail: [], cspd: 0, marching: false, lx: NaN, lz: NaN, dest: null, wps: [], snaps: [{ t: this.t, x: flat[o + 1], z: flat[o + 2] }], dots: null, flag: null, route: null, id, x: flat[o + 1], z: flat[o + 2], tx: flat[o + 1], tz: flat[o + 2], sx: flat[o + 1], sz: flat[o + 2], segT: 1, segD: 1, lastSync: this.t, heading: 0, yaw: 0, units, state: 0, mode: 0, prog: 0, speed: 0, members: [], sig: '', siege: [], rams: [], banner, total: 0, boats: null };
        this.dets.set(id, d);
      }
      const nx = flat[o + 1], nz = flat[o + 2];
      if (Math.hypot(nx - d.tx, nz - d.tz) > 1e-3) {
        // the core moves the army once per tick; glide there in a straight line over the time one tick takes, so motion is continuous
        if (Math.hypot(nx - d.x, nz - d.z) > 40) { d.x = nx; d.z = nz; d.snaps = []; }
        d.snaps.push({ t: this.t, x: nx, z: nz }); if (d.snaps.length > 6) d.snaps.shift();
        const full = path ? path(id) : null;
        d.route = full ? this.smoothRoute(d, full) : null;
        d.wps = []; if (full) for (let i = 0; i + 2 < full.length; i += 3) d.wps.push(full[i], full[i + 1]);
        d.dest = d.wps.length >= 2 ? [d.wps[d.wps.length - 2], d.wps[d.wps.length - 1]] : null;
        d.sx = d.x; d.sz = d.z; d.segT = 0; { const meas = Math.max(0.15, Math.min(4, this.t - d.lastSync)); d.segD = d.segD * 0.6 + meas * 0.4; } d.lastSync = this.t;
      }
      d.tx = nx; d.tz = nz; d.state = flat[o + 8]; d.mode = flat[o + 9]; d.prog = flat[o + 11]; d.speed = flat[o + 15];
      if (d.state === 1 || d.state === 2 || d.state === 7) d.heading = flat[o + 14];
      if (sig !== d.sig) this.rebuild(d, units, sig);
    }
    for (const [id, d] of [...this.dets]) if (!seen.has(id)) { this.dropMarks(d); this.group.remove(d.banner); d.banner.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); }); d.siege.forEach(s => this.group.remove(s)); d.rams.forEach(s => this.group.remove(s)); if (d.boats) this.group.remove(d.boats); this.dets.delete(id); }
  }

  private dotGeo = new THREE.CircleGeometry(0.22, 8).rotateX(-Math.PI / 2);
  private dotMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  private flagPole = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5);
  private tm = new THREE.Matrix4();

  private dropMarks(d: Det) {
    if (d.dots) { this.group.remove(d.dots); d.dots.dispose(); d.dots = null; }
    if (d.flag) { this.group.remove(d.flag); d.flag.traverse(o => { const m = o as THREE.Mesh; if (m.material && o !== d.flag) (m.material as THREE.Material).dispose?.(); }); d.flag = null; }
  }

  /** A dotted line from the army to where it is going, and a little flag there, while it is on its way (or selected and about to). */
  private drawMarks(d: Det) {
    const on = !!d.dest && (d.state === 1 || d.state === 2 || d.state === 3 || d.state === 4 || d.state === 6 || d.state === 7) && Math.hypot(d.dest[0] - d.x, d.dest[1] - d.z) > 2.5;
    if (!on) { if (d.dots) d.dots.visible = false; if (d.flag) d.flag.visible = false; return; }
    if (!d.dots) { d.dots = new THREE.InstancedMesh(this.dotGeo, this.dotMat, 160); d.dots.frustumCulled = false; d.dots.renderOrder = 6; this.group.add(d.dots); }
    if (!d.flag) {
      const f = new THREE.Group(), pole = new THREE.Mesh(this.flagPole, new THREE.MeshStandardMaterial({ color: 0x4a3420 })); pole.position.y = 1.3; pole.castShadow = true;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6, 4, 1), new THREE.MeshStandardMaterial({ color: this.friend, side: THREE.DoubleSide, roughness: 0.8 })); cloth.position.set(0.5, 2.25, 0); cloth.userData.cloth = true;
      f.add(pole, cloth); this.group.add(f); d.flag = f;
    }
    d.dots.visible = d.flag.visible = true;
    const line = [d.x, d.z, ...d.wps], dots = dotsAlong(line, 1.7, (this.t * 1.6) % 1.7, 160);
    let n = 0;
    for (let i = 0; i + 1 < dots.length; i += 2, n++) { this.tm.makeTranslation(dots[i], this.terrain.walkAt(dots[i], dots[i + 1]) + 0.22, dots[i + 1]); d.dots.setMatrixAt(n, this.tm); }
    d.dots.count = n; d.dots.instanceMatrix.needsUpdate = true;
    const [fx, fz] = d.dest!; d.flag.position.set(fx, this.terrain.walkAt(fx, fz), fz);
    (d.flag.children[1] as THREE.Mesh).rotation.y = Math.sin(this.t * 3 + d.id) * 0.3;
    ((d.flag.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(this.friend);
  }

  /** The rounded route for an army that is walking: from where it is drawn now, through the core's position, along the remaining waypoints, up to the first stretch of water. */
  private smoothRoute(d: Det, p: ArrayLike<number>): number[] | null {
    if (p.length < 6) return null;
    const prev = d.snaps.length >= 2 ? d.snaps[d.snaps.length - 2] : null;   // (the route starts where the army was drawn last: the drawn position runs a tick behind the core's)
    const pts: number[] = prev ? [prev.x, prev.z, 0] : [d.x, d.z, 0];
    for (let i = 0; i + 2 < p.length; i += 3) { if (p[i + 2] === 2) break; if (Math.hypot(p[i] - pts[pts.length - 3], p[i + 1] - pts[pts.length - 2]) > 0.05) pts.push(p[i], p[i + 1], p[i + 2]); }
    if (pts.length < 9) return null;
    const sm = smoothPath(pts), out: number[] = []; for (let i = 0; i < sm.length; i += 3) out.push(sm[i], sm[i + 1]);
    return out;
  }

  private rebuild(d: Det, units: number[], sig: string) {
    d.units = units; d.sig = sig; d.total = units.reduce((a, b) => a + b, 0);
    const scale = Math.min(1, MAX_SHOWN / Math.max(1, units[0] + units[1] + units[2] + units[3])), old = d.members;
    const members: Member[] = [];
    let n = 0;
    for (const kind of [0, 3, 2, 1]) {                                   // spearmen lead, then knights, swordsmen, archers
      const count = Math.max(units[kind] > 0 ? 1 : 0, Math.round(units[kind] * scale));
      for (let k = 0; k < count; k++, n++) { const prev = old[n]; members.push(prev ? { ...prev, kind } : { kind, x: d.x + (Math.random() - 0.5) * 3, z: d.z + (Math.random() - 0.5) * 3, px: d.x, pz: d.z, yaw: 0, gait: Math.random() * 6, spd: 0, seed: n * 1.7 + d.id * 5.3, row: 0 }); }
    }
    d.members = members;
    while (d.siege.length < units[4]) { const g = buildCatapult(); g.position.set(d.x, 0, d.z); this.group.add(g); d.siege.push(g); }
    while (d.siege.length > units[4]) this.group.remove(d.siege.pop()!);
    while (d.rams.length < (units[5] ?? 0)) { const g = buildRam(); g.position.set(d.x, 0, d.z); this.group.add(g); d.rams.push(g); }
    while (d.rams.length > (units[5] ?? 0)) this.group.remove(d.rams.pop()!);
  }

  /** Steepness of the ground at a point: the largest height change per unit over two paces round it. */
  private slopeAt(x: number, z: number) {
    const h = this.terrain.walkAt(x, z);
    return Math.max(Math.abs(this.terrain.walkAt(x + 2, z) - h), Math.abs(this.terrain.walkAt(x - 2, z) - h), Math.abs(this.terrain.walkAt(x, z + 2) - h), Math.abs(this.terrain.walkAt(x, z - 2) - h)) / 2;
  }

  private onBridge(x: number, z: number) {
    const b = this.bridgeSeg;
    for (let i = 0; i < b.length; i += 4) {
      const dx = b[i + 2] - b[i], dz = b[i + 3] - b[i + 1], l2 = dx * dx + dz * dz || 1, k = Math.max(0, Math.min(1, ((x - b[i]) * dx + (z - b[i + 1]) * dz) / l2));
      if ((x - (b[i] + dx * k)) ** 2 + (z - (b[i + 1] + dz * k)) ** 2 < 1.9 * 1.9) return true;
    }
    return false;
  }

  update(dt: number) {
    dt = Math.max(0, Math.min(dt, 0.2)); this.t += dt;
    const obs = this.obstacles();
    for (const d of this.dets.values()) {
      if (!Number.isFinite(d.x) || !Number.isFinite(d.z)) { d.x = d.tx; d.z = d.tz; }
      d.segT += dt; const k = Math.min(d.state === 1 || d.state === 7 ? 1.35 : 1, d.segT / d.segD), f = 1 - Math.exp(-dt * 12);
      // drawn one tick behind the core, between the last two places it was seen (carried on a little at the same pace if a tick is late): a steady glide, not a lurch at every tick
      let gx0 = d.tx, gz0 = d.tz;
      { const sn = d.snaps, rt = this.t - Math.max(0.15, d.segD);
        if (sn.length >= 2) {
          let j = -1; for (let q = 0; q < sn.length; q++) if (sn[q].t <= rt) j = q;
          if (j < 0) { gx0 = sn[0].x; gz0 = sn[0].z; }
          else if (j < sn.length - 1) { const a = sn[j], b = sn[j + 1], u = (rt - a.t) / Math.max(1e-3, b.t - a.t); gx0 = a.x + (b.x - a.x) * u; gz0 = a.z + (b.z - a.z) * u; }
          else { const a = sn[j - 1], b = sn[j], span = Math.max(1e-3, b.t - a.t), u = Math.min(0.6, (rt - b.t) / span); gx0 = b.x + (b.x - a.x) * u; gz0 = b.z + (b.z - a.z) * u; }
        } }
      let tx0 = gx0, tz0 = gz0;
      if (d.route && (d.state === 1 || d.state === 7)) { const n = nearestOnRoute(d.route, gx0, gz0); if (n && n.d < 3.5) { tx0 = n.x; tz0 = n.z; } }   // stay on the rounded route
      d.x += (tx0 - d.x) * f; d.z += (tz0 - d.z) * f;
      const sl = Math.hypot(d.tx - d.sx, d.tz - d.sz), walking = sl > 0.3 && k < 1;
      const want = walking ? Math.atan2(d.tx - d.sx, d.tz - d.sz) : Math.PI / 2 - d.heading; let da = want - d.yaw; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; d.yaw += da * Math.min(1, dt * 3);
      // Keep a short invisible trail for route following. Soldiers are released together;
      // they do not queue into a column or reform into ranks when they stop.
      { const lt = d.trail.length;
        if (lt < 2 || Math.hypot(d.x - d.trail[lt - 2], d.z - d.trail[lt - 1]) >= 0.45) d.trail.push(d.x, d.z);
        let len = 0, cut = 0;
        for (let k = d.trail.length - 2; k >= 2; k -= 2) { len += Math.hypot(d.trail[k] - d.trail[k - 2], d.trail[k + 1] - d.trail[k - 1]); if (len > 180) { cut = k - 2; break; } }
        if (cut > 0) d.trail.splice(0, cut);
        const px = Number.isFinite(d.lx) ? d.lx : d.x, pz = Number.isFinite(d.lz) ? d.lz : d.z; d.lx = d.x; d.lz = d.z;
        d.cspd += (Math.hypot(d.x - px, d.z - pz) / Math.max(dt, 0.001) - d.cspd) * Math.min(1, dt * 4);
        const going = d.state !== 4 && d.cspd > 0.15;
        d.marching = going;
        for (const m of d.members) m.stuck = 0;
      }
      for (const c of [d.g3, d.g4]) if (c) { const k = 1 - Math.exp(-dt * 5); c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; }
      const y = this.terrain.walkAt(d.x, d.z);
      d.banner.position.set(d.x, Math.max(y, d.state === 4 ? 0.3 : y), d.z);
      (d.banner.children[1] as THREE.Mesh).rotation.y = Math.sin(this.t * 3 + d.id) * 0.25;

      // Loose, unranked spacing. Individual soldiers steer around local obstacles.
      const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), rx = fz, rz = -fx;
      const moving = d.state === 1 || d.state === 2 || d.state === 7 || d.state === 4;
      const cruise = Math.max(1.5, d.speed * 1.2 + 1.5);

      d.members.forEach((m, i) => {
        const angle = (m.seed % 1) * Math.PI * 2, spread = 2.0 + Math.sqrt(i + 1) * 1.35;
        let gx = d.x + Math.cos(angle) * spread, gz = d.z + Math.sin(angle) * spread, spd = 0, pursuing = false;
        const kg = m.kind === 3 ? d.g3 : null;
        if (kg) {
          // Knights follow their own invisible route as a loose bunch, not in ranks.
          const r = 1.5 + Math.sqrt(i + 1) * 1.0;
          gx = kg.x + Math.cos(angle) * r; gz = kg.z + Math.sin(angle) * r; pursuing = true;
          spd = Math.max(0, kg.spd * 1.25 + 0.5 + Math.min(8, Math.hypot(gx - m.x, gz - m.z) * 0.8));
        } else if (d.marching) {
          const nt = nearestOnTrail(d.trail, d.x, d.z, m.x, m.z);
          const aim = Math.max(0, nt.s - 2.6 + Math.sin(angle * 2) * 2.5);
          [gx, gz] = trailAt(d.trail, d.x, d.z, aim, fx, fz);
          const lateral = Math.cos(angle) * 5.5;
          gx += rx * lateral; gz += rz * lateral;
          spd = Math.max(0, Math.min(d.cspd + 7, d.cspd + Math.max(-1, nt.s - 2.0) * 0.8));
          pursuing = true;
        }
        m.px = m.x; m.pz = m.z;
        const dx = gx - m.x, dz = gz - m.z, dist = Math.hypot(dx, dz);
        if (!pursuing) spd = Math.max(moving ? cruise : 3, dist * 0.7) * (0.9 + (m.seed % 1) * 0.2);
        // speed and heading change gradually: the velocity eases towards what the soldier wants, and it slows down on arriving
        const want = dist > 0.04 ? Math.min(spd, dist * 5) : 0, tvx = dist > 0.04 ? dx / dist * want : 0, tvz = dist > 0.04 ? dz / dist * want : 0, ease = Math.min(1, dt * (pursuing ? 7 : 5));
        m.vx = (m.vx ?? 0) + (tvx - (m.vx ?? 0)) * ease; m.vz = (m.vz ?? 0) + (tvz - (m.vz ?? 0)) * ease;
        m.x += m.vx * dt; m.z += m.vz * dt;
        // steer round things: trees, buildings, other soldiers
        this.tmp.length = 0; this.trees.nearTrees(m.x, m.z, TREE_R + 0.5, this.tmp);
        for (const t of this.tmp) { const ox = m.x - t.x, oz = m.z - t.z, od = Math.hypot(ox, oz) || 0.01; if (od < TREE_R) { m.x += ox / od * (TREE_R - od); m.z += oz / od * (TREE_R - od); } }
        for (const b of obs) { const ox = m.x - b.x, oz = m.z - b.z, od = Math.hypot(ox, oz) || 0.01, rr = b.r + 0.5; if (od < rr) { m.x += ox / od * (rr - od); m.z += oz / od * (rr - od); } }
        if (d.state !== 4) { const sn = this.terrain.snapToDeck(m.x, m.z); if (sn) { m.x = sn[0]; m.z = sn[1]; } }   // beside a bridge deck: up onto it
        // never wade into water: a step into it is undone, unless a bridge or drawbridge deck is under the soldier (the check knows how wide the deck really is)
        if (d.state !== 4 && this.terrain.wetAt(m.x, m.z) && !this.terrain.wetAt(m.px, m.pz)) {
          m.x = m.px; m.z = m.pz; m.vx = 0; m.vz = 0;
          m.stuck = (m.stuck ?? 0) + dt;
          if (pursuing && m.stuck > 0.6) { m.x = gx; m.z = gz; m.stuck = 0; }   // held up at the water's edge: back onto the path the head took
        } else m.stuck = 0;
        { const ty = d.state === 4 ? 0.35 : this.terrain.walkAt(m.x, m.z); m.dy = m.dy === undefined || !Number.isFinite(m.dy) ? ty : m.dy + Math.max(-9 * dt, Math.min(9 * dt, ty - m.dy)); }
        const moved = Math.hypot(m.x - m.px, m.z - m.pz);
        m.spd += (moved / Math.max(dt, 0.001) - m.spd) * Math.min(1, dt * 6);
        m.gait += Math.PI * moved / (0.55 + 0.13 * m.spd);
        if (moved > 0.01) { const want2 = Math.atan2(m.x - m.px, m.z - m.pz); let dd = want2 - m.yaw; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI; m.yaw += dd * Math.min(1, dt * 10); }
        else { let dd = d.yaw - m.yaw; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI; m.yaw += dd * Math.min(1, dt * 3); }
      });
      this.drawMarks(d);
      // Siege engines follow their own invisible route and spread out loosely around it.
      const engines = [...d.siege, ...d.rams];
      for (const g of d.siege) g.visible = d.state !== 8;
      for (const g of d.rams) g.visible = d.state !== 8;
      engines.forEach((g, i) => {
        let tx: number, tz: number;
        const eg = d.g4;
        if (eg) {
          const a = (i * 2.399963) % (Math.PI * 2), r = 2.0 + Math.sqrt(i + 1) * 1.8;
          tx = eg.x + Math.cos(a) * r; tz = eg.z + Math.sin(a) * r;
        } else {
          const a = (i * 2.399963) % (Math.PI * 2), r = 3.0 + Math.sqrt(i + 1) * 1.5;
          tx = d.x + Math.cos(a) * r; tz = d.z + Math.sin(a) * r;
          if (this.terrain.wetAt(tx, tz) || this.slopeAt(tx, tz) > 0.95) { [tx, tz] = trailAt(d.trail, d.x, d.z, 2.0 + i * 0.5, fx, fz); }
        }
        const px = g.position.x, pz = g.position.z, k = 1 - Math.exp(-dt * (eg ? 4 : 2.6));
        g.position.x += (tx - px) * k; g.position.z += (tz - pz) * k;
        this.tmp.length = 0; this.trees.nearTrees(g.position.x, g.position.z, 2.2, this.tmp);
        for (const t of this.tmp) { const ox = g.position.x - t.x, oz = g.position.z - t.z, od = Math.hypot(ox, oz) || 0.01; if (od < 1.6) { g.position.x += ox / od * (1.6 - od); g.position.z += oz / od * (1.6 - od); } }
        for (const o of obs) { const ox = g.position.x - o.x, oz = g.position.z - o.z, od = Math.hypot(ox, oz) || 0.01, rr = o.r + 1.6; if (od < rr) { g.position.x += ox / od * (rr - od); g.position.z += oz / od * (rr - od); } }
        if (d.state !== 4 && this.terrain.wetAt(g.position.x, g.position.z) && !this.terrain.wetAt(px, pz)) { g.position.x = px; g.position.z = pz; }   // a step into water is undone
        // it rests on the ground under both ends of its frame (the higher of the two, so the wheels never sink into a rise), changing height no faster than it could roll, and tilts with the slope
        const ddx = eg ? Math.sin(eg.yaw) : d.x - g.position.x, ddz = eg ? Math.cos(eg.yaw) : d.z - g.position.z, face = Math.atan2(ddx, ddz), hx = Math.sin(g.rotation.y), hz = Math.cos(g.rotation.y), half = SIEGE_LEN / 2;
        const yF = this.terrain.walkAt(g.position.x + hx * half, g.position.z + hz * half), yB = this.terrain.walkAt(g.position.x - hx * half, g.position.z - hz * half), yC = this.terrain.walkAt(g.position.x, g.position.z);
        const want = d.state === 4 ? 0.3 : Math.max(yC, (yF + yB) / 2, Math.min(yF, yB) + 0.0);
        const cy = g.userData.sy as number | undefined; g.userData.sy = cy === undefined || !Number.isFinite(cy) ? want : cy + Math.max(-6 * dt, Math.min(6 * dt, want - cy));
        g.position.y = Math.max(g.userData.sy as number, d.state === 4 ? 0.3 : Math.min(yF, yB, yC));   // (never below the lowest ground under it)
        g.rotation.y += (() => { let da = face - g.rotation.y; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; return da; })() * Math.min(1, dt * 3);
        g.rotation.x = d.state === 4 ? 0 : -Math.atan2(yF - yB, SIEGE_LEN) * 0.8;
        if (g.userData.arm) (g.userData.arm as THREE.Object3D).rotation.x = ARM_REST;
      });
      // boats while crossing wide water
      if (d.state === 4) {
        if (!d.boats) { d.boats = new THREE.Group(); const n = Math.max(1, Math.ceil(d.total / 8)); for (let i = 0; i < n; i++) { const b = makeBoat(); b.position.set((i - (n - 1) / 2) * 2.6, 0, 0); d.boats.add(b); } this.group.add(d.boats); }
        d.boats.position.set(d.x, 0.05 + Math.sin(this.t * 2) * 0.04, d.z); d.boats.rotation.y = d.yaw + Math.PI / 2;
      } else if (d.boats) { this.group.remove(d.boats); d.boats = null; }
    }
    this.separate(dt);
    // a pulsing ring under every selected army
    let ri = 0;
    for (const id of this.selected) {
      const d = this.dets.get(id); if (!d) continue;
      let r = this.rings[ri]; if (!r) { r = ri === 0 ? this.ring : this.ring.clone(); r.material = this.ring.material; this.group.add(r); this.rings[ri] = r; }
      r.visible = true; r.position.set(d.x, this.terrain.heightAt(d.x, d.z) + 0.3, d.z); r.scale.setScalar(2.5 + Math.sqrt(d.members.length) * 0.9); ri++;
    }
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(this.t * 4) * 0.25;
    for (let i = ri; i < this.rings.length; i++) this.rings[i].visible = false;
    this.ring.visible = ri > 0;
  }

  /** Soldiers keep their distance from every other soldier (also from other armies), pushed apart gently rather than snapped. */
  private grid = new Map<number, Member[]>(); private sepAll: Member[] = [];
  private separate(dt: number) {
    const cell = 1.6, grid = this.grid, all = this.sepAll; all.length = 0;
    if (grid.size > 4000) grid.clear(); else for (const arr of grid.values()) arr.length = 0;   // reuse the buckets instead of allocating them every frame
    for (const d of this.dets.values()) for (const m of d.members) { all.push(m); const key = Math.floor(m.x / cell) * 73856093 ^ Math.floor(m.z / cell) * 19349663; let c = grid.get(key); if (!c) grid.set(key, c = []); c.push(m); }
    for (const a of all) { a.qx = a.x; a.qz = a.z; }
    const R = 1.0, soft = Math.min(1, dt * 9) * 0.5;
    for (const a of all) {
      const cx = Math.floor(a.x / cell), cz = Math.floor(a.z / cell);
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
        const c = grid.get((cx + ix) * 73856093 ^ (cz + iz) * 19349663); if (!c) continue;
        for (const b of c) {
          if (b === a || b.seed < a.seed) continue;
          const ox = b.x - a.x, oz = b.z - a.z, od = Math.hypot(ox, oz);
          if (od < R && od > 1e-4) { const p = (R - od) * soft / od; a.x -= ox * p; a.z -= oz * p; b.x += ox * p; b.z += oz * p; }
          else if (od <= 1e-4) { a.x -= 0.02; b.x += 0.02; }
        }
      }
    }
    // being pushed by a neighbour must not put a soldier into the water (the soft push has no idea where the edge of a deck is)
    for (const a of all) if (a.qx !== undefined && this.terrain.wetAt(a.x, a.z) && !this.terrain.wetAt(a.qx, a.qz!)) { a.x = a.qx; a.z = a.qz!; }
  }

  draw(crowd: Crowd, cx: number, cz: number, radius: number) {
    const r2 = radius * radius;
    for (const d of this.dets.values()) {
      const front = d.state === 2;
      if (d.state === 8) continue;   // its soldiers are in the battle: the battle view draws them
      for (const m of d.members) {
        if ((m.x - cx) ** 2 + (m.z - cz) ** 2 > r2) continue;
        const y = m.dy ?? (d.state === 4 ? 0.35 : this.terrain.walkAt(m.x, m.z));   // (on a bridge or drawbridge: the height of its deck, reached smoothly)
        const look = lookOf(m.kind, this.friend), working = front && m.row === 0;
        crowd.add({ x: m.x, y, z: m.z, yaw: m.yaw, pose: working ? 2 : m.spd > 0.35 ? 1 : 0, phase: working ? this.t + m.seed : m.spd > 0.35 ? m.gait : this.t + m.seed, speed: m.spd, skin: 0xd9a877, ...look, ...(working ? { tool: TOOL.AXE, shield: undefined, mounted: false } : {}) } as Draw);
      }
    }
  }

  /** Which army's banner is under the pointer? */
  pick(ray: THREE.Raycaster): number | null {
    const hit = ray.intersectObject(this.group, true).find(h => h.object.userData.detId !== undefined);
    return hit ? hit.object.userData.detId : null;
  }
}

function lookOf(kind: number, col: number): Partial<Draw> {
  switch (kind) {
    case 0: return { body: col, hat: HAT.KETTLE, tool: TOOL.SPEAR, shield: 0, shieldCol: col, legs: 0x3a3a3a };
    case 1: return { body: 0x3f5a30, hat: HAT.HOOD, tool: TOOL.BOW, legs: 0x3a3228 };
    case 2: return { body: 0x8a9098, hat: HAT.HELM, tool: TOOL.SWORD, shield: 1, shieldCol: col, legs: 0x4a4a52, armor: true };
    default: return { body: 0xb8bec6, hat: HAT.GREAT, tool: TOOL.SWORD, shield: 1, shieldCol: col, mounted: true, legs: 0x5a5a62, armor: true };
  }
}

export function makeBoat(): THREE.Group {
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.9 }), dark = new THREE.MeshStandardMaterial({ color: 0x4a3420 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.55, 1.5), wood); hull.position.y = 0.2; hull.castShadow = true; g.add(hull);
  for (const s of [-1, 1]) { const bow = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.1, 4), wood); bow.rotation.z = -s * Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(s * 2.75, 0.2, 0); bow.scale.set(1, 1, 0.55); g.add(bow); }
  for (const x of [-1.2, 0, 1.2]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 1.5), dark); t.position.set(x, 0.52, 0); g.add(t); }
  const rim = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.12, 0.12), dark); rim.position.set(0, 0.5, 0.72); const rim2 = rim.clone(); rim2.position.z = -0.72; g.add(rim, rim2);
  return g;
}

/** Bridges the soldiers have built. Plain planks on posts, merged into one mesh. */
export class BridgesView {
  group = new THREE.Group();
  private sig = '';
  private mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a6a46, roughness: 0.9, vertexColors: true }));
  constructor(private terrain: Terrain) { this.mesh.castShadow = this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.group.add(this.mesh); }

  /** bridges: [ax, az, bx, bz, ...]; partial: [ax, az, bx, bz, progress] for one being built. */
  update(bridges: number[], partial: number[][]) {
    const sig = bridges.join(',') + '|' + partial.map(p => p.map(v => v.toFixed(1)).join(',')).join(';');
    if (sig === this.sig) return; this.sig = sig;
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry: number, hex: number) => {
      const geo = g.toNonIndexed(), c = new THREE.Color(hex), n = geo.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.deleteAttribute('uv');
      geo.rotateY(ry); geo.translate(x, y, z); parts.push(geo);
    };
    const build = (ax: number, az: number, bx: number, bz: number, frac: number) => {
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) * frac, ang = Math.atan2(dx, dz), ux = dx / Math.hypot(dx, dz), uz = dz / Math.hypot(dx, dz);
      for (let s = 0.3; s < L; s += 0.5) add(new THREE.BoxGeometry(2.4, 0.12, 0.42), ax + ux * s, 0.58, az + uz * s, ang, s % 1 < 0.5 ? 0x8a6a46 : 0x7a5a3a);
      for (let s = 0; s <= L + 0.01; s += 2.4) for (const side of [-1, 1]) {
        const px = ax + ux * s - uz * 1.25 * side, pz = az + uz * s + ux * 1.25 * side;
        add(new THREE.BoxGeometry(0.2, 2.4, 0.2), px, -0.5, pz, 0, 0x4a3420); add(new THREE.BoxGeometry(0.2, 0.2, 0.2), px, 1.0, pz, 0, 0x4a3420);
        if (s + 2.4 <= L + 0.01) add(new THREE.BoxGeometry(0.12, 0.12, 2.4), (px + (px + ux * 2.4)) / 2, 0.95, (pz + (pz + uz * 2.4)) / 2, ang, 0x6a4a2e);
      }
    };
    for (let i = 0; i < bridges.length; i += 4) build(bridges[i], bridges[i + 1], bridges[i + 2], bridges[i + 3], 1);
    for (const p of partial) build(p[0], p[1], p[2], p[3], Math.max(0.05, p[4]));
    this.mesh.geometry.dispose();
    void this.terrain;
    this.mesh.geometry = parts.length ? mergeAll(parts) : new THREE.BufferGeometry();
  }
}

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
function mergeAll(parts: THREE.BufferGeometry[]) { parts.forEach(p => { if (!p.attributes.normal) p.computeVertexNormals(); }); return mergeGeometries(parts)!; }

/** Closest point to (x, z) on a route polyline [x, z, x, z, ...]. */
function nearestOnRoute(r: number[], x: number, z: number): { x: number; z: number; d: number } | null {
  let best: { x: number; z: number; d: number } | null = null;
  for (let i = 0; i + 3 < r.length; i += 2) {
    const ax = r[i], az = r[i + 1], dx = r[i + 2] - ax, dz = r[i + 3] - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { x: px, z: pz, d };
  }
  return best;
}

/** Round the corners of a route [x, z, mode, ...] by cutting each corner (Chaikin), keeping both ends and the mode of every leg. */
export function smoothPath(pts: number[], rounds = 3): number[] {
  let p: number[][] = []; for (let i = 0; i + 2 < pts.length; i += 3) p.push([pts[i], pts[i + 1], pts[i + 2]]);
  for (let r = 0; r < rounds && p.length > 2; r++) {
    const q: number[][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1], m = b[2];
      if (i > 0) q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, m]);
      if (i < p.length - 2) q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, m]);
    }
    q.push(p[p.length - 1]); p = q;
  }
  return p.flat();
}

/** The route of the selected army, laid on the ground: white for walking, orange where trees are felled, blue across water. */
export class PathLine {
  mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
  constructor(private terrain: Terrain) { this.mesh.renderOrder = 12; this.mesh.frustumCulled = false; this.mesh.visible = false; }

  /** pts = [x, z, mode, ...] */
  set(pts: number[] | null, ok = true) {
    if (!pts || pts.length < 6) { this.mesh.visible = false; return; }
    pts = smoothPath(pts);
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    let prev: number[] | null = null; const colors = [[1, 1, 1], [1, 0.6, 0.15], [0.35, 0.7, 1]];
    for (let i = 0; i + 2 < pts.length; i += 3) {
      if (i === 0) { prev = [pts[0], pts[1]]; continue; }
      const ax = prev![0], az = prev![1], bx = pts[i], bz = pts[i + 1], mode = pts[i + 2], L = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(L / 1.5));
      const c = ok ? colors[mode] ?? colors[0] : [1, 0.3, 0.25], nx = -(bz - az) / (L || 1) * 0.32, nz = (bx - ax) / (L || 1) * 0.32;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = Math.max(0.3, this.terrain.heightAt(x, z)) + 0.35, dash = (s % 2 === 0) ? 1 : 0.55;
        pos.push(x + nx, y, z + nz, x - nx, y, z - nz); col.push(c[0] * dash, c[1] * dash, c[2] * dash, c[0] * dash, c[1] * dash, c[2] * dash);
        if (s > 0) { const k = pos.length / 3 - 4; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      prev = [bx, bz];
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    this.mesh.geometry.dispose(); this.mesh.geometry = g; this.mesh.visible = true;
  }
}
