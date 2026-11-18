import test from 'node:test';
import assert from 'node:assert/strict';
import { moatSurface } from '../src/render/moatwater.ts';

const step = 2.5;
const triangles = ({ positions, indices }) => {
  const out = [];
  for (let i = 0; i < indices.length; i += 3) out.push(indices.slice(i, i + 3).map(index => positions.slice(index * 3, index * 3 + 3)));
  return out;
};

test('water covers the whole terrain cell beside each cut vertex, including diagonal bank cells', () => {
  const flat = [0.1, 0.1, 1, 4]; // only the terrain vertex at (0, 0) was cut
  const surface = moatSurface(flat, step);
  assert.equal(surface.indices.length, 4 * 6);
  const corners = new Set(triangles(surface).flat().map(([x, y, z]) => `${x},${y},${z}`));
  for (const x of [-step, step]) for (const z of [-step, step]) assert.ok(corners.has(`${x},4,${z}`));
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
  assert.equal(vertexHeights.get('2.5,0'), 3);
});

test('invalid pieces add no triangles', () => {
  assert.deepEqual(moatSurface([0, 0, 0, 1, 0, 0, 4.6, NaN], step), { positions: [], indices: [] });
});
