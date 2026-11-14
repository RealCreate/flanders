import * as THREE from 'three';
import type { Terrain } from './terrain';
import { wallMats } from './buildings';
import { linkWalls, GATE_HALF } from './wallgraph';

const S = 10;
const TILE = 2;
const HEIGHT = [2.4, 3.0, 3.8, 4.4];     // wall height by tier
const THICK = [0.8, 1.1, 1.5, 1.7];
const DEPTH = 2.4;                        // foundation below ground, hides slopes
const GATE_TRIM = GATE_HALF + 0.7;        // wall runs stop at the outer face of a pillar

const WALL = 2, FENCE = 21, GATE = 22;
const PARAPET = [0, 0.5, 0.7, 0.9];       // height of the parapet on each side of the wall walk
const PARA_W = 0.24;                     // thickness of a parapet
const FLOOR = [0.74, 0.68, 0.6];          // colour of the flagstones of the wall walk, darker than the stone round them
const STEP_RUN = 0.34;                    // one stair step

interface Range { start: number; end: number; idx: number }
interface Builder { pos: number[]; uv: number[]; col: number[]; ranges: Range[]; cur: number[] }
interface Node { x: number; z: number; tier: number; rot: number; idx: number; kind: number; opts: number; shut?: boolean }
/** A walk along the top of a connected stretch of wall, reached by a stair: guards use it. Points are [x, z, y]; `stair` is the foot of the stair, its top step, then the wall walk itself. */
export interface WallWalk { stair: [number, number, number][]; walk: [number, number, number][] }

/**
 * Walls, spiked-log fences and gates are drawn as one continuous mesh: neighbouring pieces link up automatically, the wall
 * follows the ground, and the texture is laid out in world space so it flows along the wall with no overlapping faces.
 * Gates are an archway of two pillars and a lintel in the line of the wall; the wall runs stop at the pillars.
 */
export class Walls {
  group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private ranges: Range[][] = [[], [], [], []];
  private sig = '';
  /** Walks along wall tops that guards can climb to (by the stairs) and patrol. */
  walks: WallWalk[] = [];
  private hall: [number, number] = [0, 0];
  private pending: { idx: number; foot: [number, number, number]; topStep: [number, number, number] }[] = [];
  private mats = wallMats().map(m => { const c = m.clone(); c.side = THREE.DoubleSide; return c; });

  constructor(private terrain: Terrain) {
    for (let t = 0; t < 4; t++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), this.mats[t]);
      m.castShadow = m.receiveShadow = true; m.frustumCulled = false; this.meshes.push(m); this.group.add(m);
    }
  }

  /** Rebuild from the building list. `version` should change whenever the ground changed. */
  update(flat: Float32Array, version: number, options: ArrayLike<number> = [], shutGates: ArrayLike<number> = []) {
    const shut = new Set<number>(Array.from(shutGates));
    const nodes: Node[] = [];
    this.hall = [flat[2] ?? 0, flat[3] ?? 0];
    for (let i = 0; i < flat.length; i += S) { const k = flat[i]; if (k === WALL || k === FENCE || k === GATE) nodes.push({ x: flat[i + 2], z: flat[i + 3], tier: flat[i + 1], rot: flat[i + 4], idx: i / S, kind: k, opts: options[i / S] ?? 0, shut: shut.has(i / S) }); }
    const sig = nodes.map(n => `${n.idx}:${n.kind}:${n.x}:${n.z}:${n.tier}:${n.rot}:${n.opts}:${n.shut ? 1 : 0}`).join('|') + '#' + version;
    if (sig === this.sig) return; this.sig = sig;

    const { edges, adj, degree } = linkWalls(nodes);

    // a gate stands square across the line of its wall: its axis runs between its two neighbours (or towards the one it has), and each wall run ends on the outer face of a pillar on that axis
    const axis: ([number, number] | null)[] = nodes.map((n, i) => {
      if (n.kind !== GATE) return null;
      const nb = [...adj[i]].map(j => nodes[j]);
      if (nb.length >= 2) { const dx = nb[1].x - nb[0].x, dz = nb[1].z - nb[0].z, d = Math.hypot(dx, dz) || 1; return [dx / d, dz / d] as [number, number]; }
      if (nb.length === 1) { const dx = nb[0].x - n.x, dz = nb[0].z - n.z, d = Math.hypot(dx, dz) || 1; return [dx / d, dz / d] as [number, number]; }
      const a = n.rot * Math.PI / 4; return [Math.cos(a), -Math.sin(a)] as [number, number];
    });
    const trim = (g: number, other: Node): [number, number] => { const u = axis[g]!, n = nodes[g], sgn = (other.x - n.x) * u[0] + (other.z - n.z) * u[1] >= 0 ? 1 : -1; return [n.x + u[0] * sgn * GATE_TRIM, n.z + u[1] * sgn * GATE_TRIM]; };

    this.pending = [];
    const b: Builder[] = [0, 1, 2, 3].map(() => ({ pos: [], uv: [], col: [], ranges: [], cur: [1, 1, 1] }));
    for (const [i, j] of edges) {
      const A = nodes[i], B = nodes[j], idx = Math.min(A.idx, B.idx);
      if (A.kind === FENCE) { this.fenceRun(b[0], A.x, A.z, B.x, B.z, idx); continue; }
      let ax = A.x, az = A.z, bx = B.x, bz = B.z;
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / (L || 1), uz = (bz - az) / (L || 1);
      if (A.kind === GATE) [ax, az] = trim(i, B);
      if (B.kind === GATE) [bx, bz] = trim(j, A);
      // the wall beside a gate sets the style of the run
      const t = Math.min(3, A.kind === GATE ? B.tier : B.kind === GATE ? A.tier : Math.min(A.tier, B.tier));
      // the side that faces the village (the town hall), and any open stretch where a stair comes up at either end
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, inner = (-uz * (this.hall[0] - mx) + ux * (this.hall[1] - mz)) >= 0 ? 1 : -1;
      const gaps: [number, number][] = [], Lr = Math.hypot(bx - ax, bz - az);
      if (A.kind === WALL && A.opts & 1) gaps.push([0, 1.4]);
      if (B.kind === WALL && B.opts & 1) gaps.push([Lr - 1.4, Lr]);
      if (Math.hypot(bx - ax, bz - az) > 0.4 && (A.kind !== GATE || B.kind !== GATE)) this.segment(b[t], ax, az, bx, bz, t, idx, inner, gaps);
    }
    nodes.forEach((n, i) => {
      const th = n.tier;
      if (n.kind === FENCE) { if (degree[i] === 0) { const a = n.rot * Math.PI / 4, dx = Math.cos(a) * 1.8, dz = -Math.sin(a) * 1.8; this.fenceRun(b[0], n.x - dx, n.z - dz, n.x + dx, n.z + dz, n.idx); } return; }
      if (n.kind === GATE) {
        const [ux, uz] = axis[i]!;
        this.gate(b[th], n.x, n.z, ux, uz, th, n.idx, n.opts, !!n.shut); return;
      }
      if (degree[i] === 0) { const a = n.rot * Math.PI / 4, dx = Math.cos(a) * 2.4, dz = -Math.sin(a) * 2.4; this.segment(b[th], n.x - dx, n.z - dz, n.x + dx, n.z + dz, th, n.idx); }
      const dirs: [number, number][] = [...adj[i]].map(j => { const d = Math.hypot(nodes[j].x - n.x, nodes[j].z - n.z) || 1; return [(nodes[j].x - n.x) / d, (nodes[j].z - n.z) / d] as [number, number]; });
      this.post(b[th], n.x, n.z, th, n.idx, dirs);
      this.decorate(b, n, th, dirs);
    });

    this.walks = this.buildWalks(nodes, adj);
    for (let t = 0; t < 4; t++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b[t].pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b[t].uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b[t].col, 3));   // the materials use vertex colours; without any the wall renders black
      g.computeVertexNormals();
      this.meshes[t].geometry.dispose(); this.meshes[t].geometry = g; this.ranges[t] = b[t].ranges;
    }
  }


  /** The wall walks guards can use: every connected stretch of stone wall that has a stair. A walk goes along the stretch from the stair and back again. */
  private buildWalks(nodes: Node[], adj: Set<number>[]): WallWalk[] {
    const out: WallWalk[] = [], seen = new Set<number>();
    const stoneOf = (n: Node) => (n.kind === GATE || n.kind === WALL) && n.tier >= 1;
    const floor = (n: Node): [number, number, number] => {
      if (n.kind === GATE) { const t = Math.min(3, n.tier), top = HEIGHT[t] + 1.5 + t * 0.25; return [n.x, n.z, this.gy(n.x, n.z) + top + (t >= 1 ? 0.3 : 0)]; }
      return [n.x, n.z, this.gy(n.x, n.z) + HEIGHT[Math.min(3, n.tier)]];
    };
    nodes.forEach((n, i) => {
      if (seen.has(i) || !stoneOf(n)) return;
      // the connected stone stretch round this node
      const comp: number[] = [], q = [i]; seen.add(i);
      while (q.length) { const c = q.pop()!; comp.push(c); for (const j of adj[c]) if (!seen.has(j) && stoneOf(nodes[j])) { seen.add(j); q.push(j); } }
      const stair = this.pending.find(p => comp.some(c => nodes[c].idx === p.idx)); if (!stair || comp.length < 2) return;
      // a walk visiting every node of the stretch (depth first, coming back along the same way at a dead end)
      const start = comp.find(c => nodes[c].idx === stair.idx)!, order: number[] = [], vis = new Set<number>();
      const dfs = (c: number) => { vis.add(c); order.push(c); for (const j of adj[c]) if (!vis.has(j) && comp.includes(j)) { dfs(j); order.push(c); } };
      dfs(start);
      out.push({ stair: [stair.foot, stair.topStep], walk: order.map(c => floor(nodes[c])) });
    });
    return out;
  }

  dispose() { this.meshes.forEach(m => m.geometry.dispose()); this.mats.forEach(m => m.dispose()); }

  private gy(x: number, z: number) { return Math.max(-0.3, this.terrain.heightAt(x, z)); }

  private tri(b: Builder, p: number[][], uv: number[][]) { for (let k = 0; k < 3; k++) { b.pos.push(...p[k]); b.uv.push(...uv[k]); b.col.push(...b.cur); } }
  private quad(b: Builder, a: number[], bb: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) {
    this.tri(b, [a, bb, c], [ua, ub, uc]); this.tri(b, [a, c, d], [ua, uc, ud]);
  }

  /** An upright box with its long axis along (ux, uz), from y0 to y1; the top and the four sides. */
  private obox(b: Builder, cx: number, cz: number, ux: number, uz: number, hl: number, hw: number, y0: number, y1: number, top = true) {
    const nx = -uz, nz = ux, c = (a: number, l: number) => [cx + ux * hl * a + nx * hw * l, cz + uz * hl * a + nz * hw * l] as const;
    const k = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
    for (let f = 0; f < 4; f++) { const a = k[f], d = k[(f + 1) % 4], w = Math.hypot(d[0] - a[0], d[1] - a[1]); this.quad(b, [a[0], y0, a[1]], [d[0], y0, d[1]], [d[0], y1, d[1]], [a[0], y1, a[1]], [0, y0 / TILE], [w / TILE, y0 / TILE], [w / TILE, y1 / TILE], [0, y1 / TILE]); }
    if (top) this.quad(b, [k[0][0], y1, k[0][1]], [k[1][0], y1, k[1][1]], [k[2][0], y1, k[2][1]], [k[3][0], y1, k[3][1]], [0, 0], [hl * 2 / TILE, 0], [hl * 2 / TILE, hw * 2 / TILE], [0, hw * 2 / TILE]);
  }

  /** A wall run: a straight wall with a flagstone wall walk along the top and a parapet on each side (low on timber and plain stone, battlemented on the top tier).
   *  `inner` is +1 or -1: the side of the wall that faces the village. `gaps` are stretches of the inner parapet that are left open, where a stair comes up. */
  private segment(b: Builder, ax: number, az: number, bx: number, bz: number, tier: number, idx: number, inner = 1, gaps: [number, number][] = []) {
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.2) return;
    const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, th = THICK[tier] / 2, H = HEIGHT[tier], pw = tier === 0 ? 0 : PARA_W;
    const start = b.pos.length / 9;
    const P = (s: number, side: number) => [ax + ux * s + nx * th * side, az + uz * s + nz * th * side] as const;
    const u = (s: number) => (s + idx * 0.37) / TILE;
    const stops: number[] = []; for (let s = 0; s < L - 0.01; s += 1.0) stops.push(s); stops.push(L);
    for (let i = 0; i < stops.length - 1; i++) {
      const s0 = stops[i], s1 = stops[i + 1], c0 = P(s0, 0), c1 = P(s1, 0), g0 = this.gy(c0[0], c0[1]), g1 = this.gy(c1[0], c1[1]);
      const f0 = Math.min(g0, this.gy(c0[0] + nx * 3, c0[1] + nz * 3), this.gy(c0[0] - nx * 3, c0[1] - nz * 3)) - 0.7, f1 = Math.min(g1, this.gy(c1[0] + nx * 3, c1[1] + nz * 3), this.gy(c1[0] - nx * 3, c1[1] - nz * 3)) - 0.7;   // foundation: down to the lowest ground beside the wall
      for (const side of [1, -1]) {
        const p0 = P(s0, side), p1 = P(s1, side);
        this.quad(b, [p0[0], f0, p0[1]], [p1[0], f1, p1[1]], [p1[0], g1 + H, p1[1]], [p0[0], g0 + H, p0[1]], [u(s0), f0 / TILE], [u(s1), f1 / TILE], [u(s1), (g1 + H) / TILE], [u(s0), (g0 + H) / TILE]);
      }
      // the wall top: parapet strips either side of the paved walk
      const fw = th - pw, strips: [number, number, boolean][] = pw > 0 ? [[1, fw / th, false], [fw / th, -fw / th, true], [-fw / th, -1, false]] : [[1, -1, false]];
      for (const [a, c, floor] of strips) {
        const l0 = P(s0, a), l1 = P(s1, a), r1 = P(s1, c), r0 = P(s0, c);
        b.cur = floor ? [FLOOR[0], FLOOR[1], FLOOR[2]] : [1, 1, 1];
        this.quad(b, [l0[0], g0 + H, l0[1]], [l1[0], g1 + H, l1[1]], [r1[0], g1 + H, r1[1]], [r0[0], g0 + H, r0[1]], [u(s0), 0], [u(s1), 0], [u(s1), THICK[tier] / TILE], [u(s0), THICK[tier] / TILE]);
        b.cur = [1, 1, 1];
      }
      // parapets
      if (pw > 0) for (const side of [1, -1]) {
        const open = side === inner && gaps.some(([a, c]) => s1 > a && s0 < c);
        if (open) continue;
        const gm = Math.min(g0, g1) + H - 0.04, ph = PARAPET[tier] + 0.04, off = th - pw / 2;
        if (tier === 3) {   // battlements: a merlon 0.62 long, then an embrasure
          const m0 = s0, m1 = Math.min(s1, s0 + 0.62);
          this.obox(b, ax + ux * (m0 + m1) / 2 + nx * off * side, az + uz * (m0 + m1) / 2 + nz * off * side, ux, uz, (m1 - m0) / 2, pw / 2, gm, gm + ph + 0.1);
        } else this.obox(b, ax + ux * (s0 + s1) / 2 + nx * off * side, az + uz * (s0 + s1) / 2 + nz * off * side, ux, uz, (s1 - s0) / 2, pw / 2, gm, gm + ph);
      }
    }
    for (const s of [0, L]) { // end caps
      const l = P(s, 1), r = P(s, -1), g = this.gy(ax + ux * s, az + uz * s), gf = Math.min(g, this.gy(l[0] + nx * 2.5, l[1] + nz * 2.5), this.gy(r[0] - nx * 2.5, r[1] - nz * 2.5)) - 0.7;
      this.quad(b, [l[0], gf, l[1]], [r[0], gf, r[1]], [r[0], g + H, r[1]], [l[0], g + H, l[1]], [0, gf / TILE], [THICK[tier] / TILE, gf / TILE], [THICK[tier] / TILE, (g + H) / TILE], [0, (g + H) / TILE]);
    }
    b.ranges.push({ start, end: b.pos.length / 9, idx });
  }

  /** A flight of stone steps built against the village side of a wall, running along it and rising towards the post at (x, z); the top step is level with the wall walk. */
  private stairs(b: Builder, x: number, z: number, ux: number, uz: number, inner: number, tier: number, idx: number) {
    const H = HEIGHT[tier], th = THICK[tier] / 2, nx = -uz * inner, nz = ux * inner, n = Math.ceil(H / 0.34), start = b.pos.length / 9, off = th + 0.62;
    for (let k = 0; k < n; k++) {
      const s = 0.4 + k * STEP_RUN + STEP_RUN / 2, cx = x + ux * s + nx * off, cz = z + uz * s + nz * off, g = this.gy(cx, cz), top = Math.max(g + 0.1, this.gy(x, z) + H - k * (H / n) - 0.0);
      b.cur = k === 0 ? [FLOOR[0], FLOOR[1], FLOOR[2]] : [0.95, 0.95, 0.95];
      this.obox(b, cx, cz, ux, uz, STEP_RUN / 2 + 0.005, 0.56, g - 0.5, top);
    }
    b.cur = [1, 1, 1];
    // a rail on the open side
    const ro = off + 0.56 - 0.06, ph = 0.45;
    for (let k = 0; k < n; k += 2) { const s = 0.4 + k * STEP_RUN + STEP_RUN / 2, cx = x + ux * s + nx * ro, cz = z + uz * s + nz * ro, g = this.gy(cx, cz), top = this.gy(x, z) + H - k * (H / n); this.obox(b, cx, cz, ux, uz, STEP_RUN, 0.06, Math.max(g, top - ph - 0.0), top + ph * 0.6); }
    b.ranges.push({ start, end: b.pos.length / 9, idx });
    const bx = x + ux * (0.4 + n * STEP_RUN) + nx * off, bz = z + uz * (0.4 + n * STEP_RUN) + nz * off;
    return { foot: [bx, bz, this.gy(bx, bz)] as [number, number, number], top: [x + ux * 0.55 + nx * off, z + uz * 0.55 + nz * off, this.gy(x, z) + H] as [number, number, number] };
  }

  /** A square pillar from below the ground up to `top` above it, with a stone cap on the better tiers. */
  private pillar(b: Builder, x: number, z: number, w: number, top: number, tier: number, cap: boolean, absTop?: number, ax: [number, number] = [1, 0]) {
    const [ux, uz] = ax, nx = -uz, nz = ux, rot = (px: number, pz: number) => [x + ux * px + nx * pz, z + uz * px + nz * pz] as const;
    const g = this.gy(x, z), y1 = absTop ?? g + top, y0 = Math.min(g, this.gy(x + w + 2.5, z), this.gy(x - w - 2.5, z), this.gy(x, z + w + 2.5), this.gy(x, z - w - 2.5)) - 0.7;
    const corners = [rot(-w, -w), rot(w, -w), rot(w, w), rot(-w, w)];
    for (let k = 0; k < 4; k++) {
      const a = corners[k], c = corners[(k + 1) % 4];
      this.quad(b, [a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], [0, y0 / TILE], [w * 2 / TILE, y0 / TILE], [w * 2 / TILE, y1 / TILE], [0, y1 / TILE]);
    }
    this.quad(b, [corners[0][0], y1, corners[0][1]], [corners[1][0], y1, corners[1][1]], [corners[2][0], y1, corners[2][1]], [corners[3][0], y1, corners[3][1]], [0, 0], [1, 0], [1, 1], [0, 1]);
    if (cap && tier >= 1) { // stone cap
      const c = w + 0.12, y2 = y1 + 0.28;
      const cc = [rot(-c, -c), rot(c, -c), rot(c, c), rot(-c, c)];
      for (let k = 0; k < 4; k++) { const a = cc[k], d = cc[(k + 1) % 4]; this.quad(b, [a[0], y1, a[1]], [d[0], y1, d[1]], [d[0], y2, d[1]], [a[0], y2, a[1]], [0, 0], [1, 0], [1, 0.3], [0, 0.3]); }
      this.quad(b, [cc[0][0], y2, cc[0][1]], [cc[1][0], y2, cc[1][1]], [cc[2][0], y2, cc[2][1]], [cc[3][0], y2, cc[3][1]], [0, 0], [1, 0], [1, 1], [0, 1]);
    }
  }

  /** A post where wall pieces meet. On the stone tiers it stands higher than the wall walk and has a doorway through it on each side the wall runs in, so a guard can walk straight through. */
  private post(b: Builder, x: number, z: number, tier: number, idx: number, dirs: [number, number][] = []) {
    const start = b.pos.length / 9, w = THICK[tier] / 2 + 0.28, H = HEIGHT[tier];
    this.pillar(b, x, z, w, H + (tier === 0 ? 0.35 : tier === 3 ? 1.5 : 0.9), tier, true);
    if (tier >= 1) for (const [dx, dz] of dirs) this.door(b, x + dx * (w + 0.015), z + dz * (w + 0.015), dx, dz, this.gy(x, z) + H, tier);
    b.ranges.push({ start, end: b.pos.length / 9, idx });
  }

  /** A low doorway in the face of a post or gate pillar: a dark opening in a lighter frame, standing at the level of the wall walk. */
  private door(b: Builder, x: number, z: number, dx: number, dz: number, floorY: number, tier: number) {
    const nx = -dz, nz = dx, hw = 0.34, h = 1.15 + tier * 0.05, fw = 0.1;
    const q = (w: number, y0: number, y1: number, out: number, col: number[], cx = 0) => { const a = [x + nx * (cx - w) + dx * out, z + nz * (cx - w) + dz * out], c = [x + nx * (cx + w) + dx * out, z + nz * (cx + w) + dz * out]; b.cur = col; this.quad(b, [a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], [0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]); b.cur = [1, 1, 1]; };
    q(hw + fw, floorY, floorY + h + fw, 0.004, [1.15, 1.12, 1.05]);   // pale frame
    q(hw, floorY, floorY + h, 0.012, [0.07, 0.05, 0.04]);              // the dark opening
  }

  /** A gateway: two pillars and a lintel across the opening, in the line of the wall (axis u). */
  private gate(b: Builder, x: number, z: number, ux: number, uz: number, tier: number, idx: number, opts = 0, shut = false) {
    const start = b.pos.length / 9, H = HEIGHT[tier], pw = 0.72 + tier * 0.06, top = H + 1.5 + tier * 0.25, nx = -uz, nz = ux;
    const gTop = Math.max(this.gy(x, z), this.gy(x + ux * GATE_HALF, z + uz * GATE_HALF), this.gy(x - ux * GATE_HALF, z - uz * GATE_HALF)) + top;   // one height for both pillars and the lintel, even on a slope
    for (const s of [-1, 1]) this.pillar(b, x + ux * GATE_HALF * s, z + uz * GATE_HALF * s, pw, top, tier, true, gTop, [ux, uz]);
    // lintel: a beam between the pillars, clear of the ground by about 2.9
    const g0 = gTop - top, yb = gTop - 0.08, ya = yb - 1.0, hl = pw + 0.07, a0 = -GATE_HALF, a1 = GATE_HALF;   // a hair lower and wider than the pillars, so no face lies in the same plane as theirs (that flickers)
    const P = (s: number, side: number) => [x + ux * s + nx * hl * side, z + uz * s + nz * hl * side] as const;
    for (const side of [1, -1]) { const p = P(a0, side), q = P(a1, side); this.quad(b, [p[0], ya, p[1]], [q[0], ya, q[1]], [q[0], yb, q[1]], [p[0], yb, p[1]], [0, 0], [4, 0], [4, 1], [0, 1]); }
    { const p = P(a0, 1), q = P(a1, 1), r = P(a1, -1), s2 = P(a0, -1);
      this.quad(b, [p[0], yb, p[1]], [q[0], yb, q[1]], [r[0], yb, r[1]], [s2[0], yb, s2[1]], [0, 0], [4, 0], [4, 1], [0, 1]);
      this.quad(b, [s2[0], ya, s2[1]], [r[0], ya, r[1]], [q[0], ya, q[1]], [p[0], ya, p[1]], [0, 0], [4, 0], [4, 1], [0, 1]); }
    if (shut) {   // the doors are closed: two heavy timber leaves with iron bands fill the opening between the pillars
      const open = GATE_HALF - pw + 0.12, y0 = g0 - 0.3, y1 = ya + 0.02, gh = y1 - y0, wood: number[] = [0.42, 0.27, 0.15], iron: number[] = [0.2, 0.2, 0.22];
      b.cur = wood; this.obox(b, x, z, ux, uz, open, 0.16, y0, y1, false);
      b.cur = [0.3, 0.19, 0.1]; this.obox(b, x, z, ux, uz, 0.05, 0.19, y0, y1);   // the seam where the leaves meet
      b.cur = iron; for (const f of [0.22, 0.52, 0.8]) this.obox(b, x, z, ux, uz, open, 0.19, y0 + gh * f - 0.1, y0 + gh * f + 0.1);
      b.cur = [1, 1, 1];
    } else
    // a few portcullis bars hanging under the lintel
    for (let k = -3; k <= 3; k++) { const p = P(k * 0.38, 0), w = 0.05; this.quad(b, [p[0] - nx * w, ya - 1.0, p[1] - nz * w], [p[0] + nx * w, ya - 1.0, p[1] + nz * w], [p[0] + nx * w, ya, p[1] + nz * w], [p[0] - nx * w, ya, p[1] - nz * w], [0, 0], [0.1, 0], [0.1, 0.5], [0, 0.5]); }
    if (tier >= 1) for (const sgn of [-1, 1]) this.door(b, x + ux * sgn * (GATE_HALF + pw + 0.015), z + uz * sgn * (GATE_HALF + pw + 0.015), ux * sgn, uz * sgn, this.gy(x + ux * GATE_HALF * sgn, z + uz * GATE_HALF * sgn) + HEIGHT[tier], tier);
    if (opts) this.decorateGate(b, x, z, ux, uz, tier, gTop, pw, opts);
    b.ranges.push({ start, end: b.pos.length / 9, idx });
  }


  /** A pennant on a pole: the pole is timber, the cloth a coloured flag. */
  private pennant(b: Builder, x: number, y: number, z: number, h: number, ux: number, uz: number, col: number[]) {
    this.obox(b, x, z, 1, 0, 0.04, 0.04, y, y + h);
    b.cur = col; const nx = -uz, nz = ux;
    this.quad(b, [x, y + h - 0.1, z], [x + ux * 0.9, y + h - 0.2, z + uz * 0.9], [x + ux * 0.9, y + h - 0.7, z + uz * 0.9], [x, y + h - 0.75, z], [0, 0], [0.4, 0], [0.4, 0.3], [0, 0.3]);
    this.quad(b, [x, y + h - 0.75, z], [x + ux * 0.9, y + h - 0.7, z + uz * 0.9], [x + ux * 0.9, y + h - 0.2, z + uz * 0.9], [x, y + h - 0.1, z], [0, 0.3], [0.4, 0.3], [0.4, 0], [0, 0]);
    void nx; void nz; b.cur = [1, 1, 1];
  }
  /** An iron fire basket on a post. */
  private brazier(b: Builder, x: number, y: number, z: number) {
    b.cur = [0.18, 0.17, 0.17]; this.obox(b, x, z, 1, 0, 0.05, 0.05, y, y + 0.7); this.obox(b, x, z, 1, 0, 0.22, 0.22, y + 0.7, y + 0.9);
    b.cur = [1.6, 0.8, 0.2]; this.obox(b, x, z, 1, 0, 0.16, 0.16, y + 0.9, y + 1.15); b.cur = [1, 1, 1];
  }

  /** Optional upgrades of a wall piece (banners, hoarding, braziers): drawn on the wall top at the post, clear of the stairs and the parapets' gaps. */
  private decorate(b: Builder[], n: Node, tier: number, dirs: [number, number][]) {
    const o = n.opts; if (!o) return;
    const H = HEIGHT[tier], g = this.gy(n.x, n.z), ux = dirs[0]?.[0] ?? 1, uz = dirs[0]?.[1] ?? 0, nx = -uz, nz = ux;
    const start = b[tier].pos.length / 9;
    const top = g + H + (tier === 0 ? 0.35 : tier === 3 ? 1.5 : 0.9);
    if (o & 1) {   // stairs, built on the village side
      const inner = (nx * (this.hall[0] - n.x) + nz * (this.hall[1] - n.z)) >= 0 ? 1 : -1, st = this.stairs(b[tier], n.x, n.z, ux, uz, inner, tier, n.idx);
      this.pending.push({ idx: n.idx, foot: st.foot, topStep: st.top });
    }
    if (o & 2) this.pennant(b[0], n.x, top, n.z, 2.2, nx, nz, [0.85, 0.2, 0.2]);
    if (o & 4 && tier >= 2) {   // hoarding: a timber gallery hung over the outer face of each run leaving this post
      for (const [dx, dz] of dirs) {   // a gallery clamped to the outer face (planks from just below the wall top to a roof slab above it), with a corbel under each
        const outer = (-dz * (this.hall[0] - n.x) + dx * (this.hall[1] - n.z)) >= 0 ? -1 : 1, ox = -dz * outer, oz = dx * outer, face = THICK[tier] / 2, par = PARAPET[tier];
        for (const k of [1.8, 3.8]) {
          const cx = n.x + dx * k + ox * (face + 0.22), cz = n.z + dz * k + oz * (face + 0.22), top = g + H + par + 0.3;
          b[0].cur = [0.8, 0.62, 0.45]; this.obox(b[0], cx, cz, dx, dz, 0.9, 0.3, g + H - 0.7, top);
          b[0].cur = [0.55, 0.42, 0.3]; this.obox(b[0], cx, cz, dx, dz, 1.0, 0.4, top, top + 0.12);
          this.obox(b[0], n.x + dx * k + ox * (face + 0.12), n.z + dz * k + oz * (face + 0.12), dx, dz, 0.7, 0.12, g + H - 1.3, g + H - 0.7);
        }
      }
      b[0].cur = [1, 1, 1];
    }
    if (o & 8 && tier >= 1) this.brazier(b[0], n.x + nx * (THICK[tier] / 2 - 0.55), g + H + 0.04, n.z + nz * (THICK[tier] / 2 - 0.55));
    b[tier].ranges.push({ start, end: b[tier].pos.length / 9, idx: n.idx });
  }

  /** Optional upgrades of a gate (banners, braziers, spikes, a gate guard's hut). */
  private decorateGate(b: Builder, x: number, z: number, ux: number, uz: number, tier: number, gTop: number, pw: number, o: number) {
    const nx = -uz, nz = ux, cap = tier >= 1 ? 0.3 : 0;
    for (const s of [-1, 1]) {
      const px = x + ux * GATE_HALF * s, pz = z + uz * GATE_HALF * s;
      if (o & 1) this.pennant(b, px, gTop + cap, pz, 2.2, nx * s, nz * s, [0.85, 0.2, 0.2]);
      if (o & 2) this.brazier(b, px + nx * (pw + 0.35), gTop - 1.6 - 0.5, pz + nz * (pw + 0.35));
    }
    if (o & 4 && tier >= 1) for (let k = -3; k <= 3; k++) { const px = x + ux * k * 0.62, pz = z + uz * k * 0.62; b.cur = [0.2, 0.2, 0.22]; this.obox(b, px, pz, 1, 0, 0.04, 0.04, gTop, gTop + 0.55); }
    if (o & 8 && tier >= 1) { const cx = x + nx * (THICK[tier] / 2 + 1.6), cz = z + nz * (THICK[tier] / 2 + 1.6), gy = this.gy(cx, cz); b.cur = [0.85, 0.75, 0.6]; this.obox(b, cx, cz, ux, uz, 1.1, 0.9, gy - 0.3, gy + 1.9); b.cur = [0.5, 0.35, 0.28]; this.obox(b, cx, cz, ux, uz, 1.35, 1.15, gy + 1.9, gy + 2.1); }
    b.cur = [1, 1, 1];
  }

  /** A row of sharpened logs from (ax, az) to (bx, bz). */
  private fenceRun(b: Builder, ax: number, az: number, bx: number, bz: number, idx: number) {
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.2) return;
    const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, start = b.pos.length / 9, n = Math.max(2, Math.round(L / 0.62));
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * L, q = Math.sin(idx * 12.9898 + i * 78.233) * 43758.5453, j = q - Math.floor(q);
      this.log(b, ax + ux * s + nx * (j - 0.5) * 0.14, az + uz * s + nz * (j - 0.5) * 0.14, 1.9 + j * 0.7, 0.23);
    }
    b.ranges.push({ start, end: b.pos.length / 9, idx });
  }

  /** One round log with a pointed tip. */
  private log(b: Builder, x: number, z: number, h: number, r: number) {
    const g = this.gy(x, z), y0 = g - 0.5, y1 = g + h, y2 = y1 + 0.6, seg = 7;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, x0 = x + Math.cos(a0) * r, z0 = z + Math.sin(a0) * r, x1 = x + Math.cos(a1) * r, z1 = z + Math.sin(a1) * r;
      this.quad(b, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], [k / seg, y0 / TILE], [(k + 1) / seg, y0 / TILE], [(k + 1) / seg, y1 / TILE], [k / seg, y1 / TILE]);
      this.tri(b, [[x0, y1, z0], [x1, y1, z1], [x, y2, z]], [[k / seg, y1 / TILE], [(k + 1) / seg, y1 / TILE], [(k + 0.5) / seg, y2 / TILE]]);
    }
  }

  /** Which wall piece (building index) did the ray hit? */
  pick(ray: THREE.Raycaster): number | null { return this.pickHit(ray)?.idx ?? null; }
  /** The wall piece the ray hits first, with how far away it is (so it can be compared with other things under the pointer). */
  pickHit(ray: THREE.Raycaster): { idx: number; d: number } | null {
    const hit = ray.intersectObjects(this.meshes, false)[0];
    if (!hit || hit.faceIndex == null) return null;
    const t = this.meshes.indexOf(hit.object as THREE.Mesh), f = hit.faceIndex;
    for (const r of this.ranges[t]) if (f >= r.start && f < r.end) return { idx: r.idx, d: hit.distance };
    return null;
  }
}
