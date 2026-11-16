import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWinter, winterTip, winterWarning, winterLines } from '../src/winter.ts';
import { ICONS } from '../src/ui/icons.ts';

//        grain hay perDay left cold warm grace death toWinter beds sheds hearth unhappy wood left saves heads step max hosp perLog
const mk = o => parseWinter(Object.assign([55, 85, 72, 100, 0, 1, 3, 0, 12, 0, 0, 1, 0, 720, 0, 0, 14, 15, 60, 2, 6], o));
test('the numbers are named in the core order', () => {
  const w = mk({}); assert.equal(w.grain, 55); assert.equal(w.grainHay, 85); assert.equal(w.warm, true); assert.equal(w.shedsPerLog, 6); assert.equal(w.heads, 14);
});
test('the tooltip tells the grain yield, the firewood and the days left, in autumn and in winter', () => {
  const t = winterTip(mk({}), 2); assert.match(t, /12 days until winter/); assert.match(t, /55%/); assert.match(t, /72\/day/); assert.match(t, /10 days/);
  assert.match(winterTip(mk({ 5: 0, 4: 2, 14: 8 }), 3), /COLD for 2 days/);
});
test('the warning comes a season ahead and again on the last day, and says when the wood will not last', () => {
  assert.equal(winterWarning(mk({}), 1, 1), null); assert.equal(winterWarning(mk({}), 2, 5), null);
  assert.match(winterWarning(mk({ 8: 10 }), 2, 1).text, /Winter comes in 10 days/);
  const low = winterWarning(mk({ 3: 40 }), 2, 10); assert.equal(low.tone, 'bad'); assert.match(low.text, /not enough/);
  assert.equal(winterWarning(mk({ 3: 400 }), 2, 10).tone, 'info');
});
test('the panel lists the grain, firewood, days left, the cold and what helps, with drawn icons only', () => {
  const lines = winterLines(mk({}), 40, 2); assert.equal(lines.length, 5);
  assert.match(lines[0].title, /55%/); assert.match(lines[1].title, /72 a day for 40/); assert.match(lines[2].title, /10 days/); assert.match(lines[3].text, /grows by 15%/);
  for (const l of lines) { assert.ok(ICONS[l.icon], l.icon); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(l.title + l.text)); }
  assert.equal(winterLines(mk({ 3: 20 }), 40, 2)[2].tone, 'bad');
});
