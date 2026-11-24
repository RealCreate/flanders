import * as THREE from 'three';
import type { Camp } from '../camplayout';

/** What an army pitches where it has stopped (see camplayout.ts for where): little tents grouped round fires, a fence of spiked logs, and a watering trough. Geometry and cloth are shared by every camp;
 *  a camp is only a group of small groups (one per tent and fire) and one instanced mesh for all the logs, so removing one disposes only that. Each part rises out of the ground when its turn comes. */
const GEO = {
  tent: new THREE.ConeGeometry(1.7, 1.9, 4).rotateY(Math.PI / 4).translate(0, 0.95, 0),
  door: new THREE.PlaneGeometry(0.7, 1.05), pole: new THREE.CylinderGeometry(0.035, 0.035, 1.1, 4).translate(0, 0.55, 0), pennant: new THREE.PlaneGeometry(0.55, 0.3).translate(0.28, 0, 0),
  log: new THREE.CylinderGeometry(0.03, 0.17, 1.9, 6).translate(0, 0.95, 0),
  stones: new THREE.CylinderGeometry(0.55, 0.65, 0.16, 8).translate(0, 0.08, 0), flame: new THREE.ConeGeometry(0.24, 0.7, 5).translate(0, 0.45, 0),
  trough: new THREE.BoxGeometry(4.2, 0.55, 0.8).translate(0, 0.275, 0), water: new THREE.PlaneGeometry(3.9, 0.5).rotateX(-Math.PI / 2).translate(0, 0.57, 0),
  leg: new THREE.BoxGeometry(0.2, 0.3, 0.7).translate(0, 0.1, 0),
  barrel: new THREE.CylinderGeometry(0.38, 0.34, 0.85, 8).translate(0, 0.42, 0), crate: new THREE.BoxGeometry(0.8, 0.7, 0.8).translate(0, 0.35, 0),
  rail: new THREE.BoxGeometry(2.0, 0.08, 0.08).translate(0, 1.0, 0), rackLeg: new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4).translate(0, 0.6, 0), spear: new THREE.CylinderGeometry(0.025, 0.025, 2.3, 4).translate(0, 1.15, 0),
  hay: new THREE.BoxGeometry(1.1, 0.6, 0.7).translate(0, 0.3, 0), bench: new THREE.CylinderGeometry(0.15, 0.15, 1.4, 6).rotateZ(Math.PI / 2).translate(0, 0.15, 0),
  bed: new THREE.BoxGeometry(3.0, 0.3, 1.5).translate(0, 0.8, 0), hump: new THREE.BoxGeometry(2.6, 0.9, 1.3).translate(0, 1.4, 0), wheel: new THREE.CylinderGeometry(0.5, 0.5, 0.12, 10).rotateX(Math.PI / 2).translate(0, 0.5, 0),
  tLeg: new THREE.CylinderGeometry(0.1, 0.13, 3.6, 5).translate(0, 1.8, 0), deck: new THREE.BoxGeometry(2.0, 0.12, 2.0).translate(0, 3.1, 0), roof: new THREE.ConeGeometry(1.8, 1.1, 4).rotateY(Math.PI / 4).translate(0, 4.2, 0),
  post: new THREE.CylinderGeometry(0.16, 0.2, 3.4, 6).translate(0, 1.7, 0), beam: new THREE.BoxGeometry(0.2, 0.22, 5.4).translate(0, 3.2, 0),
};
const MAT = {
  canvas: new THREE.MeshStandardMaterial({ color: 0xe6dcc0, roughness: 0.95, flatShading: true }),
  door: new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1, side: THREE.DoubleSide }),
  wood: new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.9 }),
  log: new THREE.MeshStandardMaterial({ color: 0x6e4e30, roughness: 0.95, flatShading: true }),
  pennant: new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.8, side: THREE.DoubleSide }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6, side: THREE.DoubleSide }),
  barrel: new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.9 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x9a7a4c, roughness: 0.95 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 1, flatShading: true }),
  flame: new THREE.MeshBasicMaterial({ color: 0xff9a2e }),
  water: new THREE.MeshStandardMaterial({ color: 0x3f8fd0, emissive: 0x0e3454, roughness: 0.15, metalness: 0.1 }),
  hay: new THREE.MeshStandardMaterial({ color: 0xc9b25a, roughness: 1, flatShading: true }),
};
const MAX_LOGS = 170;
const RISE = 0.7;   // seconds a part takes to come up

export class ArmyCamp {
  group = new THREE.Group();
  tents: THREE.Group[] = [];
  trough = new THREE.Group();
  private gate = new THREE.Group();
  private gateFlames: THREE.Mesh[] = [];
  private commander: THREE.Group | null = null;
  private props = new THREE.Group();
  private fires: THREE.Group[] = [];
  private logs: THREE.InstancedMesh;
  private logBorn = new Float32Array(MAX_LOGS).fill(-1);
  private logBase = new Float32Array(MAX_LOGS);
  private baseOf: Camp | null = null;
  private troughBorn = -1;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private s = new THREE.Vector3();

  constructor() {
    this.logs = new THREE.InstancedMesh(GEO.log, MAT.log, MAX_LOGS); this.logs.frustumCulled = false; this.logs.count = 0; this.logs.castShadow = true;
    const box = new THREE.Mesh(GEO.trough, MAT.wood); box.castShadow = true; box.receiveShadow = true;
    const water = new THREE.Mesh(GEO.water, MAT.water);
    this.trough.add(box, water);
    for (const x of [-1.7, 1.7]) { const leg = new THREE.Mesh(GEO.leg, MAT.wood); leg.position.set(x, 0, 0); this.trough.add(leg); }
    this.trough.visible = false;
    for (const z of [-2.7, 2.7]) { const post = new THREE.Mesh(GEO.post, MAT.log); post.position.z = z; post.castShadow = true; this.gate.add(post); }
    this.gate.add(new THREE.Mesh(GEO.beam, MAT.wood));
    for (const z of [-2.7, 2.7]) {   // a torch and a pennant on each post
      const flame = new THREE.Mesh(GEO.flame, MAT.flame); flame.position.set(0, 3.45, z); flame.scale.setScalar(0.8); this.gate.add(flame); this.gateFlames.push(flame);
      const flag = new THREE.Mesh(GEO.pennant, MAT.pennant); flag.position.set(0, 3.0, z); flag.rotation.y = Math.PI / 2; this.gate.add(flag);
    }
    this.props.visible = false;
    this.gate.visible = false;
    this.group.add(this.logs, this.trough, this.gate, this.props);
  }

  private tent(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(GEO.tent, MAT.canvas); body.castShadow = true; body.receiveShadow = true;
    const door = new THREE.Mesh(GEO.door, MAT.door); door.position.set(0, 0.45, 0.78); door.rotation.x = -0.42;
    const pole = new THREE.Mesh(GEO.pole, MAT.wood); pole.position.y = 1.85;
    const pennant = new THREE.Mesh(GEO.pennant, MAT.pennant); pennant.position.y = 2.7;
    g.add(body, door, pole, pennant); this.group.add(g); return g;
  }
  private fire(): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(GEO.stones, MAT.stone), new THREE.Mesh(GEO.flame, MAT.flame));
    this.group.add(g); return g;
  }

  /** The stores, the rack of spears and the commander's pavilion, made once for a layout. */
  private furnish(camp: Camp) {
    this.props.clear();
    if (this.commander) { this.group.remove(this.commander); this.commander = null; }
    for (const p of camp.props) {
      const g = new THREE.Group();
      if (p.kind === 2) {
        for (const x of [-0.9, 0.9]) { const leg = new THREE.Mesh(GEO.rackLeg, MAT.wood); leg.position.x = x; g.add(leg); }
        g.add(new THREE.Mesh(GEO.rail, MAT.wood));
        for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(GEO.spear, MAT.steel); sp.position.set(-0.7 + i * 0.35, 0, 0.1); sp.rotation.z = (i - 2) * 0.05; sp.rotation.x = -0.12; g.add(sp); }
      } else if (p.kind === 3) { g.add(new THREE.Mesh(GEO.hay, MAT.hay)); }
      else if (p.kind === 5) { g.add(new THREE.Mesh(GEO.bench, MAT.log)); }
      else if (p.kind === 4) {
        g.add(new THREE.Mesh(GEO.bed, MAT.wood), new THREE.Mesh(GEO.hump, MAT.canvas));
        for (const x of [-1, 1]) for (const z of [-0.85, 0.85]) { const w = new THREE.Mesh(GEO.wheel, MAT.wood); w.position.set(x, 0, z); g.add(w); }
      } else if (p.kind === 6) {
        for (const x of [-0.85, 0.85]) for (const z of [-0.85, 0.85]) { const leg = new THREE.Mesh(GEO.tLeg, MAT.log); leg.position.set(x, 0, z); leg.rotation.set(-z * 0.06, 0, x * 0.06); g.add(leg); }
        g.add(new THREE.Mesh(GEO.deck, MAT.wood), new THREE.Mesh(GEO.roof, MAT.canvas));
      } else { const m = new THREE.Mesh(p.kind === 0 ? GEO.barrel : GEO.crate, p.kind === 0 ? MAT.barrel : MAT.crate); m.castShadow = true; g.add(m); }
      g.position.set(p.x, 0, p.z); g.rotation.y = p.yaw; g.userData.base = p; this.props.add(g);
    }
    if (camp.commander) { const t = this.tent(); (t.children[3] as THREE.Mesh).material = MAT.gold; t.children[2].scale.y = 1.6; t.children[3].position.y = 4.1; this.commander = t; }
  }

  /** Show the first `shown.tents` tents (and the fires lit by them), the first `shown.logs` logs of the fence and, with `shown.trough`, the trough, as `camp` lays them out; pennants in `color`, fluttering with `t`. */
  show(camp: Camp, ground: (x: number, z: number) => number, color: number, t: number, shown: { tents: number; logs: number; trough: boolean; stores: boolean }) {
    MAT.pennant.color.setHex(color);
    while (this.tents.length < camp.tents.length) this.tents.push(this.tent());
    while (this.fires.length < camp.fires.length) this.fires.push(this.fire());
    this.tents.forEach((g, i) => {
      const c = camp.tents[i], on = !!c && i < shown.tents;
      if (!on) { g.visible = false; g.userData.born = undefined; return; }
      if (!g.visible || g.userData.born === undefined) g.userData.born = t;   // each tent rises on its own, from the moment its turn comes
      g.visible = true;
      const k = Math.min(1, (t - g.userData.born) / RISE);
      g.position.set(c.x, ground(c.x, c.z) - (1 - k) * 1.6, c.z); g.rotation.y = c.yaw; g.scale.setScalar(0.4 + 0.6 * k);
      g.children[3].rotation.y = Math.sin(t * 3 + i) * 0.35;
    });
    this.fires.forEach((g, i) => {
      const f = camp.fires[i], on = !!f && shown.tents >= f.after;
      g.visible = on; if (!on) return;
      g.position.set(f.x, ground(f.x, f.z), f.z);
      g.children[1].scale.set(1, 0.8 + 0.35 * Math.sin(t * 11 + i * 2.1) * Math.sin(t * 7.3 + i), 1);
    });

    if (this.baseOf !== camp) {   // a new layout: the ground under each log is read once
      this.baseOf = camp;
      this.furnish(camp);
      camp.stakes.forEach((s, i) => { if (i < MAX_LOGS) this.logBase[i] = ground(s.x, s.z); });
    }
    const n = Math.min(MAX_LOGS, camp.stakes.length, shown.logs);
    for (let i = 0; i < n; i++) {
      const s = camp.stakes[i];
      if (this.logBorn[i] < 0) this.logBorn[i] = t;
      const k = Math.min(1, (t - this.logBorn[i]) / RISE), lean = 0.42 + ((i * 7) % 5) * 0.03;
      this.e.set(lean, s.yaw, 0, 'YXZ'); this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(s.x, this.logBase[i] - (1 - k) * 1.2, s.z), this.q, this.s.set(1, 0.85 + ((i * 3) % 4) * 0.07, 1));
      this.logs.setMatrixAt(i, this.m);
    }
    for (let i = n; i < MAX_LOGS && this.logBorn[i] >= 0; i++) this.logBorn[i] = -1;
    this.logs.count = n; this.logs.visible = n > 0; this.logs.instanceMatrix.needsUpdate = true;

    this.props.visible = shown.stores;
    if (shown.stores) this.props.children.forEach(g => { const b = g.userData.base as Camp['props'][number]; g.position.y = ground(b.x, b.z); });
    if (this.commander) {
      const c = camp.commander!;
      this.commander.visible = shown.stores; this.commander.position.set(c.x, ground(c.x, c.z), c.z); this.commander.rotation.y = c.yaw; this.commander.scale.setScalar(1.6);
      this.commander.children[3].rotation.y = Math.sin(t * 2.4) * 0.35;
    }
    this.gateFlames.forEach((f, i) => f.scale.set(0.8, 0.7 + 0.35 * Math.sin(t * 12 + i * 2) * Math.sin(t * 7.1 + i), 0.8));
    const g0 = camp.gate[0], g1 = camp.gate[1];
    this.gate.visible = !!g0 && n > 0;   // the gate stands once the fence is started
    if (g0 && g1) { const mx = (g0.x + g1.x) / 2, mz = (g0.z + g1.z) / 2; this.gate.position.set(mx, ground(mx, mz), mz); this.gate.rotation.y = g0.yaw + Math.PI / 2; }
    const tr = camp.trough, on = !!tr && shown.trough;
    this.trough.visible = on;
    if (on) {
      if (this.troughBorn < 0) this.troughBorn = t;
      const k = Math.min(1, (t - this.troughBorn) / RISE);
      this.trough.position.set(tr.x, ground(tr.x, tr.z) - (1 - k) * 0.6, tr.z); this.trough.rotation.y = tr.yaw - Math.PI / 2;
    } else this.troughBorn = -1;
    this.group.visible = true;
  }

  /** The camp is struck: everything goes, and rises again from nothing the next time. */
  hide() {
    if (!this.group.visible) return;
    this.group.visible = false; this.props.visible = false; if (this.commander) this.commander.visible = false; this.tents.forEach(g => { g.visible = false; g.userData.born = undefined; }); this.logBorn.fill(-1); this.troughBorn = -1;
  }
  dispose() { this.logs.dispose(); }
}
