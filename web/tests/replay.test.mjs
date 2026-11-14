// Replaying a history must give exactly the village the live game had (compared by the core's state hash), in any order of seeking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Replay } from '../src/replay.ts';
import { applyCmd } from '../src/commands.ts';
const { World } = createRequire(import.meta.url)('./.wasm/game_core.js');

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
