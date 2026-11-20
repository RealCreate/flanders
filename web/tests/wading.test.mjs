// Raiders wading a moat must not leap up and drop: the drawn height is continuous and stays on the ground or the water surface (real core in Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { standHeight, onWater, chase, MAX_RISE, WADE_LIFT } from '../src/render/wading.ts';
import { moatSurface } from '../src/render/moatwater.ts';
import { triangleHeight } from '../src/render/rivergrid.ts';
const { World } = createRequire(import.meta.url)('./.wasm/game_core.js');

test('standHeight: the ground on land, the water surface over a ditch, a deck still wins', () => {
  assert.equal(standHeight(4, false, 0), 4);
  assert.ok(Math.abs(standHeight(-3, false, 3) - (3 + WADE_LIFT)) < 1e-9, 'standing under the water counts as in it, whatever the flag says');
  assert.equal(standHeight(4, true, 3), 4, 'on the bank the raider stands on the bank');
  assert.ok(Math.abs(standHeight(-3, true, 3) - (3 + WADE_LIFT)) < 1e-9, 'in the ditch it floats on the water');
  assert.equal(standHeight(5, true, 3), 5, 'a bridge deck over the water');
  assert.equal(onWater(-3, true, 3), true); assert.equal(onWater(4, true, 3), false);
  assert.equal(standHeight(-2, true, -0.25), -0.25 + WADE_LIFT);
  assert.equal(chase(0, 10, 0.1), MAX_RISE * 0.1);
});

test('a raid across a moat: drawn height changes little per frame and every wading unit stays on the water or the ground', () => {
  const w = new World(1337n, 0, 0);
  w.cheat(3, 0, 0); w.cheat(1, 30, 0);
  for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; w.place(24, Math.round(Math.cos(a) * 18), Math.round(Math.sin(a) * 18), 0); }
  assert.ok(w.moat_water_flat().length > 0, 'a moat was dug');
  assert.ok(w.cheat(4, 0, 1000), 'bandits come');
  const FRAMES = 6, DT = 0.1 / FRAMES;   // a tick every tenth of a second, drawn in six frames
  const STEP = 2.5, moat = moatSurface(w.moat_water_flat(), STEP);
  const groundAt = (x, z) => {
    const i = Math.floor(x / STEP), j = Math.floor(z / STEP);
    const h = (a, b) => w.height_at(a * STEP, b * STEP);
    return triangleHeight(h(i, j), h(i + 1, j), h(i, j + 1), h(i + 1, j + 1), x / STEP - i, z / STEP - j);
  };
  const gy = new Map(), pos = new Map();
  let wadingFrames = 0, worstStep = 0, worstOff = 0, tick = 0;
  for (; tick < 2500 && w.battle_active(); tick++) {
    w.step();
    const u = w.battle_units_flat();
    for (let f = 1; f <= FRAMES; f++) for (let i = 0; i < u.length / 10; i++) {
      const o = i * 10;
      if (u[o] !== 1 || u[o + 6] <= 0 || u[o + 1] === 4) continue;
      const p = pos.get(i) ?? [u[o + 2], u[o + 3]], x = p[0] + (u[o + 2] - p[0]) * f / FRAMES, z = p[1] + (u[o + 3] - p[1]) * f / FRAMES;
      const ground = groundAt(x, z), wading = u[o + 9] > 0.02, level = Math.max(-0.25, moat.levelAt(x, z));
      const touching = wading || ground < level, want = standHeight(ground, touching, touching ? level : 0);
      const prev = gy.get(i), y = prev === undefined ? want : chase(prev, want, DT);
      if (prev !== undefined) worstStep = Math.max(worstStep, Math.abs(y - prev));
      if (wading) { wadingFrames++; worstOff = Math.max(worstOff, Math.abs(y - want)); }
      gy.set(i, y);
    }
    for (let i = 0; i < u.length / 10; i++) pos.set(i, [u[i * 10 + 2], u[i * 10 + 3]]);
  }
  assert.ok(wadingFrames > 10, `raiders waded (${wadingFrames} frames)`);
  assert.ok(worstStep <= MAX_RISE * DT + 1e-9, `vertical change per frame ${worstStep.toFixed(3)}`);
  assert.ok(worstOff < 0.6, `a wading unit strays at most ${worstOff.toFixed(2)} from the ground or water surface it stands on`);
  w.free();
});
