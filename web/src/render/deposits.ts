import * as THREE from 'three';
import type { Terrain } from './terrain';

const rand = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function rockGeo(seed: number) {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.75 + rand(seed + Math.round(p.getX(i) * 10 + p.getY(i) * 7 + p.getZ(i) * 13)) * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k); }
  g.computeVertexNormals();
  return g;
}
const mats = [
  new THREE.MeshStandardMaterial({ color: 0xa5a29b, roughness: 1, flatShading: true }),                       // stone
  new THREE.MeshStandardMaterial({ color: 0xb9663a, roughness: 0.7, flatShading: true }),                     // clay
  new THREE.MeshStandardMaterial({ color: 0x6d6560, roughness: 1, flatShading: true }),                       // iron host rock
  new THREE.MeshStandardMaterial({ color: 0x7c7770, roughness: 1, flatShading: true }),                       // gold host rock
];
const oreMats = [
  null, null,
  new THREE.MeshStandardMaterial({ color: 0xa8482a, roughness: 0.6, metalness: 0.3, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.25, metalness: 0.9, emissive: 0x9a6a00, emissiveIntensity: 0.9, flatShading: true }),
];

export class Deposits {
  group = new THREE.Group();
  private groups: THREE.Group[] = [];
  private flat: Float32Array;

  constructor(flat: Float32Array, private terrain: Terrain) {
    this.flat = flat;
    for (let i = 0; i < flat.length; i += 5) {
      const kind = flat[i], x = flat[i + 1], z = flat[i + 2], g = new THREE.Group();
      g.position.set(x, terrain.heightAt(x, z) - 0.15, z);
      const n = kind === 1 ? 4 : 6;
      for (let k = 0; k < n; k++) {
        const s = 0.9 + rand(i * 3 + k) * (kind === 1 ? 1.6 : 1.4), a = rand(i + k * 7) * 6.28, d = k === 0 ? 0 : 1.3 + rand(i + k * 11) * 1.6;
        const m = new THREE.Mesh(rockGeo(i + k), mats[kind]);
        m.scale.setScalar(kind === 1 ? s * 1.3 : s); if (kind === 1) m.scale.y *= 0.45;
        m.position.set(Math.cos(a) * d, 0.35 * s, Math.sin(a) * d); m.rotation.y = a;
        m.castShadow = m.receiveShadow = true; g.add(m);
        const ore = oreMats[kind];
        if (ore) for (let v = 0; v < 3; v++) {
          const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.28 + rand(i + k + v) * 0.2, 0), ore);
          const aa = a + (v - 1) * 0.6; o.position.set(m.position.x + Math.cos(aa) * s * 0.7, m.position.y + 0.2 + v * 0.18, m.position.z + Math.sin(aa) * s * 0.7);
          o.rotation.set(rand(v) * 3, rand(v + 3) * 3, 0); o.castShadow = true; g.add(o);
        }
      }
      this.groups.push(g); this.group.add(g);
    }
  }

  /** Sit every deposit on the ground as it is now (villages level the ground, rivers and earthworks change it); one under water is hidden. */
  refit() {
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i], h = this.terrain.heightAt(this.flat[i * 5 + 1], this.flat[i * 5 + 2]);
      g.position.y = h - 0.15; g.userData.sub = h < 0.3; g.visible = !g.userData.sub;
    }
  }

  /** Shrink deposits as they are mined out. */
  sync(flat: Float32Array) {
    for (let i = 0; i < this.groups.length; i++) {
      const rem = flat[i * 5 + 3], max = flat[i * 5 + 4], f = max > 0 ? rem / max : 0;
      this.groups[i].scale.setScalar(rem <= 0 ? 0.2 : 0.55 + 0.45 * f);
    }
  }

  get count() { return this.groups.length; }
  get raw() { return this.flat; }
}
