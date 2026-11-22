// Commands for helping an ally (docs/ALLIES.md): what a peer may send is checked field by field. The game side is tested in crates/game-core (combat_tests.rs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCmd, PEER_OPS } from '../src/net/validate.ts';

const KEY = 'A'.repeat(43) + '=';
const base = { tick: 5, n: 3 };

test('the help commands are ones a peer may send', () => { for (const op of ['sendaid', 'host', 'unhost', 'recallaid', 'ask']) assert.ok(PEER_OPS.includes(op), op); });

test('soldiers sent to help: who they go to and how many', () => {
  const ok = sanitizeCmd({ ...base, op: 'sendaid', idx: 4, to: KEY, units: [10, 5, 5, 0, 0, 0] });
  assert.deepEqual(ok, { ...base, op: 'sendaid', idx: 4, to: KEY, units: [10, 5, 5, 0, 0, 0] });
  for (const bad of [{}, { idx: 4, units: [1, 0, 0, 0, 0, 0] }, { idx: 4, to: KEY }, { idx: 4, to: KEY, units: [0, 0, 0, 0, 0, 0] }, { idx: 4, to: KEY, units: [-1, 2, 0, 0, 0, 0] },
    { idx: 4, to: KEY, units: [1, 0, 0] }, { idx: 4, to: KEY, units: new Array(7).fill(1) }, { idx: 4, to: KEY, units: [1e9, 0, 0, 0, 0, 0] }, { idx: -1, to: KEY, units: [1, 0, 0, 0, 0, 0] }, { to: 'x', idx: 1, units: [1, 0, 0, 0, 0, 0] }])
    assert.equal(sanitizeCmd({ ...base, op: 'sendaid', ...bad }), null, JSON.stringify(bad));
});

test('taking guests in and sending them home name the ally and their tag', () => {
  assert.ok(sanitizeCmd({ ...base, op: 'host', from: KEY, tag: 99, units: [1, 1, 0, 0, 0, 0] }));
  assert.ok(sanitizeCmd({ ...base, op: 'unhost', to: KEY, tag: 99, units: [1, 1, 0, 0, 0, 0] }));
  assert.equal(sanitizeCmd({ ...base, op: 'host', tag: 99, units: [1, 1, 0, 0, 0, 0] }), null, 'from whom?');
  assert.equal(sanitizeCmd({ ...base, op: 'host', from: KEY, units: [1, 1, 0, 0, 0, 0] }), null, 'no tag');
  assert.equal(sanitizeCmd({ ...base, op: 'unhost', tag: 1, units: [1, 1, 0, 0, 0, 0] }), null, 'to whom?');
  assert.equal(sanitizeCmd({ ...base, op: 'unhost', to: KEY, tag: 1.5, units: [1, 1, 0, 0, 0, 0] }), null);
});

test('requests carry a target and a kind', () => {
  assert.ok(sanitizeCmd({ ...base, op: 'recallaid', to: KEY }));
  assert.equal(sanitizeCmd({ ...base, op: 'recallaid' }), null);
  for (const kind of [1, 2, 3]) assert.ok(sanitizeCmd({ ...base, op: 'ask', to: KEY, kind }));
  for (const kind of [0, 4, -1, 1.5, undefined]) assert.equal(sanitizeCmd({ ...base, op: 'ask', to: KEY, kind }), null, String(kind));
  assert.equal(sanitizeCmd({ ...base, op: 'ask', kind: 1 }), null);
});
