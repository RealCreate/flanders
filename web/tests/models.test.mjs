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

test('the mine\'s spoil shelf does not share a top face with the stone footing option (it z-fought the door pad)', () => {
  for (const kind of [9, 10]) for (const tier of [0, 1, 2, 3]) {
    const g = B.buildModel(kind, tier, 0x2f5fa8, 0, 8);
    g.updateMatrixWorld(true);
    const boxes = [];
    g.traverse(o => { if (o.isMesh && o.visible) { o.geometry.computeBoundingBox(); const w = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); boxes.push(w); } });
    const flat = boxes.filter(x => Math.abs(x.max.y - x.min.y - 0.3) < 1e-3 && Math.abs(x.min.y) < 1e-3);
    assert.ok(flat.length >= 1, `kind ${kind} tier ${tier}: the footing is there`);
    const foot = flat.reduce((a, c) => (c.max.x - c.min.x > a.max.x - a.min.x ? c : a));
    for (const x of boxes) {
      if (x === foot) continue;
      const overlapXZ = x.min.x < foot.max.x && x.max.x > foot.min.x && x.min.z < foot.max.z && x.max.z > foot.min.z;
      if (!overlapXZ) continue;
      for (const y of [x.min.y, x.max.y]) assert.ok(Math.abs(y - foot.max.y) > 1e-3, `kind ${kind} tier ${tier}: a face at the footing's top height ${foot.max.y}`);
    }
  }
});
