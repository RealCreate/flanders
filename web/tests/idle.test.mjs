import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sceneIsStill, skipFrame, IDLE_AFTER_MS, IDLE_FRAME_MS } from '../src/idle.ts';
import { freezeSubtree } from '../src/render/static.ts';

const base = { paused: true, msSinceInput: IDLE_AFTER_MS + 1, animating: false };
test('a paused village nobody has touched for a moment is still', () => assert.equal(sceneIsStill(base), true));
test('a running village is never still', () => assert.equal(sceneIsStill({ ...base, paused: false }), false));
test('input, or anything animating on its own, wakes it at once', () => {
  assert.equal(sceneIsStill({ ...base, msSinceInput: 0 }), false);
  assert.equal(sceneIsStill({ ...base, msSinceInput: IDLE_AFTER_MS }), false);
  assert.equal(sceneIsStill({ ...base, animating: true }), false);
});
test('a still scene skips frames until its slow turn; a live one never skips', () => {
  assert.equal(skipFrame(true, 16), true);
  assert.equal(skipFrame(true, IDLE_FRAME_MS), false);
  assert.equal(skipFrame(false, 1), false);
});

test('freezeSubtree computes matrices once and then stops the walk', () => {
  const root = new THREE.Group(); root.position.set(5, 0, 0);
  const mid = new THREE.Group(), leaf = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  leaf.position.set(0, 2, 0); mid.add(leaf); root.add(mid);
  freezeSubtree(root);
  assert.equal(leaf.matrixWorld.elements[12], 5); assert.equal(leaf.matrixWorld.elements[13], 2);   // computed before freezing
  assert.equal(root.matrixAutoUpdate, false); assert.equal(leaf.matrixAutoUpdate, false);
  let walked = 0; const real = leaf.updateMatrixWorld.bind(leaf); leaf.updateMatrixWorld = f => { walked++; real(f); };
  const scene = new THREE.Scene(); scene.add(root); scene.updateMatrixWorld(true);
  assert.equal(walked, 0);   // the walk never reaches the frozen subtree
  const late = new THREE.Mesh(); mid.add(late); scene.updateMatrixWorld(true);   // an object added later sits at the identity, as the forest's merged meshes do
  assert.equal(late.matrixWorld.elements[12], 0);
});
