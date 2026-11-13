import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';
import type { Huntable, WildLike } from './people';

const tint = (g: THREE.BufferGeometry, hex: number) => {
  const geo = g.index ? g.toNonIndexed() : g, c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); geo.deleteAttribute('uv'); return geo;
};
const bx = (w: number, h: number, d: number, hex: number, x: number, y: number, z: number, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateX(rx); g.translate(x, y, z); return tint(g, hex); };
const sp = (r: number, hex: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { const g = new THREE.IcosahedronGeometry(r, 1); g.scale(sx, sy, sz); g.translate(x, y, z); return tint(g, hex); };
const merge = (p: THREE.BufferGeometry[]) => { p.forEach(g => g.computeVertexNormals()); return mergeGeometries(p)!; };
const leg = (w: number, len: number, hex: number, hoof = 0x2a2018) => merge([bx(w, len, w, hex, 0, -len / 2, 0), bx(w * 1.15, len * 0.1, w * 1.3, hoof, 0, -len * 0.97, w * 0.1)]);

type Gait = 'quad' | 'biped' | 'hop';
interface Spec {
  name: string; max: number; huntable: boolean; gait: Gait;
  walk: number; run: number;           // units/s while ambling and when fleeing (before individual variation)
  stride: number;                      // distance covered by one full gait cycle at a walk
  body: () => THREE.BufferGeometry; head: () => THREE.BufferGeometry; legGeo: () => THREE.BufferGeometry | null;
  legs: [number, number, number][];    // hip anchors: FL, FR, BL, BR
  neck: [number, number, number];      // where the head pivots
  size: number;
}

const SPECIES: Spec[] = [
  { name: 'deer', max: 40, huntable: true, gait: 'quad', walk: 1.2, run: 9, stride: 1.5, size: 1, neck: [0, 1.2, 0.5], legs: [[0.14, 0.82, 0.4], [-0.14, 0.82, 0.4], [0.14, 0.82, -0.4], [-0.14, 0.82, -0.4]],
    legGeo: () => leg(0.09, 0.82, 0x6a4a2a),
    body: () => merge([bx(0.45, 0.5, 1.1, 0x9a6a3a, 0, 1.0, 0), bx(0.12, 0.14, 0.1, 0xe8d8b8, 0, 1.05, -0.58)]),
    head: () => merge([bx(0.18, 0.5, 0.2, 0x9a6a3a, 0, 0.22, 0.1, -0.5), bx(0.16, 0.2, 0.34, 0x8a5a2e, 0, 0.5, 0.3), bx(0.04, 0.5, 0.04, 0xd8c8a0, 0.1, 0.78, 0.2, 0.3), bx(0.04, 0.5, 0.04, 0xd8c8a0, -0.1, 0.78, 0.2, 0.3), bx(0.3, 0.04, 0.04, 0xd8c8a0, 0, 0.92, 0.24)]) },
  { name: 'boar', max: 16, huntable: true, gait: 'quad', walk: 1.1, run: 6.5, stride: 0.95, size: 1, neck: [0, 0.62, 0.45], legs: [[0.16, 0.42, 0.3], [-0.16, 0.42, 0.3], [0.16, 0.42, -0.3], [-0.16, 0.42, -0.3]],
    legGeo: () => leg(0.1, 0.42, 0x3a2c24),
    body: () => merge([bx(0.5, 0.5, 0.95, 0x4a3a30, 0, 0.62, 0), bx(0.5, 0.12, 0.5, 0x2a2018, 0, 0.9, 0.1)]),
    head: () => merge([bx(0.38, 0.38, 0.42, 0x3a2c24, 0, 0, 0.2), bx(0.14, 0.1, 0.22, 0x2a1e18, 0, -0.05, 0.5), bx(0.04, 0.04, 0.14, 0xe8e0c8, 0.09, -0.03, 0.56), bx(0.04, 0.04, 0.14, 0xe8e0c8, -0.09, -0.03, 0.56)]) },
  { name: 'rabbit', max: 40, huntable: true, gait: 'hop', walk: 0.9, run: 6, stride: 0.6, size: 1, neck: [0, 0.3, 0.2], legs: [],
    legGeo: () => null,
    body: () => merge([sp(0.18, 0xb0a090, 0, 0.2, 0, 1, 0.9, 1.3), sp(0.06, 0xf0f0f0, 0, 0.22, -0.26), bx(0.1, 0.05, 0.22, 0x9a8a7a, 0.1, 0.08, -0.1), bx(0.1, 0.05, 0.22, 0x9a8a7a, -0.1, 0.08, -0.1)]),
    head: () => merge([sp(0.12, 0xb0a090, 0, 0, 0.04), bx(0.05, 0.22, 0.04, 0xb0a090, 0.05, 0.2, 0), bx(0.05, 0.22, 0.04, 0xb0a090, -0.05, 0.2, 0)]) },
  { name: 'wolf', max: 10, huntable: false, gait: 'quad', walk: 1.5, run: 10, stride: 1.4, size: 1, neck: [0, 1.0, 0.45], legs: [[0.12, 0.76, 0.34], [-0.12, 0.76, 0.34], [0.12, 0.76, -0.34], [-0.12, 0.76, -0.34]],
    legGeo: () => leg(0.08, 0.76, 0x55555b),
    body: () => merge([bx(0.38, 0.42, 1.0, 0x6a6a70, 0, 0.92, 0), bx(0.1, 0.1, 0.6, 0x5a5a60, 0, 0.9, -0.75, 0.5)]),
    head: () => merge([bx(0.26, 0.3, 0.3, 0x5a5a60, 0, 0.02, 0.15), bx(0.14, 0.14, 0.3, 0x4a4a50, 0, -0.06, 0.4), bx(0.05, 0.12, 0.05, 0x4a4a50, 0.07, 0.22, 0.1), bx(0.05, 0.12, 0.05, 0x4a4a50, -0.07, 0.22, 0.1)]) },
  { name: 'sheep', max: 70, huntable: false, gait: 'quad', walk: 0.6, run: 4, stride: 0.7, size: 1, neck: [0, 0.72, 0.4], legs: [[0.14, 0.42, 0.25], [-0.14, 0.42, 0.25], [0.14, 0.42, -0.25], [-0.14, 0.42, -0.25]],
    legGeo: () => leg(0.06, 0.42, 0x3a3430),
    body: () => merge([sp(0.36, 0xf2efe6, 0, 0.62, 0, 1, 0.9, 1.3)]),
    head: () => merge([bx(0.16, 0.2, 0.22, 0x3a3430, 0, 0, 0.1), bx(0.22, 0.04, 0.05, 0x3a3430, 0, 0.1, 0.04)]) },
  { name: 'cow', max: 30, huntable: false, gait: 'quad', walk: 0.55, run: 3.5, stride: 1.2, size: 1, neck: [0, 1.15, 0.65], legs: [[0.18, 0.62, 0.45], [-0.18, 0.62, 0.45], [0.18, 0.62, -0.45], [-0.18, 0.62, -0.45]],
    legGeo: () => leg(0.1, 0.62, 0xe8e0d0),
    body: () => merge([bx(0.55, 0.62, 1.3, 0xf0ece0, 0, 0.95, 0), bx(0.5, 0.3, 0.5, 0x6a4a32, 0.02, 1.15, 0.2), bx(0.5, 0.3, 0.4, 0x6a4a32, -0.02, 1.1, -0.35), bx(0.04, 0.4, 0.04, 0xe8e0d0, 0, 0.8, -0.68)]),
    head: () => merge([bx(0.3, 0.3, 0.38, 0xe8e0d0, 0, -0.05, 0.22), bx(0.04, 0.12, 0.04, 0xd8d0b0, 0.14, 0.15, 0.2), bx(0.04, 0.12, 0.04, 0xd8d0b0, -0.14, 0.15, 0.2)]) },
  { name: 'chicken', max: 60, huntable: false, gait: 'biped', walk: 0.5, run: 3, stride: 0.3, size: 1, neck: [0, 0.34, 0.1], legs: [[0.05, 0.2, 0], [-0.05, 0.2, 0]],
    legGeo: () => leg(0.025, 0.2, 0xd8a020, 0xd8a020),
    body: () => merge([sp(0.13, 0xd8a050, 0, 0.26, 0, 1, 1, 1.3), bx(0.06, 0.16, 0.12, 0xb87a30, 0, 0.32, -0.2, -0.6)]),
    head: () => merge([sp(0.07, 0xd8a050, 0, 0.04, 0.04), bx(0.04, 0.05, 0.07, 0xd8a020, 0, 0.03, 0.12), bx(0.02, 0.06, 0.05, 0xc02020, 0, 0.12, 0.03)]) },
];

interface Animal extends Huntable {
  sp: number; y: number; yaw: number; state: 'graze' | 'walk' | 'flee' | 'dead' | 'gone'; tx: number; tz: number; timer: number;
  hx: number; hz: number; roam: number; seed: number; huntable: boolean; deadT: number; domestic: boolean; owner?: string;
  pace: number;      // individual speed factor (some animals are just quicker)
  speed: number;     // current ground speed
  gait: number;      // gait angle, advances with distance covered
  headT: number;     // head behaviour clock
}

const rng = (seed: number) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Deer, boar, rabbits and wolves in the forests; sheep, cows and chickens around farms and houses.
 *  Each species walks, trots and gallops with its own stride; each animal has its own pace. Only animals near the camera are simulated and drawn. */
export class Wildlife implements WildLike {
  group = new THREE.Group();
  private animals: Animal[] = [];
  private bodies: THREE.InstancedMesh[] = []; private heads: THREE.InstancedMesh[] = []; private legMeshes: (THREE.InstancedMesh | null)[] = [];
  private m = new THREE.Matrix4(); private b = new THREE.Matrix4(); private h = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private s = new THREE.Vector3(); private e = new THREE.Euler(); private lm = new THREE.Matrix4(); private t4 = new THREE.Matrix4();
  private t = 0;
  private domSig = new Map<string, string>();
  visible = 0;

  constructor(seed: bigint, private terrain: Terrain, trees: { x: number; z: number }[], sites: number[]) {
    const r = rng(Number(seed % 1000003n) + 17);
    SPECIES.forEach(spec => {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
      const mk = (g: THREE.BufferGeometry, max: number) => { const m = new THREE.InstancedMesh(g, mat, max); m.castShadow = true; m.frustumCulled = false; m.count = 0; this.group.add(m); return m; };
      this.bodies.push(mk(spec.body(), spec.max)); this.heads.push(mk(spec.head(), spec.max));
      const lg = spec.legGeo(); this.legMeshes.push(lg && spec.legs.length ? mk(lg, spec.max * spec.legs.length) : null);
    });
    const near = (x: number, z: number) => { for (let i = 0; i < sites.length; i += 2) if (Math.hypot(x - sites[i], z - sites[i + 1]) < 120) return true; return false; };
    const pool = trees.filter(t => near(t.x, t.z));
    const spawn = (si: number, n: number, cx: number, cz: number) => {
      for (let i = 0; i < n; i++) {
        const x = cx + (r() - 0.5) * 10, z = cz + (r() - 0.5) * 10, hh = this.terrain.heightAt(x, z);
        if (hh < 1.5) continue;
        this.animals.push(this.make(si, x, z, hh, cx, cz, 12, r, false));
      }
    };
    const counts = [[0, 9, 4], [1, 5, 2], [2, 9, 3], [3, 3, 3]];
    if (pool.length) for (const [spi, herds, size] of counts) for (let hd = 0; hd < herds; hd++) { const t = pool[Math.floor(r() * pool.length)]; spawn(spi, 1 + Math.floor(r() * size), t.x, t.z); }
  }

  private make(si: number, x: number, z: number, y: number, hx: number, hz: number, roam: number, r: () => number, domestic: boolean, owner?: string): Animal {
    return { sp: si, x, z, y, yaw: r() * 6.28, state: 'graze', tx: x, tz: z, timer: r() * 6, hx, hz, roam, seed: r() * 100, huntable: SPECIES[si].huntable, alive: true, deadT: 0, domestic, owner,
      pace: 0.75 + r() * 0.55, speed: 0, gait: r() * 6.28, headT: r() * 10 };
  }

  // ---- WildLike (for hunters) ----
  nearest(x: number, z: number, rad: number): Huntable | null {
    let best: Animal | null = null, bd = rad * rad;
    for (const a of this.animals) {
      if (!a.huntable || a.state === 'dead' || a.state === 'gone') continue;
      const d = (a.x - x) ** 2 + (a.z - z) ** 2; if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  kill(a: Huntable) { const an = a as Animal; an.alive = false; an.state = 'dead'; an.deadT = 0; an.speed = 0; }
  remove(a: Huntable) { (a as Animal).state = 'gone'; (a as Animal).deadT = 0; }

  /** Farm animals follow the buildings of a village. `key` identifies the village. */
  syncDomestic(key: string, buildings: Float32Array) {
    const S = 10; const parts: string[] = [];
    for (let i = 0; i < buildings.length; i += S) { const k = buildings[i]; if (k === 1 || (k === 0 && buildings[i + 1] <= 1)) parts.push(`${k}:${buildings[i + 2]}:${buildings[i + 3]}:${buildings[i + 1]}`); }
    const sig = parts.join('|'); if (this.domSig.get(key) === sig) return; this.domSig.set(key, sig);
    this.animals = this.animals.filter(a => a.owner !== key);
    const r = rng(parts.length * 977 + 3);
    for (let i = 0; i < buildings.length; i += S) {
      const k = buildings[i], x = buildings[i + 2], z = buildings[i + 3];
      const add = (si: number, n: number, ox: number, oz: number, roam: number) => {
        for (let j = 0; j < n; j++) { const ax = ox + (r() - 0.5) * roam, az = oz + (r() - 0.5) * roam; this.animals.push(this.make(si, ax, az, this.terrain.heightAt(ax, az), ox, oz, roam, r, true, key)); }
      };
      if (k === 1) { add(4, 3 + buildings[i + 1], x + 1, z + 2, 8); if (buildings[i + 1] >= 1) add(5, 2, x, z + 2, 8); }
      else if (k === 0 && buildings[i + 1] <= 1) add(6, 2, x, z + 3.5, 4);
    }
  }

  /** `scares` are positions of people animals fear. Only animals within `radius` of (cx, cz) are simulated and drawn. */
  update(dt: number, scares: { x: number; z: number }[], cx = 0, cz = 0, radius = 1e9) {
    this.t += dt;
    const counts = SPECIES.map(() => 0), legCounts = SPECIES.map(() => 0), r2 = radius * radius;
    const wolves = this.animals.filter(a => SPECIES[a.sp].name === 'wolf' && a.state !== 'dead' && a.state !== 'gone');
    let shown = 0;
    for (const a of this.animals) {
      const spec = SPECIES[a.sp];
      if (a.state === 'gone') { a.deadT += dt; if (a.deadT > 120 && !a.domestic) { a.state = 'graze'; a.alive = true; a.x = a.hx + (Math.random() - 0.5) * 8; a.z = a.hz + (Math.random() - 0.5) * 8; a.huntable = spec.huntable; } continue; }
      if ((a.x - cx) ** 2 + (a.z - cz) ** 2 > r2) continue;       // far from the camera: frozen and not drawn
      shown++;
      if (a.state === 'dead') { a.deadT += dt; if (a.deadT > 40) { a.state = 'gone'; a.deadT = 0; } this.draw(a, spec, counts, legCounts); continue; }
      // fear
      let danger = false, fx = 0, fz = 0;
      if (spec.name !== 'wolf') {
        for (const s of scares) { const d2 = (s.x - a.x) ** 2 + (s.z - a.z) ** 2; if (d2 < (a.domestic ? 16 : 150)) { danger = true; fx += a.x - s.x; fz += a.z - s.z; } }
        if (!a.domestic) for (const w of wolves) { const d2 = (w.x - a.x) ** 2 + (w.z - a.z) ** 2; if (d2 < 200) { danger = true; fx += a.x - w.x; fz += a.z - w.z; } }
      } else {
        let prey: Animal | null = null, pd = 900;
        for (const o of this.animals) { if (o.sp > 2 || o.state === 'dead' || o.state === 'gone') continue; const d2 = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; if (d2 < pd) { pd = d2; prey = o; } }
        if (prey) { a.tx = prey.x; a.tz = prey.z; a.state = 'flee'; if (pd < 3) { prey.state = 'dead'; prey.alive = false; prey.deadT = 0; a.state = 'graze'; a.timer = 6; } }
        else if (a.state === 'flee') a.state = 'graze';
      }
      if (danger && spec.name !== 'wolf') { a.state = 'flee'; const l = Math.hypot(fx, fz) || 1; a.tx = a.x + (fx / l) * 14; a.tz = a.z + (fz / l) * 14; a.timer = 0; }
      else if (a.state === 'flee' && spec.name !== 'wolf') { a.timer -= dt; if (a.timer < -2) a.state = 'graze'; }
      if (a.state === 'graze') { a.timer -= dt; if (a.timer <= 0) { a.state = 'walk'; const ang = Math.random() * 6.28, d = 2 + Math.random() * a.roam; a.tx = a.hx + Math.cos(ang) * d; a.tz = a.hz + Math.sin(ang) * d; } }

      // ---- movement: accelerate towards the wanted speed, turn smoothly, advance the gait by distance
      let want = 0;
      if (a.state === 'walk') want = spec.walk * a.pace * (0.8 + 0.4 * Math.sin(a.seed * 3.1 + this.t * 0.2));
      else if (a.state === 'flee') want = spec.run * (0.8 + 0.3 * a.pace);
      const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
      if ((a.state === 'walk' || a.state === 'flee') && d < 0.5) { a.state = 'graze'; a.timer = 3 + Math.random() * 9; want = 0; }
      a.speed += (want - a.speed) * Math.min(1, dt * (want > a.speed ? 3.5 : 6));
      if (a.speed > 0.05) {
        const wantYaw = Math.atan2(dx, dz); let da = wantYaw - a.yaw; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        a.yaw += da * Math.min(1, dt * (a.state === 'flee' ? 8 : 3.5));
        const mv = a.speed * dt;
        a.x += Math.sin(a.yaw) * mv; a.z += Math.cos(a.yaw) * mv;
        a.gait += Math.PI * 2 * mv / (spec.stride * (1 + 0.12 * a.speed / spec.walk));
        if (this.terrain.heightAt(a.x, a.z) < 0.7) { a.x -= Math.sin(a.yaw) * mv * 2; a.z -= Math.cos(a.yaw) * mv * 2; a.state = 'graze'; a.timer = 2; a.speed = 0; }
      }
      a.y = this.terrain.heightAt(a.x, a.z);
      a.headT += dt;
      this.draw(a, spec, counts, legCounts);
    }
    this.visible = shown;
    this.bodies.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; this.heads[i].count = counts[i]; this.heads[i].instanceMatrix.needsUpdate = true; const lm = this.legMeshes[i]; if (lm) { lm.count = legCounts[i]; lm.instanceMatrix.needsUpdate = true; } });
  }

  private draw(a: Animal, spec: Spec, counts: number[], legCounts: number[]) {
    const i = counts[a.sp]; if (i >= spec.max) return; counts[a.sp]++;
    const dead = a.state === 'dead', moving = a.speed > 0.15, ratio = a.speed / spec.walk;
    const gallop = spec.gait === 'quad' && ratio > 3.6, trot = spec.gait === 'quad' && ratio > 1.7 && !gallop;
    const ph = a.gait;
    // body motion
    let bob = 0, pitch = 0;
    if (spec.gait === 'hop') { const hop = moving ? Math.abs(Math.sin(ph * 0.5)) : 0; bob = hop * (0.1 + 0.05 * ratio); pitch = moving ? Math.cos(ph * 0.5) * 0.35 : 0; }
    else if (moving) { bob = Math.abs(Math.sin(ph)) * (gallop ? 0.12 : trot ? 0.05 : 0.025); pitch = Math.sin(ph) * (gallop ? 0.09 : 0.03); }
    if (dead) { this.e.set(0, a.yaw, Math.PI / 2 * (a.seed > 50 ? 1 : -1), 'YXZ'); this.p.set(a.x, a.y + 0.28, a.z); }
    else { this.e.set(pitch, a.yaw, 0, 'YXZ'); this.p.set(a.x, a.y + bob, a.z); }
    this.q.setFromEuler(this.e); this.s.setScalar(spec.size * (a.domestic ? 1 : 0.95 + (a.seed % 10) * 0.012));
    this.b.compose(this.p, this.q, this.s);
    this.bodies[a.sp].setMatrixAt(i, this.b);

    // head: grazing animals drop it to the ground and chew; walkers nod; startled ones raise it
    let hp = 0, hy = 0;
    if (dead) hp = 0.4;
    else if (a.state === 'graze') { const g = a.domestic || spec.gait === 'biped' ? 1 : 0.85; const peck = spec.gait === 'biped' ? Math.max(0, Math.sin(a.headT * 5 + a.seed)) * 1.1 : 0; hp = spec.gait === 'biped' ? peck : (0.75 + Math.sin(a.headT * 2.2) * 0.08) * g * (Math.sin(a.headT * 0.35 + a.seed) > -0.55 ? 1 : -0.1); hy = Math.sin(a.headT * 0.5 + a.seed) * 0.25; }
    else if (a.state === 'flee') { hp = -0.15; }
    else if (moving) { hp = Math.sin(ph + 0.6) * (spec.gait === 'biped' ? 0.5 : 0.1); }
    this.e.set(hp, hy, 0, 'YXZ'); this.q.setFromEuler(this.e); this.p.set(spec.neck[0], spec.neck[1], spec.neck[2]); this.s.set(1, 1, 1);
    this.t4.compose(this.p, this.q, this.s); this.h.multiplyMatrices(this.b, this.t4);
    this.heads[a.sp].setMatrixAt(i, this.h);

    // legs
    const lm = this.legMeshes[a.sp]; if (!lm || !spec.legs.length) return;
    const off = spec.gait === 'biped' ? [0, Math.PI] : gallop ? [0, 0.3, 2.4, 2.7] : trot ? [0, Math.PI, Math.PI, 0] : [0, Math.PI, Math.PI * 0.5, Math.PI * 1.5];
    const amp = !moving ? 0 : spec.gait === 'biped' ? 0.7 : gallop ? 0.95 : trot ? 0.6 : 0.38;
    spec.legs.forEach((anc, k) => {
      const ang = dead ? (k % 2 ? 0.7 : -0.5) : amp * Math.sin(ph + off[k]);
      this.e.set(-ang, 0, dead ? 0.3 : 0); this.q.setFromEuler(this.e); this.p.set(anc[0], anc[1], anc[2]); this.s.set(1, 1, 1);
      this.t4.compose(this.p, this.q, this.s); this.lm.multiplyMatrices(this.b, this.t4);
      lm.setMatrixAt(legCounts[a.sp]++, this.lm);
    });
  }

  get count() { return this.animals.filter(a => a.state !== 'gone').length; }
}
