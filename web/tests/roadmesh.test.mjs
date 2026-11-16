// The mesh of the roads (src/render/roadmesh.ts): ribbons along curves, joins where roads meet, patches at the ends. No NaN, no broken indices, a width that holds along a bend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadMesh, joinLines, parseRoadLines, addRibbon, newMesh, EDGE } from '../src/render/roadmesh.ts';
import { curve, subdivide, length } from '../src/roadtool.ts';

const flat = lines => lines.flatMap(l => [l.kind, l.born ?? 0, l.pts.length / 2, ...l.pts]);
/** A curve of points through a quarter circle of radius r. */
const arc = (r, n = 24, cx = 0, cz = 0) => { const p = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; p.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r); } return p; };

function sane(m) {
  const n = m.x.length;
  for (const a of [m.x, m.z, m.a, m.u, m.v, m.born, m.along, m.pave]) { assert.equal(a.length, n); for (const v of a) assert.ok(Number.isFinite(v), 'finite'); }
  assert.ok(m.idx.length % 3 === 0);
  for (const i of m.idx) assert.ok(Number.isInteger(i) && i >= 0 && i < n, 'index in range');
}

test('a ribbon along a bend is finite and as wide as it should be all along', () => {
  const half = 1.15, m = newMesh(); addRibbon(m, { kind: 1, born: 0, pts: arc(12, 40) }, half);
  sane(m);
  assert.ok(m.idx.length > 6 * 30, 'enough triangles');
  for (let i = 0; i + 2 < m.x.length; i += 3) {
    const w = Math.hypot(m.x[i] - m.x[i + 2], m.z[i] - m.z[i + 2]);
    assert.ok(Math.abs(w - 2 * half * EDGE) < 0.35, `width ${w.toFixed(2)} at row ${i / 3}`);
  }
});

test('the ribbon of a curve laid through the player\'s points stays centred on the curve', () => {
  const pts = curve(subdivide([{ x: 0, z: 0 }, { x: 8, z: 6 }, { x: 18, z: 4 }, { x: 24, z: -6 }]));
  const line = { kind: 1, born: 0, pts: pts.flatMap(p => [p.x, p.z]) }, m = newMesh(); addRibbon(m, line, 1.15);
  sane(m);
  for (let i = 1; i + 2 < m.x.length; i += 3) {   // (the middle vertex of every row is on the curve, within the small wobble)
    const d = Math.min(...pts.map(p => Math.hypot(p.x - m.x[i], p.z - m.z[i])));
    assert.ok(d < 0.2, `centre ${d.toFixed(2)} off the curve`);
  }
  assert.ok(length(pts) > 28, 'the curve has the length of its corners');
});

test('two stretches that meet in the middle of a road are one ribbon, three are a junction', () => {
  const a = { kind: 1, born: 5, pts: [0, 0, 5, 1, 10, 0] }, b = { kind: 1, born: 9, pts: [10, 0, 15, -1, 20, 0] }, c = { kind: 1, born: 7, pts: [10, 0, 10, 8] };
  const two = joinLines([a, b]); assert.equal(two.length, 1); assert.equal(two[0].pts.length, 10); assert.equal(two[0].born, 9);
  const three = joinLines([a, b, c]); assert.equal(three.length, 3, 'a junction keeps its roads apart');
  // either order and either direction
  const rev = joinLines([{ ...b, pts: [20, 0, 15, -1, 10, 0] }, a]); assert.equal(rev.length, 1); assert.equal(rev[0].pts.length, 10);
});

test('the mesh of a village of roads: stubs, curved roads, a junction and a loop have no NaN and no gaps at the joins', () => {
  const stub = { kind: 0, born: 0, pts: [0, 0, 0, 3] };
  const road1 = { kind: 1, born: 10, pts: [0, 3, 5, 6, 10, 6] }, road2 = { kind: 1, born: 12, pts: [10, 6, 16, 8, 22, 3] }, branch = { kind: 1, born: 14, pts: [10, 6, 10, 14] };
  const loop = { kind: 1, born: 20, pts: [40, 0, 46, 0, 46, 6, 40, 6, 40, 0] };
  const m = buildRoadMesh(flat([stub, road1, road2, branch, loop]), 1.15);
  sane(m); assert.ok(m.x.length > 100);
  // every end has a round patch: the centre of a patch is at the end of a line
  const ends = [[0, 3], [22, 3], [10, 14], [10, 6], [40, 0]];
  for (const [ex, ez] of ends) assert.ok(m.x.some((x, i) => Math.hypot(x - ex, m.z[i] - ez) < 0.01 && m.a[i] > 0.9), `a patch at ${ex},${ez}`);
  assert.deepEqual(parseRoadLines(flat([stub, road1])).map(l => l.pts.length), [4, 6]);
});

test('degenerate lines (a point, doubled points, nothing) do not break the mesh', () => {
  const m = buildRoadMesh(flat([{ kind: 1, born: 0, pts: [3, 3, 3, 3] }, { kind: 1, born: 0, pts: [0, 0, 0, 0, 0, 0, 4, 0] }]), 1.15);
  sane(m);
  sane(buildRoadMesh([], 1.15));
});
