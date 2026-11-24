import * as THREE from 'three';
import { deer, boar, rabbit, wolf, sheep, cow, chicken, pig } from './animalmodels';
import type { Terrain } from './terrain';
import type { Huntable, WildLike } from './people';
import { GRAZING_RADIUS, PASTURE, PIGSTY, isLivestockPen } from '../pasture';
import { decay } from './fight';
import { Remains } from './remains';
import { surfaceTexture, type Surface } from './surfaces';

type Gait = 'quad' | 'biped' | 'hop';
interface Spec {
  name: string; max: number; huntable: boolean; gait: Gait;
  walk: number; run: number;           // units/s while ambling and when fleeing (before individual variation)
  stride: number;                      // distance covered by one full gait cycle at a walk
  body: () => THREE.BufferGeometry; head: (googly?: boolean) => THREE.BufferGeometry; legGeo: () => THREE.BufferGeometry | null;
  coat: Surface;
  legs: [number, number, number][];    // hip anchors: FL, FR, BL, BR
  neck: [number, number, number];      // where the head pivots
  size: number;
}

const SPECIES: Spec[] = [
  { ...deer, name: 'deer', coat: 'fur', max: 40, huntable: true, gait: 'quad', walk: 1.2, run: 9, stride: 1.5, size: 1, neck: [0, 1.14, 0.45], legs: [[0.14, 0.91, 0.38], [-0.14, 0.91, 0.38], [0.14, 0.91, -0.4], [-0.14, 0.91, -0.4]] },
  { ...boar, name: 'boar', coat: 'fur', max: 16, huntable: true, gait: 'quad', walk: 1.1, run: 6.5, stride: 0.95, size: 1, neck: [0, 0.64, 0.39], legs: [[0.16, 0.46, 0.3], [-0.16, 0.46, 0.3], [0.16, 0.46, -0.3], [-0.16, 0.46, -0.3]] },
  { ...rabbit, name: 'rabbit', coat: 'fur', max: 40, huntable: true, gait: 'hop', walk: 0.9, run: 6, stride: 0.6, size: 1, neck: [0, 0.275, 0.14], legs: [] },
  { ...wolf, name: 'wolf', coat: 'fur', max: 10, huntable: false, gait: 'quad', walk: 1.5, run: 10, stride: 1.4, size: 1, neck: [0, 0.98, 0.42], legs: [[0.12, 0.79, 0.34], [-0.12, 0.79, 0.34], [0.12, 0.79, -0.34], [-0.12, 0.79, -0.34]] },
  { ...sheep, name: 'sheep', coat: 'fleece', max: 70, huntable: false, gait: 'quad', walk: 0.6, run: 4, stride: 0.7, size: 1, neck: [0, 0.72, 0.37], legs: [[0.14, 0.42, 0.25], [-0.14, 0.42, 0.25], [0.14, 0.42, -0.25], [-0.14, 0.42, -0.25]] },
  { ...cow, name: 'cow', coat: 'fur', max: 30, huntable: false, gait: 'quad', walk: 0.55, run: 3.5, stride: 1.2, size: 1, neck: [0, 1.13, 0.55], legs: [[0.18, 0.77, 0.42], [-0.18, 0.77, 0.42], [0.18, 0.77, -0.45], [-0.18, 0.77, -0.45]] },
  { ...chicken, name: 'chicken', coat: 'feathers', max: 60, huntable: false, gait: 'biped', walk: 0.5, run: 3, stride: 0.3, size: 1, neck: [0, 0.34, 0.1], legs: [[0.05, 0.2, 0], [-0.05, 0.2, 0]] },
  { ...pig, name: 'pig', coat: 'hide', max: 70, huntable: false, gait: 'quad', walk: 0.68, run: 3.7, stride: 0.72, size: 1, neck: [0, 0.59, 0.31], legs: [[0.16, 0.41, 0.23], [-0.16, 0.41, 0.23], [0.16, 0.41, -0.39], [-0.16, 0.41, -0.39]] },
];

const BONE_SIZE: Record<string, number> = { deer: 1.2, boar: 0.8, rabbit: 0.3, wolf: 0.9, sheep: 0.8, cow: 1.4, chicken: 0.25, pig: 0.9 };

const BODY_H: Record<string, number> = { deer: 0.95, boar: 0.5, rabbit: 0.2, wolf: 0.85, sheep: 0.5, cow: 0.9, chicken: 0.2, pig: 0.45 };   // how high the body sits: how far it swings sideways when it falls over

interface Animal extends Huntable {
  sp: number; y: number; yaw: number; state: 'graze' | 'walk' | 'flee' | 'dead' | 'gone'; tx: number; tz: number; timer: number;
  hx: number; hz: number; roam: number; seed: number; huntable: boolean; deadT: number; domestic: boolean; owner?: string;
  pace: number;      // individual speed factor (some animals are just quicker)
  speed: number;     // current ground speed
  gait: number;      // gait angle, advances with distance covered
  headT: number;     // head behaviour clock
  pen?: number;      // fenced livestock stay within this distance of their home
}

const rng = (seed: number) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function upload(mesh: THREE.InstancedMesh, count: number) {
  mesh.count = count; mesh.visible = count > 0;   // hidden when empty: an empty instanced mesh still costs a program bind and uniform upload per pass
  if (count === 0) return;
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, count * 16);
  mesh.instanceMatrix.needsUpdate = true;
}

/** Deer, boar, rabbits and wolves in the forests; sheep, cows and chickens around farms and houses.
 *  Each species walks, trots and gallops with its own stride; each animal has its own pace. Only animals near the camera are simulated and drawn. */
export class Wildlife implements WildLike {
  group = new THREE.Group();
  private remains = new Remains();
  private animals: Animal[] = [];
  private bodies: THREE.InstancedMesh[] = []; private heads: THREE.InstancedMesh[] = []; private legMeshes: (THREE.InstancedMesh | null)[] = [];
  private normalHeads: THREE.BufferGeometry[] = [];
  private googlyHeads?: THREE.BufferGeometry[];
  private m = new THREE.Matrix4(); private b = new THREE.Matrix4(); private h = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private s = new THREE.Vector3(); private e = new THREE.Euler(); private lm = new THREE.Matrix4(); private t4 = new THREE.Matrix4();
  private t = 0;
  private domSig = new Map<string, string>();
  visible = 0;

  constructor(seed: bigint, private terrain: Terrain, trees: { x: number; z: number }[], sites: number[]) {
    this.group.add(this.remains.group);
    const r = rng(Number(seed % 1000003n) + 17);
    const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    SPECIES.forEach(spec => {
      const coat = new THREE.MeshStandardMaterial({ map: surfaceTexture(spec.coat), vertexColors: true, roughness: 0.94 });
      const mk = (g: THREE.BufferGeometry, max: number, mat = skin) => { const m = new THREE.InstancedMesh(g, mat, max); m.castShadow = true; m.frustumCulled = false; m.count = 0; this.group.add(m); return m; };
      this.normalHeads.push(spec.head());
      this.bodies.push(mk(spec.body(), spec.max, coat)); this.heads.push(mk(this.normalHeads.at(-1)!, spec.max));
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

  setGooglyEyes(on: boolean) {
    const variants = on ? this.googlyHeads ??= SPECIES.map(spec => spec.head(true)) : this.normalHeads;
    this.heads.forEach((head, index) => { head.geometry = variants[index]; });
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
    for (let i = 0; i < buildings.length; i += S) { const k = buildings[i]; if (isLivestockPen(k) || k === 1 || (k === 0 && buildings[i + 1] <= 1)) parts.push(`${k}:${buildings[i + 2]}:${buildings[i + 3]}:${buildings[i + 1]}`); }
    const sig = parts.join('|'); if (this.domSig.get(key) === sig) return; this.domSig.set(key, sig);
    this.animals = this.animals.filter(a => a.owner !== key);
    const r = rng(parts.length * 977 + 3);
    for (let i = 0; i < buildings.length; i += S) {
      const k = buildings[i], x = buildings[i + 2], z = buildings[i + 3];
      const add = (si: number, n: number, ox: number, oz: number, roam: number, pen?: number) => {
        for (let j = 0; j < n; j++) {
          const ax = ox + (r() - 0.5) * roam, az = oz + (r() - 0.5) * roam;
          const animal = this.make(si, ax, az, this.terrain.heightAt(ax, az), ox, oz, roam, r, true, key);
          animal.pen = pen;
          this.animals.push(animal);
        }
      };
      if (k === PASTURE) {
        const tier = buildings[i + 1];
        add(4, 4 + tier, x, z, 4.5, GRAZING_RADIUS);
        if (tier > 0) add(5, tier, x, z, 4.5, GRAZING_RADIUS);
      }
      else if (k === PIGSTY) add(7, 4 + buildings[i + 1], x, z, 4.5, GRAZING_RADIUS);
      else if (k === 1) add(4, 2, x, z + 4, 5);
      else if (k === 0 && buildings[i + 1] <= 1) add(6, 2, x, z + 3.5, 4);
    }
  }

  /** `scares` are positions of people animals fear. Only animals within `radius` of (cx, cz) are simulated and drawn. */
  update(dt: number, scares: { x: number; z: number }[], cx = 0, cz = 0, radius = 1e9) {
    this.t += dt;
    const counts = SPECIES.map(() => 0), legCounts = SPECIES.map(() => 0), r2 = radius * radius;
    const wolves = this.animals.filter(a => SPECIES[a.sp].name === 'wolf' && a.state !== 'dead' && a.state !== 'gone');
    let shown = 0;
    this.remains.begin();
    for (const a of this.animals) {
      const spec = SPECIES[a.sp];
      if (a.state === 'gone') { a.deadT += dt; if (a.deadT > 120 && !a.domestic) { a.state = 'graze'; a.alive = true; a.x = a.hx + (Math.random() - 0.5) * 8; a.z = a.hz + (Math.random() - 0.5) * 8; a.huntable = spec.huntable; } continue; }
      if ((a.x - cx) ** 2 + (a.z - cz) ** 2 > r2) continue;       // far from the camera: frozen and not drawn
      shown++;
      if (dt === 0) { this.draw(a, spec, counts, legCounts); continue; }
      if (a.state === 'dead') { a.deadT += dt; if (decay(a.deadT).done) { a.state = 'gone'; a.deadT = 0; } this.draw(a, spec, counts, legCounts); continue; }
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
      if (a.state === 'graze') { a.timer -= dt; if (a.timer <= 0) { a.state = 'walk'; const ang = Math.random() * 6.28, d = a.pen === undefined ? 2 + Math.random() * a.roam : 0.5 + Math.random() * (a.pen - 0.65); a.tx = a.hx + Math.cos(ang) * d; a.tz = a.hz + Math.sin(ang) * d; } }

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
      if (a.pen !== undefined) {
        const dx = a.x - a.hx, dz = a.z - a.hz, r = Math.hypot(dx, dz);
        if (r > a.pen) {
          a.x = a.hx + dx * a.pen / r; a.z = a.hz + dz * a.pen / r;
          a.state = 'graze'; a.timer = 0.8; a.speed = 0;
        }
      }
      a.y = this.terrain.heightAt(a.x, a.z);
      a.headT += dt;
      this.draw(a, spec, counts, legCounts);
    }
    this.remains.end();
    this.visible = shown;
    this.bodies.forEach((mesh, i) => {
      upload(mesh, counts[i]);
      upload(this.heads[i], counts[i]);
      const legs = this.legMeshes[i];
      if (legs) upload(legs, legCounts[i]);
    });
  }

  private draw(a: Animal, spec: Spec, counts: number[], legCounts: number[]) {
    const dead = a.state === 'dead', dc = dead ? decay(a.deadT) : null;
    if (dc) {   // a dead animal is rolled onto its side about its feet, so its body lies sideways of where it stood: put the remains under the body
      const lx = (BODY_H[spec.name] ?? 0.5) * (a.seed > 50 ? -1 : 1), ox = Math.cos(a.yaw) * lx, oz = -Math.sin(a.yaw) * lx;
      this.remains.add(a.x + ox, a.y, a.z + oz, a.yaw, BONE_SIZE[spec.name] ?? 0.7, dc); if (!dc.body) return;
    }
    const i = counts[a.sp]; if (i >= spec.max) return; counts[a.sp]++;
    const moving = a.speed > 0.15, ratio = a.speed / spec.walk;
    const gallop = spec.gait === 'quad' && ratio > 3.6, trot = spec.gait === 'quad' && ratio > 1.7 && !gallop;
    const ph = a.gait;
    // body motion
    let bob = 0, pitch = 0;
    if (spec.gait === 'hop') { const hop = moving ? Math.abs(Math.sin(ph * 0.5)) : 0; bob = hop * (0.1 + 0.05 * ratio); pitch = moving ? Math.cos(ph * 0.5) * 0.35 : 0; }
    else if (moving) { bob = Math.abs(Math.sin(ph)) * (gallop ? 0.12 : trot ? 0.05 : 0.025); pitch = Math.sin(ph) * (gallop ? 0.09 : 0.03); }
    if (dead) { this.e.set(0, a.yaw, Math.PI / 2 * (a.seed > 50 ? 1 : -1), 'YXZ'); this.p.set(a.x, a.y + 0.28 - dc!.rot * 0.15, a.z); }
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
