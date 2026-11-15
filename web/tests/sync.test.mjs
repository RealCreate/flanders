// The rules for judging a copy of another player's village (net/sync.ts) and the checks on the messages that carry the hashes (net/validate.ts). No game, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplicaTrack, ResyncPolicy, sameBuild, describe, WAIT_MS, SYNC_PROTOCOL } from '../src/net/sync.ts';
import { sanitizeHash, sanitizeBuild, Sequence } from '../src/net/validate.ts';

const NAMES = ['core', 'stock', 'buildings'];
/** A stand-in world: a tick and three section hashes. */
const fake = (tick, parts) => ({ t: tick, parts, tick() { return BigInt(this.t); }, state_hash() { return BigInt(this.parts.reduce((a, b) => a * 31 + b, 7)); }, state_hash_parts() { return this.parts.map(BigInt); } });
const msg = (w, c, extra = {}) => ({ tick: w.t, hash: w.state_hash().toString(), c, p: w.parts.map(String), tools: false, ...extra });
const advanceBy = w => t => { while (w.t < t) w.t++; return true; };

test('a hash that matches at the same tick and command count is a match', () => {
  const tr = new ReplicaTrack(); tr.reset(['place', 'place']);
  const mine = fake(10, [1, 2, 3]), theirs = fake(10, [1, 2, 3]);
  assert.deepEqual(tr.judge(msg(theirs, 2), mine, NAMES, advanceBy(mine), 0), { kind: 'match' });
  assert.equal(tr.lastGood.tick, 10);
});

test('a hash naming commands we do not have yet is not a desync: the copy waits and is not advanced', () => {
  const tr = new ReplicaTrack(); tr.reset(['place']);
  const mine = fake(10, [1, 2, 3]), theirs = fake(11, [1, 2, 4]);
  const v = tr.judge(msg(theirs, 2), mine, NAMES, advanceBy(mine), 1000);
  assert.deepEqual(v, { kind: 'wait', missing: 1 });
  assert.equal(mine.t, 10, 'the copy stayed where it was, so the missing command can still land on its own tick');
  // the command arrives; the waiting hash is judged against it
  tr.applied('upgrade'); mine.parts = [1, 2, 4];
  assert.deepEqual(tr.recheck(mine, NAMES, advanceBy(mine), 1100), { kind: 'match' });
  assert.equal(mine.t, 11);
});

test('commands that never arrive are called lost after a while', () => {
  const tr = new ReplicaTrack(); tr.reset([]);
  const mine = fake(5, [1, 1, 1]), theirs = fake(8, [1, 1, 2]);
  assert.equal(tr.judge(msg(theirs, 3), mine, NAMES, advanceBy(mine), 0).kind, 'wait');
  assert.equal(tr.judge(msg(theirs, 3), mine, NAMES, advanceBy(mine), WAIT_MS - 1).kind, 'wait');
  assert.deepEqual(tr.judge(msg(theirs, 3), mine, NAMES, advanceBy(mine), WAIT_MS + 1), { kind: 'lost', missing: 3 });
});

test('a mismatch names the sections that differ and the commands since the last match', () => {
  const tr = new ReplicaTrack(); tr.reset(['place']);
  const mine = fake(10, [1, 2, 3]);
  assert.equal(tr.judge(msg(fake(10, [1, 2, 3]), 1), mine, NAMES, advanceBy(mine), 0).kind, 'match');
  tr.applied('march'); tr.applied('train');
  mine.t = 12; const theirs = fake(12, [1, 9, 3]); mine.parts = [1, 2, 3];
  const v = tr.judge(msg(theirs, 3), mine, NAMES, advanceBy(mine), 1);
  assert.equal(v.kind, 'mismatch');
  assert.deepEqual(v.diag.parts, ['stock']);
  assert.equal(v.diag.goodTick, 10); assert.equal(v.diag.goodCount, 1);
  assert.deepEqual(v.diag.ops, ['march', 'train'], 'the first divergence is among the commands applied after the last match');
  assert.match(describe(v.diag), /tick 12 in stock .*march, train/);
});

test('nothing is judged when the copy is already past the tick, when testing tools were used, or when the sender is an older build', () => {
  const tr = new ReplicaTrack(); tr.reset([]);
  const mine = fake(20, [1, 2, 3]);
  assert.equal(tr.judge(msg(fake(15, [9, 9, 9]), 0), mine, NAMES, advanceBy(mine), 0).kind, 'stale');
  assert.equal(tr.judge(msg(fake(20, [9, 9, 9]), 0, { tools: true }), mine, NAMES, advanceBy(mine), 0).kind, 'tools');
  assert.equal(tr.judge({ tick: 20, hash: '1', c: -1, p: [], tools: false }, mine, NAMES, advanceBy(mine), 0).kind, 'stale');
  assert.equal(tr.judge(msg(fake(25, [1, 2, 3]), 0), mine, NAMES, () => false, 0).kind, 'behind', 'a copy that cannot get there is not called wrong');
});

test('re-syncs are paced and capped, so a persistent problem cannot loop', () => {
  const p = new ResyncPolicy();
  assert.equal(p.ask(0), 'go');
  assert.equal(p.ask(1000), 'later');
  assert.equal(p.ask(ResyncPolicy.GAP + 1), 'go');
  let t = 2 * ResyncPolicy.GAP + 2; assert.equal(p.ask(t), 'go');
  t += ResyncPolicy.GAP + 1; assert.equal(p.ask(t), 'go');
  t += ResyncPolicy.GAP + 1; assert.equal(p.ask(t), 'stop', 'four requests in ten minutes is all there is');
  assert.equal(p.ask(t + ResyncPolicy.WINDOW), 'go', 'after the window it may try again');
  p.reset(); assert.equal(p.requests, 0);
});

test('builds are the same only when protocol and rules fingerprint agree; an older build counts as different', () => {
  assert.ok(sameBuild({ v: SYNC_PROTOCOL, rules: 'ab12' }, { v: SYNC_PROTOCOL, rules: 'ab12' }));
  assert.ok(!sameBuild({ v: SYNC_PROTOCOL, rules: 'ab12' }, { v: SYNC_PROTOCOL, rules: 'ab13' }));
  assert.ok(!sameBuild({}, { v: SYNC_PROTOCOL, rules: 'ab12' }));
});

test('hash messages are rebuilt field by field', () => {
  const ok = sanitizeHash({ tick: 5, hash: '123', c: 4, p: ['1', '2'], tools: true, junk: 1 });
  assert.deepEqual(ok, { tick: 5, hash: '123', c: 4, p: ['1', '2'], tools: true });
  assert.deepEqual(sanitizeHash({ tick: 5, hash: '123' }), { tick: 5, hash: '123', c: -1, p: [], tools: false }, 'an older build');
  for (const bad of [null, [], 'x', { tick: -1, hash: '1' }, { tick: 1.5, hash: '1' }, { tick: 1e9, hash: '1' }, { tick: 1, hash: 'abc' }, { tick: 1, hash: '1'.repeat(21) },
    { tick: 1, hash: '1', c: -2 }, { tick: 1, hash: '1', c: 1e9 }, { tick: 1, hash: '1', c: '3' }, { tick: 1, hash: '1', p: 'x' }, { tick: 1, hash: '1', p: new Array(17).fill('1') }, { tick: 1, hash: '1', p: [1] }, { tick: 1, hash: '1', p: ['<b>'] }])
    assert.equal(sanitizeHash(bad), null, JSON.stringify(bad));
});

test('the build a hello claims is checked', () => {
  assert.deepEqual(sanitizeBuild({ v: 2, rules: '0123abcdef' }), { v: 2, rules: '0123abcdef' });
  assert.deepEqual(sanitizeBuild({}), { v: 0, rules: '' });
  for (const bad of [{ v: -1 }, { v: 1.5 }, { v: '2' }, { v: 2, rules: 'XYZ' }, { v: 2, rules: 'a'.repeat(33) }, { rules: 5 }, null]) assert.equal(sanitizeBuild(bad), null, JSON.stringify(bad));
});

test('a command we already have (it came in their history too) is dropped without a strike', () => {
  const s = new Sequence(); s.resetTo([{ n: 0, tick: 1 }, { n: 1, tick: 2 }]);
  assert.equal(s.classify({ n: 1, tick: 2 }), 'dup');
  assert.equal(s.classify({ n: 0, tick: 1 }), 'dup');
  assert.equal(s.classify({ n: 2, tick: 3 }), 'ok');
  assert.equal(s.classify({ n: 3, tick: 1 }), 'bad', 'time going backwards is still refused');
});
