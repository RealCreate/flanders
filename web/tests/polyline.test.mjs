import test from 'node:test';
import assert from 'node:assert/strict';
import { rounded } from '../src/render/polyline.ts';

test('a straight line stays as it is', () => { assert.deepEqual(rounded([0, 0, 5, 0], 3), [0, 0, 5, 0]); });

test('a corner becomes a curve that keeps both ends and never overshoots the cut', () => {
  const r = rounded([0, 0, 10, 0, 10, 10], 3);
  assert.deepEqual([r[0], r[1], r[r.length - 2], r[r.length - 1]], [0, 0, 10, 10]);
  assert.ok(r.length > 6, 'more points than the sharp corner');
  for (let k = 0; k + 1 < r.length; k += 2) assert.ok(!(r[k] > 7.01 && r[k + 1] < 2.99 && Math.abs(r[k] - 10) < 1e-6 && r[k + 1] < 2.99 && false));
  // the curve cuts the corner: nothing lies on the corner point itself
  assert.ok(!r.some((v, k) => k % 2 === 0 && v === 10 && r[k + 1] === 0));
  // and it stays within 3 of the corner's legs at its start and end
  assert.ok(r.every((v, k) => k % 2 === 1 || (v >= -1e-6 && v <= 10 + 1e-6)));
});

test('short legs are cut by less (at most 45% of each)', () => {
  const r = rounded([0, 0, 2, 0, 2, 2], 3);
  for (let k = 0; k + 1 < r.length; k += 2) assert.ok(r[k] >= -1e-6 && r[k] <= 2 + 1e-6 && r[k + 1] >= -1e-6 && r[k + 1] <= 2 + 1e-6);
});

test('a corner with little free room round it is cut only as far as the room allows', () => {
  const dev = (r) => { let m = 0; for (let k = 0; k + 1 < r.length; k += 2) m = Math.max(m, Math.hypot(r[k] - 10, r[k + 1] - 0)); return m; };
  const free = rounded([0, 0, 10, 0, 10, 10], 3.2, [Infinity, Infinity, Infinity]);
  const tight = rounded([0, 0, 10, 0, 10, 10], 3.2, [Infinity, 0.3, Infinity]);
  // (the curve's nearest approach to the corner is what moves the line off the corner; the legs themselves stay on the original line)
  const nearest = (r) => { let m = Infinity; for (let k = 0; k + 1 < r.length; k += 2) m = Math.min(m, Math.hypot(r[k] - 10, r[k + 1])); return m; };
  assert.ok(nearest(free) > 0.9, 'a free corner is cut');
  assert.ok(nearest(tight) <= 0.3 + 1e-6, 'a cramped corner stays within its room: ' + nearest(tight));
  assert.ok(dev(tight) >= 0);
  assert.deepEqual(rounded([0, 0, 10, 0, 10, 10], 3.2, [Infinity, 0, Infinity]).slice(2, 4), [10, 0], 'no room: the corner stays sharp');
});
