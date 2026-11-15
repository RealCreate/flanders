import test from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, actionsFor, foeFocus, shouldAutoJump, foeNear, sallyUnits } from '../src/defence.ts';

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
  // side, kind, x, y, hp, maxhp, alive, anim, face, elev
  const flat = [0, 0, 0, 0, 10, 10, 1, 0, 0, 0,   1, 0, 20, 0, 10, 10, 1, 0, 0, 0,   1, 0, 8, 0, 0, 10, 0, 0, 0, 0,   1, 0, 12, 0, 10, 10, 1, 0, 0, 0];
  const n = foeNear(flat, 0, 0, 30); assert.equal(n.x, 12);
  assert.equal(foeNear(flat, 0, 0, 5), null);
});
test('a sally takes everybody who is standing', () => {
  assert.deepEqual(sallyUnits([4, 2, 0, 1]), [4, 2, 0, 1, 0]);
});
