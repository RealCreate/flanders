// The door table of the core (crates/game-core/src/doors.rs) says where each building's door is, and so where its road starts. It is read off the models, so it must agree with them:
// every door box of a model (the door material) lies near the table's door for that kind and tier, and the road that leaves the door runs out clear of the building's plot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadBuildings, closeModels } from './models.mjs';
const core = createRequire(import.meta.url)('./.wasm/game_core.js');
const defs = JSON.parse(core.catalog());
const B = await loadBuildings();
const THREE = await import('three');
test.after(() => closeModels());

const NO_DOOR_BOX = new Set([2, 21, 22, 23, 24, 32, 33, 34, 37, 38, 44]);   // walls, fences, gates, bridges, moats, earthworks and the plaza (which has nodes, not a door) have no door

/** The door boxes of a model: the centre (x, z) of each box of the door material that is tall enough to be a door. */
function doorsOf(kind, tier) {
  const g = B.buildModel(kind, tier, 0x2f5fa8, 1, 0, undefined, false); g.updateMatrixWorld(true);
  const out = [];
  g.traverse(o => {
    if (!o.isMesh || !o.material.color || o.material.color.getHexString() !== '382415') return;
    const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    if (s.y > 0.4) out.push([c.x, c.z]);
  });
  return out;
}

test('the door of every building in the core table is where the model has its door', () => {
  let checked = 0;
  for (let kind = 0; kind < defs.length; kind++) {
    if (NO_DOOR_BOX.has(kind)) continue;
    for (const tier of [0, 1, 2, 3]) {
      const found = doorsOf(kind, tier);
      if (!found.length) continue;   // (the open places and a few models draw no door box: their doorstep is on the edge of what they are)
      const [dx, dz] = core.door_info(kind, tier);
      const near = Math.min(...found.map(([x, z]) => Math.hypot(x - dx, z - dz)));
      assert.ok(near < 0.8, `${defs[kind].name} tier ${tier}: the table has the door at ${dx.toFixed(1)},${dz.toFixed(1)}, the model's doors are at ${found.map(f => f.map(v => v.toFixed(1)).join(',')).join(' ')}`);
      checked++;
    }
  }
  assert.ok(checked > 60, `${checked} doors checked`);
});

test('the road from a door leaves the building\'s plot: the exit lies beyond the footprint, straight out from the door', () => {
  for (let kind = 0; kind < defs.length; kind++) {
    if (NO_DOOR_BOX.has(kind)) continue;
    for (const tier of [0, 1, 2, 3]) {
      const [dx, dz, fx, fz, ex, ez] = core.door_info(kind, tier);
      assert.ok(Math.hypot(ex, ez) > core.footprint_of(kind, tier) + 0.5, `${defs[kind].name} tier ${tier}: the exit is outside the footprint`);
      const t = (ex - dx) * fx + (ez - dz) * fz;
      assert.ok(t > 0.5, `${defs[kind].name} tier ${tier}: the exit is in front of the door`);
      assert.ok(Math.abs((ex - dx) * fz - (ez - dz) * fx) < 0.05, `${defs[kind].name} tier ${tier}: and straight out from it`);
    }
  }
});

test('the door of a farm is in the back wall of its barn, so its road leaves away from the fields', () => {
  for (const tier of [0, 1, 2, 3]) {
    const [dx, dz, fx, fz, ex, ez] = core.door_info(1, tier);
    assert.ok(fz < -0.9 && ez < dz, `farm tier ${tier}: the door faces away from the fields`);
    assert.ok(Math.abs(ex - dx) < 0.05, 'and the road runs straight out');
  }
});
