import * as THREE from 'three';
import { HALF, type Terrain } from './terrain';
import { HAT, TOOL, type Crowd } from './crowd';
import { makeBoat } from './field';

interface Ship { mesh: THREE.Group; sail: THREE.Mesh; pts: THREE.Vector2[]; len: number[]; total: number; s: number; speed: number; yaw: number; seed: number }

/** A sailing ship: a big hull with a mast and a square sail. */
export function makeShip(): THREE.Group {
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 }), cloth = new THREE.MeshStandardMaterial({ color: 0xeadfc2, roughness: 0.95, side: THREE.DoubleSide });
  const hull = makeBoat(); hull.scale.set(1.7, 1.5, 1.9); g.add(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7.2, 8), wood); mast.position.set(0.4, 4.0, 0); mast.castShadow = true; g.add(mast);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.6, 6), wood); yard.rotation.x = Math.PI / 2; yard.position.set(0.4, 6.3, 0); g.add(yard);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.8, 6, 4), cloth); sail.rotation.y = Math.PI / 2; sail.position.set(0.55, 4.4, 0); sail.castShadow = true; g.add(sail);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.7), new THREE.MeshStandardMaterial({ color: 0xa8342a, side: THREE.DoubleSide })); stripe.rotation.y = Math.PI / 2; stripe.position.set(0.58, 4.8, 0); g.add(stripe);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 2.2), wood); cabin.position.set(-3.0, 1.1, 0); cabin.castShadow = true; g.add(cabin);
  g.userData.sail = sail; return g;
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
      const deep = body.cells.filter(c => { const ci = c % N, cj = (c / N) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = ci + di, b = cj + dj; if (a < 0 || b < 0 || a >= N || b >= N || label[b * N + a] !== label[c]) return false; } return true; });
      if (deep.length < 20) continue;   // a lake has to be big and deep enough to sail on
      // waypoints: spread out through the lake (farthest-point picking), visited in order round the middle
      const pick: number[] = [deep[0]];
      while (pick.length < Math.min(5, deep.length)) {
        let best = -1, bd = -1; for (const c of deep) { const d = Math.min(...pick.map(p => Math.hypot((p % N) - (c % N), ((p / N) | 0) - ((c / N) | 0)))); if (d > bd) { bd = d; best = c; } }
        pick.push(best);
      }
      const cx = pick.reduce((a, c) => a + (c % N), 0) / pick.length, cy = pick.reduce((a, c) => a + ((c / N) | 0), 0) / pick.length;
      pick.sort((a, b) => Math.atan2(((a / N) | 0) - cy, (a % N) - cx) - Math.atan2(((b / N) | 0) - cy, (b % N) - cx));
      const pts = pick.map(c => new THREE.Vector2(...(xz(c % N, (c / N) | 0) as unknown as [number, number])));
      pts.push(pts[0]);
      const len = [0]; for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const n = Math.min(3, 1 + Math.floor(body.cells.length / 120));
      for (let k = 0; k < n && made < 10; k++, made++) {
        const mesh = makeShip(); this.group.add(mesh);
        this.ships.push({ mesh, sail: mesh.userData.sail as THREE.Mesh, pts, len, total: len[len.length - 1], s: (len[len.length - 1] * k) / n, speed: 2.0 + 0.4 * (made % 3), yaw: 0, seed: made * 3.1 });
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
      sh.mesh.rotation.set(Math.sin(this.t * 0.9 + sh.seed) * 0.025, sh.yaw + Math.PI / 2, Math.sin(this.t * 1.3 + sh.seed) * 0.035);
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
        crowd.add({ x: p.x + fx * (off as number), y: p.y + 0.45, z: p.z + fz * (off as number), yaw: sh.yaw, pose: 0, phase: this.t + i, body: body as number, skin: 0xd9a877, hat: hat as number, tool: i === 0 ? TOOL.STAFF : undefined, scale: 0.95 });
      });
    }
  }
}
