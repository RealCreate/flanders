import * as THREE from 'three';
import type { Terrain } from './terrain';
import { HAT, TOOL, ARM_REST, buildCatapult, buildRam, setSiegeWheelTravel, type Crowd, type Draw } from './crowd';
import type { ArmyPicker } from './armypick';

import { dotsAlong } from './trail';
import { buildArmyBanner, paintArmyBanner, waveArmyBanner } from './armybanner';
import { arrivalSlot, marchPoint, marchSlot } from '../marchfile';
import { campLayout, patrolAt, type Camp } from '../camplayout';
import { ArmyCamp } from './armycamp';
import type { CampSite } from '../campsite';

interface Member {
  kind: number; x: number; z: number; y: number; yaw: number; gait: number; spd: number; seed: number;
  visible: boolean; drawn: boolean; mode: number; boat?: THREE.Group; guard?: boolean; there?: boolean; onPost?: boolean;
}
interface Track { points: Float32Array; gap: number; from: number; to: number; time: number; duration: number }
interface Det {
  id: number; x: number; z: number; tx: number; tz: number; heading: number; state: number;
  members: Member[]; sig: string; siege: THREE.Group[]; rams: THREE.Group[]; banner: THREE.Group;
  tracks: Map<number, Track>;
  approaches: Map<number, Float32Array[]>;
  dest: [number, number] | null; wps: number[];
  dots: THREE.InstancedMesh | null; flag: THREE.Group | null;
  /** The camp it makes as its soldiers arrive (see camplayout.ts): tents, a fence, a trough with the horses, guards on patrol, the siege engines in rows. `layAt` is what the layout was made for. */
  camp: ArmyCamp | null; lay: Camp | null; layAt: { x: number; z: number; yaw: number; key: string } | null; travelled: boolean;
  horses: { x: number; z: number; yaw: number; hex: number }[]; inCamp: number; clashT: number;
}

export const STATE_TEXT = ['Waiting for orders', 'Marching', 'Felling trees', 'Building a bridge', 'Crossing by boat', 'Arrived — ready to attack', 'Waiting for materials', 'Returning home', 'Fighting in the battle', 'Route blocked', 'Taking position'];
const FORMING = 10;
const MOVING = new Set([1, 2, 3, 4, 6, 7]);

const SIEGE_LEN = 3.2;
const PATROL_SPEED = 1.15;   // metres a second
const HORSE_COATS = [0x896044, 0x4a3426, 0x2e2622, 0xa89478, 0x6b4a30, 0x9b9488];

/** Draw the army on the waypoints actually traversed by the simulation, in dispatch order. */
export class FieldView {
  group = new THREE.Group();
  private dets = new Map<number, Det>();
  private selected = new Set<number>();
  private ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.15, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, depthTest: false }));
  private t = 0;
  private rings: THREE.Mesh[] = [this.ring];
  friend = 0x2f5fa8;
  /** What a camp keeps off (water, steep ground, rocks, buildings, trees); without it camps go anywhere. */
  site: CampSite | null = null;
  channelLevelAt: (x: number, z: number) => number = () => -Infinity;

  constructor(private terrain: Terrain) { this.ring.renderOrder = 11; this.ring.visible = false; this.group.add(this.ring); }

  select(ids: number[]) { this.selected = new Set(ids); }
  ids() { return [...this.dets.keys()]; }
  position(id: number) { const d = this.dets.get(id); return d ? { x: d.x, z: d.z } : null; }

  sync(flat: Float32Array, path: (id: number) => ArrayLike<number>, tracks: Float32Array, approaches: Float32Array) {
    const seen = new Set<number>();
    for (let o = 0; o < flat.length; o += 17) {
      const id = flat[o]; seen.add(id);
      let d = this.dets.get(id);
      const units = [flat[o + 3], flat[o + 4], flat[o + 5], flat[o + 6], flat[o + 7], flat[o + 16]];
      const sig = units.join(',');
      if (!d) {
        const banner = buildArmyBanner(this.friend);
        this.group.add(banner);
        d = { id, x: flat[o + 1], z: flat[o + 2], tx: flat[o + 1], tz: flat[o + 2], heading: 0, state: 0, members: [], sig: '', siege: [], rams: [], banner, tracks: new Map(), approaches: new Map(), dest: null, wps: [], dots: null, flag: null, camp: null, lay: null, layAt: null, travelled: false, horses: [], inCamp: 0, clashT: -9 };
        this.dets.set(id, d);
      }
      d.tx = flat[o + 1]; d.tz = flat[o + 2]; d.state = flat[o + 8]; d.heading = flat[o + 14];
      if (MOVING.has(d.state)) d.travelled = true;
      d.approaches.clear();
      const remaining = path(id);
      d.wps = [];
      for (let i = 3; i + 2 < remaining.length; i += 3) d.wps.push(remaining[i], remaining[i + 1]);
      d.dest = d.wps.length ? [d.wps[d.wps.length - 2], d.wps[d.wps.length - 1]] : null;
      if (sig !== d.sig) this.rebuild(d, units, sig);
    }
    const currentTracks = new Map<number, Set<number>>();
    for (let o = 0; o + 4 < tracks.length;) {
      const id = tracks[o], kind = tracks[o + 1], dispatch = tracks[o + 2], gap = tracks[o + 3];
      const end = o + 5 + tracks[o + 4] * 4, points = tracks.subarray(o + 5, end);
      o = end;
      const d = this.dets.get(id);
      if (!d) continue;
      let seen = currentTracks.get(id);
      if (!seen) currentTracks.set(id, seen = new Set());
      seen.add(kind);
      const old = d.tracks.get(kind);
      if (old?.to === dispatch && old.gap === gap && old.points.length === points.length) continue;
      const continuous = old && old.gap === gap && old.to < dispatch && dispatch - old.to < 30;
      d.tracks.set(kind, {
        points, gap, from: continuous ? this.dispatch(old) : dispatch, to: dispatch, time: this.t,
        duration: continuous ? THREE.MathUtils.clamp(this.t - old.time, 0.12, 3) : 0,
      });
    }
    for (let o = 0; o + 3 < approaches.length;) {
      const d = this.dets.get(approaches[o]), kind = approaches[o + 1], rank = approaches[o + 2];
      const end = o + 4 + approaches[o + 3] * 4;
      if (d) {
        let lanes = d.approaches.get(kind);
        if (!lanes) d.approaches.set(kind, lanes = []);
        lanes[rank] = approaches.subarray(o + 4, end);
      }
      o = end;
    }
    for (const [id, d] of this.dets) {
      if (!seen.has(id)) {
        this.dropMarks(d);
        this.dropModel(d.banner);
        if (d.camp) { this.group.remove(d.camp.group); d.camp.dispose(); }
        for (const model of [...d.siege, ...d.rams]) this.group.remove(model);
        for (const m of d.members) if (m.boat) this.dropModel(m.boat);
        this.dets.delete(id);
      } else {
        for (const kind of d.tracks.keys()) if (!currentTracks.get(id)?.has(kind)) d.tracks.delete(kind);
      }
    }
  }

  private dispatch(track: Track) {
    const t = track.duration > 0 ? Math.min(1, (this.t - track.time) / track.duration) : 1;
    return track.from + (track.to - track.from) * t;
  }

  private dropModel(model: THREE.Group) {
    this.group.remove(model);
    model.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
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

  private rebuild(d: Det, units: number[], sig: string) {
    d.sig = sig;
    const members: Member[] = [];
    for (const kind of [0, 2, 1, 3]) {
      for (let k = 0; k < units[kind]; k++) {
        const i = members.length, prev = d.members[i];
        members.push(prev?.kind === kind ? prev : { kind, x: d.x, z: d.z, y: 0, yaw: 0, gait: 0, spd: 0, seed: i * 1.7 + d.id * 5.3, visible: false, drawn: false, mode: 0 });
        if (prev?.kind !== kind && prev?.boat) this.dropModel(prev.boat);
      }
    }
    for (const m of d.members.slice(members.length)) if (m.boat) this.dropModel(m.boat);
    d.members = members;
    while (d.siege.length < units[4]) { const g = buildCatapult(); g.visible = false; this.group.add(g); d.siege.push(g); }
    while (d.siege.length > units[4]) this.group.remove(d.siege.pop()!);
    while (d.rams.length < units[5]) { const g = buildRam(); g.visible = false; this.group.add(g); d.rams.push(g); }
    while (d.rams.length > units[5]) this.group.remove(d.rams.pop()!);
  }

  private slot(d: Det, kind: number, rank: number) {
    const track = d.tracks.get(kind);
    if (track) {
      const dispatch = this.dispatch(track), progress = dispatch - rank * track.gap;
      const approach = d.approaches.get(kind)?.[rank];
      if (d.state === FORMING && track.points.length === 4 && approach) {
        return arrivalSlot(approach, dispatch, rank, d.members.length + d.siege.length + d.rams.length, Math.PI / 2 - d.heading, false);
      }
      if ((d.state === 0 || d.state === 5) && track.points.length === 4 && approach) {
        return arrivalSlot(approach, dispatch, rank, 0, Math.PI / 2 - d.heading, true);
      }
      if (approach && progress <= 0) return marchPoint(approach, d.state === 0 && track.points.length === 4 ? -Infinity : progress);
      return marchSlot(track.points, dispatch, rank, track.gap);
    }
    return rank === 0 ? { x: d.tx, z: d.tz, mode: 0, yaw: Math.PI / 2 - d.heading } : null;
  }

  private waterline(x: number, z: number) {
    return Math.max(this.channelLevelAt(x, z), this.terrain.renderedWaterAt(x, z));
  }

  private updateBoat(owner: { boat?: THREE.Group }, x: number, z: number, yaw: number, water: boolean, scale: number) {
    if (water && !owner.boat) {
      owner.boat = makeBoat(); owner.boat.scale.setScalar(scale); this.group.add(owner.boat);
    }
    if (owner.boat) {
      owner.boat.visible = water;
      if (water) {
        owner.boat.position.set(x, this.waterline(x, z) + 0.04 + Math.sin(this.t * 2 + x) * 0.04, z);
        owner.boat.rotation.y = yaw - Math.PI / 2;
      }
    }
  }

  /** Has the soldier of this rank on this track got where the army is going? A standing army has all arrived. */
  private arrived(d: Det, kind: number, rank: number) {
    if (d.state === 0 || d.state === 5 || d.state === FORMING) return true;   // taking position is still the camp: it must not come down and go up again
    const track = d.tracks.get(kind);
    if (!track || !MOVING.has(d.state) || track.points.length < 8) return false;
    const p = track.points, n = p.length;
    if (d.dest && Math.hypot(p[n - 4] - d.dest[0], p[n - 3] - d.dest[1]) > 3) return false;   // the track only reaches as far as the army has got: it is there when that is the destination
    return this.dispatch(track) - rank * track.gap >= p[n - 1];
  }

  /** The camp of an army, built up as its soldiers get there: the first one to arrive starts it and each one after adds to it (tents, then the fence), whichever kind of soldier or engine it is, so it grows
   *  while the rest are still on the road, and is struck when the army moves on. It stands where the march ends, facing the way the army came. Null while nobody has arrived or while fighting. */
  private pitchCamp(d: Det, got: number, total: number, troops: number, horses: number, engines: number): Camp | null {
    if (d.state === 8 || got < 1 || total < 1) { d.camp?.hide(); return null; }
    let x = d.tx, z = d.tz, yaw = Math.PI / 2 - d.heading;
    const track = d.tracks.get(0) ?? d.tracks.get(3) ?? d.tracks.get(4);
    if (MOVING.has(d.state) && track && track.points.length >= 8) {
      const p = track.points, n = p.length;
      x = d.dest ? d.dest[0] : p[n - 4]; z = d.dest ? d.dest[1] : p[n - 3];
      const bx = d.wps.length >= 4 ? d.wps[d.wps.length - 4] : p[n - 8], bz = d.wps.length >= 4 ? d.wps[d.wps.length - 3] : p[n - 7];
      yaw = Math.atan2(x - bx, z - bz);
    }
    const key = `${troops}:${horses}:${engines}`, at = d.layAt;
    const clash = !!d.lay && this.t - d.clashT > 0.5 && !!this.overlap(d, d.lay);   // another army's camp has come up where this one stands
    if (clash) d.clashT = this.t;
    if (!d.lay || !at || at.key !== key || Math.hypot(at.x - x, at.z - z) > 2 || Math.abs(Math.atan2(Math.sin(at.yaw - yaw), Math.cos(at.yaw - yaw))) > 0.7 || clash) {
      d.lay = this.chooseSite(d, x, z, yaw, troops, Math.min(6, horses), engines); d.layAt = { x, z, yaw, key };   // camps keep off obstacles and off each other: the army with the higher number gives way
    }
    return d.lay;
  }

  /** How badly the ground under a camp is in its way: each tent, the pavilion, the trough, the stores, the engines, the fence and the yard inside it that stands on water, a slope, a rock, a building or
   *  a tree counts. 0 is a clear site. */
  private siteCost(lay: Camp): number {
    const s = this.site; if (!s) return 0;
    let c = 0;
    const hit = (x: number, z: number, r: number, w: number) => { if (s.blocked(x, z, r)) c += w; };
    for (const t of lay.tents) hit(t.x, t.z, 2.1, 3);
    for (const f of lay.fires) hit(f.x, f.z, 1.2, 2);
    if (lay.commander) hit(lay.commander.x, lay.commander.z, 3, 3);
    if (lay.trough) hit(lay.trough.x, lay.trough.z, 2.4, 2);
    for (const e of lay.engines) hit(e.x, e.z, 2.2, 1);
    for (const p of lay.props) hit(p.x, p.z, p.kind === 4 ? 2 : p.kind === 6 ? 1.4 : 0.8, 1);
    lay.stakes.forEach((q, i) => { if (i % 2 === 0) hit(q.x, q.z, 0.35, 0.5); });
    if (lay.loop.length === 4) {   // the open ground inside the fence
      const [a, b, , e] = lay.loop, ns = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3.2)), nt = Math.max(1, Math.ceil(Math.hypot(e.x - a.x, e.z - a.z) / 3.2));
      for (let i = 0; i <= ns; i++) for (let j = 0; j <= nt; j++) {
        const u = i / ns, v = j / nt;
        hit(a.x + (b.x - a.x) * u + (e.x - a.x) * v, a.z + (b.z - a.z) * u + (e.z - a.z) * v, 1.5, 1);
      }
    }
    return c;
  }

  /** The camp for an army that stops at (x, z): there if the ground is clear, otherwise at the nearest clear place found by looking round in widening rings (and away from the camps of the armies
   *  with lower numbers); if nowhere is clear, the least bad place. */
  private chooseSite(d: Det, x: number, z: number, yaw: number, troops: number, horses: number, engines: number): Camp | null {
    this.site?.begin();
    let best: Camp | null = null, bestCost = Infinity;
    const tryAt = (px: number, pz: number) => {
      const lay = campLayout(px, pz, yaw, troops, horses, engines); if (!lay) return true;
      const cost = this.siteCost(lay) + (this.overlap(d, lay) ? 50 : 0);
      if (cost < bestCost) { best = lay; bestCost = cost; }
      return cost === 0;
    };
    if (tryAt(x, z)) return best;
    for (let k = 1; k <= 12; k++) {
      const n = Math.min(16, 6 + k * 2);
      for (let i = 0; i < n; i++) { const a = yaw + (i / n) * Math.PI * 2 + k * 0.5; if (tryAt(x + Math.sin(a) * k * 4, z + Math.cos(a) * k * 4)) return best; }
    }
    return best;
  }

  /** How far `lay` has to move to clear the camp of an army with a lower number, or null if it already does. */
  private overlap(d: Det, lay: Camp) {
    for (const o of this.dets.values()) {
      if (o === d || o.id > d.id || !o.lay || !o.camp?.group.visible) continue;
      const dx = lay.mx - o.lay.mx, dz = lay.mz - o.lay.mz, dist = Math.hypot(dx, dz), need = lay.radius + o.lay.radius + 2;
      if (dist >= need) continue;
      const ux = dist > 0.01 ? dx / dist : Math.cos(lay.yaw), uz = dist > 0.01 ? dz / dist : -Math.sin(lay.yaw);
      return { dx: ux * (need - dist), dz: uz * (need - dist) };
    }
    return null;
  }

  update(dt: number) {
    dt = Math.max(0, Math.min(dt, 0.2)); this.t += dt;
    for (const d of this.dets.values()) {
      const leader = this.slot(d, 0, 0);
      const parked = d.state === FORMING || ((d.state === 0 || d.state === 5) && d.tracks.get(0)?.points.length === 4);
      d.x = parked ? d.tx : (leader?.x ?? d.tx); d.z = parked ? d.tz : (leader?.z ?? d.tz);
      const fighting = d.state === 8;
      d.banner.visible = !fighting;
      d.banner.position.set(d.x, leader?.mode === 2 ? 0.3 : this.terrain.walkAt(d.x, d.z), d.z);
      paintArmyBanner(d.banner, this.friend); waveArmyBanner(d.banner, this.t, d.id);
      const engines = [...d.siege, ...d.rams], apart = d.tracks.has(4);
      // who has got there: every kind counts, and the first one starts the camp
      let foot = 0, riders = 0, got = 0, cavGot = 0, memGot = 0;
      for (const m of d.members) {
        const separate = m.kind === 3 && d.tracks.has(3);
        m.there = !fighting && this.arrived(d, separate ? 3 : 0, separate ? riders++ : foot++);
        if (m.there) { got++; memGot++; if (m.kind === 3) cavGot++; }
      }
      engines.forEach((engine, i) => { engine.userData.there = !fighting && this.arrived(d, apart ? 4 : 0, apart ? i : foot + i); if (engine.userData.there) got++; });
      const lay = this.pitchCamp(d, got, d.members.length + engines.length, d.members.length, d.members.filter(m => m.kind === 3).length, engines.length);
      const ratio = got / Math.max(1, d.members.length + engines.length);
      const watch = lay ? Math.min(lay.guards, Math.ceil(lay.guards * ratio - 1e-6)) : 0;
      d.inCamp = lay ? memGot : 0;
      if (lay) {
        if (!d.camp) { d.camp = new ArmyCamp(); this.group.add(d.camp.group); }
        d.camp.show(lay, (x, z) => this.terrain.walkAt(x, z), this.friend, this.t, { tents: Math.ceil(lay.tents.length * ratio - 1e-6), logs: Math.ceil(lay.stakes.length * ratio - 1e-6), trough: cavGot > 0, stores: ratio >= 0.5 });
      }
      d.horses.length = 0;
      if (lay) for (let j = 0; j < Math.min(cavGot, lay.horses.length); j++) d.horses.push({ ...lay.horses[j], hex: HORSE_COATS[j % HORSE_COATS.length] });
      foot = 0; riders = 0;
      let posted = 0;
      for (const m of d.members) {
        const separate = m.kind === 3 && d.tracks.has(3);
        const rank = separate ? riders++ : foot++;
        const guardNo = lay && m.there && m.kind !== 3 && posted < watch ? posted++ : -1;   // the first foot soldiers there stand watch: they patrol inside the fence
        const post = guardNo >= 0 ? patrolAt(lay!, this.t * PATROL_SPEED + (guardNo * lay!.loopLen) / lay!.guards) : null;
        m.guard = !!post;
        if (!post) m.onPost = false;
        const gone = !!lay && !!m.there && !post;   // the others are in their tents; a rider's horse stands at the trough
        let p = fighting || gone ? null : post ? { x: post.x, z: post.z, mode: 0, yaw: post.yaw } : this.slot(d, separate ? 3 : 0, rank);
        if (p && post && !m.onPost && m.visible) {   // on the way to his post he walks there
          const dx = post.x - m.x, dz = post.z - m.z, dist = Math.hypot(dx, dz), step = Math.min(dist, 5 * dt);
          if (dist < 0.3) m.onPost = true;
          else p = { x: m.x + (dx / dist) * step, z: m.z + (dz / dist) * step, mode: 0, yaw: Math.atan2(dx, dz) };
        }
        if (!p) {
          m.visible = false;
          if (m.boat) m.boat.visible = false;
          continue;
        }
        const moved = m.visible ? Math.hypot(p.x - m.x, p.z - m.z) : 0;
        m.x = p.x; m.z = p.z; m.mode = p.mode; m.visible = true;
        if (p.yaw !== undefined) m.yaw = p.yaw;
        m.spd += (moved / Math.max(dt, 0.001) - m.spd) * Math.min(1, dt * 8);
        if (m.mode !== 2) m.gait += Math.PI * moved / (0.55 + 0.13 * m.spd);
        this.updateBoat(m, m.x, m.z, m.yaw, m.mode === 2, 0.25);
      }
      engines.forEach((engine, i) => {
        let p = fighting ? null : this.slot(d, apart ? 4 : 0, apart ? i : foot + i);
        const spot = lay && engine.userData.there ? lay.engines[i] : null;
        if (p && spot) {   // an engine that has got there drives into its place in the rows outside the gate
          const ex = engine.visible ? engine.position.x : p.x, ez = engine.visible ? engine.position.z : p.z, dx = spot.x - ex, dz = spot.z - ez, dist = Math.hypot(dx, dz), step = Math.min(dist, 5 * dt);
          const turn = Math.atan2(Math.sin(spot.yaw - engine.rotation.y), Math.cos(spot.yaw - engine.rotation.y));
          p = { x: dist > 1e-4 ? ex + (dx / dist) * step : spot.x, z: dist > 1e-4 ? ez + (dz / dist) * step : spot.z, mode: 0, yaw: engine.rotation.y + Math.max(-3 * dt, Math.min(3 * dt, turn)) };
        }
        if (!p) { engine.visible = false; return; }
        const yaw = p.yaw ?? engine.rotation.y, hx = Math.sin(yaw), hz = Math.cos(yaw), half = SIEGE_LEN / 2;
        const afloat = p.mode === 2;
        if (engine.visible && !afloat && !engine.userData.afloat) {
          const dx = p.x - engine.position.x, dz = p.z - engine.position.z;
          const travel = (engine.userData.wheelTravel ?? 0) + dx * hx + dz * hz;
          engine.userData.wheelTravel = travel;
          setSiegeWheelTravel(engine, travel);
        }
        engine.userData.afloat = afloat; engine.visible = true;
        const a = this.terrain.walkAt(p.x + hx * half, p.z + hz * half), b = this.terrain.walkAt(p.x - hx * half, p.z - hz * half);
        engine.position.set(p.x, p.mode === 2 ? 0.3 : Math.max(this.terrain.walkAt(p.x, p.z), (a + b) / 2), p.z);
        engine.rotation.set(p.mode === 2 ? 0 : -Math.atan2(a - b, SIEGE_LEN) * 0.8, yaw, 0);
        if (engine.userData.arm) (engine.userData.arm as THREE.Object3D).rotation.x = ARM_REST;
      });
      this.drawMarks(d);
    }
    let ri = 0;
    for (const id of this.selected) {
      const d = this.dets.get(id); if (!d) continue;
      let r = this.rings[ri]; if (!r) { r = ri === 0 ? this.ring : this.ring.clone(); r.material = this.ring.material; this.group.add(r); this.rings[ri] = r; }
      r.visible = true; r.position.set(d.x, this.terrain.walkAt(d.x, d.z) + 0.3, d.z); r.scale.setScalar(2.8); ri++;
    }
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(this.t * 4) * 0.25;
    for (let i = ri; i < this.rings.length; i++) this.rings[i].visible = false;
  }

  draw(crowd: Crowd, cx: number, cz: number, radius: number) {
    const r2 = radius * radius;
    for (const d of this.dets.values()) {
      if (d.state === 8) continue;
      for (const [i, m] of d.members.entries()) {
        m.drawn = m.visible && (m.x - cx) ** 2 + (m.z - cz) ** 2 <= r2;
        if (!m.drawn) continue;
        const working = d.state === 2 && i === 0;
        const walking = m.spd > 0.35 && m.mode !== 2;
        m.y = m.mode === 2 ? this.waterline(m.x, m.z) - 0.21 : this.terrain.walkAt(m.x, m.z);
        crowd.add({ x: m.x, y: m.y, z: m.z, yaw: m.yaw, pose: m.mode === 2 ? 5 : working ? 2 : walking ? 1 : 0, phase: walking ? m.gait : this.t + m.seed, speed: m.spd, skin: 0xd9a877, ...lookOf(m.kind, this.friend), ...(m.guard ? { hat: HAT.HELM, armor: true, tool: TOOL.SPEAR, shield: 0, shieldCol: this.friend } : {}), ...(working ? { tool: TOOL.AXE, shield: undefined, mounted: false } : {}), ...(m.mode === 2 ? { mounted: false, tool: undefined, shield: undefined, scale: 0.9 } : {}) } as Draw);
      }
      for (const h of d.horses) if ((h.x - cx) ** 2 + (h.z - cz) ** 2 <= r2) crowd.addHorse(h.x, this.terrain.walkAt(h.x, h.z), h.z, h.yaw, 0, 0, h.hex);   // the horses at the trough
    }
  }

  /** How many of the army's soldiers are in its camp now, of how many, and how many siege engines are parked beside it; null when it has no camp up. */
  campTroops(id: number) {
    const d = this.dets.get(id);
    return d?.lay && d.camp?.group.visible ? { here: d.inCamp, of: d.members.length, engines: d.siege.length + d.rams.length } : null;
  }

  pick(picker: ArmyPicker, crowds: boolean) {
    if (!this.group.visible) return;
    for (const d of this.dets.values()) {
      if (d.state === 8) continue;
      const banner = d.banner.position;
      if (d.banner.visible) {
        const cloth = d.banner.children[1];
        picker.test(d.id, banner.x, banner.y, banner.z, 0, 'pole');
        picker.test(d.id, banner.x + cloth.position.x, banner.y + cloth.position.y, banner.z, cloth.rotation.y, 'flag');
      }
      if (crowds) for (const m of d.members) if (m.drawn && m.visible) {
        picker.test(d.id, m.x, m.y, m.z, m.yaw, m.kind === 3 ? 'mounted' : 'foot');
      }
      if (d.camp?.group.visible) {
        for (const t of d.camp.tents) if (t.visible) picker.test(d.id, t.position.x, t.position.y, t.position.z, t.rotation.y, 'tent');
        if (d.camp.trough.visible) picker.test(d.id, d.camp.trough.position.x, d.camp.trough.position.y, d.camp.trough.position.z, d.camp.trough.rotation.y, 'trough');
        if (crowds) for (const h of d.horses) picker.test(d.id, h.x, this.terrain.walkAt(h.x, h.z), h.z, h.yaw, 'horse');
      }
      for (const engines of [d.siege, d.rams]) for (const g of engines) if (g.visible) {
        picker.test(d.id, g.position.x, g.position.y, g.position.z, g.rotation.y, 'engine');
      }
    }
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

const oaken = new THREE.MeshStandardMaterial({ color: 0x8a623a, roughness: 0.9 });
const gunwale = new THREE.MeshStandardMaterial({ color: 0x413021, roughness: 0.94 });
const strakes = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.88 });
let hullGeometry: THREE.BufferGeometry | undefined;

function buildHull() {
  // x, half-beam, sheer (top rail). The stem at +x rises higher than the stern.
  const stations = [[-3.15, 0, 0.72], [-2.45, 0.52, 0.58], [-1.55, 0.76, 0.49], [-0.45, 0.86, 0.45],
    [0.65, 0.87, 0.45], [1.7, 0.73, 0.53], [2.55, 0.43, 0.68], [3.32, 0, 0.95]];
  const bands = [[0, -0.32], [0.36, -0.14], [0.68, 0.05], [0.88, 0.23], [1, 0.45], [1.035, 0.51], [0.94, 0.48], [0.49, -0.12], [0, -0.18]];
  const colors = [0x513621, 0x6d442a, 0x845333, 0x93623c, 0x533921, 0x412d22, 0x714b30, 0x62442f];
  const positions: number[] = [], paint: number[] = [];
  const vertex = (i: number, j: number, side: number, color: THREE.Color) => {
    const [x, beam, rail] = stations[i], [w, low] = bands[j];
    positions.push(x, low + (rail - 0.45) * (0.5 + 0.5 * w), side * w * beam);
    paint.push(color.r, color.g, color.b);
  };
  for (const side of [-1, 1]) for (let j = 0; j < bands.length - 1; j++) {
    for (let i = 0; i < stations.length - 1; i++) {
      const color = new THREE.Color(colors[j]).multiplyScalar(0.94 + 0.05 * (i % 3));
      vertex(i, j, side, color); vertex(i + 1, j, side, color); vertex(i, j + 1, side, color);
      vertex(i + 1, j, side, color); vertex(i + 1, j + 1, side, color); vertex(i, j + 1, side, color);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(paint, 3)); g.computeVertexNormals();
  return g;
}

let rowingBoat: THREE.Group | undefined, deckBoat: THREE.Group | undefined;
export function makeBoat(decked = false): THREE.Group {
  const cached = decked ? deckBoat : rowingBoat;
  if (cached) return cached.clone();
  const g = new THREE.Group();
  const hull = new THREE.Mesh(hullGeometry ??= buildHull(), strakes); hull.castShadow = true; g.add(hull);
  const plank = (w: number, h: number, d: number, x: number, y: number, z = 0) => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), oaken); part.position.set(x, y, z); g.add(part); return part;
  };
  if (decked) {
    for (let i = -6; i <= 6; i++) plank(0.32, 0.09, 1.55 - 0.017 * i * i, i * 0.35, 0.36);
  } else {
    for (const x of [-1.22, -0.13, 1.04]) plank(0.26, 0.09, 1.39, x, 0.31);
    for (const side of [-1, 1]) {
      const oar = new THREE.Group(); oar.position.set(0.13, 0.3, side * 0.62); oar.rotation.y = side * -0.29;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.038, 1.89, 6), gunwale);
      shaft.rotation.x = Math.PI / 2; shaft.position.z = side * 0.45;
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.055, 0.43), oaken); paddle.position.z = side * 1.45;
      oar.add(shaft, paddle); g.add(oar);
    }
  }
  if (decked) deckBoat = g; else rowingBoat = g;
  return g.clone();
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
