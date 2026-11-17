import test from 'node:test';
import assert from 'node:assert/strict';
import { moatDiscs } from '../src/render/moatwater.ts';

test('each moat piece gets a disc at the core level, a little wider than the ditch', () => {
  const d = moatDiscs([10, 20, 4.6, 3.2, -5, 6, 4.6, 2.9]);
  assert.equal(d.length, 2); assert.ok(Math.abs(d[0][2] - 5.2) < 1e-9 && d[0][3] === 3.2 && d[1][0] === -5 && d[1][3] === 2.9);
});
test('the top surface never rises above the level the core allows for a piece (bank samples)', () => {
  const flat = []; const banks = [];
  for (let i = 0; i < 30; i++) { const bank = 2 + Math.sin(i) * 1.5; const level = bank - 0.8; banks.push(bank); flat.push(i * 4, 0, 4.6, level); }
  moatDiscs(flat).forEach((disc, i) => assert.ok(disc[3] <= banks[i] - 0.8 + 1e-6, `piece ${i}`));
});
test('broken pieces are skipped, not drawn', () => {
  assert.equal(moatDiscs([0, 0, 0, 1, 0, 0, 4.6, NaN]).length, 0);
});
