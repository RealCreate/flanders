import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCmd, parseCmd, isTestingOp, isSigned, Sequence, Bucket, cleanName, PEER_OPS, LIMITS } from '../src/net/validate.ts';

const KEY = 'A'.repeat(44);
const ok = o => sanitizeCmd({ tick: 5, n: 1, ...o });

test('a normal command passes and comes back with only known fields', () => {
  const c = ok({ op: 'place', kind: 3, x: -12, y: 40, rot: 2, evil: '<script>' });
  assert.deepEqual(c, { op: 'place', tick: 5, n: 1, kind: 3, x: -12, y: 40, rot: 2 });
});
test('every op the client sends is accepted', () => {
  const required = { turnback: { kind: 1, x: 5, to: KEY }, carhome: { kind: 1, x: 5, idx: 3 }, level: { x: 0, y: 0, kind: 8 }, restart: { e: 1, tick: 0, n: 0 }, workers: { idx: 3, kind: 2 }, research: { kind: 2 }, armybridge: { kind: 1 }, battleorder: { kind: 2, idx: 1, x: 15, y: -21 }, reserve: { x: 25, y: 50 }, plant: { x: 5, y: -5, kind: 4 }, zone: { idx: 3, x: 10, y: -10 }, rally: { kind: 0, x: 12.5, y: -30 }, sendaid: { idx: 4, to: KEY, units: [5, 0, 0, 0, 0, 0] }, host: { from: KEY, tag: 9, units: [5, 0, 0, 0, 0, 0] }, unhost: { to: KEY, tag: 9, units: [5, 0, 0, 0, 0, 0] }, recallaid: { to: KEY }, ask: { to: KEY, kind: 1 } };
  for (const op of PEER_OPS) assert.ok(ok({ op, ...required[op] }), op);
});

test('reserves require both stock limits as bounded whole numbers', () => {
  assert.ok(ok({ op: 'reserve', x: 0, y: 30_000 }));
  for (const bad of [{ x: -1, y: 0 }, { x: 1.5, y: 0 }, { x: 1 }, { x: 0, y: 30_001 }]) assert.equal(ok({ op: 'reserve', ...bad }), null);
});

test('military commands validate regiment, order, destination and research bits', () => {
  assert.equal(ok({ op: 'battleorder', idx: 5, kind: 0 }), null);
  assert.equal(ok({ op: 'battleorder', idx: 2, kind: 3, x: 0, y: 1201 }), null);
  assert.ok(ok({ op: 'battleorder', idx: 4, kind: 0 }));
  assert.ok(ok({ op: 'battleorder', idx: 2, kind: 4, x: -16, y: 32 }));
  assert.equal(ok({ op: 'battleorder', idx: 2, kind: 5, x: -16, y: 32 }), null);
  assert.equal(ok({ op: 'research', kind: 8 }), null);
  assert.equal(ok({ op: 'armybridge', kind: 2 }), null);
  assert.equal(ok({ op: 'raid', tech: 256 }), null);
  assert.equal(ok({ op: 'raid', tech: 9 }).tech, 9);
});
test('a turned-back army carries troop counts and no spoils', () => {
  const order = { op: 'return', kind: 1, units: [7, 3, 0, 0, 0, 0] };
  assert.ok(ok(order));
  assert.equal(ok({ ...order, loot: [100] }), null);
  assert.equal(ok({ ...order, units: [3, -1] }), null);
  assert.ok(ok({ op: 'return', units: [3], loot: [1] }), 'older battle reports still validate');
});
test('testing tools are refused from the network but can be recognised', () => {
  assert.equal(ok({ op: 'cheat', kind: 0, x: 1, y: 1000 }), null);
  assert.equal(ok({ op: 'flatten', x: 200 }), null);
  assert.ok(isTestingOp(JSON.stringify({ op: 'cheat', tick: 1, n: 1 })));
  assert.ok(!isTestingOp('not json'));
  assert.ok(sanitizeCmd({ op: 'cheat', tick: 1, n: 1 }, true), 'allowed for your own saved history');
});
test('unknown ops, wrong types and non-objects are refused', () => {
  for (const bad of [null, 5, 'x', [], { op: 'drop_tables', tick: 1, n: 1 }, { tick: 1, n: 1 }, { op: 'place', tick: '1', n: 1 }, { op: 'place', tick: 1.5, n: 1 }, { op: 'place', tick: -1, n: 1 }, { op: 'place', tick: 1, n: -1 }])
    assert.equal(sanitizeCmd(bad), null, JSON.stringify(bad));
});
test('ticks beyond the limit are refused', () => { assert.equal(ok({ op: 'hero', tick: LIMITS.maxTick + 1 }), null); assert.ok(ok({ op: 'hero', tick: LIMITS.maxTick })); });
test('numbers must be finite and sane', () => {
  for (const f of [{ x: NaN }, { x: Infinity }, { y: 1e12 }, { angle: -Infinity }, { ax: 'a' }, { kind: 1.5 }, { idx: 2 ** 40 }, { rot: null }])
    assert.equal(ok({ op: 'march', ...f }), null, JSON.stringify(f));
  assert.ok(ok({ op: 'march', x: 12.5, y: -300.25, idx: 3, to: KEY, ax: 5.5, ay: 6 }));
});
test('keys must look like keys', () => { assert.equal(ok({ op: 'attack', to: '<img src=x>' }), null); assert.equal(ok({ op: 'attack', to: 5 }), null); assert.ok(ok({ op: 'attack', to: KEY })); });
test('arrays are bounded and must hold whole numbers', () => {
  assert.equal(ok({ op: 'batch', units: new Array(LIMITS.maxNumbers + 1).fill(1) }), null);
  assert.equal(ok({ op: 'batch', units: [1, 2, 'x'] }), null);
  assert.equal(ok({ op: 'batch', units: [1, 2.5] }), null);
  assert.equal(ok({ op: 'form', units: [1, NaN, 2, 3, 4] }), null);
  assert.ok(ok({ op: 'batch', units: new Array(1600).fill(7) }));
});
test('parseCmd refuses oversized or broken text', () => {
  assert.equal(parseCmd('{'), null); assert.equal(parseCmd(5), null);
  assert.equal(parseCmd(JSON.stringify({ op: 'hero', tick: 1, n: 1, pad: 'x'.repeat(LIMITS.maxCmdChars) })), null);
  assert.ok(parseCmd(JSON.stringify({ op: 'hero', tick: 1, n: 1 })));
});
test('isSigned checks the shape and size', () => {
  assert.ok(isSigned({ cmd: '{}', sig: 'abc' })); assert.ok(!isSigned({ cmd: 5, sig: 'abc' })); assert.ok(!isSigned(null)); assert.ok(!isSigned({ cmd: '{}', sig: 'x'.repeat(LIMITS.maxSigChars + 1) }));
});
test('live commands must be in order and cannot leap far ahead', () => {
  const s = new Sequence();
  assert.ok(s.acceptLive({ n: 0, tick: 10 }));
  assert.ok(s.acceptLive({ n: 1, tick: 10 }));
  assert.ok(!s.acceptLive({ n: 1, tick: 11 }), 'a replayed number');
  assert.ok(!s.acceptLive({ n: 0, tick: 12 }), 'an older number');
  assert.ok(!s.acceptLive({ n: 2, tick: 9 }), 'time going backwards');
  assert.ok(!s.acceptLive({ n: 2, tick: 10 + LIMITS.maxLiveJump + 1 }), 'a huge jump');
  assert.ok(s.acceptLive({ n: 2, tick: 10 + LIMITS.maxLiveJump }));
});
test('a history is cut at the first entry out of order', () => {
  const log = [{ n: 0, tick: 1 }, { n: 1, tick: 2 }, { n: 1, tick: 3 }, { n: 5, tick: 4 }];
  assert.equal(Sequence.checkLog(log).length, 2);
  const s = new Sequence(); s.resetTo(log.slice(0, 2)); assert.ok(s.acceptLive({ n: 2, tick: 2 })); assert.ok(!s.acceptLive({ n: 2, tick: 3 }));
});
test('the rate limiter lets bursts through, then slows to its rate', () => {
  const b = new Bucket(10, 5, 0);
  let n = 0; for (let i = 0; i < 20; i++) if (b.take(0)) n++;
  assert.equal(n, 5);
  assert.ok(!b.take(50)); assert.ok(b.take(150));
});
test('names are made safe to show', () => {
  assert.equal(cleanName('<b>Evil</b>"&\''), 'bEvil/b');
  assert.equal(cleanName('a‮b\u0000c'), 'abc');
  assert.equal(cleanName(''), 'Traveller'); assert.equal(cleanName(null), 'Traveller');
  assert.equal(cleanName('x'.repeat(100)).length, 20);
});

test('workers commands: a building and -1 (auto) .. a sane count, nothing else', () => {
  for (const kind of [-1, 0, 1, 8, 1000]) assert.ok(ok({ op: 'workers', idx: 5, kind }), `kind ${kind}`);
  for (const bad of [{ idx: 5, kind: -2 }, { idx: 5, kind: 1001 }, { idx: 5, kind: 1.5 }, { idx: -1, kind: 1 }, { idx: 100001, kind: 1 }, { kind: 1 }, { idx: 5 }, { idx: 5, kind: '3' }, { idx: 5, kind: null }])
    assert.equal(ok({ op: 'workers', ...bad }), null, JSON.stringify(bad));
});

test('a bribe command carries nothing but its op: stray fields are dropped', () => {
  assert.deepEqual(ok({ op: 'bribe', kind: 5, units: [1], evil: 1 }), { op: 'bribe', tick: 5, n: 1, kind: 5, units: [1] });
  assert.ok(PEER_OPS.includes('bribe'));
  assert.equal(ok({ op: 'bribe', tick: -1 }), null);
  assert.equal(ok({ op: 'bribe', x: Infinity }), null);
});
