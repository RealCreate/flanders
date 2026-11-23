// Moving players to the latest version (src/update.ts): when the deployed build counts as newer, and how a reload loop is prevented. No browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deployedBuild, isOutdated, mayReload, reloadUrl } from '../src/update.ts';

const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } }; };
const reply = (body, ok = true) => async () => ({ ok, json: async () => body });

test('the deployed build is read from version.json; anything odd is "unknown"', async () => {
  assert.deepEqual(await deployedBuild(reply({ id: 'a-b-1', time: 5 })), { id: 'a-b-1', time: 5 });
  assert.equal(await deployedBuild(reply({ id: 5 })), null);
  assert.equal(await deployedBuild(reply({ id: '' })), null);
  assert.equal(await deployedBuild(reply({}, false)), null);
  assert.equal(await deployedBuild(async () => { throw new Error('offline'); }), null);
});

test('only a different and newer deployed build makes this one out of date; development never updates itself', () => {
  assert.equal(isOutdated('v1', { id: 'v2', time: 200 }, 100), true);
  assert.equal(isOutdated('v1', { id: 'v1', time: 100 }, 100), false, 'the same build');
  assert.equal(isOutdated('v2', { id: 'v1', time: 50 }, 100), false, 'the deployed build is older (a stale cache on the host): not an update');
  assert.equal(isOutdated('dev', { id: 'v2', time: 200 }, 0), false);
  assert.equal(isOutdated('v1', null, 100), false);
});

test('one reload per deployed version per ten minutes, so a stale cache cannot cause a loop', () => {
  const s = store();
  assert.equal(mayReload(s, 'v2', 0), true);
  assert.equal(mayReload(s, 'v2', 60_000), false, 'it did not help the first time');
  assert.equal(mayReload(s, 'v3', 60_000), true, 'a newer one is another matter');
  assert.equal(mayReload(s, 'v2', 700_000), true, 'later it may try again');
});

test('the reload address keeps the world and adds a cache breaker', () => {
  const u = new URL(reloadUrl('https://x.test/flanders/?world=abc&player=2', 'v2-abc-1'));
  assert.equal(u.searchParams.get('world'), 'abc'); assert.equal(u.searchParams.get('player'), '2'); assert.equal(u.searchParams.get('_u'), 'v2-abc-1');
});
