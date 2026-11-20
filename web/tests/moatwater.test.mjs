import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { moatSurface } from '../src/render/moatwater.ts';
import { renderedRiverAt, riverFootprint, riverGrid, riverStageAt, seaGrid } from '../src/render/rivergrid.ts';
import { patchWater } from '../src/render/water.ts';

const step = 2.5;

test('only the sea animates foam and ripples, and river mouths still meet the tide', () => {
  const src = { heightTex: new THREE.Texture(), half: 10, step, nv: 9 };
  const time = { value: 12 }, tide = { value: -0.25 };
  for (const surface of ['sea', 'river', 'channel']) {
    const mat = new THREE.MeshPhysicalMaterial();
    patchWater(mat, src, surface, time, tide);
    const shader = { ...THREE.ShaderLib.physical, uniforms: {} };
    mat.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uTime, surface === 'sea' ? time : undefined);
    assert.equal(shader.uniforms.uSeaLevel, surface === 'river' ? tide : undefined);
    assert.equal(/uTime|float foam/.test(shader.fragmentShader), surface === 'sea');
    assert.equal(shader.vertexShader.includes('transformed.y += level - vWP.y'), surface === 'river');
  }
});

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
  const both = moatSurface([...low, ...high], step, [true, true]);
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
  assert.equal(both.levelAt(3.3, 1.8), moatSurface([...high, ...low], step, [true, true]).levelAt(3.3, 1.8));
});

test('a moat is exactly flat even next to a sloped carved river', () => {
  const pieces = [0, 0, 4.6, 3, 4, 1, 4.6, 3.2, 10, 1, 4.6, 3.6];
  const standing = moatSurface(pieces, step);
  assert.ok(standing.positions.every((v, i) => i % 3 !== 1 || v === 3));
  const mixed = moatSurface(pieces, step, [false, true, true]);
  assert.equal(mixed.levelAt(0.3, 0.4), 3);
  assert.ok(mixed.levelAt(10, 1) > 3.2);
});

test('separate standing basins retain their levels even when their bank triangles share an edge', () => {
  const surface = moatSurface([0, 0, 1.5, 4, 5, 0, 1.5, 2], step);
  assert.equal(surface.levelAt(0, 0), 4);
  assert.equal(surface.levelAt(5, 0), 2);
  assert.deepEqual(new Set(surface.positions.filter((_, i) => i % 3 === 1)), new Set([4, 2]));
});

test('invalid pieces add no triangles', () => {
  const surface = moatSurface([0, 0, 0, 1, 0, 0, 4.6, NaN], step);
  assert.deepEqual(surface.positions, []);
  assert.deepEqual(surface.indices, []);
});
