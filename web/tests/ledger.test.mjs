import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger.ts';

const loot = (gold) => { const l = new Array(12).fill(0); l[8] = gold; return l; };

test('an honest return passes and is marked checked', () => {
  const l = new Ledger(); l.record(7, [5, 2, 0, 0, 0], loot(40));
  const r = l.claim(7, [5, 2, 0, 0, 0], loot(40));
  assert.ok(r.checked && !r.lied); assert.deepEqual(r.loot, loot(40));
});
test('a return that claims more loot is replaced by the real result', () => {
  const l = new Ledger(); l.record(7, [5, 2, 0, 0, 0], loot(40));
  const r = l.claim(7, [5, 2, 0, 0, 0], loot(400));
  assert.ok(r.checked && r.lied); assert.equal(r.loot[8], 40);
});
test('a return that claims extra survivors is replaced too', () => {
  const l = new Ledger(); l.record(7, [1, 0, 0, 0, 0], loot(0));
  const r = l.claim(7, [300, 300, 300, 300, 300], loot(0));
  assert.ok(r.lied); assert.deepEqual(r.units, [1, 0, 0, 0, 0]);
});
test('with nothing recorded the claim stands (there is nothing to check it against)', () => {
  const r = new Ledger().claim(9, [1, 1, 1, 1, 1], loot(10));
  assert.ok(!r.checked && !r.lied); assert.equal(r.loot[8], 10);
});
test('a result is used once, and stale ones are dropped', () => {
  const l = new Ledger(); l.record(7, [1, 0, 0, 0, 0], loot(1)); l.record(7, [2, 0, 0, 0, 0], loot(2));
  assert.equal(l.claim(7, [2, 0, 0, 0, 0], loot(2)).loot[8], 2);
  assert.equal(l.pending(7), 0);
  assert.ok(!l.claim(7, [9, 0, 0, 0, 0], loot(9)).checked);
});
test('results are kept per attacker and bandits are ignored', () => {
  const l = new Ledger(); l.record(1, [1, 0, 0, 0, 0], loot(1)); l.record(2, [2, 0, 0, 0, 0], loot(2)); l.record(0, [3, 0, 0, 0, 0], loot(3));
  assert.equal(l.claim(2, undefined, undefined).units[0], 2); assert.equal(l.pending(1), 1); assert.equal(l.pending(0), 0);
});
