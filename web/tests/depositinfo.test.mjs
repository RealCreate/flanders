import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPercent, wakeProgress, daysUntilEmpty, fmtDays, depositLabel, parseBuildingDeposit, depositPanel, WAKE_PCT } from '../src/depositinfo.ts';

const dep = (rem, max, asleep = false) => ({ rem, max, asleep });
const dot = '·';

test('fill level is a clamped percentage and a cleared deposit is empty', () => {
  assert.equal(fillPercent(dep(3000, 6000)), 50);
  assert.equal(fillPercent(dep(7000, 6000)), 100);
  assert.equal(fillPercent(dep(0, 0)), 0);
});
test('a dormant deposit shows how far it is from waking', () => {
  assert.equal(wakeProgress(dep(0, 1000, true)), 0);
  assert.equal(wakeProgress(dep(75, 1000, true)), 50);   // 7.5% of the maximum is halfway to the wake threshold
  assert.equal(wakeProgress(dep(500, 1000, false)), 100);
  assert.equal(WAKE_PCT, 15);
});
test('days until empty', () => {
  assert.equal(daysUntilEmpty(dep(900, 6000), 90), 10);
  assert.equal(daysUntilEmpty(dep(900, 6000), 0), Infinity);
  assert.equal(fmtDays(Infinity), 'never'); assert.equal(fmtDays(0.4), 'under a day'); assert.equal(fmtDays(2.54), '2.5 days'); assert.equal(fmtDays(66.2), '66 days');
});
test('labels say dormant, recovering for a used-up deposit and the amount otherwise', () => {
  assert.equal(depositLabel('Stone outcrop', dep(0, 6000, true)), `Stone outcrop ${dot} dormant, recovering 0%`);
  assert.equal(depositLabel('Stone outcrop', dep(300, 6000, true)), `Stone outcrop ${dot} dormant, recovering 5%`);
  assert.equal(depositLabel('Clay bank', dep(4000, 9000)), `Clay bank ${dot} 4000 / 9000`);
  assert.equal(depositLabel('Clay bank', dep(0, 0)), `Clay bank ${dot} cleared`);
});
test('a mine panel reads the core numbers', () => {
  assert.equal(parseBuildingDeposit([]), null);
  const d = parseBuildingDeposit([3, 5400, 6000, 0, 90]);
  assert.deepEqual(d, { index: 3, rem: 5400, max: 6000, asleep: false, perDay: 90 });
  const p = depositPanel(d); assert.equal(p.fill, 90); assert.equal(p.headline, '5400 / 6000 left'); assert.match(p.detail, /60 days/);
  const z = depositPanel({ ...d, rem: 120, asleep: true }); assert.equal(z.headline, 'Dormant, regrowing: 2%');
});
