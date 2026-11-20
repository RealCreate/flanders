// War machines are modelled facing +z at yaw 0 and placed with yaw = PI/2 - heading (heading = atan2(dz, dx), the core's convention). The catapult's throwing end (the cup) must
// end up over the target side when it throws, and the whole machine must face along its path while marching.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadModule, closeModels } from './models.mjs';
const C = await loadModule('/src/render/crowd.ts');
const { FieldView } = await loadModule('/src/render/field.ts');
const { ArmyView } = await loadModule('/src/render/army.ts');
const { ArmyPicker } = await loadModule('/src/render/armypick.ts');
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

test('both siege axles roll by the distance travelled and rotate around their hubs', () => {
  for (const build of [C.buildCatapult, C.buildRam]) {
    const engine = build(), { axles, wheelRadius } = engine.userData;
    const hubs = axles.map(a => a.position.clone());
    assert.equal(axles.length, 2);
    C.setSiegeWheelTravel(engine, wheelRadius * 1.3);
    for (const [i, axle] of axles.entries()) {
      assert.ok(Math.abs(axle.rotation.x - 1.3) < 1e-6);
      assert.ok(axle.position.equals(hubs[i]));
    }
    C.setSiegeWheelTravel(engine, -wheelRadius);
    assert.equal(axles[0].rotation.x, -1);
    assert.equal(engine.rotation.x, 0);
  }
});

const terrain = { walkAt: () => 0, renderedWaterAt: () => 0, water: { position: { y: 0 } } };
const at = (x, z) => new ArmyPicker(new THREE.Ray(new THREE.Vector3(x, 9, z), new THREE.Vector3(0, -1, 0)));
const det = (id, state, foot, catapult, ram) => [id, 40, 0, foot, 0, 0, 0, catapult, state, 0, 0, 0, 0, 0, 0, 0, ram];
const crowd = { add() {} };
const track = (id, kind, dispatch, gap, points) => [id, kind, dispatch, gap, points.length / 4, ...points];

test('clicking the back of a marching file selects its army away from its banner', () => {
  const view = new FieldView(terrain);
  view.sync(Float32Array.from(det(7, 1, 2, 0, 0)), () => [], Float32Array.from(track(7, 0, 40, 12, [0, 0, 0, 0, 40, 0, 0, 40])), new Float32Array());
  view.update(0.1);
  view.draw(crowd, 0, 0, 100);
  const tail = at(28, 0);
  view.pick(tail, true);
  assert.equal(tail.hit?.id, 7);
  const hidden = at(28, 0);
  view.pick(hidden, false);
  assert.equal(hidden.hit, null);
});

test('marching siege wheels roll on land and hold their position while ferrying', () => {
  const view = new FieldView(terrain);
  const sync = dispatch => view.sync(Float32Array.from(det(7, 1, 0, 1, 1)), () => [],
    Float32Array.from(track(7, 0, dispatch, 4.8, [0, 0, 0, 0, 20, 0, 0, 20, 40, 0, 2, 40])), new Float32Array());
  sync(6);
  view.update(0.2);
  const engines = view.group.children.filter(o => o.userData.axles);
  assert.equal(engines.length, 2);
  sync(7);
  view.update(0.2);
  const travel = engines.map(g => g.userData.wheelTravel);
  assert.deepEqual(travel, [1, 1]);
  sync(30);
  view.update(0.2);
  assert.deepEqual(engines.map(g => g.userData.wheelTravel), travel);
});

test('only friendly field-army troops can be picked from a battle', () => {
  const view = new ArmyView(terrain);
  const unit = (side, kind, x) => [side, kind, x, 0, 10, 10, 1, 0, 0, 0, 0, 0, 0, 0];
  view.syncBattle(Float32Array.from([...unit(0, 0, 15), ...unit(1, 0, 20), ...unit(0, 5, 30)]), Uint32Array.of(13, 13, 22));
  view.update(0.1);
  view.draw(crowd, { x: 0, z: 0 });
  for (const [x, expected] of [[15, 13], [20, undefined], [30, 22]]) {
    const hit = at(x, 0);
    view.pick(hit);
    assert.equal(hit.hit?.id, expected);
  }
});
