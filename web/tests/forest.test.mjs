import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadModule, closeModels } from './models.mjs';

const { Forest, TREE_SHADOW_LAYER } = await loadModule('/src/render/trees.ts');
const { ShadowRefresh } = await loadModule('/src/render/sky.ts');
const { EffectView, Effects2, Particles } = await loadModule('/src/render/fx.ts');
test.after(() => closeModels());

function forest(heightAt = () => 6) {
  const terrain = { heightAt };
  const raw = Float32Array.of(10, 10, 0, 1, 0, 20, 20, 1, 1, 0, 190, 190, 2, 1, 0);
  return { terrain, view: new Forest(1n, terrain, raw) };
}

function batches(view, layer = 0, visible = false) {
  const meshes = [];
  const visit = node => { if (node.isInstancedMesh && node.layers.isEnabled(layer)) meshes.push(node); };
  if (visible) view.group.traverseVisible(visit); else view.group.traverse(visit);
  return meshes;
}

test('clearings, retained groves and road changes update only the touched batches and can be removed', () => {
  let samples = 0;
  const { view } = forest(() => { samples++; return 6; });
  samples = 0;
  const remote = batches(view)[2], remoteVersion = remote.instanceMatrix.version;
  const grove = [{ x: 10, z: 10, r: 8 }];
  const broad = { x: 20, z: 20, r: 31 }, small = { x: 10, z: 10, r: 2 };
  const road = [{ ax: 8, az: 10, bx: 12, bz: 10, r: 1 }];

  view.rebuild([broad], [], grove);
  assert.equal(view.countTrees(10, 10, 2), 1);
  assert.equal(view.countTrees(20, 20, 2), 0);
  view.rebuild([broad, small], [], grove);
  assert.equal(view.countTrees(10, 10, 2), 0);
  view.rebuildLater([broad], [], grove);
  view.rebuild([broad], road, grove);
  assert.equal(view.countTrees(10, 10, 2), 0);
  view.rebuild([]);
  assert.equal(view.countTrees(10, 10, 2), 1);
  assert.equal(view.countTrees(20, 20, 2), 1);
  assert.equal(remote.instanceMatrix.version, remoteVersion);
  assert.equal(samples, 0, 'mask changes reuse the sampled ground');
});

test('committed terrain edits resample touched trees and leave other batches alone', () => {
  let deeper = false;
  const { terrain, view } = forest((x, z, committed) => {
    assert.equal(committed, true);
    return deeper && x < 15 && z < 15 ? 0 : 6;
  });
  const remote = batches(view)[2], remoteVersion = remote.instanceMatrix.version;
  deeper = true;
  terrain.onHeightChange(7, 7, 13, 13);
  view.rebuild([]);
  assert.equal(view.countTrees(10, 10, 2), 0);
  assert.equal(view.countTrees(20, 20, 2), 1);
  assert.equal(remote.instanceMatrix.version, remoteVersion);
  deeper = false;
  terrain.onHeightChange(7, 7, 13, 13);
  view.rebuild([]);
  assert.equal(view.countTrees(10, 10, 2), 1);
});

test('camera altitude selects cheaper crowns while a low-poly proxy casts the shadow', () => {
  const { view } = forest();
  const mesh = batches(view)[0];
  const triangles = geometry => (geometry.index?.count ?? geometry.attributes.position.count) / 3;
  const bound = mesh.boundingSphere.clone(), matrixVersion = mesh.instanceMatrix.version;
  view.tick(0, new THREE.Vector3(30, 20, 30));
  const proxy = batches(view, TREE_SHADOW_LAYER)[0], near = triangles(mesh.geometry);
  assert.ok(!mesh.castShadow && mesh.receiveShadow && mesh.material.map);
  assert.ok(mesh.material.isMeshLambertMaterial);
  assert.ok(proxy.castShadow && proxy.visible && !proxy.layers.isEnabled(0));
  assert.equal(batches(view, TREE_SHADOW_LAYER).length, 2, 'only nearby casters join the scene');
  assert.equal(proxy.instanceMatrix, mesh.instanceMatrix);
  assert.ok(triangles(proxy.geometry) < near / 3);
  view.tick(1, new THREE.Vector3(30, 110, 30));
  assert.ok(mesh.material.map, 'keep the close-up model until the camera leaves its wider band');
  view.tick(2, new THREE.Vector3(30, 140, 30));
  const mid = triangles(mesh.geometry);
  assert.ok(mid < near && !mesh.material.map);
  assert.ok(mesh.geometry.attributes.position.count < mesh.geometry.index.count / 2, 'shared crown vertices cut the vertex workload');
  view.tick(3, new THREE.Vector3(30, 260, 30));
  assert.equal(triangles(mesh.geometry), mid, 'keep individual crowns through normal zoom-out');
  const far = new THREE.Vector3(30, 325, 30);
  view.tick(4, far);
  const silhouette = triangles(mesh.geometry);
  assert.ok(silhouette < mid && mesh.material.isMeshBasicMaterial);
  assert.ok(!mesh.castShadow && !mesh.receiveShadow);
  view.tick(5, new THREE.Vector3(30, 280, 30));
  assert.equal(triangles(mesh.geometry), silhouette, 'returning briefly into the band does not switch the model again');
  view.tick(6, new THREE.Vector3(30, 240, 30));
  assert.equal(triangles(mesh.geometry), mid);
  assert.equal(mesh.instanceMatrix.version, matrixVersion);
  assert.ok(mesh.boundingSphere.equals(bound));
  view.drawDistance = 0;
  view.tick(7, far);
  assert.equal(batches(view, 0, true).length, 0);
  assert.equal(batches(view, TREE_SHADOW_LAYER, true).length, 0);
});

test('distant tiles share a draw call and clearings update the combined instances', () => {
  const data = [];
  for (let x = 500; x < 700; x += 60) for (let z = 20; z < 240; z += 60) data.push(x, z, 1, 1, 0);
  const view = new Forest(1n, { heightAt: () => 6 }, Float32Array.from(data));
  const cam = new THREE.Vector3(0, 20, 0);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1500);
  camera.position.copy(cam); camera.lookAt(600, 6, 120); camera.updateMatrixWorld();
  view.tick(0, cam, cam, 0, camera);
  const [merged] = batches(view, 0, true);
  assert.equal(batches(view, 0, true).length, 1);
  assert.equal(merged.count, 16);
  view.rebuild([{ x: 500, z: 20, r: 4 }]);
  assert.equal(merged.count, 15);
  view.rebuild([]);
  assert.equal(merged.count, 16);
  camera.lookAt(600, 6, 440); camera.updateMatrixWorld();
  view.tick(1, cam, cam, 0, camera);
  assert.equal(batches(view, 0, true).length, 1, 'a sector across the edge of the view with most of its tiles on screen stays one draw');
  camera.lookAt(600, 6, 600); camera.updateMatrixWorld();
  view.tick(1.2, cam, cam, 0, camera);
  assert.equal(batches(view, 0, true).length, 16, 'keep tile culling when most of the sector is off screen');
  camera.lookAt(-600, 6, 0); camera.updateMatrixWorld();
  view.tick(1.5, cam, cam, 0, camera);
  assert.equal(batches(view, 0, true).length, 0, 'entire sectors behind the camera are skipped');
  camera.lookAt(600, 6, 440); camera.updateMatrixWorld();
  view.drawDistance = 560;
  view.tick(2, cam, cam, 0, camera);
  assert.ok(batches(view, 0, true).reduce((n, mesh) => n + mesh.count, 0) < 16);
});

test('static shadow maps stay cached and a wide view refreshes moving shadows less often', () => {
  const schedule = new ShadowRefresh(), focus = new THREE.Vector3(), sun = new THREE.Vector3(0, 1, 0);
  assert.equal(schedule.update(0, focus, sun, 250, false), true);
  assert.equal(schedule.update(200, focus, sun, 250, true), false);
  assert.equal(schedule.update(275, focus, sun, 250, true), true);
  assert.equal(schedule.update(900, focus, sun, 250, false), true);
  assert.equal(schedule.update(1000, focus, sun, 250, false), false);
  focus.x = 8;
  assert.equal(schedule.update(1016, focus, sun, 250, false), false, 'a short pan stays inside the shadowed square');
  focus.x = 13;
  assert.equal(schedule.update(1060, focus, sun, 250, false), true, 'a longer pan redraws once the cooldown is over');
  schedule.invalidate();
  assert.equal(schedule.update(1076, focus, sun, 250, false), true);
  sun.set(0.05, 1, 0).normalize();
  assert.equal(schedule.update(1240, focus, sun, 250, false), true);
  assert.equal(schedule.update(1256, focus, sun, 40, false, 62), false);
  assert.equal(schedule.update(1400, focus, sun, 40, false, 62), true, 'zoom refreshes the footprint after the cooldown');
});

test('particle buffers draw and upload only live entries, including after an expiry in the middle', () => {
  const pool = new Particles(100, false, 0, 0);
  const emit = (x, life) => pool.emit(x, 0, 0, 0, 0, 0, life, 1, 1, 1, 1, 1, 1);
  emit(1, 4); emit(2, 1); emit(3, 5);
  pool.update(2);
  const geometry = pool.points.geometry;
  assert.equal(geometry.drawRange.count, 2);
  assert.deepEqual([...geometry.attributes.position.array.slice(0, 6)], [1, 0, 0, 3, 0, 0]);
  assert.deepEqual(geometry.attributes.position.updateRanges, [{ start: 0, count: 6 }]);
  pool.update(4);
  assert.equal(geometry.drawRange.count, 0);
  assert.equal(pool.points.visible, false);
  emit(4, 5);
  pool.update(1);
  assert.equal(geometry.drawRange.count, 1);
  assert.equal(pool.points.visible, true);
});

test('offscreen fires are skipped and come into view with fresh particles', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1000);
  camera.position.set(0, 20, 0); camera.lookAt(150, 0, 0); camera.updateMatrixWorld();
  const view = new EffectView();
  const effects = new Effects2({ heightAt: () => 0 });
  const fires = Float32Array.of(0, -150, 0, 4);
  const draws = () => effects.group.children.some(child => child.isPoints && child.geometry.drawRange.count > 0);
  view.update(camera); effects.update(0.1, fires, camera.position, view);
  assert.equal(draws(), false);
  camera.lookAt(-150, 0, 0); camera.updateMatrixWorld();
  view.update(camera); effects.update(0.1, fires, camera.position, view);
  assert.equal(draws(), true);
  assert.equal(effects.group.children.filter(child => child.isPointLight).length, 1);
});
