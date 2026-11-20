import * as THREE from 'three';
import { HALF, type Terrain } from './terrain';
import { HAT, TOOL, type Crowd } from './crowd';
import { makeBoat } from './field';

interface Ship { mesh: THREE.Group; sail: THREE.Mesh; pts: THREE.Vector2[]; len: number[]; total: number; s: number; speed: number; yaw: number; seed: number }

const shipWood = new THREE.MeshStandardMaterial({ color: 0x67422c, roughness: 0.86 });
const rope = new THREE.MeshStandardMaterial({ color: 0xa99470, roughness: 1 });
const canvas = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
const furledCanvas = new THREE.MeshStandardMaterial({ color: 0xe4d5ad, roughness: 0.95 });
const shipModels = new Map<boolean, THREE.Group>();

/** A clinker-built cog with a raised stern, standing rigging and either a set or furled sail. */
export function makeShip(moored = false): THREE.Group {
  const cached = shipModels.get(moored);
  if (cached) return cached.clone();
  const g = new THREE.Group(), hull = makeBoat(true); hull.scale.set(1.65, 1.42, 1.78); g.add(hull);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shipWood);
    mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh);
  };
  const line = (a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) => {
    const direction = b.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, direction.length(), 6), material);
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); g.add(mesh);
  };
  const mast = new THREE.Vector3(0.42, 6.65, 0), yardY = moored ? 5.34 : 6.1;
  line(new THREE.Vector3(0.42, 0.42, 0), new THREE.Vector3(0.42, 7.15, 0), 0.108, shipWood);
  line(new THREE.Vector3(0.42, yardY, -2.27), new THREE.Vector3(0.42, yardY, 2.27), 0.062, shipWood);
  line(mast, new THREE.Vector3(4.6, 1.06, 0), 0.024, rope);
  line(mast, new THREE.Vector3(-4.1, 1.28, 0), 0.024, rope);
  for (const side of [-1, 1]) {
    line(mast, new THREE.Vector3(-0.85, 0.64, side * 1.49), 0.023, rope);
    box(2.15, 0.38, 0.13, -3.14, 1.14, side * 1.03);
    if (!moored) line(new THREE.Vector3(0.79, 2.37, side * 1.98), new THREE.Vector3(1.65, 0.68, side * 1.14), 0.022, rope);
  }
  box(2.24, 0.36, 2.17, -3.14, 0.79, 0);
  box(0.16, 0.68, 0.37, -4.96, 0.3, 0); // stern rudder
  box(0.63, 0.57, 0.64, -1.28, 0.83, -0.42);
  box(0.52, 0.44, 0.51, -1.91, 0.8, 0.43);
  if (moored) {
    line(new THREE.Vector3(0.54, yardY - 0.1, -2.06), new THREE.Vector3(0.54, yardY - 0.1, 2.06), 0.155, furledCanvas);
    for (const z of [-1.55, -0.7, 0.7, 1.55]) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.157, 0.035, 5, 8), rope);
      strap.position.set(0.54, yardY - 0.1, z); g.add(strap);
    }
  } else {
    const cloth = new THREE.PlaneGeometry(4.2, 3.75, 14, 14);
    const p = cloth.attributes.position, colors: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / 2.1, y = p.getY(i) / 1.875, fullness = 1 - x * x;
      p.setXYZ(i, p.getX(i) * (0.94 + y * 0.06), p.getY(i) + Math.max(0, -y) * fullness * 0.28,
        fullness * Math.sin((1 - y) * Math.PI * 0.42) * 0.92);
      const ink = new THREE.Color(Math.abs(x) < 0.095 || (y >= 0 && y <= 0.3) ? 0x9c3d31 : 0xeee1bf);
      ink.multiplyScalar(0.94 + Math.cos(i % 15 * 2.6) * 0.055); colors.push(ink.r, ink.g, ink.b);
    }
    cloth.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); cloth.computeVertexNormals();
    const sail = new THREE.Mesh(cloth, canvas); sail.name = 'sail'; sail.rotation.y = Math.PI / 2;
    sail.position.set(0.5, yardY - 1.875, 0); sail.castShadow = true; g.add(sail);
  }
  shipModels.set(moored, g);
  return g.clone();
}

/** Big ships sailing on the open lakes of the map. They follow loops through deep water and ride the tide. */
export class WorldShips {
  group = new THREE.Group();
  private ships: Ship[] = [];
  private t = 0;

  constructor(terrain: Terrain) {
    const C = 6, N = Math.round((HALF * 2) / C), water = new Uint8Array(N * N), label = new Int32Array(N * N).fill(-1);
    const xz = (i: number, j: number) => [-HALF + (i + 0.5) * C, -HALF + (j + 0.5) * C] as const;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const [x, z] = xz(i, j); water[j * N + i] = terrain.baseAt(x, z) < -0.4 ? 1 : 0; }
    // label the water bodies; those touching the edge of the map are the sea, the rest are lakes
    const bodies: { cells: number[]; sea: boolean }[] = [];
    for (let s = 0; s < N * N; s++) {
      if (!water[s] || label[s] >= 0) continue;
      const id = bodies.length, cells: number[] = [], stack = [s]; label[s] = id; let sea = false;
      while (stack.length) {
        const c = stack.pop()!; cells.push(c); const ci = c % N, cj = (c / N) | 0; if (ci === 0 || cj === 0 || ci === N - 1 || cj === N - 1) sea = true;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = ci + di, b = cj + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue; const k = b * N + a; if (water[k] && label[k] < 0) { label[k] = id; stack.push(k); } }
      }
      bodies.push({ cells, sea });
    }
    let made = 0;
    for (const body of bodies) {
      if (body.sea || body.cells.length < 60 || made >= 10) continue;
      // deep water: every neighbour is water of the same lake
      // deep water well clear of the shore (two cells of water all round), or failing that one; only the biggest connected stretch of it, so a ship can always sail from any waypoint to the next
      const clear = (c: number, ring: number) => { const ci = c % N, cj = (c / N) | 0; for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) { const a = ci + di, b = cj + dj; if (a < 0 || b < 0 || a >= N || b >= N || label[b * N + a] !== label[c]) return false; } return true; };
      let mask = new Uint8Array(N * N), cells = body.cells.filter(c => clear(c, 2));
      if (cells.length < 20) cells = body.cells.filter(c => clear(c, 1));
      for (const c of cells) mask[c] = 1;
      const comp = new Int32Array(N * N).fill(-1); let bestComp: number[] = [];
      for (const c0 of cells) {
        if (comp[c0] >= 0) continue; const id = c0, list: number[] = [], st = [c0]; comp[c0] = id;
        while (st.length) { const c = st.pop()!; list.push(c); const ci = c % N, cj = (c / N) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = ci + di, b = cj + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue; const k = b * N + a; if (mask[k] && comp[k] < 0) { comp[k] = id; st.push(k); } } }
        if (list.length > bestComp.length) bestComp = list;
      }
      const deep = bestComp; if (deep.length < 20) continue;   // a lake has to be big and deep enough to sail on
      mask = new Uint8Array(N * N); for (const c of deep) mask[c] = 1;
      // waypoints: spread out through the lake (farthest-point picking), visited in order round the middle
      const pick: number[] = [deep[0]];
      while (pick.length < Math.min(5, deep.length)) {
        let best = -1, bd = -1; for (const c of deep) { const d = Math.min(...pick.map(p => Math.hypot((p % N) - (c % N), ((p / N) | 0) - ((c / N) | 0)))); if (d > bd) { bd = d; best = c; } }
        pick.push(best);
      }
      const cx = pick.reduce((a, c) => a + (c % N), 0) / pick.length, cy = pick.reduce((a, c) => a + ((c / N) | 0), 0) / pick.length;
      pick.sort((a, b) => Math.atan2(((a / N) | 0) - cy, (a % N) - cx) - Math.atan2(((b / N) | 0) - cy, (b % N) - cx));
      // between waypoints the ship follows the water: the shortest way through the deep cells (never a straight line across a headland or an island)
      const bfs = (from: number, to: number): number[] => {
        const prev = new Int32Array(N * N).fill(-2); prev[from] = -1; const q = [from];
        for (let h = 0; h < q.length && prev[to] === -2; h++) {
          const c = q[h], ci = c % N, cj = (c / N) | 0;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const a = ci + di, b = cj + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue; const k = b * N + a; if (!mask[k] || prev[k] !== -2) continue;
            if (di && dj && (!mask[cj * N + a] || !mask[b * N + ci])) continue;   // no cutting a corner of land
            prev[k] = c; q.push(k);
          }
        }
        if (prev[to] === -2) return [from];
        const path: number[] = []; for (let c = to; c !== -1; c = prev[c]) path.push(c); return path.reverse();
      };
      // straighten each leg where a straight line stays in deep water
      const sees = (p: number, q: number) => { const ax = p % N, ay = (p / N) | 0, bx = q % N, by = (q / N) | 0, n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2 || 1; for (let k = 0; k <= n; k++) { const x = Math.round(ax + (bx - ax) * k / n), y = Math.round(ay + (by - ay) * k / n); if (!mask[y * N + x]) return false; } return true; };
      const keep: number[] = [];
      for (let i = 0; i < pick.length; i++) {
        const seg = bfs(pick[i], pick[(i + 1) % pick.length]); let at = 0; if (!keep.length) keep.push(seg[0]);
        while (at < seg.length - 1) { let nx = seg.length - 1; while (nx > at + 1 && !sees(seg[at], seg[nx])) nx--; keep.push(seg[nx]); at = nx; }
      }
      const pts = keep.map(c => new THREE.Vector2(...(xz(c % N, (c / N) | 0) as unknown as [number, number])));
      if (pts.length < 2) continue;
      if (pts[pts.length - 1].distanceTo(pts[0]) > 0.01) pts.push(pts[0]);
      const len = [0]; for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const n = Math.min(3, 1 + Math.floor(body.cells.length / 120));
      for (let k = 0; k < n && made < 10; k++, made++) {
        const mesh = makeShip(); this.group.add(mesh);
        this.ships.push({ mesh, sail: mesh.getObjectByName('sail') as THREE.Mesh, pts, len, total: len[len.length - 1], s: (len[len.length - 1] * k) / n, speed: 2.0 + 0.4 * (made % 3), yaw: 0, seed: made * 3.1 });
      }
    }
  }

  get count() { return this.ships.length; }

  update(dt: number, level: number) {
    this.t += dt;
    for (const sh of this.ships) {
      sh.s = (sh.s + sh.speed * dt) % sh.total;
      let i = 1; while (i < sh.len.length - 1 && sh.len[i] < sh.s) i++;
      const a = sh.pts[i - 1], b = sh.pts[i], seg = Math.max(0.001, sh.len[i] - sh.len[i - 1]), f = (sh.s - sh.len[i - 1]) / seg;
      const want = Math.atan2((b.x - a.x) / seg, (b.y - a.y) / seg);
      let d = want - sh.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; sh.yaw += d * Math.min(1, dt * 0.8);
      sh.mesh.position.set(a.x + (b.x - a.x) * f, level + 0.12 + Math.sin(this.t * 1.1 + sh.seed) * 0.08, a.y + (b.y - a.y) * f);
      sh.mesh.rotation.set(Math.sin(this.t * 0.9 + sh.seed) * 0.025, sh.yaw - Math.PI / 2, Math.sin(this.t * 1.3 + sh.seed) * 0.035);
      sh.sail.rotation.y = Math.PI / 2 + Math.sin(this.t * 1.7 + sh.seed) * 0.08;
    }
  }

  /** The crew standing on deck. */
  draw(crowd: Crowd, cx: number, cz: number, radius: number) {
    const r2 = radius * radius;
    for (const sh of this.ships) {
      const p = sh.mesh.position; if ((p.x - cx) ** 2 + (p.z - cz) ** 2 > r2) continue;
      const fx = Math.sin(sh.yaw), fz = Math.cos(sh.yaw);
      [[2.2, 0xb8342a, HAT.CAP], [-0.6, 0x3b5f8c, HAT.STRAW], [-1.8, 0x8a7a4a, HAT.CAP]].forEach(([off, body, hat], i) => {
        crowd.add({ x: p.x + fx * (off as number), y: p.y + 0.58, z: p.z + fz * (off as number), yaw: sh.yaw, pose: 0, phase: this.t + i, body: body as number, skin: 0xd9a877, hat: hat as number, tool: i === 0 ? TOOL.STAFF : undefined, scale: 0.95 });
      });
    }
  }
}
