// The startup must never block the page for long: histories replay and the navigation grid builds in slices, and a sliced run gives exactly the blocking result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { replayInSlices, warmNavigationInSlices, collectInSlices } from '../src/loader.ts';
import { applyCmd, stepTo } from '../src/commands.ts';
const core = createRequire(import.meta.url)('./.wasm/game_core.js');
const { World } = core;

/** A history with enough building in it to cost something to replay. */
function history() {
  const w = new World(1337n, 0, 0), cmds = []; let n = 0;
  const do_ = (c) => { const full = { ...c, tick: Number(w.tick()), n: n++ }; applyCmd(w, full); cmds.push(full); };
  do_({ op: 'cheat', kind: 3, x: 0, y: 0 });
  for (let i = 0; i < 60; i++) { for (let k = 0; k < 25; k++) w.step(); do_({ op: 'place', kind: i % 4 === 0 ? 1 : 0, x: (i % 10) * 13 - 60, y: Math.floor(i / 10) * 13 - 40, rot: 0 }); }
  for (let k = 0; k < 400; k++) w.step();
  return { cmds, final: Number(w.tick()), hash: w.state_hash() };
}
const blocking = (cmds, final) => { const w = new World(1337n, 0, 0); for (const c of cmds) { stepTo(w, c.tick); applyCmd(w, c); } stepTo(w, final); return w; };

test('a history replayed in slices is the very same village as one replayed in a blocking loop', async () => {
  const { cmds, final, hash } = history();
  assert.equal(blocking(cmds, final).state_hash(), hash);
  for (const budgetMs of [0, 1, 5, 1e9]) {   // 0: yield after every command; 1e9: never yield
    const w = new World(1337n, 0, 0); let yields = 0;
    const r = await replayInSlices(w, cmds, applyCmd, final, { budgetMs, yieldFn: async () => { yields++; } });
    assert.ok(r.ok); assert.equal(Number(w.tick()), final);
    assert.equal(w.state_hash(), hash, `budget ${budgetMs} ms`);
    if (budgetMs === 0) assert.ok(yields >= cmds.length, 'it gave the thread back after every command');
    if (budgetMs === 1e9) assert.equal(yields, 0);
  }
});

test('a cancelled replay stops and says so', async () => {
  const { cmds, final } = history(); let n = 0;
  const r = await replayInSlices(new World(1337n, 0, 0), cmds, applyCmd, final, { budgetMs: 0, yieldFn: async () => {}, cancelled: () => ++n > 3 });
  assert.equal(r.ok, false);
});

test('the navigation grid builds in slices, each short, and the heavy startup work yields often', async () => {
  const seed = 31337n; let yields = 0;
  const t0 = performance.now();
  const r = await warmNavigationInSlices(core.warm_navigation_step, seed, { budgetMs: 12, yieldFn: async () => { yields++; } });
  const total = performance.now() - t0;
  // CI machines are slow and noisy: the budget is generous. The point is that the work is cut up, not blocking for seconds.
  assert.ok(r.slices >= 20, `built in ${r.slices} slices (${total.toFixed(0)} ms in all)`);
  assert.ok(r.longestMs < 400, `longest stretch without yielding was ${r.longestMs.toFixed(0)} ms`);
  assert.equal(core.warm_navigation_step(seed, 4), 1, 'once built it stays built');
  // a village (placing and stepping) works on the grid that was built that way
  const w = new World(seed, 0, 0); w.cheat(3, 0, 0); for (let i = 0; i < 50; i++) w.step();
  assert.ok(w.state_hash());
});

test('the ground and the forest fetched in slices are exactly what the whole-map calls return', async () => {
  const seed = 5n, HALF = 300, STEP = 2.5, NV = Math.round((HALF * 2) / STEP) + 1;
  const g = await collectInSlices(NV, (a, b) => core.terrain_grid_rows(seed, -HALF, -HALF, NV, STEP, a, b), 7, { budgetMs: 0, yieldFn: async () => {} });
  assert.deepEqual(g, core.terrain_grid(seed, -HALF, -HALF, NV, NV, STEP));
  const rows = core.trees_in_row_count(-HALF, HALF);
  const t = await collectInSlices(rows, (a, b) => core.trees_in_rows(seed, -HALF, -HALF, HALF, a, b), 5, { budgetMs: 0, yieldFn: async () => {} });
  assert.ok(t.length > 0); assert.deepEqual(t, core.trees_in(seed, -HALF, -HALF, HALF, HALF));
});
