import test from 'node:test';
import assert from 'node:assert/strict';
import { lunge, fallen, mix, pickFoe, colourDistance, nearestFoe, decay, DECAY } from '../src/render/fight.ts';

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

test('a corpse decays through blood, rotting and bones, then is gone', () => {
  const f = decay(1), r = decay(25), k = decay(45), g = decay(70);
  assert.ok(f.blood > 0.9 && f.body && f.bones === 0 && f.rot === 0 && f.stain > 0.4);
  assert.ok(r.rot > 0 && r.bones > 0 && r.body && r.blood < f.blood);
  assert.ok(!k.body && k.bones === 1 && k.stain > 0.9 && !k.done);
  assert.ok(g.fade > 0.5 && g.bones < 1 && !g.done);
  assert.ok(decay(DECAY.end).done && !decay(DECAY.end - 0.1).done);
  assert.equal(decay(-5).blood, 1);
});
