import * as THREE from 'three';
import type { Terrain } from './terrain';
import { HAT, TOOL, ARM_REST, buildCatapult, buildRam, setSiegeWheelTravel, type Crowd, type Draw } from './crowd';
import type { ArmyPicker } from './armypick';

import { dotsAlong } from './trail';
import { arrivalSlot, marchPoint, marchSlot } from '../marchfile';

interface Member {
  kind: number; x: number; z: number; y: number; yaw: number; gait: number; spd: number; seed: number;
  visible: boolean; drawn: boolean; mode: number; boat?: THREE.Group;
}
interface Track { points: Float32Array; gap: number; from: number; to: number; time: number; duration: number }
interface Det {
  id: number; x: number; z: number; tx: number; tz: number; heading: number; state: number;
  members: Member[]; sig: string; siege: THREE.Group[]; rams: THREE.Group[]; banner: THREE.Group;
  tracks: Map<number, Track>;
  approaches: Map<number, Float32Array[]>;
  dest: [number, number] | null; wps: number[];
  dots: THREE.InstancedMesh | null; flag: THREE.Group | null;
}

export const STATE_TEXT = ['Waiting for orders', 'Marching', 'Felling trees', 'Building a bridge', 'Crossing by boat', 'Arrived — ready to attack', 'Waiting for materials', 'Returning home', 'Fighting in the battle', 'Route blocked', 'Taking position'];
const FORMING = 10;

const SIEGE_LEN = 3.2;

/** Draw the army on the waypoints actually traversed by the simulation, in dispatch order. */
export class FieldView {
  group = new THREE.Group();
  private dets = new Map<number, Det>();
  private selected = new Set<number>();
  private ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.15, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, depthTest: false }));
  private t = 0;
  private rings: THREE.Mesh[] = [this.ring];
  friend = 0x2f5fa8;
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
        const banner = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6), new THREE.MeshStandardMaterial({ color: 0x4a3420 })); pole.position.y = 2.1; pole.castShadow = true;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), new THREE.MeshStandardMaterial({ color: this.friend, side: THREE.DoubleSide, roughness: 0.8 })); cloth.position.set(0.8, 3.6, 0);
        banner.add(pole, cloth);
        this.group.add(banner);
        d = { id, x: flat[o + 1], z: flat[o + 2], tx: flat[o + 1], tz: flat[o + 2], heading: 0, state: 0, members: [], sig: '', siege: [], rams: [], banner, tracks: new Map(), approaches: new Map(), dest: null, wps: [], dots: null, flag: null };
        this.dets.set(id, d);
      }
      d.tx = flat[o + 1]; d.tz = flat[o + 2]; d.state = flat[o + 8]; d.heading = flat[o + 14];
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

  update(dt: number) {
    dt = Math.max(0, Math.min(dt, 0.2)); this.t += dt;
    for (const d of this.dets.values()) {
      const leader = this.slot(d, 0, 0);
      const parked = d.state === FORMING || ((d.state === 0 || d.state === 5) && d.tracks.get(0)?.points.length === 4);
      d.x = parked ? d.tx : (leader?.x ?? d.tx); d.z = parked ? d.tz : (leader?.z ?? d.tz);
      const fighting = d.state === 8;
      d.banner.visible = !fighting;
      d.banner.position.set(d.x, leader?.mode === 2 ? 0.3 : this.terrain.walkAt(d.x, d.z), d.z);
      (d.banner.children[1] as THREE.Mesh).rotation.y = Math.sin(this.t * 3 + d.id) * 0.25;
      let foot = 0, riders = 0;
      for (const m of d.members) {
        const separate = m.kind === 3 && d.tracks.has(3);
        const rank = separate ? riders++ : foot++;
        const p = fighting ? null : this.slot(d, separate ? 3 : 0, rank);
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
      [...d.siege, ...d.rams].forEach((engine, i) => {
        const separate = d.tracks.has(4);
        const p = fighting ? null : this.slot(d, separate ? 4 : 0, separate ? i : foot + i);
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
        crowd.add({ x: m.x, y: m.y, z: m.z, yaw: m.yaw, pose: m.mode === 2 ? 5 : working ? 2 : walking ? 1 : 0, phase: walking ? m.gait : this.t + m.seed, speed: m.spd, skin: 0xd9a877, ...lookOf(m.kind, this.friend), ...(working ? { tool: TOOL.AXE, shield: undefined, mounted: false } : {}), ...(m.mode === 2 ? { mounted: false, tool: undefined, shield: undefined, scale: 0.9 } : {}) } as Draw);
      }
    }
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
