// The joints of the roads (src/render/roadmesh.ts): where a road ends on another (T), crosses it (X), three meet (Y) or a stub meets a road, the side road is cut back to the edge
// of the through road and the soft dark falloff is drawn only along the outer boundary of the union: never across a road. Dirt and stone differ only in width.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadMesh, cutPts, pointAt, EDGE } from '../src/render/roadmesh.ts';
import { roadHalfWidth } from '../src/render/roadlook.ts';

const HALVES = [roadHalfWidth(0), roadHalfWidth(2)];   // dirt, stone
const flat = lines => lines.flatMap(l => [l.kind, l.born ?? 0, l.tier ?? 0, l.opts ?? 0, l.pts.length / 2, ...l.pts]);
const arm = (deg, len, from = [0, 0], kind = 1) => { const a = (deg * Math.PI) / 180; return { kind, born: 0, pts: [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len, ...from] }; };
const dir = (deg, d) => [Math.cos((deg * Math.PI) / 180) * d, Math.sin((deg * Math.PI) / 180) * d];

function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
const distLine = (px, pz, pts) => { let d = Infinity; for (let k = 2; k < pts.length; k += 2) d = Math.min(d, distSeg(px, pz, pts[k - 2], pts[k - 1], pts[k], pts[k + 1])); return d; };

function sane(m) {
  const n = m.x.length;
  for (const a of [m.x, m.z, m.a, m.u, m.v, m.born, m.along, m.mat]) { assert.equal(a.length, n); for (const v of a) assert.ok(Number.isFinite(v), 'finite'); }
  assert.ok(m.idx.length % 3 === 0);
  for (const i of m.idx) assert.ok(Number.isInteger(i) && i >= 0 && i < n, 'index in range');
}

/** Edges used by one triangle only (after welding vertices at the same place), as [a, b] ids of welded points. */
function boundary(m) {
  const id = new Map(), pos = [], alpha = [];
  const w = i => { const k = Math.round(m.x[i] * 1e4) + ':' + Math.round(m.z[i] * 1e4); let v = id.get(k); if (v === undefined) { v = pos.length; id.set(k, v); pos.push([m.x[i], m.z[i]]); alpha.push(0); } alpha[v] = Math.max(alpha[v], m.a[i]); return v; };
  const cnt = new Map();
  for (let t = 0; t < m.idx.length; t += 3) {
    const v = [w(m.idx[t]), w(m.idx[t + 1]), w(m.idx[t + 2])];
    for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3]; if (a === b) continue; const k = Math.min(a, b) + '_' + Math.max(a, b); cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  }
  const edges = []; for (const [k, c] of cnt) if (c === 1) edges.push(k.split('_').map(Number));
  return { edges, pos, alpha };
}

// fixtures: every road ends at the node (0,0); the through road is two lines (a node splits a road in the core)
const FIXTURES = {
  'T at 90 degrees': { lines: [arm(180, 14), arm(0, 14), arm(90, 14)], through: [0, 1], side: 2 },
  'T at 60 degrees': { lines: [arm(180, 14), arm(0, 14), arm(60, 14)], through: [0, 1], side: 2 },
  'T at 120 degrees': { lines: [arm(180, 14), arm(0, 14), arm(120, 14)], through: [0, 1], side: 2 },
  'X': { lines: [arm(180, 14), arm(0, 14), arm(90, 14), arm(270, 14)], through: [0, 1], side: 2 },
  'Y of three roads': { lines: [arm(90, 14), arm(210, 14), arm(330, 14)], through: [], side: 0 },
  'a curved road meeting a straight one': {
    lines: [arm(180, 14), arm(0, 14), { kind: 1, born: 0, pts: [10, 14, 6, 9, 2.6, 5, 0.9, 2.4, 0, 0] }], through: [0, 1], side: 2,
  },
  'a stub meeting a road': { lines: [arm(180, 14), arm(0, 14), { kind: 0, born: 0, pts: [0, 3.2, 0, 0] }], through: [0, 1], side: 2, near: 1.6 },
  'a stub meeting a road at an angle': { lines: [arm(180, 14), arm(0, 14), { kind: 0, born: 0, pts: [...dir(60, 7), 0, 0] }], through: [0, 1], side: 2, near: 2.2 },
};

for (const [name, fx] of Object.entries(FIXTURES)) {
  test(`junction: ${name} (dirt and stone)`, () => {
    for (const half of HALVES) {
      const H = half * EDGE, m = buildRoadMesh(flat(fx.lines), half);
      sane(m);
      const all = fx.lines.map(l => l.pts);
      // no vertex with a falloff lies inside the solid part of any road: the dark edge is only along the outer boundary of the union
      for (let i = 0; i < m.x.length; i++) {
        if (m.a[i] > 0 || Math.hypot(m.x[i], m.z[i]) > 6 * H) continue;   // (the round caps at the far ends of the arms are not the joint)
        for (let li = 0; li < all.length; li++) assert.ok(distLine(m.x[i], m.z[i], all[li]) >= half * 0.999, `half ${half}: falloff vertex ${i} (${m.x[i].toFixed(2)}, ${m.z[i].toFixed(2)}) is ${distLine(m.x[i], m.z[i], all[li]).toFixed(2)} from line ${li}`);
      }
      // the side road starts at the edge of the through road, not at its centre line
      const side = all[fx.side], thr = fx.through.map(i => all[i]);
      let found = 0;
      for (let i = 0; i < m.x.length; i++) {
        if (m.a[i] < 0.9 || distLine(m.x[i], m.z[i], side) > 0.06 || Math.hypot(m.x[i], m.z[i]) < 0.01) continue;
        found++;
        const dThrough = Math.min(...thr.map(p => distLine(m.x[i], m.z[i], p)));
        const onThrough = thr.some(p => distLine(m.x[i], m.z[i], p) < 0.06);
        if (!onThrough && thr.length) assert.ok(dThrough >= H * 0.98 || dThrough >= half * 0.98 && fx.lines[fx.side].kind === 0, `half ${half}: side vertex ${dThrough.toFixed(2)} from the through road (soft edge at ${H.toFixed(2)})`);
      }
      assert.ok(found > 0, 'the side road has a row of vertices');
      // the union boundary is closed: every edge used by one triangle near the joint has no brightness (falloff) and ends at two other such edges
      const b = boundary(m), near = p => Math.hypot(p[0], p[1]) <= (fx.near ?? 3) * H, deg = new Map();
      for (const [p, q] of b.edges) {
        if (!near(b.pos[p]) && !near(b.pos[q])) continue;
        if (near(b.pos[p])) assert.equal(b.alpha[p], 0, 'a bright vertex on the outline'); if (near(b.pos[q])) assert.equal(b.alpha[q], 0, 'a bright vertex on the outline');
        deg.set(p, (deg.get(p) ?? 0) + 1); deg.set(q, (deg.get(q) ?? 0) + 1);
      }
      for (const [v, d] of deg) if (near(b.pos[v])) assert.equal(d % 2, 0, `outline is open at ${b.pos[v]}`);
      assert.ok(deg.size > 4, 'there is an outline');
    }
  });
}

test('dirt and stone make the same joint, only wider', () => {
  const lines = FIXTURES['T at 60 degrees'].lines;
  const a = buildRoadMesh(flat(lines), HALVES[0]), b = buildRoadMesh(flat(lines), HALVES[1]);
  assert.equal(a.idx.length, b.idx.length); assert.equal(a.x.length, b.x.length);
  assert.deepEqual(a.a, b.a);
});

test('a joint of two roads running straight on is a plain ribbon: no seam of falloff across it', () => {
  const m = buildRoadMesh(flat([arm(180, 10), arm(0, 10)]), 1.15);
  sane(m);
  for (let i = 0; i < m.x.length; i++) if (m.a[i] === 0) assert.ok(Math.abs(Math.abs(m.z[i]) - 1.15 * EDGE) < 0.1 || Math.abs(m.x[i]) > 8, 'falloff only along the two sides');
});

test('lines too short for their cut, a doubled road and a loop on one node stay finite', () => {
  sane(buildRoadMesh(flat([arm(0, 0.6), arm(20, 0.6), arm(200, 0.6)]), 1.45));
  sane(buildRoadMesh(flat([arm(0, 10), arm(0, 10), arm(3, 10)]), 1.15));
  sane(buildRoadMesh(flat([{ kind: 1, born: 0, pts: [0, 0, 6, 0, 6, 6, 0, 6, 0, 0] }, arm(225, 8)]), 1.15));
  sane(buildRoadMesh(flat([arm(0, 10), arm(25, 10), arm(50, 10), arm(75, 10), arm(100, 10), arm(300, 10)]), 1.45));
});

test('cutPts and pointAt walk along the line', () => {
  const p = [0, 0, 4, 0, 4, 4];
  assert.deepEqual(pointAt(p, 6), [4, 2]);
  assert.deepEqual(cutPts(p, 1, 1), [1, 0, 4, 0, 4, 3]);
  assert.deepEqual(cutPts(p, 0, 0), p);
  assert.deepEqual(cutPts(p, 5, 5), []);
});
