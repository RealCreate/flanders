// Every building model builds, and every material in it can be tinted the way the placement ghost does it (it clones the material and gives it an emissive colour,
// which only a standard material draws: a basic material in the iron mine's door made the game throw while you hovered the mine over the ground).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadBuildings, closeModels } from './models.mjs';
const defs = JSON.parse(createRequire(import.meta.url)('./.wasm/game_core.js').catalog());
const B = await loadBuildings();
test.after(() => closeModels());

test('every kind, tier and option set builds with materials that take a tint', () => {
  for (let kind = 0; kind < defs.length; kind++) for (const tier of [0, 1, 2, 3]) for (const opts of [0, 15]) {
    const g = B.buildModel(kind, tier, 0x2f5fa8, 1, opts, undefined, false);
    g.traverse(o => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) assert.ok(m.isMeshStandardMaterial, `${defs[kind].name} tier ${tier} options ${opts}: a ${m.type} cannot be tinted by the ghost`);
    });
  }
});

test('the placement ghost can be made from the iron mine and the gold mine', () => {
  for (const kind of [9, 10]) {
    const g = B.buildModel(kind, 0, 0x2f5fa8, 0);
    g.traverse(o => { if (!o.isMesh) return; const c = o.material.clone(); c.transparent = true; c.emissive.setHex(0x22cc55); c.emissiveIntensity = 0.32; assert.ok(c.isMeshStandardMaterial); });
  }
});

// The watermill: its stone footing stops at the bank (the core's WHEEL_FOOT, 3.2 from the house's middle) and the wheel hangs out over the water on an axle WHEEL_REACH (5.2) out, clear of the footing.
test('the watermill footing ends before the wheel starts, at every tier', async () => {
  const THREE = await import('three');
  for (const tier of [0, 1, 2, 3]) {
    const g = B.buildModel(29, tier, 0x2f5fa8, 1, 0, undefined, false); g.updateMatrixWorld(true);
    const foot = g.getObjectByName('footing'), wheel = g.getObjectByName('wheel');
    assert.ok(foot && wheel, `tier ${tier}: footing and wheel are named`);
    const fb = new THREE.Box3().setFromObject(foot), wb = new THREE.Box3().setFromObject(wheel);
    assert.ok(Math.abs(fb.max.x - 3.2) < 1e-3, `tier ${tier}: the footing ends at the bank, ${fb.max.x}`);
    assert.ok(wb.min.x - fb.max.x >= 1.0, `tier ${tier}: the wheel (from ${wb.min.x}) hangs clear of the footing (to ${fb.max.x})`);
    assert.ok(Math.abs((wb.min.x + wb.max.x) / 2 - 5.2) < 0.05, `tier ${tier}: the axle is 5.2 out, ${(wb.min.x + wb.max.x) / 2}`);
    assert.ok(fb.max.y < 0.5 && wb.min.y < 0, `tier ${tier}: the wheel dips below the footing's level`);
  }
});
