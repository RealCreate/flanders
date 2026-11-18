// Replaying a history must give exactly the village the live game had (compared by the core's state hash), in any order of seeking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Replay } from '../src/replay.ts';
import { applyCmd } from '../src/commands.ts';
const { World, world_restore } = createRequire(import.meta.url)('./.wasm/game_core.js');

/** Play a short game live, recording the commands the way the client does (apply, then log with the tick it happened at). */
function live() {
  const w = new World(1337n, 0, 0), cmds = []; let n = 0;
  const do_ = (c) => { const full = { ...c, tick: Number(w.tick()), n: n++ }; applyCmd(w, full); cmds.push(full); };
  const run = (k) => { for (let i = 0; i < k; i++) w.step(); };
  w.cheat(3, 0, 0);
  do_({ op: 'cheat', kind: 3, x: 0, y: 0 });
  run(5); do_({ op: 'place', kind: 0, x: 12, y: 4, rot: 0 });
  run(30); do_({ op: 'place', kind: 1, x: -14, y: 6, rot: 0 });
  run(100); do_({ op: 'place', kind: 0, x: 18, y: 8, rot: 0 }); do_({ op: 'upgrade', idx: 1 });
  run(200); do_({ op: 'field', idx: 2, kind: 1 });
  run(150);
  return { w, cmds, final: Number(w.tick()) };
}
const source = (cmds) => ({ make: () => new World(1337n, 0, 0), apply: applyCmd, cmds });

test('replaying all of a history reproduces the live village exactly', () => {
  const { w, cmds, final } = live();
  const r = new Replay(source(cmds), final);
  const out = r.advanceTo(final);
  assert.ok(out.reached); assert.equal(r.tick, final);
  assert.equal(r.world.state_hash(), w.state_hash());
});
test('seeking forwards, backwards and forwards again gives the same village at the same tick', () => {
  const { w, cmds, final } = live();
  const r = new Replay(source(cmds), final);
  r.advanceTo(100); const mid = r.world.state_hash(); const midTick = r.tick;
  r.advanceTo(final); assert.equal(r.world.state_hash(), w.state_hash());
  const back = r.advanceTo(100); assert.ok(back.rewound); assert.equal(r.tick, midTick); assert.equal(r.world.state_hash(), mid);
  r.advanceTo(final); assert.equal(r.world.state_hash(), w.state_hash());
});
test('a time budget makes it advance in pieces without losing its place', () => {
  const { w, cmds, final } = live();
  const r = new Replay(source(cmds), final);
  let t = 0, calls = 0; const clock = () => (t += 1);   // every look at the clock costs 1ms: a 3ms budget stops after a few batches
  while (!r.advanceTo(final, 3, clock).reached && calls++ < 10000);
  assert.ok(calls >= 1, 'it took more than one call'); assert.equal(r.world.state_hash(), w.state_hash());
});
test('it never runs past the end of the history, and an empty history is just the empty map', () => {
  const { cmds, final } = live(); const r = new Replay(source(cmds), final);
  r.advanceTo(final + 99999); assert.equal(r.tick, final);
  const e = new Replay(source([])); e.advanceTo(50); assert.equal(e.tick, 0);
});
test('the callback fires when a rewind replaces the world', () => {
  const { cmds, final } = live(); const r = new Replay(source(cmds), final); let seen = 0; r.onWorld = () => seen++;
  r.advanceTo(final); assert.equal(seen, 0); r.advanceTo(10); assert.equal(seen, 1);
});

test('a history preserves both chosen heights and older automatic earthworks', () => {
  const RAISE = 33, LOWER = 34;
  const cmds = [
    { op: 'cheat', kind: 3 },
    { op: 'flatten', x: 55, y: 60 },
    { op: 'place', kind: RAISE, x: 28, y: 24, h: 9.5 },
    { op: 'batch', units: [LOWER, 28, -22, 0, LOWER, 36, -22, 0], h: 3.5 },
    { op: 'place', kind: RAISE, x: -26, y: -24 },
  ].map((cmd, tick) => ({ ...cmd, tick, n: tick }));
  const r = new Replay(source(cmds), cmds.length);
  assert.ok(r.advanceTo(cmds.length).reached);
  assert.equal(r.world.height_at(28, 24), 9.5);
  assert.equal(r.world.height_at(28, -22), 3.5);
  assert.equal(r.world.height_at(36, -22), 3.5);
  assert.ok(Math.abs(r.world.height_at(-26, -24) - 8.2) < 0.01);
});

test('research, bridge policy and battle orders replay and checkpoint in a running fight', () => {
  const cmds = [
    { op: 'cheat', kind: 3 },
    { op: 'place', kind: 19, x: -20, y: 16 },
    { op: 'research', kind: 0 },
    { op: 'armybridge', kind: 1 },
    { op: 'raid', tag: 25, units: [8, 3, 0, 2, 0, 0], tech: 32 },
    { op: 'battleorder', idx: 2, kind: 2, x: 15, y: 15, tag: 25 },
    { op: 'battleorder', idx: 4, kind: 1, x: 10, y: 10 },
  ].map((cmd, tick) => ({ ...cmd, tick, n: tick }));
  const r = new Replay(source(cmds), 25);
  assert.ok(r.advanceTo(12).reached);
  assert.ok(r.world.battle_active());
  assert.equal(r.world.military_tech(), 1);
  assert.ok(r.world.army_bridge_shortcuts());
  const resumed = world_restore(r.world.snapshot());
  assert.ok(resumed);
  while (resumed.tick() < 25n) resumed.step();
  assert.ok(r.advanceTo(25).reached);
  assert.equal(resumed.state_hash(), r.world.state_hash());
});
