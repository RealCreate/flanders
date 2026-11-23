// The mesh of the roads (src/render/roadmesh.ts): ribbons along curves, joins where roads meet, patches at the ends. No NaN, no broken indices, a width that holds along a bend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTANT, buildRoadMesh, joinLines, parseRoadLines, addRibbon, newMesh, EDGE } from '../src/render/roadmesh.ts';
import { curve, subdivide, length } from '../src/roadtool.ts';

const flat = lines => lines.flatMap(l => [l.kind, l.born ?? 0, l.tier ?? 0, l.opts ?? 0, l.pts.length / 2, ...l.pts]);
/** A curve of points through a quarter circle of radius r. */
const arc = (r, n = 24, cx = 0, cz = 0) => { const p = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; p.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r); } return p; };

function sane(m) {
  const n = m.x.length;
  for (const a of [m.x, m.z, m.a, m.u, m.v, m.born, m.along, m.mat]) { assert.equal(a.length, n); for (const v of a) assert.ok(Number.isFinite(v), 'finite'); }
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

test('a road the player laid shows at once, a stub still grows in with its building', () => {
  const m = buildRoadMesh(flat([{ kind: 1, born: 5000, pts: [0, 0, 10, 0, 20, 4] }]), 1.15);
  assert.ok(m.born.length > 0 && m.born.every(b => b === INSTANT), 'every vertex of a laid road is there from the first frame');
  const s = buildRoadMesh(flat([{ kind: 0, born: 5000, pts: [0, 0, 3, 0] }]), 1.15);
  assert.ok(s.born.every(b => b === 5000), 'a stub is born with its building');
});

test('a building\'s stub is a narrow ribbon along the door-to-node segment: no wide patch under the building', () => {
  for (const len of [0.8, 1.5, 3, 6]) for (const half of [1.15, 1.45]) for (const ang of [0, 0.4, 0.785, 1.57, 2.4, 3.9]) {
    const ex = Math.cos(ang) * len, ez = Math.sin(ang) * len;
    const m = buildRoadMesh(flat([{ kind: 0, born: 0, pts: [0, 0, ex, ez] }]), half);
    sane(m);
    // every vertex of the stub (ribbon and the round patch at its node) lies near the segment, within the soft edge of the ribbon
    const reach = half * EDGE + 1e-6;
    for (let i = 0; i < m.x.length; i++) {
      const t = Math.max(0, Math.min(1, (m.x[i] * ex + m.z[i] * ez) / (len * len)));
      assert.ok(Math.hypot(m.x[i] - ex * t, m.z[i] - ez * t) <= reach + 1e-6, `vertex ${i} strays ${Math.hypot(m.x[i] - ex * t, m.z[i] - ez * t)}`);
    }
    // and the area is bounded by the stub's length times its width, plus the patch at the node
    let area = 0;
    for (let i = 0; i < m.idx.length; i += 3) { const [a, b, c] = [m.idx[i], m.idx[i + 1], m.idx[i + 2]]; area += Math.abs((m.x[b] - m.x[a]) * (m.z[c] - m.z[a]) - (m.x[c] - m.x[a]) * (m.z[b] - m.z[a])) / 2; }
    assert.ok(area <= len * 2 * half * EDGE * 1.6 + Math.PI * (half * EDGE) ** 2, `area ${area} for a stub ${len} long`);
  }
});

// ---- surfaces: every vertex carries the surface it is on, and one surface runs into the next ------------------------------------------------------------------------------------------

import { BLEND_LEN } from '../src/render/roadmesh.ts';

test('a parsed line carries its surface and design', () => {
  const [l] = parseRoadLines(flat([{ kind: 1, born: 3, tier: 2, opts: 5, pts: [0, 0, 5, 0, 9, 1] }]));
  assert.equal(l.tier, 2); assert.equal(l.opts, 5); assert.deepEqual(l.pts, [0, 0, 5, 0, 9, 1]); assert.equal(l.born, 3);
});

test('two stretches of one surface are one ribbon, two of different surfaces are not', () => {
  const same = joinLines(parseRoadLines(flat([{ kind: 1, tier: 1, pts: [0, 0, 5, 0, 10, 0] }, { kind: 1, tier: 1, pts: [10, 0, 15, 0, 20, 0] }])));
  assert.equal(same.length, 1); assert.equal(same[0].tier, 1);
  const diff = joinLines(parseRoadLines(flat([{ kind: 1, tier: 0, pts: [0, 0, 5, 0, 10, 0] }, { kind: 1, tier: 2, pts: [10, 0, 15, 0, 20, 0] }])));
  assert.equal(diff.length, 2);
});

test('a road keeps its own surface along its length and every vertex has one', () => {
  for (const tier of [0, 1, 2, 3]) {
    const m = buildRoadMesh(flat([{ kind: 1, tier, pts: [0, 0, 10, 0, 20, 0, 30, 0] }]), 1.3);
    sane(m);
    assert.ok(m.mat.every(v => v === tier), `tier ${tier}: ${[...new Set(m.mat)]}`);
  }
});

test('where a dirt road meets a cobbled one the surface runs from one to the other over a stretch, never jumping', () => {
  const run = (a, b) => { const p = []; for (let x = a; x <= b + 1e-9; x += 1.5) p.push(x, 0); if (p[p.length - 2] !== b) p.push(b, 0); return p; };   // (the core samples a curve about every 1.5 units)
  const m = buildRoadMesh(flat([{ kind: 1, tier: 0, pts: run(0, 24) }, { kind: 1, tier: 2, pts: run(24, 48) }]), 1.3);
  sane(m);
  const at = x => { let best = null; for (let i = 0; i < m.x.length; i++) if (Math.abs(m.z[i]) < 0.2 && (best === null || Math.abs(m.x[i] - x) < Math.abs(m.x[best] - x))) best = i; return m.mat[best]; };
  assert.equal(at(1), 0, 'the far end is dirt'); assert.equal(at(47), 2, 'the far end is cobbles');
  assert.ok(Math.abs(at(24) - 1) < 0.05, `at the meeting it is half way (${at(24)})`);
  const xs = []; for (let x = 1; x <= 47; x += 0.5) xs.push(at(x));
  for (let i = 1; i < xs.length; i++) { assert.ok(xs[i] >= xs[i - 1] - 1e-6, 'never goes back'); assert.ok(xs[i] - xs[i - 1] < 0.7, `no jump (${xs[i - 1]} to ${xs[i]})`); }
  assert.ok(at(24 - BLEND_LEN - 3) === 0 && at(24 + BLEND_LEN + 3) === 2, 'the blend is local');
});

test('a junction takes the mean surface of the roads that meet there, and a stub takes the surface of the road it runs into', () => {
  const m = buildRoadMesh(flat([
    { kind: 1, tier: 3, pts: [-20, 0, -10, 0, 0, 0] }, { kind: 1, tier: 3, pts: [0, 0, 10, 0, 20, 0] }, { kind: 1, tier: 1, pts: [0, 0, 0, 10, 0, 20] }, { kind: 0, tier: 0, pts: [0, -12, 0, -6, 0, 0] },
  ]), 1.3);
  sane(m);
  const near = []; for (let i = 0; i < m.x.length; i++) if (Math.hypot(m.x[i], m.z[i]) < 0.1) near.push(m.mat[i]);
  assert.ok(near.length > 0 && near.every(v => Math.abs(v - (3 + 3 + 1) / 3) < 1e-6), `the centre of the joint: ${near}`);
  const stubFar = []; for (let i = 0; i < m.x.length; i++) if (Math.abs(m.x[i]) < 2 && m.z[i] < -9) stubFar.push(m.mat[i]);
  assert.ok(stubFar.every(v => v > 2 && v < 3), 'the stub is on its way to the surface of the road');
});

test('a dead end is capped in the surface of its road, and a stub with nothing to join stays dirt', () => {
  const m = buildRoadMesh(flat([{ kind: 1, tier: 2, pts: [0, 0, 8, 0, 16, 0] }, { kind: 0, tier: 0, pts: [0, 30, 0, 36] }]), 1.3);
  sane(m);
  assert.ok(m.mat.every(v => v === 0 || v === 2));
  assert.ok(m.mat.some(v => v === 2) && m.mat.some(v => v === 0));
});
