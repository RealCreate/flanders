import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { trees_in } from '../wasm/game_core.js';
import { HALF, type Terrain } from './terrain';

// ---------------------------------------------------------------------------------------------
// Trees are built the way stylised games do it (see e.g. "fluffy trees with Three.js", bent normals for foliage):
//  * foliage is a cluster of overlapping low-poly clumps, so the silhouette is lumpy and full;
//  * every clump gets *bent normals*, pointing away from the crown centre instead of away from its own faces, so the
//    whole crown shades like one soft, round mass instead of a pile of flat facets;
//  * colour is baked into vertices: dark deep inside and underneath (fake ambient occlusion), bright on top;
//  * near trees use richer geometry, far trees a cheaper version (swapped per tile as the camera moves).
// ---------------------------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Plain coloured geometry (non-indexed) with a face-axis-projected UV. */
function prep(geo: THREE.BufferGeometry, hex: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const p = g.attributes.position, nm = g.attributes.normal, k = 0.8;
  for (let i = 0; i < n; i++) {
    a.set([c.r, c.g, c.b], i * 3);
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(nm.getX(i)), ay = Math.abs(nm.getY(i)), az = Math.abs(nm.getZ(i));
    if (ay >= ax && ay >= az) { uv[i * 2] = x * k; uv[i * 2 + 1] = z * k; } else if (ax >= az) { uv[i * 2] = z * k + 3.1; uv[i * 2 + 1] = y * k; } else { uv[i * 2] = x * k + 7.7; uv[i * 2 + 1] = y * k; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Same point, same wobble: neighbouring faces never tear apart. */
const wobble = (x: number, y: number, z: number, seed: number, amt = 0.17) => 1 + amt * Math.sin(Math.round(x * 40) * 12.9898 + Math.round(y * 40) * 78.233 + Math.round(z * 40) * 37.719 + seed);

/** A lumpy sphere of leaves. */
function clump(r: number, x: number, y: number, z: number, detail: number, sy = 0.88, seed = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = wobble(p.getX(i), p.getY(i), p.getZ(i), seed + x * 3.1 + z * 2.7, detail ? 0.2 : 0.16); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * sy, p.getZ(i) * k); }
  g.translate(x, y, z); g.computeVertexNormals();
  return g;
}

/** Bend normals towards the crown and bake light into the colours: dark inside and below, bright on top. */
function finishFoliage(parts: { geo: THREE.BufferGeometry; color: number }[], centre: THREE.Vector3, R: number, yMin: number, yMax: number, soft = 0.72) {
  const out: THREE.BufferGeometry[] = [];
  for (const { geo, color } of parts) {
    const g = prep(geo, color), p = g.attributes.position, nm = g.attributes.normal as THREE.BufferAttribute, col = g.attributes.color as THREE.BufferAttribute;
    const base = new THREE.Color(color), v = new THREE.Vector3(), n = new THREE.Vector3(), f = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)); f.set(nm.getX(i), nm.getY(i), nm.getZ(i));
      n.copy(v).sub(centre); const dist = n.length(); n.normalize().multiplyScalar(soft).addScaledVector(f, 1 - soft).normalize();
      nm.setXYZ(i, n.x, n.y, n.z);
      const t = clamp((v.y - yMin) / Math.max(0.01, yMax - yMin), 0, 1), inner = clamp(dist / R, 0, 1.15);
      const shade = (0.5 + 0.62 * t) * (0.62 + 0.5 * inner) * (0.9 + 0.1 * n.y);
      col.setXYZ(i, clamp(base.r * shade, 0, 1.4), clamp(base.g * shade, 0, 1.4), clamp(base.b * shade * 0.96, 0, 1.4));
    }
    out.push(g);
  }
  return out;
}

/** Trunk with a flared base, a little taper and vertical bark streaks. */
function trunk(h: number, r0: number, r1: number, hex: number, lean = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 8, 3, true), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + h / 2, t = y / h, flare = 1 + 0.55 * Math.pow(1 - t, 5), bark = 1 + 0.07 * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 7);
    p.setXYZ(i, (p.getX(i) * flare * bark) + lean * t * t, y, p.getZ(i) * flare * bark);
  }
  g.computeVertexNormals();
  const out = prep(g, hex), col = out.attributes.color as THREE.BufferAttribute, pos = out.attributes.position;
  for (let i = 0; i < col.count; i++) { const s = 0.72 + 0.35 * (pos.getY(i) / h) + 0.12 * Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 7); col.setXYZ(i, col.getX(i) * s, col.getY(i) * s, col.getZ(i) * s); }
  return out;
}
const branch = (len: number, r: number, x: number, y: number, rz: number, hex: number) => { const g = new THREE.CylinderGeometry(r * 0.6, r, len, 5, 1, true); g.translate(0, len / 2, 0); g.rotateZ(rz); g.translate(x, y, 0); g.computeVertexNormals(); return prep(g, hex); };

const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;

function oak(hi: boolean) {
  const d = hi ? 1 : 0, centre = new THREE.Vector3(0, 4.0, 0), R = 2.7;
  const clumps = [
    { geo: clump(1.6, 0, 3.8, 0, d, 0.9, 1), color: 0x2f6a2a }, // dark core
    { geo: clump(2.0, 0, 3.95, 0, d, 0.88, 2), color: 0x4f8f3a }, { geo: clump(1.55, 1.3, 3.3, 0.7, d, 0.88, 3), color: 0x5a9a42 }, { geo: clump(1.45, -1.25, 3.4, -0.8, d, 0.88, 4), color: 0x468436 },
    { geo: clump(1.35, 0.2, 5.0, -0.4, d, 0.9, 5), color: 0x66a84c },
    ...(hi ? [{ geo: clump(1.25, -0.5, 3.5, 1.4, d, 0.9, 6), color: 0x52923c }, { geo: clump(1.15, 1.0, 4.4, -1.2, d, 0.9, 7), color: 0x5c9c44 }, { geo: clump(1.0, -1.4, 4.5, 0.4, d, 0.9, 8), color: 0x57973f }] : []),
  ];
  return merge([trunk(3.0, 0.5, 0.26, 0x5e4128), branch(1.5, 0.12, 0.2, 2.6, -0.8, 0x5e4128), ...(hi ? [branch(1.3, 0.1, -0.2, 2.9, 0.9, 0x5e4128)] : []), ...finishFoliage(clumps, centre, R, 2.2, 6.0)]);
}

function birch(hi: boolean) {
  const d = hi ? 1 : 0, centre = new THREE.Vector3(0, 4.2, 0), R = 1.9;
  const clumps = [
    { geo: clump(1.0, 0, 4.1, 0, d, 1.15, 1), color: 0x6aa03a },
    { geo: clump(1.3, 0, 4.2, 0, d, 1.1, 2), color: 0x8cbf4e }, { geo: clump(0.95, 0.7, 3.3, 0.3, d, 1.1, 3), color: 0x9acb58 }, { geo: clump(0.95, -0.6, 4.9, -0.2, d, 1.1, 4), color: 0x7fb246 },
    ...(hi ? [{ geo: clump(0.85, -0.5, 3.4, 0.7, d, 1.1, 5), color: 0x93c455 }] : []),
  ];
  const stem = trunk(3.7, 0.24, 0.12, 0xe9e5da, 0.1);
  const bandsCol = stem.attributes.color as THREE.BufferAttribute, sp = stem.attributes.position;   // dark papery bark bands
  for (let i = 0; i < bandsCol.count; i++) { const band = Math.sin(sp.getY(i) * 9 + sp.getX(i) * 20) > 0.7 ? 0.35 : 1; bandsCol.setXYZ(i, bandsCol.getX(i) * band, bandsCol.getY(i) * band, bandsCol.getZ(i) * band); }
  return merge([stem, ...finishFoliage(clumps, centre, R, 3.0, 5.6)]);
}

/** Layered skirts with ragged, drooping hems. */
function conifer(hi: boolean) {
  const centre = new THREE.Vector3(0, 3.3, 0), R = 2.4, seg = hi ? 11 : 8;
  const tiers = [[2.3, 2.6, 0.9, 0x2d5a34], [1.9, 2.4, 1.9, 0x346339], [1.5, 2.3, 3.0, 0x3b6c3e], [1.1, 2.1, 4.1, 0x42774a], [0.65, 1.8, 5.1, 0x4a8252]] as const;
  const parts: { geo: THREE.BufferGeometry; color: number }[] = [{ geo: new THREE.ConeGeometry(1.0, 5.0, 8).translate(0, 3.1, 0), color: 0x234a2c }];
  tiers.forEach(([r, h, y, c], ti) => {
    const g = new THREE.ConeGeometry(r, h, seg, 1, true), p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      if (p.getY(k) < 0) { const a = Math.atan2(p.getZ(k), p.getX(k)), spike = 1 + 0.2 * Math.sin(a * (hi ? 5.5 : 4) + ti), droop = -0.28 * (0.5 + 0.5 * Math.sin(a * (hi ? 5.5 : 4) + ti)); p.setXYZ(k, p.getX(k) * spike, p.getY(k) + droop, p.getZ(k) * spike); }
    }
    g.translate(0, y + h / 2 - 0.4, 0); g.computeVertexNormals(); parts.push({ geo: g, color: c });
  });
  return merge([trunk(2.2, 0.36, 0.16, 0x4a3524), ...finishFoliage(parts, centre, R, 0.6, 6.0, 0.55)]);
}

/** Fine leaf-speckle luminance texture, only for close-up detail. */
function foliageTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d')!;
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 1100; i++) {
    const x = Math.random() * s, y = Math.random() * s, l = 175 + Math.random() * 80, w = 4 + Math.random() * 6;
    g.fillStyle = `rgb(${l},${l},${l})`; g.save(); g.translate(x, y); g.rotate(Math.random() * 6.28); g.beginPath(); g.ellipse(0, 0, w, w * 0.42, 0, 0, 7); g.fill(); g.restore();
  }
  for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(15,22,10,0.16)'; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 3 + Math.random() * 6, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const TILE = 60; // trees are batched per tile so the GPU can cull patches of forest and each tile can pick a detail level

export class Forest {
  group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private tileCentre: { x: number; z: number; type: number; hi: boolean }[] = [];
  private geos: { hi: THREE.BufferGeometry; lo: THREE.BufferGeometry }[];
  private trees: { x: number; y: number; z: number; type: number; s: number; rot: number; slot: number; mesh: number }[] = [];
  private uTime = { value: 0 };
  private hidden = new Uint8Array(0);
  private grid = new Map<number, number[]>();
  private static key(cx: number, cz: number) { return (cx + 200) * 1000 + (cz + 200); }

  /** `rawTrees` is the core's list of trees when the caller already built it a slice at a time (see loader.ts); otherwise it is built here in one go. */
  constructor(seed: bigint, private terrain: Terrain, rawTrees?: Float32Array) {
    const raw = rawTrees ?? trees_in(seed, -HALF, -HALF, HALF, HALF);
    const tiles = new Map<string, number>(); // "type:tx:tz" -> mesh index
    const counts: number[] = [], keys: string[] = [];
    for (let i = 0; i < raw.length; i += 5) {
      const x = raw[i], z = raw[i + 1];
      if (Math.max(Math.abs(x), Math.abs(z)) > HALF - 30) continue;
      const type = raw[i + 2], key = `${type}:${Math.floor(x / TILE)}:${Math.floor(z / TILE)}`;
      let mi = tiles.get(key);
      if (mi === undefined) { mi = counts.length; tiles.set(key, mi); counts.push(0); keys.push(key); }
      this.trees.push({ x, z, y: 0, type, s: raw[i + 3], rot: raw[i + 4], slot: counts[mi]++, mesh: mi });
    }
    this.hidden = new Uint8Array(this.trees.length);
    this.trees.forEach((t, i) => { const k = Forest.key(Math.floor(t.x / 4), Math.floor(t.z / 4)); let l = this.grid.get(k); if (!l) { l = []; this.grid.set(k, l); } l.push(i); });
    this.geos = [{ hi: conifer(true), lo: conifer(false) }, { hi: oak(true), lo: oak(false) }, { hi: birch(true), lo: birch(false) }];
    const leaf = foliageTexture();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: leaf, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
          float sw = sin(uTime * 1.3 + ip.x * 0.21 + ip.y * 0.17) * 0.035 + sin(uTime * 2.7 + ip.x * 0.5) * 0.012;
          transformed.x += sw * position.y * position.y * 0.18;
          transformed.z += sw * position.y * position.y * 0.1;
        #endif`);
    };
    keys.forEach((k, mi) => {
      const [type, tx, tz] = k.split(':').map(Number);
      const m = new THREE.InstancedMesh(this.geos[type].lo, mat, Math.max(1, counts[mi]));
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = true;
      this.meshes.push(m); this.group.add(m);
      this.tileCentre.push({ x: (tx + 0.5) * TILE, z: (tz + 0.5) * TILE, type, hi: false });
    });
    this.rebuild([]);
  }

  /** Display settings: how far forests are drawn, and whether trees near the camera get their rich shape. */
  drawDistance = 1300; detail = true;

  /** Per frame: wind, and swap each tile between its rich and cheap geometry by distance to the camera. */
  tick(t: number, cam?: THREE.Vector3) {
    this.uTime.value = t;
    if (this.job) { this.deadline = performance.now() + 5; if (this.job.next().done) this.job = null; }
    if (!cam) return;
    this.tileCentre.forEach((c, i) => {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z), want = this.detail && (c.hi ? d < 95 : d < 75);
      this.meshes[i].visible = d < this.drawDistance;   // forests further away than the draw distance are skipped   // hysteresis: no flicker at the boundary
      this.meshes[i].castShadow = d < 150;   // forest beyond the shadow map casts none
      if (want !== c.hi) { c.hi = want; this.meshes[i].geometry = want ? this.geos[c.type].hi : this.geos[c.type].lo; }
    });
  }

  /** Standing trees within r of a point (felled and cleared trees do not count). */
  nearTrees(x: number, z: number, r: number, out: { x: number; z: number }[]) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || r > 60) return;
    const c0 = Math.floor((x - r) / 4), c1 = Math.floor((x + r) / 4), d0 = Math.floor((z - r) / 4), d1 = Math.floor((z + r) / 4);
    for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) { const l = this.grid.get(Forest.key(a, b)); if (!l) continue; for (const i of l) { if (this.hidden[i]) continue; const t = this.trees[i]; if ((t.x - x) ** 2 + (t.z - z) ** 2 <= r * r) out.push(t); } }
  }
  countTrees(x: number, z: number, r: number) { const o: { x: number; z: number }[] = []; this.nearTrees(x, z, r, o); return o.length; }

  /** All tree positions (for placing wildlife near forests). */
  get all() { return this.trees; }

  /** Rebuild instances; trees inside any `clear` disc (x, z, radius) are removed. */
  rebuild(clear: { x: number; z: number; r: number }[], lines: { ax: number; az: number; bx: number; bz: number; r: number }[] = [], keep: { x: number; z: number; r: number }[] = []) {
    this.job = null; this.deadline = Infinity;
    const g = this.steps(clear, lines, keep); while (!g.next().done);
  }

  /** The same, spread over the next frames (a few milliseconds of each): the forest is rebuilt behind the scenes and swapped in when it is done, so placing a building does not stall a frame. */
  rebuildLater(clear: { x: number; z: number; r: number }[], lines: { ax: number; az: number; bx: number; bz: number; r: number }[] = [], keep: { x: number; z: number; r: number }[] = []) {
    this.job = this.steps(clear, lines, keep);
  }
  private job: Generator<void, void, void> | null = null; private deadline = Infinity;
  get busy() { return this.job !== null; }

  private *steps(clear: { x: number; z: number; r: number }[], lines: { ax: number; az: number; bx: number; bz: number; r: number }[], keep: { x: number; z: number; r: number }[]): Generator<void, void, void> {
    const L = lines.map(l => ({ ...l, minx: Math.min(l.ax, l.bx) - l.r, maxx: Math.max(l.ax, l.bx) + l.r, minz: Math.min(l.az, l.bz) - l.r, maxz: Math.max(l.az, l.bz) + l.r, dx: l.bx - l.ax, dz: l.bz - l.az }));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color(), used = new Array<number>(this.meshes.length).fill(0);
    const tm = this.meshes.map(mm => new Float32Array(mm.instanceMatrix.array.length)), tc = this.meshes.map(mm => new Float32Array(mm.instanceMatrix.array.length / 16 * 3));   // (written aside and swapped in at the end)   // felled and drowned trees are left out, not drawn as zero-size instances
    // the clearings and paths are filed by the square of ground they touch, so a tree looks only at the few round it (a village has hundreds of them, a forest has tens of thousands of trees)
    const SQ = 24, sk = (a: number, b: number) => (a + 8192) * 16384 + (b + 8192);
    const dgrid = new Map<number, number[]>(), lgrid = new Map<number, number[]>();
    const file = (grid: Map<number, number[]>, i: number, x0: number, x1: number, z0: number, z1: number) => {
      const a0 = Math.floor(x0 / SQ), a1 = Math.floor(x1 / SQ), b0 = Math.floor(z0 / SQ), b1 = Math.floor(z1 / SQ);
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const k = sk(a, b); const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); }
    };
    clear.forEach((c, i) => file(dgrid, i, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r));
    L.forEach((l, i) => file(lgrid, i, l.minx, l.maxx, l.minz, l.maxz));
    for (let ti = 0; ti < this.trees.length; ti++) {
      if ((ti & 2047) === 0 && performance.now() > this.deadline) yield;
      const t = this.trees[ti];
      let hidden = false;
      const near = dgrid.get(sk(Math.floor(t.x / SQ), Math.floor(t.z / SQ))), nearL = lgrid.get(sk(Math.floor(t.x / SQ), Math.floor(t.z / SQ)));
      if (near) for (const ci of near) { const c = clear[ci], dx = t.x - c.x, dz = t.z - c.z; if (dx * dx + dz * dz < c.r * c.r) { hidden = true; break; } }
      // a kept grove stands even inside a big cleared area (the model village's woodcutter grove); small clearings (moats, scorch, felled spots) still win
      if (hidden && keep.length && !near!.some(ci => clear[ci].r < 30 && (t.x - clear[ci].x) ** 2 + (t.z - clear[ci].z) ** 2 < clear[ci].r ** 2) && keep.some(k => (t.x - k.x) ** 2 + (t.z - k.z) ** 2 < k.r * k.r)) hidden = false;
      if (!hidden && nearL) for (const li of nearL) { const l = L[li];            // trees never grow on a path
        if (t.x < l.minx || t.x > l.maxx || t.z < l.minz || t.z > l.maxz) continue;
        const len2 = l.dx * l.dx + l.dz * l.dz || 1, k = clamp(((t.x - l.ax) * l.dx + (t.z - l.az) * l.dz) / len2, 0, 1), px = l.ax + l.dx * k, pz = l.az + l.dz * k;
        if ((t.x - px) ** 2 + (t.z - pz) ** 2 < l.r * l.r) { hidden = true; break; }
      }
      // terrain rules: no trees in water (a lake, river or moat, natural or dug), and none on ground too steep to grow on after earthworks
      let h0 = 0;
      if (!hidden) {
        h0 = this.terrain.heightAt(t.x, t.z);
        if (h0 < 0.55) hidden = true;
        else { const hx = this.terrain.heightAt(t.x + 1.5, t.z), hz = this.terrain.heightAt(t.x, t.z + 1.5); if (Math.hypot(hx - h0, hz - h0) / 1.5 > 1.25) hidden = true; }
      }
      this.hidden[ti] = hidden ? 1 : 0;
      if (hidden) continue;
      t.slot = used[t.mesh]++; t.y = h0;
      q.setFromAxisAngle(up, t.rot); p.set(t.x, t.y - 0.1, t.z); s.set(t.s * (t.type === 0 ? 1.1 : 1), t.s * (1 + ((t.rot * 3.7) % 1) * 0.25), t.s * (t.type === 0 ? 1.1 : 1));
      m.compose(p, q, s); m.toArray(tm[t.mesh], t.slot * 16);
      const v = 0.88 + ((t.rot * 7.3) % 1) * 0.26, hue = (t.x * 0.13) % 0.12;
      col.setRGB(v * (1 + hue * 0.6), v * (1 + hue * 0.2), v * (0.9 + hue)); col.toArray(tc[t.mesh], t.slot * 3);
    }
    this.meshes.forEach((mm, i) => {
      mm.instanceMatrix.array.set(tm[i].subarray(0, used[i] * 16));
      if (!mm.instanceColor) mm.setColorAt(0, col);
      (mm.instanceColor!.array as Float32Array).set(tc[i].subarray(0, used[i] * 3));
      mm.count = used[i]; mm.instanceMatrix.needsUpdate = true; mm.instanceColor!.needsUpdate = true; mm.computeBoundingSphere(); mm.computeBoundingBox();
    });
  }
}
