// Multi-select: connected wall runs and the combined cost of a bulk upgrade (src/multiselect.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedWalls, planUpgrade } from '../src/multiselect.ts';

const b = (kind, tier, x, z) => [kind, tier, x, z, 0, 0, 0, 0, 0, 0];
const flat = (...bs) => Float32Array.from(bs.flat());

test('a wall run is found from any piece, gates included, and other runs and non-walls are left out', () => {
  const f = flat(b(15, 0, 0, 0), b(2, 0, 10, 0), b(2, 0, 16, 0), b(22, 0, 22, 0), b(2, 0, 28, 0), b(2, 0, 100, 100), b(2, 0, 106, 100), b(21, 0, 16, 3));
  const run = [1, 2, 3, 4];
  for (const s of run) assert.deepEqual(connectedWalls(f, s), run);
  assert.deepEqual(connectedWalls(f, 5), [5, 6]);
  assert.deepEqual(connectedWalls(f, 0), [], 'a hall is not a wall');
  assert.deepEqual(connectedWalls(f, 7), [7], 'fences only join fences');
});

test('a bulk upgrade pays one after another, skips the top tier and reports who ran out', () => {
  const f = flat(b(2, 0, 0, 0), b(2, 1, 6, 0), b(2, 0, 12, 0), b(2, 0, 18, 0));
  const plan = planUpgrade([3, 0, 1, 2, 0], f, () => 1, () => [0, 10, 1, 5], [25, 100]);
  assert.deepEqual(plan.go, [0, 2]);
  assert.deepEqual(plan.full, [1]);
  assert.deepEqual(plan.poor, [3]);
  assert.deepEqual(plan.total, [[0, 20], [1, 10]]);
});
