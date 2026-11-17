// The radii the interface draws are the core's own: read them back through the real wasm and compare with the rules they stand for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseRadii, labelFor, FX_FIRE_FULL, FX_FIRE_HALF, FX_SHOOT } from '../src/coverage.ts';
const { effect_radii, flammability_of, units } = createRequire(import.meta.url)('./.wasm/game_core.js');
const WELL = 16, TOWER = 3, KEEP = 26, BUILDERS = 20, WALL = 2, HOUSE = 0;

test('a well reaches 18 at full strength and 36 at half; the label says so', () => {
  const r = parseRadii(effect_radii(WELL, 0));
  assert.equal(r.find(e => e.fx === FX_FIRE_FULL).r, 18); assert.equal(r.find(e => e.fx === FX_FIRE_HALF).r, 36);
  assert.equal(labelFor(r), 'Fire help: 18 full / 36 half');
});
test('towers and keeps shoot as far as an archer does', () => {
  const archer = JSON.parse(units()).find(u => u.name === 'Archer').range;
  for (const k of [TOWER, KEEP]) assert.equal(parseRadii(effect_radii(k, 1)).find(e => e.fx === FX_SHOOT).r, archer);
  assert.ok(parseRadii(effect_radii(WALL, 2)).find(e => e.fx === FX_SHOOT).r > archer, 'archers on a wall shoot further');
  assert.deepEqual(parseRadii(effect_radii(WALL, 0)), [], 'a timber palisade has no walkway');
});
test('the builders\' yard reaches 45; a house reaches nothing; what burns is known', () => {
  assert.equal(parseRadii(effect_radii(BUILDERS, 0))[0].r, 45);
  assert.deepEqual(parseRadii(effect_radii(HOUSE, 0)), []);
  assert.ok(flammability_of(HOUSE, 0) >= 0.1 && flammability_of(WALL, 2) === 0);
});
