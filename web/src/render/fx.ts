import * as THREE from 'three';
import type { Terrain } from './terrain';

/** Soft round particles (flames, smoke, dust) on the GPU. */
class Particles {
  points: THREE.Points;
  private n: number; private cursor = 0;
  private pos: Float32Array; private vel: Float32Array; private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private rgb: Float32Array; private a0: Float32Array;
  private aSize: THREE.BufferAttribute; private aCol: THREE.BufferAttribute;
  private grav: number; private drag: number;
  private active = false;   // nothing is alive: skip the per-frame work and the draw call

  constructor(n: number, additive: boolean, grav = 0, drag = 0.5) {
    this.n = n; this.grav = grav; this.drag = drag;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.age = new Float32Array(n).fill(99); this.life = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.rgb = new Float32Array(n * 3); this.a0 = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.aSize = new THREE.BufferAttribute(new Float32Array(n), 1); this.aCol = new THREE.BufferAttribute(new Float32Array(n * 4), 4);
    g.setAttribute('aSize', this.aSize); g.setAttribute('aCol', this.aCol);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute float aSize; attribute vec4 aCol; varying vec4 vC; void main(){ vC=aCol; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=aSize*(260./-mv.z); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,.15,d)*vC.a; if(a<.01) discard; gl_FragColor=vec4(vC.rgb,a); }',
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.points.renderOrder = 5; this.points.visible = false;
  }

  /** Show the (normally hidden) points so their shader is compiled before the first fire. */
  warm(on: boolean) { this.points.visible = on || this.active; }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, r: number, g: number, b: number, a: number) {
    const i = this.cursor++ % this.n;
    this.active = true; this.points.visible = true;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.rgb.set([r, g, b], i * 3); this.a0[i] = a;
  }

  update(dt: number) {
    if (!this.active) return;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      const a = (this.age[i] += dt);
      if (a >= this.life[i]) { this.aCol.setW(i, 0); continue; }
      live++;
      const u = a / this.life[i];
      for (let k = 0; k < 3; k++) { this.vel[i * 3 + k] *= 1 - this.drag * dt; this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; }
      this.vel[i * 3 + 1] += this.grav * dt;
      this.aSize.setX(i, this.s0[i] + (this.s1[i] - this.s0[i]) * u);
      this.aCol.setXYZW(i, this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2], this.a0[i] * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85));
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; this.aSize.needsUpdate = this.aCol.needsUpdate = true;
    if (!live) { this.active = false; this.points.visible = false; }
  }
}

interface Shot { m: THREE.Object3D; t: number; dur: number; a: THREE.Vector3; b: THREE.Vector3; arc: number; fire: boolean; stone: boolean; alive: boolean }

/** Flames, smoke, arrows, stones, dust and fire light. */
export class Effects2 {
  group = new THREE.Group();
  private flames = new Particles(2600, true, 3.0, 0.8);
  private smoke = new Particles(1800, false, 0.8, 0.4);
  private dust = new Particles(500, false, -3, 1.4);
  private shots: Shot[] = [];
  private lights: THREE.PointLight[] = [];
  private acc: number[] = [];
  private arrowGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.3, 5).rotateX(Math.PI / 2);
  private arrowMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a });
  private stoneGeo = new THREE.IcosahedronGeometry(0.32, 0);
  private stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8782, roughness: 1 });
  private t = 0;

  constructor(private terrain: Terrain) {
    this.group.add(this.dust.points, this.smoke.points, this.flames.points);
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xff7a2a, 0, 34, 2); l.castShadow = false; this.lights.push(l); this.group.add(l); }
  }

  warm(on: boolean) { this.flames.warm(on); this.smoke.warm(on); this.dust.warm(on); }

  /** Spawn an arrow or a catapult stone flying from a to b. */
  shot(kind: number, x0: number, z0: number, x1: number, z1: number, fire: boolean, y0 = 1.5) {
    const stone = kind === 1;
    const a = new THREE.Vector3(x0, this.terrain.heightAt(x0, z0) + (stone ? 2.4 : y0), z0), b = new THREE.Vector3(x1, this.terrain.heightAt(x1, z1) + (stone ? 0.4 : 1.1), z1);
    const m = new THREE.Mesh(stone ? this.stoneGeo : this.arrowGeo, stone ? this.stoneMat : this.arrowMat); m.castShadow = false; this.group.add(m);
    const d = a.distanceTo(b);
    this.shots.push({ m, t: 0, dur: Math.max(0.35, d / (stone ? 15 : 30)), a, b, arc: stone ? d * 0.35 : d * 0.08, fire, stone, alive: true });
  }

  /** The ogre's slam: a ring of dust and small stones thrown outward from where he struck. */
  slam(x: number, z: number, reach = 3.5) {
    const y = this.terrain.heightAt(x, z) + 0.3;
    for (let i = 0; i < 44; i++) { const a = i / 44 * 6.283 + Math.random() * 0.1, s = reach * (1.2 + Math.random() * 0.8); this.dust.emit(x, y, z, Math.cos(a) * s, 0.6 + Math.random() * 1.4, Math.sin(a) * s, 0.7 + Math.random() * 0.5, 0.8, 2.6, 0.5, 0.42, 0.33, 0.8); }
    for (let i = 0; i < 8; i++) { const a = Math.random() * 6.283, s = 2 + Math.random() * 3; this.dust.emit(x, y, z, Math.cos(a) * s, 3 + Math.random() * 3, Math.sin(a) * s, 0.6, 0.3, 0.15, 0.4, 0.37, 0.33, 1); }
  }

  /** A war horn: a ring of gold light spreading out over the field as far as it spurs the escort on. */
  hornBlast(x: number, z: number, reach = 32) {
    const y = this.terrain.heightAt(x, z) + 1.6, life = 1.1;
    for (let i = 0; i < 70; i++) { const a = i / 70 * 6.283, s = reach / life; this.flames.emit(x, y, z, Math.cos(a) * s * 0.9, 0.2, Math.sin(a) * s * 0.9, life, 1.5, 0.7, 1, 0.78, 0.28, 0.55); }
  }

  /** Embers rising off an enraged boss (call a few times a second). */
  rageSpark(x: number, y: number, z: number) {
    for (let i = 0; i < 3; i++) this.flames.emit(x + (Math.random() - 0.5) * 1.6, y + Math.random() * 1.8, z + (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.6, 0.7, 0.9, 0.2, 1, 0.18 + Math.random() * 0.2, 0.05, 0.8);
  }

  arrowAt(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const m = new THREE.Mesh(this.arrowGeo, this.arrowMat); this.group.add(m);
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), d = a.distanceTo(b);
    this.shots.push({ m, t: 0, dur: Math.max(0.3, d / 30), a, b, arc: d * 0.08, fire: false, stone: false, alive: true });
  }

  /** A bucket of water thrown onto a burning building: droplets in an arc, then a hiss of steam. */
  waterThrow(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const T = 0.75, g = 3.0;
    for (let i = 0; i < 16; i++) {
      const j = () => (Math.random() - 0.5) * 1.4;
      this.dust.emit(x0, y0, z0, (x1 - x0 + j()) / T, (y1 - y0) / T + 0.5 * g * T + Math.random() * 0.8, (z1 - z0 + j()) / T, T + 0.1, 0.45, 0.25, 0.55, 0.75, 0.95, 0.85);
    }
    setTimeout(() => { for (let i = 0; i < 9; i++) this.smoke.emit(x1 + (Math.random() - 0.5) * 1.4, y1, z1 + (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6, 1.6, 1.0, 3.6, 0.9, 0.92, 0.95, 0.5); }, T * 1000);
  }

  /** A blow landing on a soldier: a few specks of blood and dust at chest height (more when it kills). */
  hit(x: number, y: number, z: number, killed: boolean) {
    const n = killed ? 14 : 6;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, s = 0.6 + Math.random() * 1.6;
      this.dust.emit(x, y, z, Math.cos(a) * s, 0.8 + Math.random() * 1.6, Math.sin(a) * s, 0.5 + Math.random() * 0.4, 0.22, 0.5, i % 3 ? 0.6 : 0.5, i % 3 ? 0.08 : 0.4, i % 3 ? 0.06 : 0.3, 0.85);
    }
  }

  burst(x: number, z: number, big = true) {
    const y = this.terrain.heightAt(x, z) + 0.3, n = big ? 40 : 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, s = 1 + Math.random() * 4;
      this.dust.emit(x, y, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 1.2 + Math.random() * 1.2, 1.2, 3.2, 0.45, 0.38, 0.3, 0.7);
      if (big && i % 3 === 0) this.flames.emit(x, y, z, Math.cos(a) * s * 0.5, 2 + Math.random() * 3, Math.sin(a) * s * 0.5, 0.6, 1.4, 0.4, 1, 0.55, 0.15, 0.9);
    }
  }

  /** Update fires. `fires` is World.fires_flat(): [kind, x, y, r] per fire. `camera` picks which fires cast light. */
  update(dt: number, fires: Float32Array, camPos: THREE.Vector3) {
    this.t += dt;
    const nf = fires.length / 4;
    while (this.acc.length < nf) this.acc.push(0);
    const lit: { i: number; d: number }[] = [];
    for (let i = 0; i < nf; i++) {
      const kind = fires[i * 4], x = fires[i * 4 + 1], z = fires[i * 4 + 2], r = fires[i * 4 + 3];
      const gy = this.terrain.heightAt(x, z);
      const rate = kind === 0 ? 70 : 24 + r * 8;
      this.acc[i] += rate * dt;
      while (this.acc[i] >= 1) {
        this.acc[i] -= 1;
        const ang = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * (kind === 0 ? r * 0.8 : r), px = x + Math.cos(ang) * rr, pz = z + Math.sin(ang) * rr;
        const py = (kind === 0 ? gy + 1.2 + Math.random() * 3.6 : this.terrain.heightAt(px, pz) + 0.3 + Math.random() * 1.2);
        const hot = Math.random();
        this.flames.emit(px, py, pz, (Math.random() - 0.5) * 0.7, 1.4 + Math.random() * 2.4, (Math.random() - 0.5) * 0.7, 0.55 + Math.random() * 0.6, kind === 0 ? 3.4 : 4.2, 0.6, 1, 0.35 + hot * 0.5, 0.05 + hot * 0.12, 0.85);
        if (Math.random() < 0.55) this.smoke.emit(px, py + 1.4, pz, 0.6 + Math.random() * 0.6, 1.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.7, 3 + Math.random() * 2.5, 3.2, 12, 0.16, 0.15, 0.15, 0.55);
        if (Math.random() < 0.05) this.flames.emit(px, py, pz, (Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.9, 0.35, 0.1, 1, 0.85, 0.3, 1);
      }
      lit.push({ i, d: Math.hypot(x - camPos.x, z - camPos.z) });
    }
    lit.sort((a, b) => a.d - b.d);
    this.lights.forEach((l, k) => {
      const f = lit[k];
      if (!f) { l.intensity = 0; return; }
      const x = fires[f.i * 4 + 1], z = fires[f.i * 4 + 2];
      l.position.set(x, this.terrain.heightAt(x, z) + 3.5, z);
      l.intensity = (90 + fires[f.i * 4 + 3] * 25) * (0.8 + Math.sin(this.t * 17 + k * 3) * 0.12 + Math.sin(this.t * 31 + k) * 0.08);
    });

    // projectiles
    const v = new THREE.Vector3();
    for (const s of this.shots) {
      s.t += dt; const u = Math.min(1, s.t / s.dur);
      v.lerpVectors(s.a, s.b, u); v.y += s.arc * 4 * u * (1 - u);
      const prev = s.m.position.clone(); s.m.position.copy(v);
      if (u < 1) {
        const dir = v.clone().sub(prev); if (dir.lengthSq() > 1e-6) s.m.lookAt(v.clone().add(dir));
        if (s.stone) { s.m.rotation.x += dt * 8; this.smoke.emit(v.x, v.y, v.z, 0, 0.2, 0, 0.8, 0.5, 1.4, 0.3, 0.28, 0.26, 0.4); }
        if (s.fire) { this.flames.emit(v.x, v.y, v.z, 0, 0.5, 0, 0.35, 0.6, 0.1, 1, 0.55, 0.15, 0.9); this.smoke.emit(v.x, v.y, v.z, 0, 0.4, 0, 1.2, 0.5, 2, 0.2, 0.2, 0.2, 0.3); }
      } else {
        s.alive = false; this.group.remove(s.m);
        if (s.stone) this.burst(s.b.x, s.b.z, true);
        else if (s.fire) this.flames.emit(s.b.x, s.b.y, s.b.z, 0, 1, 0, 0.8, 1.2, 0.2, 1, 0.5, 0.1, 0.9);
      }
    }
    this.shots = this.shots.filter(s => s.alive);
    this.flames.update(dt); this.smoke.update(dt); this.dust.update(dt);
  }
}

/** Charred rubble where buildings stood. */
export class Ruins {
  group = new THREE.Group();
  private sig = '';
  private mats = [new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 1 }), new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 1 }), new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 })];
  private ray = new THREE.Raycaster();
  constructor(private terrain: Terrain) {}

  /** ruins = World.ruins_flat(): [x, y, r, kind, tier, rot] per ruin. Each ruin is a clickable pile of charred rubble. */
  sync(ruins: Float32Array, terrainVersion = 0) {
    const sig = Array.from(ruins).join(',') + '#' + terrainVersion;   // refitted whenever the ground changes if (sig === this.sig) return; this.sig = sig;
    this.group.children.slice().forEach(c => { this.group.remove(c); c.traverse(o => (o as THREE.Mesh).geometry?.dispose()); });
    const n = ruins.length / 6;
    for (let i = 0; i < n; i++) {
      const x = ruins[i * 6], z = ruins[i * 6 + 1], r = ruins[i * 6 + 2], pile = new THREE.Group(); pile.userData.ruinIdx = i;
      for (let k = 0; k < 14; k++) {
        const a = Math.sin(i * 12.9 + k * 7.1) * 43758.5453, rnd = (m: number) => { const q = Math.sin(a * m + k) * 43758.5453; return q - Math.floor(q); };
        const isBeam = k % 3 === 0, w = isBeam ? 0.18 : 0.5 + rnd(1) * 0.7, h = isBeam ? 0.15 : 0.3 + rnd(2) * 0.5, d = isBeam ? 1.4 + rnd(3) * 1.4 : 0.5 + rnd(4) * 0.7;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mats[isBeam ? 2 : k % 2]);
        const ang = rnd(5) * 6.28, rr = rnd(6) * r * 0.9;
        m.position.set(x + Math.cos(ang) * rr, this.terrain.heightAt(x, z) + h * 0.35, z + Math.sin(ang) * rr); m.rotation.set((rnd(7) - 0.5) * 0.6, rnd(8) * 6.28, (rnd(9) - 0.5) * 0.6);
        m.castShadow = m.receiveShadow = true; pile.add(m);
      }
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.8, r + 0.8, 2.4, 10), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(x, this.terrain.heightAt(x, z) + 1.2, z); pile.add(hit);
      this.group.add(pile);
    }
  }

  /** Index of the ruin under the pointer, or null. */
  pick(ray: THREE.Raycaster): number | null {
    void this.ray;
    const hit = ray.intersectObjects(this.group.children, true)[0]; if (!hit) return null;
    let o: THREE.Object3D | null = hit.object; while (o && o.userData.ruinIdx === undefined) o = o.parent;
    return o ? o.userData.ruinIdx : null;
  }
}
