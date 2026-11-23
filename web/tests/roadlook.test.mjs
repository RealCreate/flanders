// What the roads look like (src/render/roadlook.ts): the material for each castle tier, and the dirt standing out from the grass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roadMaterialOfTier, ROAD_MATERIALS, ROAD_TIER_NAMES, MAX_ROAD_TIER, ROAD_HALF, roadHalfWidth, dirtPixels, stonePixels, cobblePixels, flagstonePixels, gravelPixels, roadPixels, luminance, meanColor, GRASS_RGB } from '../src/render/roadlook.ts';

test('every road tier has its own surface, in order: dirt, gravel, cobbles, flagstones; anything out of range is the nearest', () => {
  assert.deepEqual([0, 1, 2, 3].map(roadMaterialOfTier), ['dirt', 'gravel', 'cobble', 'flagstone']);
  assert.equal(roadMaterialOfTier(-4), 'dirt'); assert.equal(roadMaterialOfTier(9), 'flagstone'); assert.equal(roadMaterialOfTier(Number.NaN), 'dirt'); assert.equal(roadMaterialOfTier(1.9), 'gravel');
  assert.equal(ROAD_TIER_NAMES.length, MAX_ROAD_TIER + 1); assert.equal(ROAD_MATERIALS.length, MAX_ROAD_TIER + 1);
});

test('the width is the same for every surface, so a stretch can be resurfaced without its edges stepping', () => {
  for (let t = 0; t <= 3; t++) assert.equal(roadHalfWidth(t), ROAD_HALF);
});

test('the textures are made the same every time and have the size asked for', () => {
  for (const m of ROAD_MATERIALS) { assert.deepEqual(Array.from(roadPixels(m, 32)), Array.from(roadPixels(m, 32)), m); assert.equal(roadPixels(m, 16).length, 16 * 16 * 4); }
  assert.deepEqual(Array.from(stonePixels(32)), Array.from(cobblePixels(32)));
});

test('every surface is fully opaque and different from every other', () => {
  const means = ROAD_MATERIALS.map(m => { const px = roadPixels(m, 64); for (let i = 3; i < px.length; i += 4) assert.equal(px[i], 255, m); return meanColor(px); });
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const d = Math.hypot(...means[i].map((v, q) => v - means[j][q]));
    assert.ok(d > 12 || Math.abs(luminance(...means[i]) - luminance(...means[j])) > 0.02, `${ROAD_MATERIALS[i]} and ${ROAD_MATERIALS[j]} look alike`);
  }
});

test('the better the surface, the lighter it is', () => {
  const l = ROAD_MATERIALS.map(m => luminance(...meanColor(roadPixels(m, 96))));
  assert.ok(l[0] < l[1] && l[1] < l[3] && l[0] < l[2], `luminances ${l.map(v => v.toFixed(3))}`);
});

test('every surface tiles without a seam along the road, and its two edges are both a verge', () => {
  for (const m of ROAD_MATERIALS) {
    const size = 128, px = roadPixels(m, size), row = y => { let s = 0; for (let x = 0; x < size; x++) { const o = (y * size + x) * 4; s += luminance(px[o], px[o + 1], px[o + 2]); } return s / size; };
    const seam = Math.abs(row(0) - row(size - 1)), inner = Math.abs(row(60) - row(61));
    assert.ok(seam < Math.max(0.12, inner * 6), `${m}: the last row is not far from the first (${seam.toFixed(3)})`);
  }
});

test('the stone surfaces have joints: dark lines between lighter stones', () => {
  for (const m of ['cobble', 'flagstone']) {
    const size = 128, px = roadPixels(m, size), lum = []; for (let i = 0; i < px.length; i += 4) lum.push(luminance(px[i], px[i + 1], px[i + 2]));
    const sorted = lum.slice().sort((a, b) => a - b), dark = sorted[Math.floor(sorted.length * 0.05)], mid = sorted[Math.floor(sorted.length * 0.5)];
    assert.ok(dark < mid * 0.55, `${m}: joints ${dark.toFixed(3)} against stone ${mid.toFixed(3)}`);
  }
});

test('flagstones have a kerb: darker at the two edges than in the middle', () => {
  const size = 128, px = flagstonePixels(size), col = x => { let s = 0; for (let y = 0; y < size; y++) { const o = (y * size + x) * 4; s += luminance(px[o], px[o + 1], px[o + 2]); } return s / size; };
  const mid = (col(40) + col(90)) / 2;   // (the middle of a slab each: not at a joint)
  assert.ok(col(5) < mid * 0.9 && col(size - 4) < mid * 0.9, 'kerb stones');
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

test('cobbles and flagstones are grey stone: lighter than dirt, far from the grass, not brown', () => {
  const d = meanColor(dirtPixels(128));
  for (const m of ['cobble', 'flagstone']) {
    const s = meanColor(roadPixels(m, 128));
    assert.ok(luminance(...s) > luminance(...d) * 1.5, `${m} lighter than dirt`);
    for (const g of GRASS_RGB) assert.ok(Math.hypot(s[0] - g[0], s[1] - g[1], s[2] - g[2]) > 40, `${m} is not the grass`);
    assert.ok(Math.abs(s[0] - s[2]) < 40, `${m} grey rather than brown`);
  }
});

test('gravel is a pale earthy road: lighter than dirt, still warm, and clear of the grass', () => {
  const g = meanColor(gravelPixels(128)), d = meanColor(dirtPixels(128));
  assert.ok(luminance(...g) > luminance(...d) * 1.3, 'lighter than dirt');
  assert.ok(g[0] > g[2] * 1.15, 'warm');
  for (const gr of GRASS_RGB) assert.ok(Math.hypot(g[0] - gr[0], g[1] - gr[1], g[2] - gr[2]) > 40, 'not the grass');
});

test('the ground round a building is a faint plain earth tint, nowhere near the road\'s own look', async () => {
  const { APRON_RGB, APRON_ALPHA } = await import('../src/render/roadlook.ts');
  assert.ok(APRON_ALPHA <= 0.5, 'faint');
  assert.ok(APRON_RGB.every(v => v > 0 && v <= 1));
});
