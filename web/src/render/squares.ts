import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';

const WOOD = 0x8a6a46, DARK = 0x4a3420;

/**
 * Squares: benches and lanterns round the rim of a plaza where several roads of the village meet (the middle is left open: the roads run across it). The core works out where the squares are and how big
 * (World.squares_flat: [x, z, radius, kind] each); the ground of a square is drawn with the roads (paths.ts), in the same texture, so the roads that run in are not told apart from it.
 */
export class Squares {
  group = new THREE.Group();
  private things = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  private key = '';

  constructor(private terrain: Terrain) {
    this.things.castShadow = this.things.receiveShadow = true; this.things.frustumCulled = false;
    this.group.add(this.things);
  }

  update(sq: ArrayLike<number>, ground = 0) {
    const key = Array.from(sq).map(v => v.toFixed(2)).join(',') + ':' + ground;
    if (key === this.key) return; this.key = key;
    const parts: THREE.BufferGeometry[] = [];
    const h = (x: number, z: number) => this.terrain.heightAt(x, z);
    const put = (g: THREE.BufferGeometry, x: number, y: number, z: number, hex: number, ry = 0) => {
      const geo = g.index ? g.toNonIndexed() : g; const n = geo.attributes.position.count, c = new THREE.Color(hex), cs = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const sh = 0.9 + 0.12 * (geo.attributes.position.getY(i) > 0 ? 1 : 0); cs.set([c.r * sh, c.g * sh, c.b * sh], i * 3); }
      geo.setAttribute('color', new THREE.BufferAttribute(cs, 3)); geo.deleteAttribute('uv'); if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1)));
      parts.push(geo);
    };
    const box = (w: number, hh: number, d: number, hex: number, x: number, y: number, z: number, ry = 0) => put(new THREE.BoxGeometry(w, hh, d), x, y + hh / 2, z, hex, ry);
    const cyl = (r: number, hh: number, hex: number, x: number, y: number, z: number, seg = 12, r2 = r) => put(new THREE.CylinderGeometry(r2, r, hh, seg), x, y + hh / 2, z, hex);
    for (let s = 0; s + 3 < sq.length; s += 4) {
      const [cx, cz, R, kind] = [sq[s], sq[s + 1], sq[s + 2], sq[s + 3]];
      const off = (kind * 1.3 + Math.abs(cx) * 0.37) % 6.28;
      // benches round the rim, their backs to the outside
      const n = R < 3.4 ? 3 : R < 4.8 ? 4 : 6;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2, bx = cx + Math.cos(a) * (R - 0.95), bz = cz + Math.sin(a) * (R - 0.95), by = h(bx, bz) + 0.08, th = -a - Math.PI / 2;
        const at = (lx: number, lz: number) => [bx + lx * Math.cos(th) + lz * Math.sin(th), bz - lx * Math.sin(th) + lz * Math.cos(th)];
        const seat = at(0, 0), back = at(0, -0.26), l1 = at(-0.7, 0), l2 = at(0.7, 0);
        box(1.7, 0.1, 0.5, WOOD, seat[0], by + 0.4, seat[1], th); box(1.7, 0.42, 0.08, WOOD, back[0], by + 0.5, back[1], th);
        box(0.1, 0.45, 0.45, DARK, l1[0], by, l1[1], th); box(0.1, 0.45, 0.45, DARK, l2[0], by, l2[1], th);
        // a lantern on a post in the gap after each bench
        const la = a + Math.PI / n, lx = cx + Math.cos(la) * (R - 0.45), lz = cz + Math.sin(la) * (R - 0.45);
        if (i % 2 === 0) { cyl(0.07, 2.2, DARK, lx, h(lx, lz), lz, 6); box(0.3, 0.34, 0.3, 0xffc860, lx, h(lx, lz) + 2.2, lz); }
      }
    }
    this.things.geometry.dispose(); this.things.geometry = parts.length ? mergeGeometries(parts, false) : new THREE.BufferGeometry();
  }

  dispose() { this.things.geometry.dispose(); }
}
