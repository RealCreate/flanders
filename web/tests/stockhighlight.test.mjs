import test from 'node:test';
import assert from 'node:assert/strict';
import { stockSources, summarize, kindLine, kindNote, tierText, HighlightState, idleTotal, mergeSources, addCatalogKinds } from '../src/stockhighlight.ts';

const flow = { covered: 240, nk: 3, extras: ['villagers', 'orders'], lines: [
  { cat: 0, res: 10, gain: 120, loss: 0 },   // farms make grain
  { cat: 1, res: 10, gain: 0, loss: 30 },    // bakery uses grain
  { cat: 3, res: 10, gain: 0, loss: 50 },    // villagers eat it
  { cat: 2, res: 10, gain: 10, loss: 0 },    // a kind with no building standing
] };
// kind, tier, x, z, _, pad, status, pct, workers, residents
const b = (kind, tier, status = 0, workers = 2) => [kind, tier, 0, 0, 0, 0, status, 0, workers, 0];
const f = [...b(0, 0), ...b(0, 0, 3), ...b(0, 1), ...b(1, 0), ...b(0, 2, 0, 0), ...b(0, 1, 1)];
const info = () => ({ maxTier: 2, jobs: 2 });

test('sources by sign', () => {
  const p = stockSources(flow, 10, 1), m = stockSources(flow, 10, -1);
  assert.deepEqual(p.kinds.map(k => k.kind), [0, 2]); assert.equal(p.kinds[0].perDay, 120);
  assert.deepEqual(m.kinds.map(k => k.kind), [1]); assert.deepEqual(m.extras.map(e => e.key), ['villagers']);
  assert.equal(stockSources(undefined, 1, 1).kinds.length, 0);
});

test('counts, tiers, upgrades, idle', () => {
  const s = summarize(f, stockSources(flow, 10, 1).kinds, info, (k, t) => t === 0);
  assert.equal(s.length, 1);   // no kind 2 buildings standing
  const k = s[0];
  assert.equal(k.count, 5); assert.deepEqual(k.tiers, [2, 2, 1]);
  assert.equal(k.upgradable, 2); assert.equal(k.maxed, 1);
  assert.equal(k.noWorkers, 1); assert.equal(k.full, 1); assert.equal(k.waiting, 1); assert.equal(idleTotal(k), 3);
  assert.deepEqual(k.idx, [0, 1, 2, 4, 5]);
});

test('text', () => {
  const k = summarize(f, stockSources(flow, 10, 1).kinds, info, (kk, t) => t === 0)[0];
  assert.equal(tierText(k), '2 at tier 1, 2 at tier 2, 1 at tier 3');
  assert.equal(kindLine('Farm', k, 1), 'Farm x5: +120/day, 2 can be upgraded; idle: 1 no workers, 1 short of materials, 1 store full');
  assert.match(kindNote({ ...k, upgradable: 0, maxed: 5, noWorkers: 0, waiting: 0, full: 0 }), /fully upgraded/);
  assert.match(kindLine('Bakery', { ...k, count: 1, perDay: 30, upgradable: 0, maxed: 0, noWorkers: 0, waiting: 0, full: 0 }, -1), /^Bakery: −30\/day, none affordable/);
});

test('hover state machine', () => {
  const s = new HighlightState();
  assert.equal(s.active, null);
  s.enter(10, 1); assert.deepEqual(s.active, { res: 10, sign: 1 });
  assert.equal(s.next([4, 7, 9]), 4); assert.equal(s.next([4, 7, 9]), 7);
  s.leave(); assert.equal(s.active, null);
  s.enter(10, 1); assert.equal(s.next([4, 7, 9]), 9, 're-entering the same rate keeps the cycle going');
  assert.equal(s.next([4, 7, 9]), 4, 'wraps');
  s.enter(10, -1); assert.equal(s.next([4, 7, 9]), 4, 'a different rate starts over');
  assert.equal(s.next([]), -1);
  assert.equal(s.ringed(3, 3), false, 'the selected building keeps its own ring');
  assert.equal(s.ringed(3, null), true);
  s.leave(); assert.equal(s.ringed(3, null), false);
});

test('merging resources (the Food pill)', () => {
  const m = mergeSources([stockSources(flow, 10, 1), { kinds: [{ kind: 0, perDay: 5 }, { kind: 9, perDay: 7 }], extras: [] }]);
  assert.deepEqual(m.kinds.map(k => [k.kind, k.perDay]), [[0, 125], [2, 10], [9, 7]]);
});

test('catalogue kinds are added before the ledger has seen them', () => {
  const defs = [{ inputs: [], outputs: [[10, 10]] }, { inputs: [[10, 3]], outputs: [[14, 3]] }, { inputs: [], outputs: [] }];
  const p = addCatalogKinds({ kinds: [], extras: [] }, defs, 10, 1), m = addCatalogKinds({ kinds: [{ kind: 1, perDay: 30 }], extras: [] }, defs, 10, -1);
  assert.deepEqual(p.kinds, [{ kind: 0, perDay: 0 }]);
  assert.deepEqual(m.kinds, [{ kind: 1, perDay: 30 }], 'no duplicate');
});

test('alternate smokehouse outputs are discoverable before production and highlight the current recipe', () => {
  const defs = [{ inputs: [[12, 3]], outputs: [[13, 3]], alternateRecipe: { inputs: [[15, 3]], outputs: [[16, 3]] } }];
  const source = addCatalogKinds({ kinds: [], extras: [] }, defs, 16, 1);
  assert.deepEqual(source.kinds, [{ kind: 0, perDay: 0 }]);
  const active = summarize([...b(0, 0), ...b(0, 0)], source.kinds, info, () => false, i => i === 1);
  assert.deepEqual(active[0].idx, [1]);
});
