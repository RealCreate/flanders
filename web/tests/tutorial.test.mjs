import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, stepAfter, loadProgress } from '../src/tutorial.ts';

const counts = (n = {}, o = {}) => ({ n: k => n[k] ?? 0, pop: 10, hall: 0, army: 0, rivals: 0, ...o });

test('every step has a title and text, and the conditions are functions', () => {
  assert.ok(STEPS.length >= 10);
  for (const s of STEPS) { assert.ok(s.title && s.text); assert.ok(s.done === undefined || typeof s.done === 'function'); }
});
test('a new village stays on the first (waiting) step', () => { assert.equal(stepAfter(0, counts()), 0); });
test('a step completes when the village has what it asks for, and the guide moves on', () => {
  const house = STEPS.findIndex(s => s.title === 'A home for new villagers');
  assert.equal(stepAfter(house, counts()), house);
  assert.equal(STEPS[stepAfter(house, counts({ 0: 1 }))].title, 'Grain for the table');
});
test('it skips ahead past several finished steps but stops at one that waits for Next', () => {
  const house = STEPS.findIndex(s => s.title === 'A home for new villagers');
  const after = stepAfter(house, counts({ 0: 5, 1: 1, 4: 1, 5: 1 }));
  assert.ok(!STEPS[after].done, 'it stops at an information step: ' + STEPS[after].title);
  assert.ok(after > house + 2);
});
test('finishing every step ends the guide', () => {
  const all = counts({ 0: 9, 1: 9, 3: 1, 4: 1, 5: 1, 6: 1, 16: 1, 19: 1 }, { pop: 40, hall: 3, army: 20 });
  let s = 0; for (let i = 0; i < STEPS.length * 2; i++) { s = stepAfter(s, all); if (s < STEPS.length && !STEPS[s].done) s++; }
  assert.equal(s, STEPS.length);
});
test('saved progress is read back safely', () => {
  const st = v => ({ getItem: () => v });
  assert.equal(loadProgress(st(null)), null); assert.equal(loadProgress(st('done')), 'done'); assert.equal(loadProgress(st('skipped')), 'skipped');
  assert.deepEqual(loadProgress(st('3')), { step: 3 });
  for (const bad of ['-1', '99', 'abc', '2.5', '']) assert.equal(loadProgress(st(bad)), null, bad);
  assert.equal(loadProgress({ getItem: () => { throw new Error('blocked'); } }), null);
});

import { fillKeys } from '../src/tutorial.ts';
test('key names in the guide come from the player\'s own bindings', () => {
  assert.equal(fillKeys('Press {deposits} then {photo}'), 'Press V then F9');
  assert.equal(fillKeys('Press {deposits}', a => (a === 'deposits' ? 'K' : '?')), 'Press K');
  for (const s of STEPS) assert.ok(!/\{\w+\}/.test(fillKeys(s.text)), 'unfilled placeholder in: ' + s.title);
  assert.ok(STEPS.some(s => s.text.includes('{panUp}')), 'the camera step names the movement keys');
});
