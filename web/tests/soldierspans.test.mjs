import test from 'node:test';
import assert from 'node:assert/strict';
import { spanAcross, soldierSpansFlat } from '../src/render/soldierspans.ts';

// a moat running east-west between z = -3 and z = 3: dry ground at 6.6, the bed at -3.4
const moat = (x, z) => (Math.abs(z) < 3 ? -3.4 : 6.6);

test('a bridge ordered across a moat runs from bank to bank at the height of the banks, not at the bed', () => {
  const s = spanAcross(0, -9, 0, 9, moat);
  assert.ok(s, 'a span');
  assert.ok(Math.abs(s.cx) < 1e-6 && Math.abs(s.cz) < 0.5, `centred on the moat: ${s.cx},${s.cz}`);
  assert.ok(s.length > 6 && s.length < 9, `bank to bank with a little on each: ${s.length}`);
  assert.equal(s.hA, 6.6); assert.equal(s.hB, 6.6);
  assert.ok(Math.abs(s.ang - Math.PI / 2) < 1e-9, 'along the line of the order');
});

test('an order that starts or ends in the water still gets a bridge from dry land to dry land', () => {
  const s = spanAcross(0, -1, 0, 4, moat);   // starts in the moat
  assert.equal(s.hA, 6.6); assert.equal(s.hB, 6.6);
  assert.ok(s.cz > -1 && s.cz < 1, `still centred on the water: ${s.cz}`);
});

test('a bridge being built grows from the near bank', () => {
  const half = spanAcross(0, -9, 0, 9, moat, 0.5), full = spanAcross(0, -9, 0, 9, moat, 1);
  assert.ok(Math.abs(half.length - full.length / 2) < 1e-6);
  assert.ok(half.cz < 0, `its middle is on the near side: ${half.cz}`);
});

test('the records have the stride and the negative index that mark them as not being buildings', () => {
  const f = soldierSpansFlat([0, -9, 0, 9], [[0, -9, 0, 9, 0.4]], moat);
  assert.equal(f.length, 20);
  assert.equal(f[0], -1); assert.equal(f[10], -2);
});

test('nothing to draw for a zero-length order', () => { assert.equal(spanAcross(1, 1, 1, 1, moat), null); });
