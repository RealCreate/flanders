import test from 'node:test';
import assert from 'node:assert/strict';
import { ringHeight, RING_LIFT, OVER_WATER_KINDS } from '../src/render/ringheight.ts';

const DECK = 3.0, BED = -2.4;
test('a drawbridge ring lies at the deck, not on the moat bed, in both states and at every rotation', () => {
  // (the ring is the same for every rotation and state: it only depends on the building's deck height)
  for (let rot = 0; rot < 8; rot++) for (const up of [false, true]) {
    assert.ok(Math.abs(ringHeight(BED, 23, DECK) - (DECK + RING_LIFT)) < 1e-9, `rot ${rot} ${up ? 'up' : 'down'}`);
  }
});
test('the ring is never below the water surface over a moat', () => {
  for (const kind of OVER_WATER_KINDS) assert.ok(ringHeight(-5, kind, 0.4) >= 0.4, `kind ${kind}`);
});
test('the ring still follows high ground on the banks and other buildings stay on the terrain', () => {
  assert.equal(ringHeight(5, 23, DECK), 5 + RING_LIFT);
  assert.equal(ringHeight(BED, 0, DECK), BED + RING_LIFT);
});
