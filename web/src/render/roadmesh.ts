// The flat mesh of the roads: ribbons along the curves the player laid, the short stubs of the buildings, and round patches where roads end or meet.
// Pure geometry on plain arrays (no three.js), so it can be tested under node (tests/roadmesh.test.mjs); paths.ts puts the ground's height under every vertex.

/** One line of road from the core (World.road_lines_flat): kind 0 a building's stub, kind 1 a stretch of a road the player laid. */
export interface RoadLine { kind: number; born: number; pts: number[] }

export function parseRoadLines(flat: ArrayLike<number>): RoadLine[] {
  const out: RoadLine[] = [];
  for (let o = 0; o + 2 < flat.length;) {
    const n = flat[o + 2], pts: number[] = [];
    for (let k = 0; k < n * 2; k++) pts.push(flat[o + 3 + k]);
    out.push({ kind: flat[o], born: flat[o + 1], pts }); o += 3 + 2 * n;
  }
  return out;
}

/** Vertices as parallel arrays: position (x, z), alpha, uv, and what the shader grows the road by (birth tick, distance from the start 0..1, paveable). */
export interface Mesh { x: number[]; z: number[]; a: number[]; u: number[]; v: number[]; born: number[]; along: number[]; pave: number[]; idx: number[] }
export const newMesh = (): Mesh => ({ x: [], z: [], a: [], u: [], v: [], born: [], along: [], pave: [], idx: [] });

/** The birth tick of a road that is there from the first frame. */
export const INSTANT = -1e6;

/** How far beyond the solid half width the soft edge of a ribbon reaches. */
export const EDGE = 1.3;
/** The widest a mitre may stretch a ribbon at a sharp corner. */
const MITRE = 1.6;

/** Join lines that meet end to end at a place where exactly two ends meet (a piece of a road in the middle of a stretch), so that a long road is one ribbon and not a string of patches. */
export function joinLines(lines: RoadLine[]): RoadLine[] {
  const key = (x: number, z: number) => x + ':' + z;
  const ends = new Map<string, number>();
  for (const l of lines) { if (l.kind !== 1) continue; for (const [x, z] of [[l.pts[0], l.pts[1]], [l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]]]) ends.set(key(x, z), (ends.get(key(x, z)) ?? 0) + 1); }
  // (a stub that ends where a road does counts as a third end: it must stay a junction)
  for (const l of lines) { if (l.kind !== 0) continue; const k = key(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]); if (ends.has(k)) ends.set(k, (ends.get(k) ?? 0) + 1); }
  const roads = lines.filter(l => l.kind === 1).map(l => ({ ...l, pts: l.pts.slice() }));
  const used = new Array(roads.length).fill(false), out: RoadLine[] = lines.filter(l => l.kind !== 1);
  const at = new Map<string, number[]>();
  roads.forEach((l, i) => { for (const e of [0, 1]) { const k = e ? key(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]) : key(l.pts[0], l.pts[1]); if (!at.has(k)) at.set(k, []); at.get(k)!.push(i); } });
  const joinable = (k: string) => ends.get(k) === 2 && (at.get(k)?.length ?? 0) === 2 && at.get(k)![0] !== at.get(k)![1];
  for (let i = 0; i < roads.length; i++) {
    if (used[i]) continue;
    used[i] = true; let cur = roads[i];
    // grow the chain at the end, then at the start
    for (let side = 0; side < 2; side++) {
      for (let guard = 0; guard < 4000; guard++) {
        const k = key(cur.pts[cur.pts.length - 2], cur.pts[cur.pts.length - 1]);
        if (!joinable(k)) break;
        const j = at.get(k)!.find(q => q !== i && !used[q]); if (j === undefined) break;
        used[j] = true; let nx = roads[j].pts;
        if (key(nx[0], nx[1]) !== k) { const r: number[] = []; for (let q = nx.length - 2; q >= 0; q -= 2) r.push(nx[q], nx[q + 1]); nx = r; }
        cur = { kind: 1, born: Math.max(cur.born, roads[j].born), pts: cur.pts.concat(nx.slice(2)) };
      }
      // turn the chain round and grow the other end
      const r: number[] = []; for (let q = cur.pts.length - 2; q >= 0; q -= 2) r.push(cur.pts[q], cur.pts[q + 1]); cur = { ...cur, pts: r };
    }
    out.push(cur);
  }
  return out;
}

/** Drop points closer together than `min` (a curve sampled very finely, doubled-up points) but keep the end points. */
export function thin(pts: number[], min = 0.35): number[] {
  const o = [pts[0], pts[1]];
  for (let k = 2; k < pts.length - 2; k += 2) if (Math.hypot(pts[k] - o[o.length - 2], pts[k + 1] - o[o.length - 1]) >= min) o.push(pts[k], pts[k + 1]);
  o.push(pts[pts.length - 2], pts[pts.length - 1]);
  return o;
}

/** A ribbon along the line: three vertices across at every point (soft edge, solid middle, soft edge), turned smoothly at corners. `half` is the solid half width. */
export function addRibbon(m: Mesh, line: RoadLine, half: number, seed = 0) {
  const P = thin(line.pts); const n = P.length / 2;
  if (n < 2) return;
  const cum = [0]; for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(P[2 * k] - P[2 * k - 2], P[2 * k + 1] - P[2 * k - 1]));
  const total = cum[n - 1]; if (total < 0.3) return;
  let prev: number[] | null = null;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let ux = P[2 * b] - P[2 * a], uz = P[2 * b + 1] - P[2 * a + 1]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    // the ribbon is as wide across the corner as along the straight: widen by the mitre of the turn here (limited)
    let wide = 1;
    if (i > 0 && i < n - 1) {
      let ix = P[2 * i] - P[2 * i - 2], iz = P[2 * i + 1] - P[2 * i - 1], ox = P[2 * i + 2] - P[2 * i], oz = P[2 * i + 3] - P[2 * i + 1];
      const il = Math.hypot(ix, iz) || 1, ol = Math.hypot(ox, oz) || 1; ix /= il; iz /= il; ox /= ol; oz /= ol;
      const c = Math.max(-1, Math.min(1, ix * ox + iz * oz)); wide = Math.min(MITRE, 1 / Math.max(0.3, Math.cos(Math.acos(c) / 2)));
    }
    const nx = -uz, nz = ux, hw = half * wide, wob = Math.min(0.08, half * 0.07) * Math.sin(cum[i] * 0.7 + seed * 1.7) * Math.min(1, i / 2, (n - 1 - i) / 2);
    const cx = P[2 * i] + nx * wob, cz = P[2 * i + 1] + nz * wob, t = cum[i] / total, v = cum[i] * 0.25;
    const row: number[] = [];
    for (const [s, al, uu] of [[1, 0, 0], [0, 0.95, 0.5], [-1, 0, 1]] as const) {
      const k = m.x.length; m.x.push(cx + nx * hw * EDGE * s); m.z.push(cz + nz * hw * EDGE * s); m.a.push(al); m.u.push(uu); m.v.push(v);
      m.born.push(line.born); m.along.push(t); m.pave.push(1); row.push(k);
    }
    if (prev) for (let k = 0; k < 2; k++) m.idx.push(prev[k], row[k], prev[k + 1], prev[k + 1], row[k], row[k + 1]);
    prev = row;
  }
}

/** A round patch (a fan) at a place where roads end or meet: it fills the wedge the square-cut ends of the ribbons leave. */
export function addDisc(m: Mesh, x: number, z: number, half: number, born = -1e6) {
  const c = m.x.length, R = half * EDGE, seg = 16;
  const push = (px: number, pz: number, a: number, u: number, v: number) => { m.x.push(px); m.z.push(pz); m.a.push(a); m.u.push(u); m.v.push(v); m.born.push(born); m.along.push(0.5); m.pave.push(1); };
  push(x, z, 0.95, 0.5, 0.5);
  for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; push(x + Math.cos(a) * R, z + Math.sin(a) * R, 0, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5); }
  for (let k = 0; k < seg; k++) m.idx.push(c, c + 1 + k, c + 1 + ((k + 1) % seg));
}

/** The whole road mesh for the lines of the core: ribbons, and a patch at every end of a road and wherever two or more lines end at one place. */
export function buildRoadMesh(flat: ArrayLike<number>, half: number): Mesh {
  const m = newMesh(), lines = joinLines(parseRoadLines(flat));
  const ends = new Map<string, [number, number, number, number]>();   // place -> x, z, how many ends, earliest birth
  lines.forEach((l0, li) => {
    let l = l0;
    // a road the player laid shows at once, in full (only a building's stub grows in with the building)
    if (l.kind === 1) l = { ...l, born: INSTANT };
    addRibbon(m, l, half, li);
    const stub = l.kind === 0;
    for (const e of stub ? [1] : [0, 1]) {
      const x = l.pts[e ? l.pts.length - 2 : 0], z = l.pts[e ? l.pts.length - 1 : 1], k = x + ':' + z, o = ends.get(k);
      if (o) { o[2]++; o[3] = Math.min(o[3], l.born); } else ends.set(k, [x, z, 1, l.born]);
    }
  });
  for (const [x, z, c, born] of ends.values()) if (c >= 1) addDisc(m, x, z, half, born);
  return m;
}
