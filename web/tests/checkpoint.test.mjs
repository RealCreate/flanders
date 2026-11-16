// A checkpoint is a shortcut for replaying a history: resuming from one must give exactly the village a full replay gives, and a checkpoint that does not belong to the history is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { replayInSlices } from '../src/loader.ts';
import { checkpointFits, resumeFromCheckpoint, checksum } from '../src/checkpoint.ts';
import { applyCmd, stepTo } from '../src/commands.ts';
const core = createRequire(import.meta.url)('./.wasm/game_core.js');
const { World, world_restore } = core;

function history(n = 50) {
  const w = new World(1337n, 0, 0), cmds = []; let k = 0;
  const do_ = (c) => { const full = { ...c, tick: Number(w.tick()), n: k++ }; applyCmd(w, full); cmds.push(full); };
  do_({ op: 'cheat', kind: 3, x: 0, y: 0 });
  for (let i = 0; i < n; i++) { for (let t = 0; t < 30; t++) w.step(); do_({ op: 'place', kind: i % 4 === 0 ? 1 : 0, x: (i % 10) * 13 - 60, y: Math.floor(i / 10) * 13 - 40, rot: 0 }); }
  for (let t = 0; t < 300; t++) w.step();
  return { cmds, final: Number(w.tick()), hash: w.state_hash(), roads: Array.from(w.roads_flat()) };
}
const fast = { budgetMs: 1e9, yieldFn: async () => {} };

test('resuming from a checkpoint in the middle of a history gives the village a full replay gives', async () => {
  const { cmds, final, hash, roads } = history();
  for (const cut of [1, 17, cmds.length - 1, cmds.length]) {
    const part = new World(1337n, 0, 0);
    for (const c of cmds.slice(0, cut)) { stepTo(part, c.tick); applyCmd(part, c); }   // (the world as it was when the checkpoint was taken)
    const back = world_restore(part.snapshot());
    assert.ok(back, 'it restores'); assert.equal(back.state_hash(), part.state_hash());
    const r = await replayInSlices(back, cmds.slice(cut), applyCmd, final, fast);
    assert.ok(r.ok); assert.equal(back.state_hash(), hash, `cut at ${cut}`);
    assert.deepEqual(Array.from(back.roads_flat()), roads, `roads, cut at ${cut}`);
  }
});

test('a checkpoint is used only for the history it belongs to', () => {
  const h = [{ cmd: 'a', tick: 1 }, { cmd: 'b', tick: 5 }, { cmd: 'c', tick: 9 }];
  const now = { rules: 'r1', v: 3, site: 2 };
  const cp = (o = {}) => ({ meta: { rules: 'r1', v: 3, site: 2, cmds: 2, lastCmd: 'b', tick: 7, savedAt: 0, hash: '1', sum: 0, ...o }, bytes: new Uint8Array(4) });
  assert.equal(checkpointFits(cp(), now, h), true);
  assert.equal(checkpointFits(null, now, h), false);
  assert.equal(checkpointFits(cp({ rules: 'r2' }), now, h), false, 'other rules');
  assert.equal(checkpointFits(cp({ v: 4 }), now, h), false, 'other protocol');
  assert.equal(checkpointFits(cp({ site: 1 }), now, h), false, 'other site');
  assert.equal(checkpointFits(cp({ lastCmd: 'x' }), now, h), false, 'another history');
  assert.equal(checkpointFits(cp({ cmds: 4 }), now, h), false, 'more commands than the history has');
  assert.equal(checkpointFits(cp({ cmds: 0 }), now, h), false);
  assert.equal(checkpointFits(cp({ tick: 2 }), now, h), false, 'earlier than its own last command');
});

test('a damaged or mismatched checkpoint falls back (null), a good one resumes, and an old save without one is just a full replay', async () => {
  const { cmds, final, hash } = history(20);
  const part = new World(1337n, 0, 0);
  for (const c of cmds.slice(0, 10)) { stepTo(part, c.tick); applyCmd(part, c); }
  const now = { rules: 'r', v: 1, site: 0 }, hist = cmds.map(c => ({ cmd: JSON.stringify(c), tick: c.tick }));
  const bytes = part.snapshot();
  const cp = (b, o = {}) => ({ meta: { rules: 'r', v: 1, site: 0, cmds: 10, lastCmd: hist[9].cmd, tick: Number(part.tick()), savedAt: 0, hash: String(part.state_hash()), sum: checksum(bytes), ...o }, bytes: b });
  const restore = (b) => world_restore(b);
  const good = resumeFromCheckpoint(cp(bytes), now, hist, restore);
  assert.ok(good, 'a good checkpoint resumes');
  assert.ok((await replayInSlices(good, cmds.slice(10), applyCmd, final, fast)).ok); assert.equal(good.state_hash(), hash);
  assert.equal(resumeFromCheckpoint(cp(bytes, { hash: '12345' }), now, hist, restore), null, 'the hash does not come out');
  const flipped = bytes.slice(); flipped[Math.floor(flipped.length / 2)] ^= 0xff;
  assert.equal(resumeFromCheckpoint(cp(flipped), now, hist, restore), null, 'a damaged byte is caught by the checksum');
  assert.equal(resumeFromCheckpoint(cp(bytes.slice(0, 100)), now, hist, restore), null, 'cut short');
  assert.equal(resumeFromCheckpoint(cp(bytes, { rules: 'other' }), now, hist, restore), null, 'other rules');
  assert.equal(resumeFromCheckpoint(undefined, now, hist, restore), null, 'an old save has no checkpoint: full replay');
  assert.equal(resumeFromCheckpoint(cp(bytes), now, hist, () => { throw new Error('boom'); }), null, 'a restore that throws');
  const full = new World(1337n, 0, 0);
  assert.ok((await replayInSlices(full, cmds, applyCmd, final, fast)).ok); assert.equal(full.state_hash(), hash, 'the full replay still gives the same village');
});
