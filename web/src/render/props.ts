import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';

const S = 10;
const rnd = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

/** A little vertex-coloured piece of scenery, already placed and rotated. */
class Kit {
  parts: THREE.BufferGeometry[] = [];
  glow: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3(1, 1, 1); private e = new THREE.Euler();
  constructor(public x: number, public y: number, public z: number, public yaw: number) {}
  private put(g: THREE.BufferGeometry, lx: number, ly: number, lz: number, hex: number, rx = 0, ry = 0, rz = 0, target = this.parts) {
    const geo = g.index ? g.toNonIndexed() : g;
    const n = geo.attributes.position.count, c = new THREE.Color(hex), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const shade = 0.92 + 0.12 * (geo.attributes.position.getY(i) > 0 ? 1 : 0); col.set([c.r * shade, c.g * shade, c.b * shade], i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.deleteAttribute('uv'); if (!geo.attributes.normal) geo.computeVertexNormals();
    this.e.set(rx, ry, rz); this.q.setFromEuler(this.e); this.v.set(lx, ly, lz); this.m.compose(this.v, this.q, this.s); geo.applyMatrix4(this.m);
    this.e.set(0, this.yaw, 0); this.q.setFromEuler(this.e); this.v.set(this.x, this.y, this.z); const w = new THREE.Matrix4().compose(this.v, this.q, this.s); geo.applyMatrix4(w);
    target.push(geo);
  }
  box(w: number, h: number, d: number, hex: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) { this.put(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, hex, rx, ry, rz); return this; }
  cyl(r: number, h: number, hex: number, x: number, y: number, z: number, seg = 8, r2 = r) { this.put(new THREE.CylinderGeometry(r2, r, h, seg), x, y + h / 2, z, hex); return this; }
  ball(r: number, hex: number, x: number, y: number, z: number, glow = false) { this.put(new THREE.IcosahedronGeometry(r, 1), x, y, z, hex, 0, 0, 0, glow ? this.glow : this.parts); return this; }
  lamp(hex: number, x: number, y: number, z: number) { this.put(new THREE.BoxGeometry(0.22, 0.3, 0.22), x, y, z, hex, 0, 0, 0, this.glow); return this; }
}

const WOOD = 0x8a6a46, DARK = 0x4a3420, IRON = 0x3a3a40, STONE = 0x8d8a82, HAY = 0xd6b655;

function bench(k: Kit) { return k.box(1.7, 0.1, 0.5, WOOD, 0, 0.5, 0).box(1.7, 0.45, 0.08, WOOD, 0, 0.6, -0.26, -0.18).box(0.1, 0.5, 0.45, DARK, -0.7, 0, 0).box(0.1, 0.5, 0.45, DARK, 0.7, 0, 0); }
function barrel(k: Kit, x = 0, z = 0) { k.cyl(0.34, 0.8, 0x7a5a38, x, 0, z, 10, 0.3); k.cyl(0.355, 0.07, IRON, x, 0.2, z, 10); k.cyl(0.355, 0.07, IRON, x, 0.58, z, 10); return k; }
function crate(k: Kit, x = 0, z = 0, s = 0.7) { return k.box(s, s, s, 0x9a7a4e, x, 0, z).box(s + 0.04, 0.07, s + 0.04, DARK, x, s * 0.5 - 0.03, z); }
function bale(k: Kit, x = 0, z = 0) { return k.cyl(0.42, 0.7, HAY, x, 0, z, 10); }
function lantern(k: Kit) { k.cyl(0.07, 2.5, DARK, 0, 0, 0, 6); k.box(0.7, 0.07, 0.07, DARK, 0.3, 2.2, 0); k.box(0.05, 0.3, 0.05, IRON, 0.62, 1.95, 0); k.lamp(0xffc860, 0.62, 1.68, 0); return k; }
function signpost(k: Kit) { k.cyl(0.09, 2.2, DARK, 0, 0, 0, 6); k.box(1.0, 0.28, 0.06, WOOD, 0.4, 1.6, 0.05, 0, 0, 0.05); k.box(0.9, 0.26, 0.06, WOOD, -0.35, 1.2, -0.05, 0, 0, -0.06); return k; }
function flowerbed(k: Kit, seed: number) {
  k.box(1.8, 0.18, 0.7, 0x5a4630, 0, 0, 0);
  const cols = [0xe8546a, 0xf2c94c, 0xe8e0ff, 0xb070e0, 0xff9a3c];
  for (let i = 0; i < 9; i++) { const x = -0.75 + (i % 5) * 0.37, z = -0.15 + Math.floor(i / 5) * 0.3 + rnd(seed, i) * 0.1; k.ball(0.11, cols[Math.floor(rnd(seed + 1, i) * cols.length)], x, 0.32 + rnd(seed, i + 9) * 0.1, z); k.box(0.03, 0.2, 0.03, 0x3f7a2e, x, 0.12, z); }
  return k;
}
function cart(k: Kit) {
  k.box(1.6, 0.14, 0.9, WOOD, 0, 0.5, 0); k.box(1.6, 0.35, 0.08, WOOD, 0, 0.62, 0.42); k.box(1.6, 0.35, 0.08, WOOD, 0, 0.62, -0.42); k.box(0.08, 0.35, 0.9, WOOD, -0.8, 0.62, 0);
  for (const z of [-0.5, 0.5]) { k.cyl(0.38, 0.1, DARK, 0, 0.38, z, 12); }
  k.box(1.6, 0.06, 0.06, DARK, 1.2, 0.5, 0.25, 0, 0, 0.08); k.box(1.6, 0.06, 0.06, DARK, 1.2, 0.5, -0.25, 0, 0, 0.08);
  for (let i = 0; i < 3; i++) k.cyl(0.34, 0.5, HAY, -0.45 + i * 0.5, 0.62, 0, 8);
  return k;
}
function stall(k: Kit, color: number) {
  for (const [x, z] of [[-1, -0.6], [1, -0.6], [-1, 0.6], [1, 0.6]]) k.box(0.1, 1.9, 0.1, DARK, x, 0, z);
  k.box(2.4, 0.1, 1.5, WOOD, 0, 1.9, 0, 0.18);
  for (let i = 0; i < 6; i++) k.box(0.4, 0.06, 1.6, i % 2 ? 0xf2ead8 : color, -1 + i * 0.4 + 0.2, 2.05 - 0.05, 0, 0.2);
  k.box(2.1, 0.12, 0.8, WOOD, 0, 0.85, 0.05); k.box(2.0, 0.85, 0.7, DARK, 0, 0, 0.05);
  const fruit = [0xd8423a, 0xe8b030, 0x6aa84a];
  for (let i = 0; i < 6; i++) k.ball(0.14, fruit[i % 3], -0.8 + i * 0.32, 1.05, 0.05);
  return k;
}

/** Scenery along the village paths and around its buildings: benches, lanterns, barrels, carts, flower beds, market stalls.
 *  Everything is merged into two meshes (one draw call each) and rebuilt only when the village changes. */
export class Props {
  group = new THREE.Group();
  private mesh: THREE.Mesh; private glow: THREE.Mesh;
  private sig = '';
  /** Where the lanterns stand (x, z), for the night lights that follow the camera. */
  lamps: [number, number][] = [];

  /** Lanterns burn brighter as it gets dark (0 by day .. 1 at night). */
  setNight(n: number) { const m = this.glow.material as THREE.MeshStandardMaterial; m.emissiveIntensity = 0.5 + 2.9 * n; }

  constructor(private terrain: Terrain) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0xffd070, emissive: 0xffa030, emissiveIntensity: 2.2 }));
    this.mesh.castShadow = this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.glow.frustumCulled = false;
    this.group.add(this.mesh, this.glow);
  }

  update(buildings: Float32Array, roads: Float32Array, radii: number[]) {
    const n = buildings.length / S, sig = Array.from({ length: n }, (_, i) => `${buildings[i * S]}:${buildings[i * S + 1]}:${buildings[i * S + 2]}:${buildings[i * S + 3]}`).join('|');
    if (sig === this.sig) return; this.sig = sig;
    const kits: Kit[] = []; this.lamps = [];
    const lamp = (x: number, z: number, yaw: number) => { kits.push(lantern(at(x, z, yaw))); this.lamps.push([x, z]); };
    /** How close (to its middle line) something may stand to a path: villagers walk the paths, so scenery must not sit on or against them. */
    const nearRoad = (x: number, z: number, margin: number) => {
      for (let s = 0; s < roads.length; s += 6) {
        const ax = roads[s], az = roads[s + 1], dx = roads[s + 2] - ax, dz = roads[s + 3] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < margin) return true;
      }
      return false;
    };
    const free = (x: number, z: number, margin = 1.2, road = 3.0) => { if (this.terrain.heightAt(x, z) < 0.5 || (road > 0 && nearRoad(x, z, road))) return false; for (let i = 0; i < n; i++) { const dx = x - buildings[i * S + 2], dz = z - buildings[i * S + 3]; if (Math.hypot(dx, dz) < radii[buildings[i * S]] + margin) return false; } return true; };
    const at = (x: number, z: number, yaw: number) => new Kit(x, this.terrain.heightAt(x, z), z, yaw);
    const hx = buildings[2], hz = buildings[3], hallTier = buildings[1];

    // path furniture: a bench or lantern at intervals, alternating sides. Paths made of many short overlapping pieces (a hand-drawn road) would otherwise get a bench from
    // every piece, so furniture keeps a minimum distance from all other furniture, whichever segment it belongs to.
    const FURNITURE_GAP = 15, placed = new Map<string, [number, number][]>();
    const roomFor = (x: number, z: number) => {
      const cx = Math.floor(x / FURNITURE_GAP), cz = Math.floor(z / FURNITURE_GAP);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [qx, qz] of placed.get(`${cx + i}:${cz + j}`) ?? []) if (Math.hypot(qx - x, qz - z) < FURNITURE_GAP) return false;
      const key = `${cx}:${cz}`; (placed.get(key) ?? placed.set(key, []).get(key)!).push([x, z]); return true;
    };
    for (let s = 0; s < roads.length; s += 6) {
      const ax = roads[s], az = roads[s + 1], bx = roads[s + 2], bz = roads[s + 3], L = Math.hypot(bx - ax, bz - az);
      if (L < 9) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, yaw = Math.atan2(nx, nz);
      for (let d = 6.5, k = 0; d < L - 5; d += 9, k++) {
        const side = (Math.floor(rnd(s, k) * 2) ? 1 : -1), px = ax + ux * d + nx * 2.3 * side, pz = az + uz * d + nz * 2.3 * side;
        if (!free(px, pz, 1.2, 1.6) || !roomFor(px, pz)) continue;
        const near = Math.hypot(px - hx, pz - hz) < 24;
        // a bench's seat faces its local +z, which must point at the road: back along -side * normal, i.e. the normal's yaw (turned half a circle on the +normal side)
        if (k % 2 === 0 || !near) kits.push(bench(at(px, pz, yaw + (side > 0 ? Math.PI : 0))));
        else lamp(px, pz, yaw);
      }
    }
    // around buildings
    for (let i = 1; i < n; i++) {
      const kind = buildings[i * S], tier = buildings[i * S + 1], x = buildings[i * S + 2], z = buildings[i * S + 3], r = radii[kind], a0 = rnd(x, z) * 6.28;
      const around = (k: number, dist: number, make: (kit: Kit) => Kit) => { const a = a0 + k * 2.1, px = x + Math.cos(a) * (r + dist), pz = z + Math.sin(a) * (r + dist); if (free(px, pz, 0.8)) kits.push(make(at(px, pz, rnd(px, pz) * 6.28))); };
      if ([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18].includes(kind)) { around(0, 1.2, k => { barrel(k, 0, 0); barrel(k, 0.7, 0.25); return crate(k, -0.5, 0.7, 0.55); }); if (tier >= 1) around(1, 1.4, k => crate(k, 0, 0, 0.8)); }
      if (kind === 1) { around(0, 2.2, k => bale(bale(k, 0, 0), 0.9, 0.3)); if (tier >= 1) around(1, 3.0, cart); }
      if (kind === 0 && tier >= 1) around(0, 0.9, k => flowerbed(k, i));
      if (kind === 0 && tier === 0) around(0, 0.9, k => barrel(k, 0, 0));
      if (kind === 16) around(0, 1.0, k => crate(k, 0, 0, 0.5));
      if (kind === 19) { around(0, 1.2, k => barrel(k, 0, 0)); }
    }
    // the market square in front of a grown town hall, with lamp posts at the corners
    if (hallTier >= 1) {
      for (const [dx, dz, c] of [[-9.5, -5.5, 0xb8403a], [9.5, -5.5, 0x3a6ab8]] as const) {
        // a stall is wide: keep it a good 4 units clear of every path, trying other spots round the square if the first is on one
        const spot = [[dx, dz], [dx * 1.25, dz - 1.5], [dx * 0.8, dz - 3.5], [dx * 1.3, dz + 2], [dx, dz - 6], [dx * 1.5, dz - 4]].find(([ox, oz]) => free(hx + ox, hz + oz, 1.2, 4.2));
        if (spot) kits.push(stall(at(hx + spot[0], hz + spot[1], Math.PI), c));
      }
      for (const [dx, dz] of [[-8, 8], [8, 8], [-8, -8], [8, -8]]) lamp(hx + dx, hz + dz, Math.atan2(dx, dz));
      kits.push(signpost(at(hx + 7.5, hz + 8.8, 0.6)));
    }

    const parts = kits.flatMap(k => k.parts), glows = kits.flatMap(k => k.glow);
    this.mesh.geometry.dispose(); this.glow.geometry.dispose();
    this.mesh.geometry = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
    this.glow.geometry = glows.length ? mergeGeometries(glows.map(g => { g.deleteAttribute('color'); return g; }))! : new THREE.BufferGeometry();
  }
}
