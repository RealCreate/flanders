import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';

const STONE2 = 0x8a867c, EDGE = 0xb4afa2, WOOD = 0x8a6a46, DARK = 0x4a3420, WATER = 0x4a86b8, LEAF = 0x4f8a3a, BARK = 0x5e4630, ROOF = 0x7a3f2e;

function cobbleTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d')!;
  g.fillStyle = '#a7a398'; g.fillRect(0, 0, s, s);
  const n = 8, w = s / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * w + (j % 2 ? w / 2 : 0), v = 0.82 + ((i * 7 + j * 13) % 5) * 0.045;
    g.fillStyle = `rgb(${Math.round(166 * v)},${Math.round(162 * v)},${Math.round(152 * v)})`; g.fillRect(x + 1, j * w + 1, w - 2, w - 2);
    if (x + w > s) g.fillRect(x - s + 1, j * w + 1, w - 2, w - 2);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/**
 * Squares: a stone plaza with benches round it and a well, a fountain or a tree in the middle, where several roads of the village meet. The core works out where they are and how big
 * (World.squares_flat: [x, z, radius, kind] each); this only draws them, sitting on the ground and over the ribbons of the roads that run in.
 */
export class Squares {
  group = new THREE.Group();
  private paving = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: cobbleTexture(), vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
  private things = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  private key = '';

  constructor(private terrain: Terrain) {
    this.paving.receiveShadow = true; this.paving.renderOrder = 3; this.paving.frustumCulled = false;
    this.things.castShadow = this.things.receiveShadow = true; this.things.frustumCulled = false;
    this.group.add(this.paving, this.things);
  }

  update(sq: ArrayLike<number>, ground = 0) {
    const key = Array.from(sq).map(v => v.toFixed(2)).join(',') + ':' + ground;
    if (key === this.key) return; this.key = key;
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
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
      // the paving: a disc that follows the ground (as flat as the roads left it), lying just over the ribbons of the roads, lighter at the rim
      const base = pos.length / 3, rings = 4, seg = 36, y = (x: number, z: number) => h(x, z) + 0.11;
      pos.push(cx, y(cx, cz), cz); col.push(0.9, 0.9, 0.9); uv.push(0.5, 0.5);
      for (let r = 1; r <= rings; r++) for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2, rr = (R * r) / rings, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, edge = r === rings, v = edge ? 1.12 : 0.92 + 0.06 * Math.sin(k * 2.1 + r);
        pos.push(x, y(x, z) - (edge ? 0.04 : 0), z); col.push(v, v, v); uv.push(0.5 + (x - cx) / 5, 0.5 + (z - cz) / 5);
      }
      for (let k = 0; k < seg; k++) idx.push(base, base + 1 + k, base + 1 + ((k + 1) % seg));
      for (let r = 1; r < rings; r++) for (let k = 0; k < seg; k++) { const a = base + 1 + (r - 1) * seg + k, b = base + 1 + (r - 1) * seg + ((k + 1) % seg), c = a + seg, d = b + seg; idx.push(a, c, b, b, c, d); }
      const gy = h(cx, cz) + 0.11, off = (kind * 1.3 + Math.abs(cx) * 0.37) % 6.28;
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
      // the middle of the square
      if (kind < 1) {   // a well: a stone ring, two posts and a little roof
        cyl(1.0, 0.9, STONE2, cx, gy, cz, 14); cyl(0.78, 0.04, WATER, cx, gy + 0.88, cz, 14);
        for (const sx of [-0.85, 0.85]) cyl(0.07, 1.8, DARK, cx + sx, gy, cz, 6);
        box(2.2, 0.08, 0.5, DARK, cx, gy + 1.8, cz); put(new THREE.ConeGeometry(1.5, 0.7, 4), cx, gy + 2.2, cz, ROOF, Math.PI / 4);
      } else if (kind < 2) {   // a fountain: a wide basin, a pillar and a bowl
        cyl(1.5, 0.55, STONE2, cx, gy, cz, 18); cyl(1.28, 0.04, WATER, cx, gy + 0.54, cz, 18);
        cyl(0.22, 1.2, EDGE, cx, gy, cz, 8); cyl(0.55, 0.16, EDGE, cx, gy + 1.15, cz, 12, 0.25); cyl(0.4, 0.03, WATER, cx, gy + 1.3, cz, 12);
      } else {   // a tree in a ring of stone
        cyl(1.25, 0.35, STONE2, cx, gy, cz, 16); cyl(1.05, 0.05, 0x4b3a28, cx, gy + 0.34, cz, 16);
        cyl(0.22, 2.2, BARK, cx, gy, cz, 8, 0.3);
        for (const [dx, dy, dz, r] of [[0, 3.1, 0, 1.4], [0.7, 2.7, 0.3, 1.0], [-0.6, 2.8, -0.4, 1.0]] as [number, number, number, number][]) put(new THREE.IcosahedronGeometry(r, 1), cx + dx, gy + dy, cz + dz, LEAF);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col.flatMap(v => [v * 0.62, v * 0.6, v * 0.55]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    this.paving.geometry.dispose(); this.paving.geometry = g;
    this.things.geometry.dispose(); this.things.geometry = parts.length ? mergeGeometries(parts, false) : new THREE.BufferGeometry();
  }

  dispose() { this.paving.geometry.dispose(); this.things.geometry.dispose(); }
}
