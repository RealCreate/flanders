import test from 'node:test';
import assert from 'node:assert/strict';
import { lunge, fallen, mix, pickFoe, colourDistance, nearestFoe } from '../src/render/fight.ts';

test('a swing lunges forward and comes back', () => {
  assert.equal(lunge(0), 0); assert.ok(lunge(0.35) < 1e-6); assert.ok(Math.abs(lunge(0.175) - 0.5) < 1e-6); assert.ok(lunge(0.01) < 0.05);
});
test('a killed soldier falls over in about half a second and stays down', () => {
  assert.equal(fallen(0), 0); assert.ok(fallen(0.1) > 0.3 && fallen(0.1) < 1); assert.equal(fallen(0.55), 1); assert.equal(fallen(30), 1);
});
test('colours mix and the two sides never look alike', () => {
  assert.equal(mix(0x000000, 0xffffff, 0), 0); assert.equal(mix(0x000000, 0xffffff, 1), 0xffffff);
  for (const def of [0x4a3a2a, 0xb02a2a, 0x2f5fa8, 0xe0c030, 0x202020]) assert.ok(colourDistance(def, pickFoe(def, 0x4a3a2a)) > 90, `foe differs from ${def.toString(16)}`);
  assert.equal(pickFoe(0x2f5fa8, 0x4a3a2a), 0x4a3a2a);
});
test('the nearest living enemy is found, skipping the dead and the same side', () => {
  // side, kind, x, y, hp, max, alive, swing, face, elev, boss, phase, name, aura
  const T = [0,0,0,0];
  const u = [0,0,0,0,10,10,1,0,0,0,...T,  0,0,1,0,10,10,1,0,0,0,...T,  1,0,5,0,10,10,0,0,0,0,...T,  1,0,8,0,10,10,1,0,0,0,...T,  1,0,3,0,10,10,1,0,0,0,...T];
  assert.equal(nearestFoe(u, 0), 4); assert.equal(nearestFoe(u, 4), 1);
});
