import test from 'node:test';
import assert from 'node:assert/strict';
import { moatSurface } from '../src/render/moatwater.ts';
import { renderedRiverAt, riverFootprint, riverGrid, riverStageAt, seaGrid } from '../src/render/rivergrid.ts';

const step = 2.5;

test('river chunks meet at a flat bank stage and cover both sides of the terrain diagonal', () => {
  const stages = new Float64Array(25).fill(-1.8); stages[12] = 4.8;
  const cells = riverFootprint(stages, 5);
  const left = riverGrid(stages, cells, 5, step, 0, 0, 2, 4);
  const right = riverGrid(stages, cells, 5, step, 2, 0, 4, 4);
  assert.equal(left.indices.length, 48);
  assert.equal(right.indices.length, 48);
  for (const { positions } of [left, right]) {
    for (let i = 0; i < positions.length / 3; i++) {
      const [x, y, z] = positions.slice(i * 3, i * 3 + 3);
      assert.equal(y, Math.max(Math.abs(x), Math.abs(z)) <= step ? 4.8 : 0);
    }
  }
  const footprint = ({ positions }, flip = 1) => positions
    .flatMap((x, i) => i % 3 === 0 ? [`${x * flip},${positions[i + 1]},${positions[i + 2]}`] : []).sort();
  assert.deepEqual(footprint(left), footprint(right, -1));
  assert.equal(riverStageAt(stages, 5, step, 0, 0), 4.8);
  assert.equal(riverStageAt(stages, 5, step, step / 2, 0), 3.3);
  assert.equal(renderedRiverAt(stages, cells, 5, step, step / 2, 0, -0.25), 4.8);
  assert.equal(riverStageAt(stages, 5, step, step + 0.25, 0), 0);
});
const triangles = ({ positions, indices }) => {
  const out = [];
  for (let i = 0; i < indices.length; i += 3) out.push(indices.slice(i, i + 3).map(index => positions.slice(index * 3, index * 3 + 3)));
  return out;
};

test('river mouths and flat ocean cover each terrain cell once and meet at tide height', () => {
  const size = 13, stride = size - 1, half = stride * step / 2;
  const stages = new Float64Array(size * size);
  for (const [i, j, stage] of [[2, 3, 2.5], [3, 4, 1.2], [4, 5, 0.6], [9, 7, 3], [9, 8, 2], [10, 9, 0.3]]) {
    stages[j * size + i] = stage;
    stages[j * size + i + 1] = -stage; // capped river bank
  }
  const cells = riverFootprint(stages, size);
  const river = riverGrid(stages, cells, size, step, 0, 0, stride, stride);
  const sea = seaGrid(cells, size, step, 100);
  const grid = world => (world + half) / step;
  const riverCoverage = new Uint8Array(stride * stride), seaCoverage = new Uint8Array(stride * stride);
  const riverVertices = new Map();
  for (const tri of triangles(river)) {
    const i = Math.min(...tri.map(([x]) => grid(x)));
    const j = Math.min(...tri.map(([, , z]) => grid(z)));
    riverCoverage[j * stride + i]++;
    for (const [x, y, z] of tri) riverVertices.set(`${grid(x)},${grid(z)}`, y);
  }
  for (let at = 0; at < sea.positions.length; at += 12) {
    const [x0, y0, z0, , , z1, x1] = sea.positions.slice(at, at + 12);
    assert.equal(y0, 0);
    // Also clip the offshore quads against the grid to catch any overlap at the map edge.
    for (let j = Math.max(0, grid(z0)); j < Math.min(stride, grid(z1)); j++) {
      for (let i = Math.max(0, grid(x0)); i < Math.min(stride, grid(x1)); i++) seaCoverage[j * stride + i]++;
    }
  }
  for (let j = 0; j < stride; j++) for (let i = 0; i < stride; i++) {
    const at = j * stride + i;
    assert.equal(riverCoverage[at], cells[at] ? 2 : 0);
    assert.equal(seaCoverage[at], cells[at] ? 0 : 1);
    if (!seaCoverage[at]) continue;
    for (const key of [`${i},${j}`, `${i + 1},${j}`, `${i},${j + 1}`, `${i + 1},${j + 1}`]) {
      if (riverVertices.has(key)) assert.equal(riverVertices.get(key), 0);
    }
  }
});

test('water covers the whole terrain cell beside each cut vertex, including diagonal bank cells', () => {
  const flat = [0.1, 0.1, 1, 4]; // only the terrain vertex at (0, 0) was cut
  const surface = moatSurface(flat, step);
  assert.equal(surface.indices.length, 4 * 6);
  const corners = new Set(triangles(surface).flat().map(([x, y, z]) => `${x},${y},${z}`));
  for (const x of [-step, step]) for (const z of [-step, step]) assert.ok(corners.has(`${x},4,${z}`));
  assert.equal(surface.levelAt(0.3, 0.4), 4);
  assert.equal(surface.levelAt(4, 4), -Infinity);
});

test('overlapping pieces draw each cell once and share vertices at different water levels', () => {
  const low = [0, 0, 4.6, 3], high = [4, 1, 4.6, 3.2];
  const both = moatSurface([...low, ...high], step);
  const loc = ([x, , z]) => `${x},${z}`;
  const key = tri => tri.map(loc).sort().join('|');
  const union = new Set([...triangles(moatSurface(low, step)), ...triangles(moatSurface(high, step))].map(key));
  const drawn = triangles(both);
  assert.equal(drawn.length, union.size);
  assert.deepEqual(new Set(drawn.map(key)), union);
  const vertexHeights = new Map();
  for (const p of drawn.flat()) {
    const k = loc(p);
    if (vertexHeights.has(k)) assert.equal(p[1], vertexHeights.get(k));
    else vertexHeights.set(k, p[1]);
  }
  assert.ok(vertexHeights.get('2.5,0') > 3 && vertexHeights.get('2.5,0') < 3.2);
  assert.equal(both.levelAt(2.5, 0), vertexHeights.get('2.5,0'));
  assert.equal(both.levelAt(3.3, 1.8), moatSurface([...high, ...low], step).levelAt(3.3, 1.8));
});

test('invalid pieces add no triangles', () => {
  const surface = moatSurface([0, 0, 0, 1, 0, 0, 4.6, NaN], step);
  assert.deepEqual(surface.positions, []);
  assert.deepEqual(surface.indices, []);
});
