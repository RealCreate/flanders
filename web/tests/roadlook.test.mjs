// What the roads look like (src/render/roadlook.ts): the material for each castle tier, and the dirt standing out from the grass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roadMaterialFor, roadHalfWidth, STONE_FROM_TIER, dirtPixels, stonePixels, roadPixels, luminance, meanColor, GRASS_RGB } from '../src/render/roadlook.ts';

test('every castle tier gives dirt or stone: dirt in the first tiers, stone from the threshold up, the same every time', () => {
  for (let t = 0; t <= 3; t++) {
    const m = roadMaterialFor(t);
    assert.ok(m === 'dirt' || m === 'stone', `tier ${t}`);
    assert.equal(m, t >= STONE_FROM_TIER ? 'stone' : 'dirt');
    assert.equal(roadMaterialFor(t), m, 'deterministic');
  }
  assert.equal(roadMaterialFor(0), 'dirt'); assert.equal(roadMaterialFor(1), 'dirt'); assert.equal(roadMaterialFor(3), 'stone');
  assert.equal(roadMaterialFor(Number.NaN), 'dirt'); assert.equal(roadMaterialFor(-1), 'dirt');
  for (let t = 1; t <= 3; t++) assert.ok(roadMaterialFor(t) >= roadMaterialFor(t - 1) || roadMaterialFor(t - 1) === 'dirt', 'never goes back to dirt as the castle grows');
});

test('the width changes with the material and not at any other tier', () => {
  for (let t = 0; t <= 3; t++) assert.equal(roadHalfWidth(t), roadMaterialFor(t) === 'stone' ? 1.45 : 1.15);
});

test('the textures are made the same every time', () => {
  assert.deepEqual(Array.from(dirtPixels(32)), Array.from(dirtPixels(32)));
  assert.deepEqual(Array.from(stonePixels(32)), Array.from(stonePixels(32)));
  assert.equal(roadPixels('dirt', 32).length, 32 * 32 * 4); assert.equal(roadPixels('stone', 16).length, 16 * 16 * 4);
});

test('a dirt road is clearly darker and warmer than the grass, however the light falls', () => {
  const d = meanColor(dirtPixels(128)), ld = luminance(...d);
  for (const g of GRASS_RGB) {
    const lg = luminance(...g);
    // light scales both alike (day or night), so the ratio of the two luminances is what has to hold; and a WCAG-style contrast ratio in full daylight
    assert.ok(lg / ld >= 1.8, `grass ${lg.toFixed(3)} against dirt ${ld.toFixed(3)}`);
    assert.ok((lg + 0.05) / (ld + 0.05) >= 1.6, 'daylight contrast ratio');
    assert.ok(d[0] > d[2] * 1.4 && d[0] > d[1], 'warm: red above green above blue');   // earth, not a grey or a green tint
    assert.ok(g[1] > g[0] && g[1] > g[2], 'the grass is green');
    assert.ok(Math.hypot(d[0] - g[0], d[1] - g[1], d[2] - g[2]) > 60, 'far from the grass in colour');
  }
});

test('the dirt has detail: ruts and grit, not a flat tint', () => {
  const px = dirtPixels(128), lum = [];
  for (let i = 0; i < px.length; i += 4) lum.push(luminance(px[i], px[i + 1], px[i + 2]));
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length, sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
  assert.ok(sd / mean > 0.08, `variation ${(sd / mean).toFixed(3)}`);
  // the ruts (columns at 0.3 and 0.7 of the width) are darker than the ridge between them
  const col = u => { let s = 0; for (let y = 0; y < 128; y++) { const o = (y * 128 + Math.round(u * 127)) * 4; s += luminance(px[o], px[o + 1], px[o + 2]); } return s / 128; };
  assert.ok(col(0.3) < col(0.5) * 0.9 && col(0.7) < col(0.5) * 0.9, 'ruts are darker than the middle');
});

test('stone is a light grey paving that differs from both the grass and the dirt', () => {
  const s = meanColor(stonePixels(128)), d = meanColor(dirtPixels(128));
  assert.ok(luminance(...s) > luminance(...d) * 1.5, 'lighter than dirt');
  for (const g of GRASS_RGB) assert.ok(Math.hypot(s[0] - g[0], s[1] - g[1], s[2] - g[2]) > 40, 'not the grass');
  assert.ok(Math.abs(s[0] - s[2]) < 40, 'grey rather than brown');
});
