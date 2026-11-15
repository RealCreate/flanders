import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BATTLE_STRIDE, parseBoss, bossTitle, bossLine, hpFraction, raidAnnouncement, lairAnnouncement, reportBoss, reportLine } from '../src/bosses.ts';

const defs = [
  { id: 1, name: 'Warlord', names: ['Garrick', 'Odo the Red', 'Hagen', 'Brun Ironhand'], hp: 520, dmg: 28, speed: 5.2, armor: 4, hornReach: 32, hornSecs: 8, slamReach: 0, gold: 260, iron: 40, desc: '' },
  { id: 2, name: 'Ogre of the Marches', names: ['Grum', 'Thokk', 'Ulg', 'Mor the Wide'], hp: 2400, dmg: 55, speed: 1.9, armor: 2, hornReach: 0, hornSecs: 0, slamReach: 3.5, gold: 220, iron: 30, desc: '' },
];

test('the battle record is fourteen numbers wide and the core says so', () => {
  assert.equal(BATTLE_STRIDE, 14);
  const lib = readFileSync(new URL('../../crates/game-core/src/lib.rs', import.meta.url), 'utf8');
  assert.match(lib, /\(stride 14\)/);
  assert.match(lib, /\.chunks\(14\)|u\.len\(\) \/ 14/);
});

test('the boss strip reads the core\'s boss record', () => {
  const b = parseBoss([1, 2, 260, 520, 0, 1]);
  assert.deepEqual(b, { kind: 1, name: 2, hp: 260, max: 520, phase: 0, alive: true });
  assert.equal(hpFraction(b), 0.5);
  assert.equal(parseBoss([]), null); assert.equal(parseBoss([0, 0, 0, 0, 0, 0]), null);
  assert.equal(bossTitle(defs, 1, 2), 'Hagen, the Warlord');
  assert.equal(bossTitle(defs, 2, 0), 'Grum, the Ogre of the Marches');
  assert.equal(bossTitle(defs, 9, 0), 'A boss');
  assert.match(bossLine(defs, b), /Hagen, the Warlord · 50%$/);
  assert.match(bossLine(defs, { ...b, phase: 1, hp: 100 }), /19% · enraged/);
  assert.match(bossLine(defs, { ...b, hp: 0, alive: false }), /fallen/);
});

test('announcements name the boss and the direction', () => {
  const b = parseBoss([1, 0, 520, 520, 0, 1]);
  assert.equal(raidAnnouncement(defs, b, 'north-west', true, 'your village'), 'Garrick, the Warlord, rides on your village from the north-west!');
  assert.match(lairAnnouncement(defs, parseBoss([2, 1, 100, 100, 0, 1])), /lair of Thokk, the Ogre of the Marches/);
});

test('a report names the boss, whether he fell and whether it was a lair', () => {
  // seq, won, tag, left, dead, lost, survivors x6, loot x12, [boss, name, fell, lair], fledA, fledD
  const rep = (tail) => [1, 1, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, ...new Array(12).fill(0), ...tail, 0, 0];
  assert.equal(reportBoss(rep([0, 0, 0, 0])), null);
  const r = reportBoss(rep([1, 3, 1, 0])); assert.deepEqual(r, { kind: 1, name: 3, fell: true, lair: false });
  assert.match(reportLine(defs, r, true), /Brun Ironhand, the Warlord, has fallen! \+260 gold, \+40 iron/);
  assert.match(reportLine(defs, reportBoss(rep([2, 0, 1, 1])), true), /Grum.*lair is cleared/);
  assert.match(reportLine(defs, reportBoss(rep([2, 0, 0, 1])), false), /held his lair/);
  assert.match(reportLine(defs, reportBoss(rep([1, 0, 0, 0])), false), /ravaged/);
  assert.equal(reportBoss([1, 2, 3]), null, 'a short report has none');
});

test('the names and numbers the screen uses come from the core\'s table', () => {
  const rs = readFileSync(new URL('../../crates/game-core/src/military.rs', import.meta.url), 'utf8');
  for (const d of defs) { assert.ok(rs.includes(`name: "${d.name}"`), d.name); for (const n of d.names) assert.ok(rs.includes(`"${n}"`), n); }
});
