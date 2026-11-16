// War machines are modelled facing +z at yaw 0 and placed with yaw = PI/2 - heading (heading = atan2(dz, dx), the core's convention). The catapult's throwing end (the cup) must
// end up over the target side when it throws, and the whole machine must face along its path while marching.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadModule, closeModels } from './models.mjs';
const C = await loadModule('/src/render/crowd.ts');
test.after(() => closeModels());

const yawFor = heading => Math.PI / 2 - heading;
const ANGLES = [0, 0.7, Math.PI / 2, 2.4, Math.PI, -2.4, -Math.PI / 2, -0.7];
/** The world direction (x, z) of a point `local` of the model after placing it at the origin with `yaw`. */
const dir = (g, yaw, v) => { g.rotation.y = yaw; g.updateMatrixWorld(true); const w = v.clone().applyMatrix4(g.matrixWorld); return [w.x, w.z]; };
const cos = ([ax, az], [bx, bz]) => (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz));

test('a catapult throws towards its target for every angle, and its cup rests at the back', () => {
  const g = C.buildCatapult(), arm = g.userData.arm, cup = g.userData.stone;
  for (const a of ANGLES) {
    const yaw = yawFor(a), target = [Math.cos(a), Math.sin(a)];
    arm.rotation.x = C.ARM_REST; let c = new THREE.Vector3(); cup.updateWorldMatrix(true, false); g.rotation.y = 0; g.updateMatrixWorld(true);
    const rest = cup.getWorldPosition(c.clone());
    assert.ok(rest.z < 0 && rest.y < 1.5, 'at rest the cup trails low behind the pivot');
    assert.ok(cos(dir(g, yaw, new THREE.Vector3(0, 0, 1)), target) > 0.999, `the front of the frame faces the target at ${a}`);
    arm.rotation.x = C.ARM_THROW; g.rotation.y = yaw; g.updateMatrixWorld(true);
    const cupAt = cup.getWorldPosition(new THREE.Vector3()), pivot = arm.getWorldPosition(new THREE.Vector3());
    assert.ok(cos([cupAt.x - pivot.x, cupAt.z - pivot.z], target) > 0.999, `the cup ends up towards the target at ${a}`);
  }
});
test('a ram strikes towards its target and a marching machine faces its path', () => {
  const g = C.buildRam(), head = g.userData.log.children[1];
  for (const a of ANGLES) {
    const path = [Math.cos(a), Math.sin(a)];
    g.rotation.y = yawFor(a); g.updateMatrixWorld(true);
    const h = head.getWorldPosition(new THREE.Vector3()), mid = g.userData.log.getWorldPosition(new THREE.Vector3());
    assert.ok(cos([h.x - mid.x, h.z - mid.z], path) > 0.999, `the ram's head leads at ${a}`);
  }
  // field.ts turns the machine with atan2(dx, dz) of its travel: that yaw puts +z along the path
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 1], [-3, -2]]) assert.ok(cos(dir(C.buildCatapult(), Math.atan2(dx, dz), new THREE.Vector3(0, 0, 1)), [dx, dz]) > 0.999);
});
