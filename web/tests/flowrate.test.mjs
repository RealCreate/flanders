import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLedger, steadyRate, fmtRate, daysLeft, fmtDaysLeft, breakdown, perDay, categoryKey, MIN_TICKS, EXTRA_INFO } from '../src/flowrate.ts';
import { ICON_NAMES } from '../src/ui/icons.ts';

const EXTRAS = ['villagers', 'soldiers', 'winter', 'backup', 'doves', 'tax', 'tithe', 'toll', 'port', 'harvest', 'merchants', 'orders', 'other'];
const NK = 41, GR = 10;
const ex = k => NK + EXTRAS.indexOf(k);
const make = (covered, rows) => parseLedger([covered, NK, EXTRAS.length, ...rows.flat()], EXTRAS);

test('a day of grain: farms in, villagers and soldiers out', () => {
  const d = make(240, [[1, GR, 300, 0], [ex('villagers'), GR, 0, 220], [ex('soldiers'), GR, 0, 50]]);
  assert.equal(steadyRate(d, GR), 30);
  const b = breakdown(d, GR, c => (c === 1 ? 4 : 0));
  assert.deepEqual(b.sources.map(r => [r.key, r.perDay, r.count]), [['b1', 300, 4]]);
  assert.deepEqual(b.sinks.map(r => r.key), ['villagers', 'soldiers']);
  assert.equal(b.net, 30);
});

test('the rate is a whole day whatever part of it has been seen', () => {
  assert.equal(perDay(60, 60), 240);
  assert.equal(steadyRate(make(120, [[1, GR, 60, 0]]), GR), 120);
  assert.equal(steadyRate(make(MIN_TICKS - 1, [[1, GR, 60, 0]]), GR), 0, 'too little seen to say');
});

test('a raid or a purchase does not make the steady rate jump', () => {
  const calm = make(240, [[1, GR, 300, 0], [ex('villagers'), GR, 0, 260]]);
  const raided = make(240, [[1, GR, 300, 0], [ex('villagers'), GR, 0, 260], [ex('other'), GR, 0, 200], [ex('orders'), GR, 0, 80]]);
  assert.equal(steadyRate(calm, GR), steadyRate(raided, GR));
  const b = breakdown(raided, GR);
  assert.equal(b.steady, 40); assert.equal(b.net, -240, 'the panel still shows everything');
  assert.ok(b.sinks.some(r => r.key === 'other'));
});

test('other resources are left out of a resource breakdown', () => {
  const d = make(240, [[1, GR, 300, 0], [ex('winter'), 0, 0, 90], [3, 0, 120, 30]]);
  assert.equal(steadyRate(d, 0), 0); assert.equal(steadyRate(d, GR), 300);
  assert.deepEqual(breakdown(d, 0).sinks.map(r => r.key), ['winter', 'b3']);
  assert.equal(categoryKey(d, ex('tax')), 'tax');
});

test('formatting and days of supply', () => {
  assert.equal(fmtRate(12), '+12/day'); assert.equal(fmtRate(-3.4), '−3/day'); assert.equal(fmtRate(0.2), '±0/day');
  assert.equal(daysLeft(100, -25), 4); assert.equal(daysLeft(100, -5), 20); assert.equal(daysLeft(100, 0), null); assert.equal(daysLeft(0, -5), null); assert.equal(daysLeft(10, 3), null);
  assert.equal(fmtDaysLeft(4), 'about 4.0 days'); assert.equal(fmtDaysLeft(20.2), 'about 20 days'); assert.equal(fmtDaysLeft(0.01), 'less than a tenth of a day');
});

test('an empty ledger is harmless', () => {
  const d = parseLedger([], EXTRAS); assert.equal(steadyRate(d, GR), 0); assert.deepEqual(breakdown(d, GR).sources, []);
});

test('every extra category has a label and a drawn icon', () => {
  for (const k of EXTRAS) { assert.ok(EXTRA_INFO[k], k); assert.ok(ICON_NAMES.includes(EXTRA_INFO[k].icon), `${k}: ${EXTRA_INFO[k].icon}`); }
});
