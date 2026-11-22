import * as THREE from 'three';
import type { Terrain } from './terrain';

/** The camps of the map as models: a bandit camp (kind 2), a lair (3) and the plague doctor's camp (4). Abbeys and ruins (0, 1) are not drawn here. */
const rand = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true, ...extra });
const M = {
  wood: std(0x5a4128), darkWood: std(0x33261a), stone: std(0x6f6a63), bone: std(0xd8d0b8), ash: std(0x2a2623),
  cloth: [std(0x7a2f26, { side: THREE.DoubleSide }), std(0x6b5a3a, { side: THREE.DoubleSide }), std(0x4c5a3a, { side: THREE.DoubleSide })],
  banner: std(0x9c2a22, { side: THREE.DoubleSide }), sick: std(0x4a6b34, { side: THREE.DoubleSide }),
  fire: new THREE.MeshBasicMaterial({ color: 0xff8a1e }), sickFire: new THREE.MeshBasicMaterial({ color: 0x7dff4a }),
};
const G = {
  tent: new THREE.ConeGeometry(2.1, 2.6, 5), stake: new THREE.CylinderGeometry(0.12, 0.2, 2.2, 5).translate(0, 1.1, 0),
  pole: new THREE.CylinderGeometry(0.14, 0.18, 6, 6).translate(0, 3, 0), flag: new THREE.PlaneGeometry(2.2, 1.4).translate(1.1, 0, 0),
  rock: new THREE.DodecahedronGeometry(1, 0), flame: new THREE.ConeGeometry(0.45, 1.3, 6).translate(0, 0.65, 0),
  log: new THREE.CylinderGeometry(0.14, 0.14, 1.3, 5).rotateZ(Math.PI / 2), skull: new THREE.SphereGeometry(0.4, 6, 5),
  ring: new THREE.TorusGeometry(1, 0.2, 4, 9).rotateX(Math.PI / 2),
};

interface Place { g: THREE.Group; kind: number; done: boolean; flames: THREE.Object3D[]; tents: THREE.Object3D[]; flags: THREE.Object3D[]; seed: number }

export class Camps {
  group = new THREE.Group();
  private places = new Map<string, Place>();
  constructor(private terrain: Terrain) {}

  private mesh(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, o: { y?: number; s?: number | [number, number, number]; ry?: number; shadow?: boolean } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, (o.y ?? 0) + this.terrain.heightAt(g.position.x + x, g.position.z + z) - g.position.y, z);
    const s = o.s ?? 1; if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(...s);
    m.rotation.y = o.ry ?? 0; m.castShadow = o.shadow ?? true; m.receiveShadow = true; g.add(m); return m;
  }
  private fire(p: Place, x: number, z: number, sick: boolean) {
    const g = p.g;
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283; this.mesh(g, G.rock, M.stone, x + Math.cos(a) * 0.9, z + Math.sin(a) * 0.9, { s: 0.3, y: 0.1 }); }
    for (let i = 0; i < 3; i++) this.mesh(g, G.log, M.darkWood, x, z, { y: 0.15 + i * 0.05, ry: i * 1.05, s: 0.8, shadow: false });
    const f = this.mesh(g, G.flame, sick ? M.sickFire : M.fire, x, z, { y: 0.2, shadow: false });
    p.flames.push(f);
  }
  private tent(p: Place, x: number, z: number, i: number, mat: THREE.Material) {
    const t = this.mesh(p.g, G.tent, mat, x, z, { y: 1.3, ry: rand(p.seed + i) * 6.28, s: 0.9 + rand(p.seed + i * 3) * 0.4 });
    t.userData.y0 = t.position.y; t.userData.s0 = t.scale.x; p.tents.push(t);
  }
  private flag(p: Place, x: number, z: number, mat: THREE.Material, h = 1) {
    this.mesh(p.g, G.pole, M.wood, x, z, { s: [1, h, 1] });
    const f = this.mesh(p.g, G.flag, mat, x, z, { y: 6 * h - 1, ry: rand(p.seed) * 6.28, shadow: false }); p.flags.push(f);
  }
  private palisade(p: Place, r: number, gapAt: number) {
    const n = Math.round(r * 2.6);
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.283; let d = Math.abs(a - gapAt); d = Math.min(d, 6.283 - d); if (d < 0.35) continue;   // an opening to walk in by
      this.mesh(p.g, G.stake, M.darkWood, Math.cos(a) * r, Math.sin(a) * r, { s: [1, 0.8 + rand(p.seed + i) * 0.6, 1], ry: rand(i) * 3 });
    }
  }

  private build(kind: number, x: number, z: number): Place {
    const g = new THREE.Group(); g.position.set(x, this.terrain.heightAt(x, z), z);
    const p: Place = { g, kind, done: false, flames: [], tents: [], flags: [], seed: Math.floor(x * 7 + z * 13) };
    if (kind === 2) {   // bandit camp: tents round a fire, a palisade with a gate and a banner
      const n = 4 + Math.floor(rand(p.seed) * 3);
      for (let i = 0; i < n; i++) { const a = i / n * 6.283 + rand(p.seed + i); this.tent(p, Math.cos(a) * 5, Math.sin(a) * 5, i, M.cloth[i % 3]); }
      this.fire(p, 0, 0, false); this.palisade(p, 9, rand(p.seed + 9) * 6.283); this.flag(p, 2, -2.5, M.banner);
    } else if (kind === 3) {   // lair: a heap of boulders with a dark mouth, a skull totem and two fires
      for (let i = 0; i < 9; i++) { const a = i / 9 * 6.283, r = 4.5 + rand(p.seed + i) * 2; this.mesh(g, G.rock, M.stone, Math.cos(a) * r, Math.sin(a) * r, { s: [2.2 + rand(i) * 1.6, 1.8 + rand(i + 4) * 1.8, 2.2 + rand(i + 8) * 1.6], y: 0.8, ry: a }); }
      this.mesh(g, G.rock, M.ash, 0, -1, { s: [3, 2.2, 2.4], y: 1.0 });
      this.flag(p, 3, 3, M.banner, 1.3);
      for (let i = 0; i < 3; i++) this.mesh(g, G.skull, M.bone, 3 + (i - 1) * 0.0, 3, { y: 1.1 + i * 0.9, s: 1.2 - i * 0.15 });
      this.fire(p, -3.5, 4, false); this.fire(p, 4.5, -3, false);
      for (let i = 0; i < 12; i++) { const a = rand(p.seed + i * 5) * 6.283, r = 6 + rand(i * 9) * 4; this.mesh(g, G.log, M.bone, Math.cos(a) * r, Math.sin(a) * r, { y: 0.1, ry: a, s: 0.7, shadow: false }); }
    } else {   // the plague doctor's camp: sickly green cloth, a green fire, a flag on a pole
      for (let i = 0; i < 4; i++) { const a = i / 4 * 6.283 + 0.4; this.tent(p, Math.cos(a) * 4.5, Math.sin(a) * 4.5, i, M.sick); }
      this.fire(p, 0, 0, true); this.palisade(p, 8, rand(p.seed) * 6.283); this.flag(p, 0, 7.5, M.sick, 1.1);
    }
    this.group.add(g);
    return p;
  }

  /** neutrals_flat() (stride 4: kind, x, z, done): add the camps that have been found, mark the cleared ones, drop the ones that are no longer listed. */
  sync(flat: Float32Array) {
    const seen = new Set<string>();
    for (let i = 0; i + 3 < flat.length; i += 4) {
      const kind = flat[i]; if (kind < 2) continue;
      const x = flat[i + 1], z = flat[i + 2], key = `${kind}:${Math.round(x)}:${Math.round(z)}`; seen.add(key);
      let p = this.places.get(key); if (!p) { p = this.build(kind, x, z); this.places.set(key, p); }
      const done = flat[i + 3] > 0;
      if (done !== p.done) {   // cleared: tents slump, flags come down, the fire dies
        p.done = done;
        for (const t of p.tents) { t.scale.set(t.userData.s0, done ? t.userData.s0 * 0.3 : t.userData.s0, t.userData.s0); t.position.y = t.userData.y0 - (done ? 0.9 : 0); }
        for (const f of p.flags) f.visible = !done;
        for (const f of p.flames) f.visible = !done;
      }
    }
    for (const [key, p] of this.places) if (!seen.has(key)) { this.group.remove(p.g); this.places.delete(key); }
  }

  /** Flicker the fires and stir the flags; `t` in seconds. Camps far from (x, z) are hidden. */
  update(t: number, x: number, z: number) {
    for (const p of this.places.values()) {
      p.g.visible = Math.hypot(p.g.position.x - x, p.g.position.z - z) < 600;
      for (const f of p.flames) {
        const k = 0.85 + 0.15 * Math.sin(t * 9 + p.seed) + 0.1 * Math.sin(t * 23 + p.seed * 2);
        f.scale.set(k, 0.8 + 0.4 * k, k);
      }
      for (const f of p.flags) f.rotation.y = 0.3 * Math.sin(t * 1.7 + p.seed) + (f.userData.r0 ??= f.rotation.y);
    }
  }
}
