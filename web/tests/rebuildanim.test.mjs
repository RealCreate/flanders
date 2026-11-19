// Finished buildings must never replay the build animation: the core's building list shifts when one is pulled down, burnt or lost, and buildings were once matched by index.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { build } from 'vite';
import { Box3 } from 'three';

const noop = () => {};
const ctx = new Proxy({}, { get: (_, k) => k === 'getImageData' ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };
globalThis.window ??= globalThis;
const dir = new URL('./.tmp/', import.meta.url);
async function load(entry) {
  const out = await build({
    configFile: false, logLevel: 'silent', root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'x' }, rollupOptions: { external: ['three'] } },
  });
  const chunk = (Array.isArray(out) ? out[0] : out).output[0];
  mkdirSync(dir, { recursive: true });
  const file = new URL(`bundle-ra-${Math.random().toString(36).slice(2)}.mjs`, dir);
  writeFileSync(file, chunk.code);
  return import(file.href);
}
const radii = new Array(60).fill(3);
const b = (kind, tier, x, z) => [kind, tier, x, z, 0, 1, 4, 0, 0, 0];
const flat = (...bs) => Float32Array.from(bs.flat());

test('removing or adding a building does not re-animate the others', async () => {
  const { VillageView } = await load('src/render/buildings.ts');
  const v = new VillageView(0xcc3333);
  const A = b(15, 0, 0, 0), B = b(1, 0, 14, 6), C = b(4, 0, -14, 6), D = b(1, 0, 20, 20);
  v.sync(flat(A, B, C, D), radii);
  v.animateNew = true;
  const ga = v.groupOf(0), gb = v.groupOf(1), gc = v.groupOf(2), gd = v.groupOf(3);
  const building = () => [0, 1, 2, 3].some(i => v.items.get(i)?.build || v.items.get(i)?.pop !== undefined);
  // B is pulled down: C and D shift down one index but stay the same objects, with no animation
  v.sync(flat(A, C, D), radii);
  assert.equal(v.groupOf(0), ga); assert.equal(v.groupOf(1), gc); assert.equal(v.groupOf(2), gd); assert.equal(v.groupOf(3), undefined);
  assert.equal(gc.userData.idx, 1); assert.equal(gd.userData.idx, 2);
  assert.ok(!building(), 'no animation started');
  // a new building in the middle shifts the later ones up; only the new one animates
  const E = b(1, 0, -30, 5);
  v.sync(flat(A, E, C, D), radii);
  assert.equal(v.groupOf(0), ga); assert.equal(v.groupOf(2), gc); assert.equal(v.groupOf(3), gd);
  assert.ok(v.items.get(1).build || v.items.get(1).pop !== undefined, 'the new building animates');
  assert.ok(!v.items.get(2).build && v.items.get(2).pop === undefined && !v.items.get(3).build);
  void gb;
});

test('an upgrade still animates, in place', async () => {
  const { VillageView } = await load('src/render/buildings.ts');
  const v = new VillageView(0xcc3333);
  v.sync(flat(b(15, 0, 0, 0), b(1, 0, 14, 6)), radii);
  v.animateNew = true;
  const g = v.groupOf(1);
  v.sync(flat(b(15, 0, 0, 0), b(1, 1, 14, 6)), radii);
  assert.notEqual(v.groupOf(1), g);
  assert.ok(v.items.get(1).build, 'the upgrade is drawn up');
  assert.ok(!v.items.get(0).build);
});

test('the port upgrade replaces only the warehouse foundation at every tier', async () => {
  const { BuildingModel } = await load('src/render/buildings.ts');
  for (let tier = 0; tier <= 3; tier++) {
    const model = new BuildingModel(35, tier);
    const footing = model.base.children.find(c => c.userData.slot === 'warehouseFooting');
    const bounds = new Box3().setFromObject(footing);
    model.setOptions(8);
    const upgraded = new Box3().setFromObject(model.parts.get(3));
    assert.ok(!bounds.isEmpty() && !upgraded.isEmpty());
    assert.ok(upgraded.max.z < 2, 'the foundation ends before the pier starts');
    for (const extent of ['min', 'max']) for (const axis of ['x', 'z']) {
      assert.ok(Math.abs(upgraded[extent][axis] - bounds[extent][axis]) < 1e-5);
    }
    assert.equal(footing.parent, null);
    model.setOptions(0);
    assert.equal(footing.parent, model.base);
  }
});

test('water-side equipment follows the water without lowering the buildings', async () => {
  const { VillageView } = await load('src/render/buildings.ts');
  let water = 2;
  const view = new VillageView(0xcc3333, () => water);
  const mill = b(29, 0, 10, 0), hut = b(41, 0, 20, 0);
  mill[5] = hut[5] = 6;
  view.sync(flat(mill, hut), radii);
  const model = view.groupOf(0), fishery = view.groupOf(1);
  const slot = (group, name) => group.children[0].children.find(c => c.userData.slot === name);
  const race = slot(model, 'millrace'), rowboat = slot(fishery, 'rowboat'), posts = slot(fishery, 'jettyPosts');
  assert.ok(race.position.y < -3 && rowboat.position.y < -3);
  assert.ok(posts.scale.y > 1);
  view.update(0.21);
  water = 3;
  const previous = race.position.y;
  view.sync(flat(mill, hut), radii);
  assert.equal(race.position.y, previous + 1);
  assert.equal(model.position.y, 6);
  assert.equal(fishery.position.y, 6);
});

test.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
