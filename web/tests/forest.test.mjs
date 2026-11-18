import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadModule, closeModels } from './models.mjs';

const { Forest } = await loadModule('/src/render/trees.ts');
test.after(() => closeModels());

function forest(heightAt = () => 6) {
  const terrain = { heightAt };
  const raw = Float32Array.of(10, 10, 0, 1, 0, 20, 20, 1, 1, 0, 190, 190, 2, 1, 0);
  return { terrain, view: new Forest(1n, terrain, raw) };
}

test('clearings, retained groves and road changes update only the touched batches and can be removed', () => {
  let samples = 0;
  const { view } = forest(() => { samples++; return 6; });
  samples = 0;
  const remote = view.group.children[2], remoteVersion = remote.instanceMatrix.version;
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
  const remote = view.group.children[2], remoteVersion = remote.instanceMatrix.version;
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

test('camera altitude selects cheaper distant trees with unchanged placement and no shadow pass', () => {
  const { view } = forest();
  const mesh = view.group.children[0];
  const triangles = () => mesh.geometry.attributes.position.count / 3;
  const bound = mesh.boundingSphere.clone(), matrixVersion = mesh.instanceMatrix.version;
  view.tick(0, new THREE.Vector3(30, 20, 30));
  const near = triangles();
  assert.ok(mesh.castShadow && mesh.receiveShadow && mesh.material.map);
  view.tick(1, new THREE.Vector3(30, 110, 30));
  const mid = triangles();
  assert.ok(near > mid);
  const far = new THREE.Vector3(30, 310, 30);
  view.tick(2, far);
  assert.ok(triangles() < mid && mesh.material.isMeshLambertMaterial);
  assert.ok(!mesh.castShadow && !mesh.receiveShadow);
  assert.equal(mesh.instanceMatrix.version, matrixVersion);
  assert.ok(mesh.boundingSphere.equals(bound));
  view.drawDistance = 0;
  view.tick(3, far);
  assert.equal(mesh.visible, false);
});
