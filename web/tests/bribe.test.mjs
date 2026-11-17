import test from 'node:test';
import assert from 'node:assert/strict';
import { bribeOffer, bribedText, bribeToast, bribeRefusal, BRIBE_CONSEQUENCE } from '../src/bribe.ts';

test('no button when the raiders cannot be bought off (price -1)', () => {
  const o = bribeOffer(-1, 5000); assert.equal(o.show, false); assert.equal(o.disabled, true);
});
test('the button shows the price and is enabled when the stores hold enough', () => {
  const o = bribeOffer(240, 240); assert.equal(o.show, true); assert.equal(o.disabled, false); assert.equal(o.label, 'Pay them off (240)');
  assert.ok(o.title.includes('240') && o.title.includes(BRIBE_CONSEQUENCE));
});
test('too poor: disabled with the reason', () => {
  const o = bribeOffer(240, 100); assert.equal(o.show, true); assert.equal(o.disabled, true); assert.match(o.reason, /140 more gold/); assert.equal(o.title, o.reason);
});
test('a repeat customer is told they ask more', () => { assert.match(bribeOffer(100, 500, 60).title, /ask more/); assert.doesNotMatch(bribeOffer(100, 500, 0).title, /ask more/); });
test('the reports name the coins and the leader', () => {
  assert.equal(bribedText(240, 0), 'The bandits took 240 coins and left.');
  assert.match(bribedText(500, 1), /Warlord.*500 coins/);
  assert.match(bribeToast(240, 0), /240 gold.*sooner/);
});
test('refusals say why', () => {
  assert.match(bribeRefusal(-6, 240, 100), /140 more gold/); assert.match(bribeRefusal(-1, -1, 100), /cannot be bought off/);
});
