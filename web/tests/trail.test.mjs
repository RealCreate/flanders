import test from 'node:test';
import assert from 'node:assert/strict';
import { trailAt, GAP } from '../src/render/trail.ts';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('on a straight trail soldiers stand one gap apart, behind the head', () => {
  const trail = [0, 0, 5, 0, 10, 0];   // oldest first: the army walked east from 0 to 10
  for (let i = 0; i < 6; i++) { const [x, z] = trailAt(trail, 10, 0, i * GAP, 1, 0); assert.ok(near(x, 10 - i * GAP) && near(z, 0), `soldier ${i} at ${x},${z}`); }
});
test('a column follows the path round a corner, not a straight line cut across it', () => {
  const trail = [0, 0, 10, 0, 10, 10];   // east, then turned south
  const [x, z] = trailAt(trail, 10, 10, 15, 0, 1);   // 15 back = 10 up the south leg, 5 along the east leg
  assert.ok(near(x, 5) && near(z, 0), `${x},${z}`);
  const [x2, z2] = trailAt(trail, 10, 10, 4, 0, 1);
  assert.ok(near(x2, 10) && near(z2, 6));
});
test('through a gap the whole column goes through it, one after another', () => {
  // the army's centre walked north through a gate 3 wide at x=0: every soldier's spot is on that line
  const trail = []; for (let z = 0; z <= 20; z += 0.5) trail.push(0, z);
  for (let i = 0; i < 12; i++) { const [x] = trailAt(trail, 0, 20, i * GAP, 0, 1); assert.ok(near(x, 0), 'nobody leaves the line of the gate'); }
});
test('past the oldest point the line carries straight on, and an empty trail falls back to the facing', () => {
  const [x, z] = trailAt([0, 0, 4, 0], 4, 0, 10, 1, 0); assert.ok(near(x, -6) && near(z, 0), `${x},${z}`);
  const [a, b] = trailAt([], 3, 3, 2, 0, 1); assert.ok(near(a, 3) && near(b, 1), `${a},${b}`);
});
test('the head itself is at distance zero and a standing army (zero-length trail) stays put', () => {
  assert.deepEqual(trailAt([5, 5, 5, 5], 5, 5, 0, 1, 0), [5, 5]);
  const [x, z] = trailAt([5, 5, 5, 5, 5, 5], 5, 5, 0, 0, 1); assert.ok(near(x, 5) && near(z, 5));
});

import { dotsAlong } from '../src/render/trail.ts';
test('a dotted line has its dots evenly spaced along the path, also round a corner', () => {
  const d = dotsAlong([0, 0, 10, 0, 10, 10], 2, 0, 100);
  assert.equal(d.length / 2, 11);   // 0..20 along the path in steps of 2
  for (let i = 1; i < d.length / 2; i++) { const g = Math.hypot(d[2 * i] - d[2 * i - 2], d[2 * i + 1] - d[2 * i - 1]); assert.ok(g <= 2 + 1e-9 && g > 1.99, `gap ${g}`); }
  assert.equal(dotsAlong([0, 0, 100, 0], 2, 0, 5).length / 2, 5, 'capped');
  assert.deepEqual(dotsAlong([0, 0], 2, 0, 5), []);
});
