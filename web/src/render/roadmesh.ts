// The flat mesh of the roads: ribbons along the curves the player laid, the short stubs of the buildings, and round patches where roads end or meet.
// Pure geometry on plain arrays (no three.js), so it can be tested under node (tests/roadmesh.test.mjs); paths.ts puts the ground's height under every vertex.

/** One line of road from the core (World.road_lines_flat): kind 0 a building's stub, kind 1 a stretch of a road the player laid, kind 2 the road under a gate or a toll house. `tier` is its surface
 *  (0 dirt, 1 gravel, 2 cobbles, 3 flagstones) and `opts` the design along it (bits: trees, hedges, benches, lanterns, see roadlook.ts). */
export interface RoadLine { kind: number; born: number; tier: number; opts: number; pts: number[] }

export function parseRoadLines(flat: ArrayLike<number>): RoadLine[] {
  const out: RoadLine[] = [];
  for (let o = 0; o + 4 < flat.length;) {
    const n = flat[o + 4], pts: number[] = [];
    for (let k = 0; k < n * 2; k++) pts.push(flat[o + 5 + k]);
    out.push({ kind: flat[o], born: flat[o + 1], tier: flat[o + 2], opts: flat[o + 3], pts }); o += 5 + 2 * n;
  }
  return out;
}

/** Vertices as parallel arrays: position (x, z), alpha, uv, what the shader grows the road by (birth tick, distance from the start 0..1) and the surface (`mat`: 0 dirt .. 3 flagstones, a fraction
 *  between two where one surface runs into the next: the shader blends the two layers there). */
export interface Mesh { x: number[]; z: number[]; a: number[]; u: number[]; v: number[]; born: number[]; along: number[]; mat: number[]; idx: number[] }
export const newMesh = (): Mesh => ({ x: [], z: [], a: [], u: [], v: [], born: [], along: [], mat: [], idx: [] });

/** How far along a road (in world units) a surface takes to run into the next one at a place where they meet. */
export const BLEND_LEN = 4.5;

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
  const joinable = (k: string) => ends.get(k) === 2 && (at.get(k)?.length ?? 0) === 2 && at.get(k)![0] !== at.get(k)![1] && roads[at.get(k)![0]].tier === roads[at.get(k)![1]].tier;   // (a change of surface is a joint of its own: the two blend there)
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
        cur = { kind: 1, born: Math.max(cur.born, roads[j].born), tier: cur.tier, opts: cur.opts & roads[j].opts, pts: cur.pts.concat(nx.slice(2)) };
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
export function addRibbon(m: Mesh, line: RoadLine, half: number, seed = 0, ends?: [number, number], fade?: [boolean, boolean]): { first: number[]; last: number[] } | null {
  const P = thin(line.pts); const n = P.length / 2;
  if (n < 2) return null;
  const cum = [0]; for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(P[2 * k] - P[2 * k - 2], P[2 * k + 1] - P[2 * k - 1]));
  const total = cum[n - 1]; if (total < 0.3) return null;
  // the surface along the ribbon: its own, run into the surface of what it meets at either end over BLEND_LEN (`ends`: the surface to reach at the start and at the end)
  const own = Math.max(0, line.tier || 0), ramp = (d: number) => { const f = Math.max(0, 1 - d / BLEND_LEN); return f * f * (3 - 2 * f); };
  const matAt = (d: number, len: number) => ends ? own + (ends[0] - own) * ramp(d) + (ends[1] - own) * ramp(len - d) : own;
  // a side road's end at a through road: it fades in over its first stretch from the node (so it grows out of the through road), and from there on fills the wedge between the two, however sharp
  const grow = (d: number) => { const f = Math.max(0, Math.min(1, d / (half * EDGE * 0.9))); return f * f * (3 - 2 * f); };
  const alphaAt = (d: number, len: number) => (fade ? Math.min(fade[0] ? grow(d) : 1, fade[1] ? grow(len - d) : 1) : 1);
  let prev: number[] | null = null, first: number[] | null = null;
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
      const k = m.x.length; m.x.push(cx + nx * hw * EDGE * s); m.z.push(cz + nz * hw * EDGE * s); m.a.push(al * alphaAt(cum[i], total)); m.u.push(uu); m.v.push(v);
      m.born.push(line.born); m.along.push(t); m.mat.push(matAt(cum[i], total)); row.push(k);
    }
    if (prev) for (let k = 0; k < 2; k++) m.idx.push(prev[k], row[k], prev[k + 1], prev[k + 1], row[k], row[k + 1]);
    prev = row; if (!first) first = row;
  }
  return { first: first!, last: prev! };
}

/** A round patch (a fan) at a place where roads end or meet: it fills the wedge the square-cut ends of the ribbons leave. */
export function addDisc(m: Mesh, x: number, z: number, half: number, born = -1e6, mat = 0) {
  const c = m.x.length, R = half * EDGE, seg = 16;
  const push = (px: number, pz: number, a: number, u: number, v: number) => { m.x.push(px); m.z.push(pz); m.a.push(a); m.u.push(u); m.v.push(v); m.born.push(born); m.along.push(0.5); m.mat.push(mat); };
  push(x, z, 0.95, 0.5, 0.5);
  for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; push(x + Math.cos(a) * R, z + Math.sin(a) * R, 0, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5); }
  for (let k = 0; k < seg; k++) m.idx.push(c, c + 1 + k, c + 1 + ((k + 1) % seg));
}


// ---- junctions -------------------------------------------------------------------------------------------------------------------------------------------------
// Where two or more lines end at one place (a T, an X as two Ts, a Y, a stub on a road) the ribbons are cut back to the soft edge of their neighbours and the joint is
// one fan polygon: full brightness in the middle, the falloff only along the outer boundary of the union of the roads, so no dark edge is drawn across a road.

/** The farthest (in soft half widths) a ribbon is cut back at a very sharp angle; beyond it the corner is bevelled. */
const CUT_MAX = 2.2;

type Pt = [number, number];
const arcLength = (p: number[]) => { let t = 0; for (let k = 2; k < p.length; k += 2) t += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]); return t; };
const reversePts = (p: number[]) => { const r: number[] = []; for (let q = p.length - 2; q >= 0; q -= 2) r.push(p[q], p[q + 1]); return r; };

/** The point at arc distance d from the start of the polyline. */
export function pointAt(p: number[], d: number): Pt {
  let acc = 0;
  for (let k = 2; k < p.length; k += 2) {
    const l = Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
    if (acc + l >= d && l > 0) { const f = (d - acc) / l; return [p[k - 2] + (p[k] - p[k - 2]) * f, p[k - 1] + (p[k + 1] - p[k - 1]) * f]; }
    acc += l;
  }
  return [p[p.length - 2], p[p.length - 1]];
}

/** The polyline with arc length `s` removed from its start and `e` from its end. */
export function cutPts(p: number[], s: number, e: number): number[] {
  const total = arcLength(p), end = total - e;
  if (s <= 0 && e <= 0) return p;
  if (end - s < 1e-6) return [];
  const o: number[] = [...pointAt(p, s)]; let acc = 0;
  for (let k = 2; k < p.length; k += 2) {
    acc += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
    if (acc > s + 1e-6 && acc < end - 1e-6) o.push(p[k], p[k + 1]);
  }
  o.push(...pointAt(p, end));
  return o;
}

interface Arm { li: number; end: 0 | 1; pts: number[]; ang: number; len: number; cut: number; L: Pt; M: Pt; R: Pt; v0: number }

/** How far back from the node a ribbon must be cut so that its soft edge meets the soft edge of the neighbour at this angle. */
const cutFor = (gap: number, H: number) => (gap < Math.PI - 0.02 ? Math.min(H / Math.tan(gap / 2), CUT_MAX * H) : 0);

/** The fan of a junction. `arms` are sorted counter-clockwise by angle and carry their cut row (L, M, R as seen leaving the node).
 *  Every wedge of the fan takes the texture mapping of the ribbon it hangs on, so the paving and the ruts run on from the ribbon into the joint without a jump. */
function addJunction(m: Mesh, ox: number, oz: number, arms: Arm[], H: number, born: number, mat = 0) {
  const n = arms.length;
  // the mapping of an arm: across the road from the left/right of its ribbon, along from the v of its cut row
  const mapOf = (a: Arm) => {
    let nx = a.L[0] - a.R[0], nz = a.L[1] - a.R[1]; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;   // left, leaving the node
    const dx = nz, dz = -nx, sU = a.end === 0 ? -1 : 1, sV = a.end === 0 ? 1 : -1;
    return (x: number, z: number): [number, number] => {
      const px = x - a.M[0], pz = z - a.M[1];
      return [0.5 + sU * (px * nx + pz * nz) / (2 * H), a.v0 + sV * (px * dx + pz * dz) * 0.25];
    };
  };
  // one mapping for the whole joint, that of the longest arm (the main road) carried straight on over the fan: wedges that each carried the mapping of their own ribbon showed hard seams and
  // strangely turned patterns where they met, and a joint mapped flat on the ground sat turned against every road; this way the main road runs through the joint unbroken
  const main = arms.reduce((best, q) => (q.len > best.len ? q : best), arms[0]), mMain = mapOf(main);
  const vert = (map: (x: number, z: number) => [number, number], x: number, z: number, al: number) => {
    const k = m.x.length, [u, v] = map(x, z);
    m.x.push(x); m.z.push(z); m.a.push(al); m.u.push(u); m.v.push(v); m.born.push(born); m.along.push(0.5); m.mat.push(mat); return k;
  };
  // the brightness of the middle of the fan: the falloff must stay along the outer edge (the width of a road's soft edge), however wide the fan is, so the middle is brighter the wider the fan
  const reach = Math.max(...arms.flatMap(q => [Math.hypot(q.L[0] - ox, q.L[1] - oz), Math.hypot(q.R[0] - ox, q.R[1] - oz)])), kc = 0.95 * Math.max(1, Math.min(3, reach / H));
  for (let i = 0; i < n; i++) {
    const a = arms[i], b = arms[(i + 1) % n], mi = mMain, mj = mMain;
    const o = vert(mi, ox, oz, kc), r = vert(mi, a.R[0], a.R[1], 0), mm = vert(mi, a.M[0], a.M[1], 0.95), l = vert(mi, a.L[0], a.L[1], 0);
    m.idx.push(o, r, mm, o, mm, l);
    let gap = b.ang - a.ang; if (gap <= 1e-9) gap += Math.PI * 2;
    const need = cutFor(gap, H) - 1e-6;
    if (gap < Math.PI - 0.02 && a.cut >= need && b.cut >= need) {
      const mid = a.ang + gap / 2, d = H / Math.sin(gap / 2), cx = ox + Math.cos(mid) * d, cz = oz + Math.sin(mid) * d;
      // the corner: half hangs on this arm, half on the next
      const o1 = vert(mi, ox, oz, kc), l1 = vert(mi, a.L[0], a.L[1], 0), c1 = vert(mi, cx, cz, 0);
      const o2 = vert(mj, ox, oz, kc), c2 = vert(mj, cx, cz, 0), r2 = vert(mj, b.R[0], b.R[1], 0);
      m.idx.push(o1, l1, c1, o2, c2, r2);
    } else {   // a straight or reflex stretch, or a corner too sharp to mitre: the outline goes straight across
      // (when the two edges are on one line through the middle the triangle is a sliver: it adds nothing but a thin dark streak, so it is left out)
      const area = Math.abs((a.L[0] - ox) * (b.R[1] - oz) - (b.R[0] - ox) * (a.L[1] - oz)) / 2;
      if (area > 0.12 * H * H) {
        const o1 = vert(mi, ox, oz, kc), l1 = vert(mi, a.L[0], a.L[1], 0), r1 = vert(mi, b.R[0], b.R[1], 0);
        m.idx.push(o1, l1, r1);
      }
    }
  }
}

/** The whole road mesh for the lines of the core: ribbons, a round cap at every dead end, and a joint polygon wherever two or more lines end at one place. */
export function buildRoadMesh(flat: ArrayLike<number>, half: number): Mesh {
  const m = newMesh(), lines = joinLines(parseRoadLines(flat)).map(l => (l.kind === 1 ? { ...l, born: INSTANT } : l));   // a road the player laid shows at once, in full (only a building's stub grows in with the building)
  const H = half * EDGE;
  const nodes = new Map<string, { x: number; z: number; arms: Arm[]; born: number }>();
  lines.forEach((l, li) => {
    for (const e of (l.kind === 0 ? [1] : [0, 1]) as (0 | 1)[]) {
      const x = l.pts[e ? l.pts.length - 2 : 0], z = l.pts[e ? l.pts.length - 1 : 1], k = x + ':' + z;
      let nd = nodes.get(k); if (!nd) nodes.set(k, nd = { x, z, arms: [], born: l.born });
      nd.born = Math.min(nd.born, l.born);
      const pts = thin(e ? reversePts(l.pts) : l.pts), len = arcLength(pts);
      nd.arms.push({ li, end: e, pts, ang: 0, len, cut: 0, L: [x, z], M: [x, z], R: [x, z], v0: 0 });
    }
  });
  // the direction of every arm, and how far it is cut back
  const cutOf = lines.map(() => [0, 0]), fadeOf = new Map<number, [boolean, boolean]>();   // (fadeOf: the ends of lines that grow out of a through road)
  const joints: { x: number; z: number; arms: Arm[]; born: number }[] = [];
  for (const nd of nodes.values()) {
    const arms = nd.arms.filter(a => a.len >= 0.05);
    if (arms.length < 2) continue;
    for (const a of arms) { const q = pointAt(a.pts, Math.min(H, a.len)); a.ang = Math.atan2(q[1] - nd.z, q[0] - nd.x); }
    arms.sort((p, q) => p.ang - q.ang);
    // Where three or more roads meet, the two that run most nearly straight on through the place are the through road: they are joined as an ordinary bend. Every other arm (a side road, a stub) is
    // not cut back and not joined with a fan at all: it runs on to the middle of the through road and fades in from the edge of it, so it grows out of the road it leaves with no hard outline and
    // no sliver wedge, however sharp the angle between them.
    let jarms = arms;
    if (arms.length >= 3) {
      const roadArms = arms.filter(a => lines[a.li].kind === 1), cand = roadArms.length >= 2 ? roadArms : arms;   // (a stub or the road under a gate is never the through road of a joint of roads)
      let best: [Arm, Arm] = [cand[0], cand[1]], bestScore = -1;
      for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
        let sep = Math.abs(cand[i].ang - cand[j].ang); if (sep > Math.PI) sep = Math.PI * 2 - sep;
        // the straightest pair; of equal ones (the arms of a cross) the better surface, then the longer roads
        const score = Math.round(sep * 1e3) * 1e6 + (lines[cand[i].li].tier + lines[cand[j].li].tier) * 1e4 + Math.min(9999, cand[i].len + cand[j].len);
        if (score > bestScore) { bestScore = score; best = [cand[i], cand[j]]; }
      }
      jarms = arms.filter(a => a === best[0] || a === best[1]);
      for (const a of arms) if (!jarms.includes(a)) { const f = fadeOf.get(a.li) ?? [false, false]; f[a.end] = true; fadeOf.set(a.li, f); }
    }
    jarms.forEach((a, i) => {
      const prev = jarms[(i + jarms.length - 1) % jarms.length], next = jarms[(i + 1) % jarms.length];
      let g1 = next.ang - a.ang; if (g1 <= 1e-9) g1 += Math.PI * 2;
      let g0 = a.ang - prev.ang; if (g0 <= 1e-9) g0 += Math.PI * 2;
      a.cut = Math.max(cutFor(g1, H), cutFor(g0, H));
      cutOf[a.li][a.end] = a.cut;
    });
    joints.push({ ...nd, arms: jarms });
  }
  // the surface at every place where lines meet: the best of the roads that meet there (a stub or the road under a gate takes the surface of the road it runs into); each ribbon runs into it over BLEND_LEN
  const key = (x: number, z: number) => x + ':' + z, nodeMat = new Map<string, number>();
  for (const j of joints) {
    const roads = j.arms.filter(a => lines[a.li].kind === 1), set = roads.length ? roads : j.arms;
    nodeMat.set(key(j.x, j.z), set.reduce((t, a) => Math.max(t, lines[a.li].tier), 0));   // (the best of them: a joint is never the poorest road's dirt in the middle of a paved crossing)
  }
  const lineEnds = (l: RoadLine): [number, number] => [nodeMat.get(key(l.pts[0], l.pts[1])) ?? l.tier, nodeMat.get(key(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1])) ?? l.tier];
  lines.forEach(l => { if (l.kind !== 1) { const e = lineEnds(l); l.tier = l.kind === 0 ? e[1] : (e[0] + e[1]) / 2; } });
  // never cut a line to nothing from both ends
  lines.forEach((l, li) => {
    const len = arcLength(l.pts), s = cutOf[li][0], e = cutOf[li][1];
    if (s + e > len * 0.9 && s + e > 0) { const f = (len * 0.9) / (s + e); cutOf[li][0] *= f; cutOf[li][1] *= f; }
  });
  for (const j of joints) for (const a of j.arms) a.cut = cutOf[a.li][a.end];
  // the ribbons
  const rowsOf = lines.map((l, li) => addRibbon(m, { ...l, pts: cutPts(l.pts, cutOf[li][0], cutOf[li][1]) }, half, li, lineEnds(l), fadeOf.get(li)));
  // the joints
  for (const j of joints) {
    for (const a of j.arms) {
      const r = rowsOf[a.li];
      if (r) {
        // the row of the cut: the left of the line's travel is the left leaving the node along its start, the right along its end
        const row = a.end === 0 ? r.first : r.last, pos = (i: number): Pt => [m.x[row[i]], m.z[row[i]]];
        if (a.end === 0) { a.L = pos(0); a.M = pos(1); a.R = pos(2); } else { a.L = pos(2); a.M = pos(1); a.R = pos(0); }
        a.v0 = m.v[row[1]];
      } else {
        const q = pointAt(a.pts, a.cut), q2 = pointAt(a.pts, a.cut + 0.5); let ux = q2[0] - q[0], uz = q2[1] - q[1]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        a.M = q; a.L = [q[0] - uz * H, q[1] + ux * H]; a.R = [q[0] + uz * H, q[1] - ux * H];
      }
    }
    addJunction(m, j.x, j.z, j.arms, H, j.born, nodeMat.get(key(j.x, j.z)) ?? 0);
  }
  // a dead end (one line ends here alone) is capped with a round patch
  for (const nd of nodes.values()) if (nd.arms.length === 1) addDisc(m, nd.x, nd.z, half, nd.born, lines[nd.arms[0].li].tier);
  return m;
}
