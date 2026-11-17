// The headless game: it must play by the core's rules, save and load exactly, offer no cheats, and keep every reply small.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Game } from '../engine.mjs';

const size = v => JSON.stringify(v).length;

/** A small opening played through the same entry point the MCP tools use. */
function opening(g) {
  const r = [
    g.act(['place', 0, 12, 4, 0, 6]), g.act(['place', 0, 18, 8, 0, 6]), g.act(['place', 0, 22, -2, 0, 6]),
    g.act(['place', 1, -14, 6, 0, 8]), g.act(['place', 4, 20, -14, 0, 12]),
  ];
  return r;
}

test('a new game opens with a compact status and goals', () => {
  const g = new Game({ world: 'test-a' });
  const s = g.status();
  assert.ok(s.pop >= 2 && s.stock.length === 17 && s.next?.length > 0);
  assert.ok(size(s) < 900, `status is ${size(s)} characters`);
});

test('static data is small and on demand', () => {
  const g = new Game({ world: 'test-a' });
  assert.ok(size(g.info()) < 1900, `the building table is ${size(g.info())} characters`);
  const one = g.info(6, true);
  assert.equal(one.name, 'Quarry'); assert.ok(size(one) < 700);
  assert.ok(g.info(999).e);
  assert.ok(size(g.unitTable()) < 400);
});

test('building works through the core, with a clear reason when it is refused', () => {
  const g = new Game({ world: 'test-a' });
  const r = opening(g);
  assert.ok(r.filter(x => x.ok).length >= 3, JSON.stringify(r));
  assert.equal(g.act(['place', 15, 5, 5]).ok, false, 'the hall cannot be built');
  assert.equal(g.act(['place', 0, 9999, 9999]).e, 'outside border');
  assert.equal(g.act(['up', 9999]).ok, false);
  assert.equal(g.act(['demo', 3]).ok, false, 'demolishing needs the confirming true');
  assert.equal(g.act(['place', 'x', 1, 1]).e, 'bad arguments');
});

test('there is no way to cheat', () => {
  const g = new Game({ world: 'test-a' });
  for (const op of ['cheat', 'flatten', 'demo_village', 'give', 'speed', 'reset', 'demo0']) assert.match(g.act([op, 0, 0, 100]).e, /unknown action|demolish needs/);
  const before = g.status().stock.join();
  g.act(['place', 0, 12, 4]);   // costs wood: nothing is free
  assert.notEqual(g.status().stock.join(), before);
});

test('time passes, stops at important events, and the reply stays small', () => {
  const g = new Game({ world: 'test-a' }); opening(g);
  const r = g.advance(300, false);
  assert.equal(r.ticks, 300); assert.equal(g.tick, 300);
  const stop = new Game({ world: 'test-a' }); opening(stop);
  let paused = false; for (let i = 0; i < 40 && !paused; i++) { const x = stop.advance(600, true); paused = x.stopped; if (paused) assert.ok(x.events.length > 0 && x.ticks <= 600); }
  assert.ok(size(g.status()) < 900);
});

test('looking is paged and compact', () => {
  const g = new Game({ world: 'test-a' }); opening(g); g.advance(20, false);
  const b = g.buildings({ limit: 3 });
  assert.equal(b.rows.length, 3); assert.ok(b.total >= 5 && b.more >= 1 && b.by[0] >= 2);
  assert.ok(size(g.buildings()) < 1500, `buildings page: ${size(g.buildings())}`);
  const land = g.land({ half: 20, step: 4 });
  assert.equal(land.rows.length, 11); assert.ok(size(land) < 800, `land: ${size(land)}`);
  assert.ok(Array.isArray(g.deposits()));
});

test('a mine snaps onto the deposit it works', () => {
  const g = new Game({ world: 'test-a' });
  const dep = g.deposits({ limit: 8 }).find(d => d[0] === 0);   // stone
  assert.ok(dep, 'a stone deposit near the hall');
  const sn = g.snap(6, dep[1], dep[2]);
  assert.ok(sn, 'a quarry snaps to it');
  const r = g.act(['place', 6, dep[1], dep[2], 0, 4]);
  // the snapped spot may still be refused (border, funds); if it was built it stands beside the deposit
  if (r.ok) assert.ok(Math.hypot(r.at[0] - dep[1], r.at[1] - dep[2]) < 7, `quarry at ${r.at} for deposit ${dep}`);
  else assert.ok(['outside border', 'not enough resources', 'blocked', 'too steep', 'water'].includes(r.e), r.e);
});

test('a saved game continues exactly where it stopped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flanders-'));
  try {
    const file = join(dir, 'g.json');
    const a = new Game({ world: 'test-b', save: file });
    opening(a); a.advance(240, false); a.act(['place', 0, 26, 6, 0, 8]); a.advance(240, false); a.act(['field', 3, 2]); a.advance(120, false); a.save();
    const b = new Game({ world: 'test-b', save: file });
    assert.equal(b.tick, a.tick, 'same time');
    assert.equal(b.world.state_hash(), a.world.state_hash(), 'same village, to the last number');
    assert.deepEqual(b.log, a.log);
    assert.throws(() => new Game({ world: 'other', save: file }), /another world/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the same world name is the same map', () => {
  const a = new Game({ world: 'Test-A' }), b = new Game({ world: 'test-a' });
  assert.equal(a.world.state_hash(), b.world.state_hash());
  assert.notEqual(new Game({ world: 'test-c' }).origin.x + ',' + new Game({ world: 'test-c' }).origin.z, 'x');
});

test('a whole first season can be played in a handful of small calls', () => {
  const g = new Game({ world: 'test-d' });
  let chars = size(g.status()) + size(g.info());
  const batch = [['place', 0, 12, 4, 0, 8], ['place', 0, 18, 8, 0, 8], ['place', 0, 24, 2, 0, 8], ['place', 1, -14, 6, 0, 8], ['place', 4, 20, -14, 0, 12], ['place', 0, 12, 14, 0, 8]];
  chars += size(batch) + size(batch.map(a => g.act(a).ok ? 1 : 'no'));
  let calls = 0; while (g.tick < 1800 && calls++ < 60) { const r = g.advance(200, true); chars += 120 + size(r.events); }   // (an advance pauses at raids, fires and famine, so it can take a few more calls)
  assert.ok(g.tick >= 1800, 'time ran on');
  assert.ok(chars < 9000, `about ${chars} characters of traffic in ${calls} advances for the opening 7 days`);
});

test('a boss leading a raid shows in the status, and the battle data is fourteen numbers a soldier', () => {
  const g = new Game({ world: 'test-boss' });
  assert.equal(g.status().boss, undefined, 'no boss in peace');
  assert.ok(g.world.cheat(10, 120, 500), 'a warlord raid (the testing tool the engine itself never offers)');
  const s = g.status(); assert.equal(s.boss?.kind, 'warlord'); assert.ok(s.boss.hp > 300 && s.boss.alive && !s.boss.lair);
  const flat = g.world.battle_units_flat(); assert.equal(flat.length % 14, 0); assert.ok(flat.length >= 14 * 8);
  let bosses = 0; for (let i = 0; i < flat.length; i += 14) if (flat[i + 10] > 0) bosses++;
  assert.equal(bosses, 1, 'exactly one boss on the field');
  assert.ok(size(s) < 900, `status with a boss is ${size(s)} characters`);
});

test('a raid can be bought off through the engine: the price is in the status, gold is paid, the raiders leave', () => {
  const g = new Game({ world: 'test-bribe' });
  assert.equal(g.act(['bribe']).ok, false, 'nothing to buy off in peace');
  assert.ok(g.world.cheat(4, 120, 400), 'a bandit raid (the testing tool the engine itself never offers)');
  const s = g.status(); assert.ok(s.attack_price >= 40, 'the price is shown while a raid can be bought off');
  assert.equal(g.act(['bribe']).e?.startsWith('not enough gold'), true, 'a poor village is refused with the price');
  g.world.cheat(0, 8, 5000);
  const before = Array.from(g.world.stocks())[8];
  const r = g.act(['bribe']); assert.equal(r.ok, true);
  assert.equal(Array.from(g.world.stocks())[8], before - s.attack_price);
  assert.equal(g.act(['bribe']).ok, false, 'only once');
  for (let i = 0; i < 20 && g.world.battle_active(); i++) g.advance(1, true);
  assert.equal(g.world.battle_active(), false, 'the raiders went away');
});
