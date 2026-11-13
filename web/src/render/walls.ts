import * as THREE from 'three';
import type { Terrain } from './terrain';
import { wallMats } from './buildings';

const S = 10;
const TILE = 2;
const HEIGHT = [2.4, 3.0, 3.8, 4.4];     // wall height by tier
const THICK = [0.8, 1.1, 1.5, 1.7];
const REACH = 8.6;                        // wall pieces closer than this join up
const FENCE_REACH = 5.6;                  // spiked-log pieces join up at a shorter distance
const DEPTH = 2.4;                        // foundation below ground, hides slopes
const GATE_HALF = 2.3;                    // the gate's two pillars stand this far from its centre
const GATE_TRIM = GATE_HALF + 0.7;        // wall runs stop at the outer face of a pillar

const WALL = 2, FENCE = 21, GATE = 22;

interface Range { start: number; end: number; idx: number }
interface Builder { pos: number[]; uv: number[]; ranges: Range[] }
interface Node { x: number; z: number; tier: number; rot: number; idx: number; kind: number }

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
  private mats = wallMats().map(m => { const c = m.clone(); c.side = THREE.DoubleSide; return c; });

  constructor(private terrain: Terrain) {
    for (let t = 0; t < 4; t++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), this.mats[t]);
      m.castShadow = m.receiveShadow = true; m.frustumCulled = false; this.meshes.push(m); this.group.add(m);
    }
  }

  /** Rebuild from the building list. `version` should change whenever the ground changed. */
  update(flat: Float32Array, version: number) {
    const nodes: Node[] = [];
    for (let i = 0; i < flat.length; i += S) { const k = flat[i]; if (k === WALL || k === FENCE || k === GATE) nodes.push({ x: flat[i + 2], z: flat[i + 3], tier: flat[i + 1], rot: flat[i + 4], idx: i / S, kind: k }); }
    const sig = nodes.map(n => `${n.idx}:${n.kind}:${n.x}:${n.z}:${n.tier}:${n.rot}`).join('|') + '#' + version;
    if (sig === this.sig) return; this.sig = sig;

    // Candidate links, shortest first. Walls and gates link with each other, fences with fences. A link is skipped when it would
    // close a triangle (both ends already share a neighbour) or run past a piece that sits on the way (that piece links up instead).
    const group = (n: Node) => (n.kind === FENCE ? 1 : 0), reach = (n: Node) => (n.kind === FENCE ? FENCE_REACH : REACH);
    const cand = new Map<string, { i: number; j: number; d: number }>(), degree = new Array(nodes.length).fill(0), adj: Set<number>[] = nodes.map(() => new Set<number>());
    nodes.forEach((a, i) => {
      const near = nodes.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.z - b.z) })).filter(o => o.j !== i && group(nodes[o.j]) === group(a) && o.d <= reach(a)).sort((p, q) => p.d - q.d).slice(0, 2);
      for (const o of near) { const lo = Math.min(i, o.j), hi = Math.max(i, o.j); cand.set(`${lo}-${hi}`, { i: lo, j: hi, d: o.d }); }
    });
    const edges: [number, number][] = [];
    for (const c of [...cand.values()].sort((p, q) => p.d - q.d)) {
      const A = nodes[c.i], B = nodes[c.j], dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz || 1;
      let ok = true;
      for (const n of adj[c.i]) if (adj[c.j].has(n)) { ok = false; break; }
      if (ok) nodes.forEach((P, k) => { if (!ok || k === c.i || k === c.j || group(P) !== group(A)) return; const t = ((P.x - A.x) * dx + (P.z - A.z) * dz) / l2; if (t > 0.08 && t < 0.92 && Math.hypot(P.x - (A.x + dx * t), P.z - (A.z + dz * t)) < 1.3) ok = false; });
      if (!ok) continue;
      edges.push([c.i, c.j]); adj[c.i].add(c.j); adj[c.j].add(c.i); degree[c.i]++; degree[c.j]++;
    }

    const b: Builder[] = [0, 1, 2, 3].map(() => ({ pos: [], uv: [], ranges: [] }));
    for (const [i, j] of edges) {
      const A = nodes[i], B = nodes[j], idx = Math.min(A.idx, B.idx);
      if (A.kind === FENCE) { this.fenceRun(b[0], A.x, A.z, B.x, B.z, idx); continue; }
      let ax = A.x, az = A.z, bx = B.x, bz = B.z;
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / (L || 1), uz = (bz - az) / (L || 1);
      if (A.kind === GATE) { ax += ux * GATE_TRIM; az += uz * GATE_TRIM; }
      if (B.kind === GATE) { bx -= ux * GATE_TRIM; bz -= uz * GATE_TRIM; }
      // the wall beside a gate sets the style of the run
      const t = Math.min(3, A.kind === GATE ? B.tier : B.kind === GATE ? A.tier : Math.min(A.tier, B.tier));
      if (Math.hypot(bx - ax, bz - az) > 0.4 && (A.kind !== GATE || B.kind !== GATE)) this.segment(b[t], ax, az, bx, bz, t, idx);
    }
    nodes.forEach((n, i) => {
      const th = n.tier;
      if (n.kind === FENCE) { if (degree[i] === 0) { const a = n.rot * Math.PI / 4, dx = Math.cos(a) * 1.8, dz = -Math.sin(a) * 1.8; this.fenceRun(b[0], n.x - dx, n.z - dz, n.x + dx, n.z + dz, n.idx); } return; }
      if (n.kind === GATE) {
        let ux: number, uz: number;
        const nb = [...adj[i]][0];
        if (nb !== undefined) { const d = Math.hypot(nodes[nb].x - n.x, nodes[nb].z - n.z) || 1; ux = (nodes[nb].x - n.x) / d; uz = (nodes[nb].z - n.z) / d; }
        else { const a = n.rot * Math.PI / 4; ux = Math.cos(a); uz = -Math.sin(a); }
        this.gate(b[th], n.x, n.z, ux, uz, th, n.idx); return;
      }
      if (degree[i] === 0) { const a = n.rot * Math.PI / 4, dx = Math.cos(a) * 2.4, dz = -Math.sin(a) * 2.4; this.segment(b[th], n.x - dx, n.z - dz, n.x + dx, n.z + dz, th, n.idx); }
      this.post(b[th], n.x, n.z, th, n.idx);
    });

    for (let t = 0; t < 4; t++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b[t].pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b[t].uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(b[t].pos.length).fill(1), 3));   // the materials use vertex colours; without any the wall renders black
      g.computeVertexNormals();
      this.meshes[t].geometry.dispose(); this.meshes[t].geometry = g; this.ranges[t] = b[t].ranges;
    }
  }

  dispose() { this.meshes.forEach(m => m.geometry.dispose()); this.mats.forEach(m => m.dispose()); }

  private gy(x: number, z: number) { return Math.max(-0.3, this.terrain.heightAt(x, z)); }

  private tri(b: Builder, p: number[][], uv: number[][]) { for (let k = 0; k < 3; k++) { b.pos.push(...p[k]); b.uv.push(...uv[k]); } }
  private quad(b: Builder, a: number[], bb: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) {
    this.tri(b, [a, bb, c], [ua, ub, uc]); this.tri(b, [a, c, d], [ua, uc, ud]);
  }

  /** A plain wall run: a straight, flat-topped wall; the top tier gets crenellations. */
  private segment(b: Builder, ax: number, az: number, bx: number, bz: number, tier: number, idx: number) {
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.2) return;
    const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, th = THICK[tier] / 2, H = HEIGHT[tier];
    // stations along the wall: [distance, height above ground]; steps give the crenellations of the battlemented tier
    const st: [number, number][] = [];
    if (tier === 3) {
      const hi = H + 0.65;
      for (let s = 0; s < L; s += 1.5) { const a = s, m = Math.min(L, s + 1.0), e = Math.min(L, s + 1.5); st.push([a, hi], [m, hi]); if (m < L) st.push([m, H], [e, H]); if (e < L) st.push([e, hi]); }
    } else { for (let s = 0; s < L; s += 1.0) st.push([s, H]); st.push([L, H]); }
    const start = b.pos.length / 9;
    const P = (s: number, side: number) => { const x = ax + ux * s + nx * th * side, z = az + uz * s + nz * th * side; return [x, z] as const; };
    const u = (s: number) => (s + idx * 0.37) / TILE;
    for (let i = 0; i < st.length - 1; i++) {
      const [s0, o0] = st[i], [s1, o1] = st[i + 1];
      const c0 = P(s0, 0), c1 = P(s1, 0), g0 = this.gy(c0[0], c0[1]), g1 = this.gy(c1[0], c1[1]);
      const f0 = Math.min(g0, this.gy(c0[0] + nx * 3, c0[1] + nz * 3), this.gy(c0[0] - nx * 3, c0[1] - nz * 3)) - 0.7, f1 = Math.min(g1, this.gy(c1[0] + nx * 3, c1[1] + nz * 3), this.gy(c1[0] - nx * 3, c1[1] - nz * 3)) - 0.7;   // foundation: down to the lowest ground beside the wall
      if (s1 - s0 < 1e-4) { // vertical step in the crenellation
        const l = P(s0, 1), r = P(s0, -1), y0 = g0 + o0, y1 = g0 + o1;
        this.quad(b, [l[0], y0, l[1]], [r[0], y0, r[1]], [r[0], y1, r[1]], [l[0], y1, l[1]], [0, y0 / TILE], [THICK[tier] / TILE, y0 / TILE], [THICK[tier] / TILE, y1 / TILE], [0, y1 / TILE]);
        continue;
      }
      for (const side of [1, -1]) {
        const p0 = P(s0, side), p1 = P(s1, side);
        this.quad(b, [p0[0], f0, p0[1]], [p1[0], f1, p1[1]], [p1[0], g1 + o1, p1[1]], [p0[0], g0 + o0, p0[1]], [u(s0), f0 / TILE], [u(s1), f1 / TILE], [u(s1), (g1 + o1) / TILE], [u(s0), (g0 + o0) / TILE]);
      }
      const l0 = P(s0, 1), l1 = P(s1, 1), r1 = P(s1, -1), r0 = P(s0, -1);
      this.quad(b, [l0[0], g0 + o0, l0[1]], [l1[0], g1 + o1, l1[1]], [r1[0], g1 + o1, r1[1]], [r0[0], g0 + o0, r0[1]], [u(s0), 0], [u(s1), 0], [u(s1), THICK[tier] / TILE], [u(s0), THICK[tier] / TILE]);
    }
    for (const [s, o] of [[0, st[0][1]], [L, st[st.length - 1][1]]] as const) { // end caps
      const l = P(s, 1), r = P(s, -1), g = this.gy(ax + ux * s, az + uz * s), gf = Math.min(g, this.gy(l[0] + nx * 2.5, l[1] + nz * 2.5), this.gy(r[0] - nx * 2.5, r[1] - nz * 2.5)) - 0.7;
      this.quad(b, [l[0], gf, l[1]], [r[0], gf, r[1]], [r[0], g + o, r[1]], [l[0], g + o, l[1]], [0, gf / TILE], [THICK[tier] / TILE, gf / TILE], [THICK[tier] / TILE, (g + o) / TILE], [0, (g + o) / TILE]);
    }
    b.ranges.push({ start, end: b.pos.length / 9, idx });
  }

  /** A square pillar from below the ground up to `top` above it, with a stone cap on the better tiers. */
  private pillar(b: Builder, x: number, z: number, w: number, top: number, tier: number, cap: boolean, absTop?: number) {
    const g = this.gy(x, z), y1 = absTop ?? g + top, y0 = Math.min(g, this.gy(x + w + 2.5, z), this.gy(x - w - 2.5, z), this.gy(x, z + w + 2.5), this.gy(x, z - w - 2.5)) - 0.7;
    const corners = [[x - w, z - w], [x + w, z - w], [x + w, z + w], [x - w, z + w]];
    for (let k = 0; k < 4; k++) {
      const a = corners[k], c = corners[(k + 1) % 4];
      this.quad(b, [a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], [0, y0 / TILE], [w * 2 / TILE, y0 / TILE], [w * 2 / TILE, y1 / TILE], [0, y1 / TILE]);
    }
    this.quad(b, [corners[0][0], y1, corners[0][1]], [corners[1][0], y1, corners[1][1]], [corners[2][0], y1, corners[2][1]], [corners[3][0], y1, corners[3][1]], [0, 0], [1, 0], [1, 1], [0, 1]);
    if (cap && tier >= 1) { // stone cap
      const c = w + 0.12, y2 = y1 + 0.28;
      const cc = [[x - c, z - c], [x + c, z - c], [x + c, z + c], [x - c, z + c]];
      for (let k = 0; k < 4; k++) { const a = cc[k], d = cc[(k + 1) % 4]; this.quad(b, [a[0], y1, a[1]], [d[0], y1, d[1]], [d[0], y2, d[1]], [a[0], y2, a[1]], [0, 0], [1, 0], [1, 0.3], [0, 0.3]); }
      this.quad(b, [cc[0][0], y2, cc[0][1]], [cc[1][0], y2, cc[1][1]], [cc[2][0], y2, cc[2][1]], [cc[3][0], y2, cc[3][1]], [0, 0], [1, 0], [1, 1], [0, 1]);
    }
  }

  /** A post where wall pieces meet. */
  private post(b: Builder, x: number, z: number, tier: number, idx: number) {
    const start = b.pos.length / 9;
    this.pillar(b, x, z, THICK[tier] / 2 + 0.28, HEIGHT[tier] + (tier === 0 ? 0.35 : tier === 3 ? 1.5 : 0.9), tier, true);
    b.ranges.push({ start, end: b.pos.length / 9, idx });
  }

  /** A gateway: two pillars and a lintel across the opening, in the line of the wall (axis u). */
  private gate(b: Builder, x: number, z: number, ux: number, uz: number, tier: number, idx: number) {
    const start = b.pos.length / 9, H = HEIGHT[tier], pw = 0.72 + tier * 0.06, top = H + 1.5 + tier * 0.25, nx = -uz, nz = ux;
    const gTop = Math.max(this.gy(x, z), this.gy(x + ux * GATE_HALF, z + uz * GATE_HALF), this.gy(x - ux * GATE_HALF, z - uz * GATE_HALF)) + top;   // one height for both pillars and the lintel, even on a slope
    for (const s of [-1, 1]) this.pillar(b, x + ux * GATE_HALF * s, z + uz * GATE_HALF * s, pw, top, tier, true, gTop);
    // lintel: a beam between the pillars, clear of the ground by about 2.9
    const g0 = gTop - top, ya = gTop - 1.0, yb = gTop, hl = THICK[tier] / 2 + 0.1, a0 = -GATE_HALF, a1 = GATE_HALF;
    const P = (s: number, side: number) => [x + ux * s + nx * hl * side, z + uz * s + nz * hl * side] as const;
    for (const side of [1, -1]) { const p = P(a0, side), q = P(a1, side); this.quad(b, [p[0], ya, p[1]], [q[0], ya, q[1]], [q[0], yb, q[1]], [p[0], yb, p[1]], [0, 0], [4, 0], [4, 1], [0, 1]); }
    { const p = P(a0, 1), q = P(a1, 1), r = P(a1, -1), s2 = P(a0, -1);
      this.quad(b, [p[0], yb, p[1]], [q[0], yb, q[1]], [r[0], yb, r[1]], [s2[0], yb, s2[1]], [0, 0], [4, 0], [4, 1], [0, 1]);
      this.quad(b, [s2[0], ya, s2[1]], [r[0], ya, r[1]], [q[0], ya, q[1]], [p[0], ya, p[1]], [0, 0], [4, 0], [4, 1], [0, 1]); }
    // a few portcullis bars hanging under the lintel
    for (let k = -3; k <= 3; k++) { const p = P(k * 0.38, 0), w = 0.05; this.quad(b, [p[0] - nx * w, ya - 1.0, p[1] - nz * w], [p[0] + nx * w, ya - 1.0, p[1] + nz * w], [p[0] + nx * w, ya, p[1] + nz * w], [p[0] - nx * w, ya, p[1] - nz * w], [0, 0], [0.1, 0], [0.1, 0.5], [0, 0.5]); }
    b.ranges.push({ start, end: b.pos.length / 9, idx });
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
  pick(ray: THREE.Raycaster): number | null {
    const hit = ray.intersectObjects(this.meshes, false)[0];
    if (!hit || hit.faceIndex == null) return null;
    const t = this.meshes.indexOf(hit.object as THREE.Mesh), f = hit.faceIndex;
    for (const r of this.ranges[t]) if (f >= r.start && f < r.end) return r.idx;
    return null;
  }
}
