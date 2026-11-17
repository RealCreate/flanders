// The road tool's geometry (src/roadtool.ts): points are never farther apart than the core allows, and the previewed curve passes through every point, smoothly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { subdivide, curve, length, MAX_GAP } from '../src/roadtool.ts';

test('long stretches are cut into pieces no longer than the core allows, keeping the corners', () => {
  const pts = subdivide([{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 5 }]);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) <= MAX_GAP + 1e-9);
  assert.ok(pts.some(p => p.x === 40 && p.z === 0), 'the corner stays');
  assert.deepEqual(subdivide([]), []);
  assert.equal(subdivide([{ x: 1, z: 1 }]).length, 1);
});

test('the curve runs through every point, is finite, and bends smoothly (no kink at a point)', () => {
  const pts = [{ x: 0, z: 0 }, { x: 8, z: 5 }, { x: 16, z: 5 }, { x: 22, z: -3 }, { x: 30, z: -4 }];
  const c = curve(pts);
  for (const p of pts) assert.ok(c.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 1e-6), `through ${p.x},${p.z}`);
  for (const q of c) { assert.ok(Number.isFinite(q.x) && Number.isFinite(q.z)); }
  // the direction changes by little from one step to the next, including at the points themselves
  let worst = 0;
  for (let i = 1; i + 1 < c.length; i++) {
    const a = Math.atan2(c[i].z - c[i - 1].z, c[i].x - c[i - 1].x), b = Math.atan2(c[i + 1].z - c[i].z, c[i + 1].x - c[i].x);
    let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d; worst = Math.max(worst, d);
  }
  assert.ok(worst < 0.5, `largest turn between steps ${worst.toFixed(2)} rad`);
  assert.ok(length(c) > length(pts) * 0.98 - 1e-9, 'a little longer than the corners joined by straight lines');
});

test('the curve is deterministic and a straight run stays straight', () => {
  const pts = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 12, z: 0 }, { x: 18, z: 0 }];
  assert.deepEqual(curve(pts), curve(pts));
  for (const q of curve(pts)) assert.ok(Math.abs(q.z) < 1e-9);
  assert.equal(curve([{ x: 0, z: 0 }]).length, 1);
});
