// The command screen's roster maths and markup (src/ui/commandscreen.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sideSummary, rosterHtml, strengthHtml, ROSTER_STRIDE, ROSTER_KINDS } from '../src/ui/commandscreen.ts';

const roster = () => new Float32Array(2 * ROSTER_KINDS * ROSTER_STRIDE);
const put = (f, side, kind, v) => f.set(v, (side * ROSTER_KINDS + kind) * ROSTER_STRIDE);

test('a side lists only the troop types it still has and totals them', () => {
  const f = roster();
  put(f, 0, 0, [4, 200, 280, 0, 0, 1, 0.9]);
  put(f, 0, 1, [2, 30, 90, 1, 0, 0, 0.3]);
  put(f, 1, 3, [3, 510, 510, 0, 0, 0, 1]);
  const mine = sideSummary(f, 0);
  assert.deepEqual(mine.rows.map(r => r.name), ['Spearmen', 'Archers']);
  assert.equal(mine.alive, 6); assert.equal(mine.hp, 230); assert.equal(mine.maxHp, 370); assert.equal(mine.running, 1);
  assert.ok(Math.abs(mine.morale - (4 * 0.9 + 2 * 0.3) / 6) < 1e-6, 'morale is the average over the men');
  assert.equal(sideSummary(f, 1).rows[0].name, 'Knights');
  assert.equal(sideSummary(new Float32Array(0), 0).alive, 0, 'an empty roster is an empty side');
});

test('the roster shows health, morale, veterans and who is fleeing', () => {
  const f = roster(); put(f, 0, 0, [4, 100, 280, 1, 0, 2, 0.5]);
  const html = rosterHtml(sideSummary(f, 0), k => `<i>${k}</i>`);
  assert.match(html, /Spearmen/); assert.match(html, /★2/); assert.match(html, /1 fleeing/); assert.match(html, /Health 36%/); assert.match(html, /Morale 50%/);
  assert.match(rosterHtml(sideSummary(roster(), 0), () => ''), /No soldiers/);
});

test('the strength line names both sides', () => {
  const f = roster(); put(f, 0, 0, [4, 280, 280, 0, 0, 0, 1]); put(f, 1, 0, [2, 70, 140, 0, 0, 0, 0.4]);
  const html = strengthHtml(sideSummary(f, 0), sideSummary(f, 1), 'Defenders', 'Bandits');
  assert.match(html, /Defenders/); assert.match(html, /Bandits/); assert.match(html, /4 men/); assert.match(html, /2 men/);
});

import { armyCardHtml } from '../src/ui/commandscreen.ts';
test('the card of a selected army lists its troops and offers orders', () => {
  const one = armyCardHtml({ title: 'Army 3', units: [8, 3, 0, 0, 0, 0], state: 'Marching (40%)', armies: 1 }, k => `<i>${k}</i>`);
  assert.match(one, /Army 3/); assert.match(one, /11 soldiers · Marching/); assert.match(one, /Spearmen/); assert.match(one, /Archers/); assert.doesNotMatch(one, /Knights/);
  assert.match(one, /data-army="split"/);
  const many = armyCardHtml({ title: '2 armies', units: [4, 0, 0, 1, 0, 0], state: '', armies: 2 }, () => '');
  assert.doesNotMatch(many, /data-army="split"/); assert.match(many, /data-army="halt"/);
});
