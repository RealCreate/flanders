import test from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, actionsFor, foeFocus, shouldAutoJump, foeNear, sallyUnits, newlyLent, drawnUp } from '../src/defence.ts';

test('you defend your own village, attack with your own tag, and otherwise watch', () => {
  assert.equal(roleOf(true, 0, 5), 'defend'); assert.equal(roleOf(true, 9, 5), 'defend');
  assert.equal(roleOf(false, 5, 5), 'attack'); assert.equal(roleOf(false, 9, 5), 'watch');
});
test('both sides have a say: the defender sends troops out, the attacker retreats or reinforces', () => {
  assert.deepEqual(actionsFor('defend', { armies: 2, standing: 5, reserve: 0 }), ['look', 'send-armies', 'sally']);
  assert.deepEqual(actionsFor('defend', { armies: 0, standing: 0, reserve: 0 }), ['look']);
  assert.deepEqual(actionsFor('attack', { armies: 0, standing: 0, reserve: 0 }), ['look', 'retreat']);
  assert.deepEqual(actionsFor('attack', { armies: 0, standing: 0, reserve: 3 }), ['look', 'retreat', 'reinforce']);
  assert.deepEqual(actionsFor('watch', { armies: 3, standing: 3, reserve: 3 }), ['look']);
});
test('the camera goes out along the direction the attackers came from', () => {
  const f = foeFocus(Math.PI / 2, 100, 200, 30);
  assert.ok(Math.abs(f.x - 100) < 1e-9 && Math.abs(f.z - 252) < 1e-9);
  const g = foeFocus(0, 0, 0, 40); assert.ok(Math.abs(g.x - 62) < 1e-9 && Math.abs(g.z) < 1e-9);
});
test('the jump to the raiders happens once, at the start of a raid on your own village, and only when switched on', () => {
  assert.equal(shouldAutoJump(false, true, true, 'defend'), true);
  assert.equal(shouldAutoJump(true, true, true, 'defend'), false);
  assert.equal(shouldAutoJump(false, true, false, 'defend'), false);
  assert.equal(shouldAutoJump(false, true, true, 'watch'), false);
  assert.equal(shouldAutoJump(true, false, true, 'defend'), false);
});
test('the nearest living attacker is found, and nothing beyond reach', () => {
  // side, kind, x, y, hp, maxhp, alive, anim, face, elev, boss, phase, name, aura
  const T = [0, 0, 0, 0];
  const flat = [0, 0, 0, 0, 10, 10, 1, 0, 0, 0, ...T,   1, 0, 20, 0, 10, 10, 1, 0, 0, 0, ...T,   1, 0, 8, 0, 0, 10, 0, 0, 0, 0, ...T,   1, 0, 12, 0, 10, 10, 1, 0, 0, 0, ...T];
  const n = foeNear(flat, 0, 0, 30); assert.equal(n.x, 12);
  assert.equal(foeNear(flat, 0, 0, 5), null);
});
test('a sally takes everybody who is standing', () => {
  assert.deepEqual(sallyUnits([4, 2, 0, 1]), [4, 2, 0, 1, 0]);
});

test('a drawbridge lent to an army is down even in a fight, and is announced once', () => {
  assert.equal(drawnUp(5, false), true); assert.equal(drawnUp(4, false), false); assert.equal(drawnUp(4, true), true);
  assert.equal(drawnUp(6, true), false); assert.equal(drawnUp(7, true), false); assert.equal(drawnUp(6, false), false);
  const row = (kind, status) => [kind, 0, 0, 0, 0, 0, status, 0, 0, 0];
  const flat = [...row(0, 4), ...row(23, 6), ...row(23, 5)];
  let r = newlyLent(flat, new Set()); assert.deepEqual(r.fresh, [1]);
  r = newlyLent(flat, r.now); assert.deepEqual(r.fresh, [], 'not announced again while it stays down');
  r = newlyLent([...row(0, 4), ...row(23, 5), ...row(23, 7)], r.now); assert.deepEqual(r.fresh, [2]);
});

import { foeCentroid, foeTarget, edgeArrow } from '../src/defence.ts';
test('the camera goes to where the attackers stand now, not where they began', () => {
  const unit = (side, x, z, alive = 1) => [side, 0, x, z, 10, 10, alive, 0, 0, 0, 0, 0, 0, 0];
  const flat = [...unit(1, 100, 40), ...unit(1, 110, 60), ...unit(1, 999, 999, 0), ...unit(0, -5, -5)];
  const c = foeCentroid(flat); assert.equal(c.n, 2); assert.ok(Math.abs(c.x - 105) < 1e-9 && Math.abs(c.z - 50) < 1e-9, 'the dead and the defenders do not count');
  const t = foeTarget(flat, [300, 300], 0.5, 0, 0, 30); assert.deepEqual(t, { x: 105, z: 50 });
  assert.deepEqual(foeTarget([], [300, 310], 0.5, 0, 0, 30), { x: 300, z: 310 }, 'before any attackers exist: where they formed up');
  const f = foeTarget([], [], 0, 10, 20, 30); assert.ok(Math.abs(f.x - 62) < 1e-9 && Math.abs(f.z - 20) < 1e-9, 'with nothing else: out along the raid angle');
});
test('an arrow at the screen edge points at what is off screen', () => {
  assert.equal(edgeArrow(500, 300, 1000, 600), null);
  const r = edgeArrow(2500, 300, 1000, 600); assert.ok(Math.abs(r.x - 964) < 1e-6 && Math.abs(r.y - 300) < 1e-6 && Math.abs(r.angle) < 1e-9);
  const u = edgeArrow(500, -900, 1000, 600); assert.ok(u.y < 40 && Math.abs(u.angle + Math.PI / 2) < 1e-9);
  const b = edgeArrow(500, 300, 1000, 600, true); assert.ok(b, 'behind the camera is always off screen');
  for (const [x, y] of [[-300, -300], [1300, 900], [-50, 700]]) { const e = edgeArrow(x, y, 1000, 600); assert.ok(e.x >= 36 - 1e-6 && e.x <= 964 + 1e-6 && e.y >= 36 - 1e-6 && e.y <= 564 + 1e-6, 'stays inside the screen'); }
});
