import test from 'node:test';
import assert from 'node:assert/strict';
import { aiKey, isAiKey, pickLayouts, pickSites, raidRequests, aiName, AI_COUNT, LAYOUT_COUNT } from '../src/pve.ts';

test('computer villages get different layouts, the same ones every time for one world', () => {
  const a = pickLayouts('flanders', 'Tijs'), b = pickLayouts('flanders', 'Tijs');
  assert.deepEqual(a, b);
  assert.equal(a.length, AI_COUNT);
  assert.equal(new Set(a).size, AI_COUNT);
  assert.ok(a.every(l => l >= 0 && l < LAYOUT_COUNT));
});

test('layouts vary with the world and the player', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(pickLayouts('world' + i, 'x').join(','));
  assert.ok(seen.size > 10, 'only ' + seen.size + ' different pairs in 40 worlds');
  const used = new Set(); for (const p of seen) for (const l of p.split(',')) used.add(l);
  assert.equal(used.size, LAYOUT_COUNT, 'every layout turns up');
});

test('sites: the nearest far ones, never the player\'s own, spread apart', () => {
  const sites = [{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 230, z: 20 }, { x: -220, z: 10 }, { x: 0, z: 400 }];
  const s = pickSites(sites, 0);
  assert.equal(s.length, 2);
  assert.ok(!s.includes(0));
  assert.deepEqual(s, [1, 3]);   // none is far enough: the nearest, but 2 is too close to 1
  assert.deepEqual(pickSites([{ x: 0, z: 0 }], 0), []);
});

test('sites far from the player come first', () => {
  const sites = [{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: -600, z: 0 }, { x: 0, z: 700 }];
  assert.deepEqual(pickSites(sites, 0), [2, 3]);
});

test('computer keys look like keys and are recognised', () => {
  for (let n = 0; n < 3; n++) { assert.match(aiKey(n), /^[A-Za-z0-9+/_=-]{20,100}$/); assert.ok(isAiKey(aiKey(n))); }
  assert.ok(!isAiKey('somebodyelse'));
  assert.notEqual(aiName('w', 0), aiName('w', 1));
});

test('raid requests from the core are read in sevens', () => {
  assert.deepEqual(raidRequests([1, 5, 4, 0, 0, 0, 0]), [[5, 4, 0, 0, 0, 0]]);
  assert.deepEqual(raidRequests([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]), [[1, 1, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2]]);
  assert.deepEqual(raidRequests([]), []);
  assert.deepEqual(raidRequests([1, -3, 0, 0, 0, 0, 0]), [[0, 0, 0, 0, 0, 0]]);
});
