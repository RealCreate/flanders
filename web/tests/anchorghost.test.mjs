// The road anchors of the placement ghost (src/render/anchorghost.ts): the ring and the stub follow the position and the turn, and nothing is drawn for a building with no door.
import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorShape, doorInWorld } from '../src/render/anchorghost.ts';
import { buildRoadMesh } from '../src/render/roadmesh.ts';

test('the door lands where the core puts it, and turns with the building', () => {
  const d = [0.8, 1.6, 0, 1, 0, 5];
  const a = doorInWorld(d, 10, 20, 0), b = doorInWorld(d, 10, 20, 2);
  assert.ok(Math.abs(a.x - 10.8) < 1e-9 && Math.abs(a.z - 21.6) < 1e-9);
  assert.ok(Math.abs(Math.hypot(a.x - 10, a.z - 20) - Math.hypot(b.x - 10, b.z - 20)) < 1e-9, 'the same distance from the middle');
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1, 'a quarter turn moves it');
  // (x cos + z sin, -x sin + z cos) for a quarter turn (rot 2): (z, -x)
  assert.ok(Math.abs(b.x - (10 + 1.6)) < 1e-9 && Math.abs(b.z - (20 - 0.8)) < 1e-9);
});

test('a ghost with one node shows a ring and a stub from its door; a passage shows two rings and no stub', () => {
  const s = anchorShape([12, 30], { x: 10, z: 24 });
  assert.equal(s.rings.length, 1); assert.deepEqual(s.stub, { x0: 10, z0: 24, x1: 12, z1: 30 });
  const p = anchorShape([0, 5, 0, -5], null);
  assert.equal(p.rings.length, 2); assert.equal(p.stub, null);
  assert.equal(anchorShape([], null).rings.length, 0);
  assert.equal(anchorShape([3, 3], { x: 3, z: 3.1 }).stub, null, 'a door on its node has no stub to draw');
});

test('turning the building moves its ring and stub consistently', () => {
  const door = [0, 2, 0, 1, 0, 6];
  const at = rot => { const dw = doorInWorld(door, 50, 50, rot); const th = rot * Math.PI / 4; const n = [50 + 6 * Math.sin(th), 50 + 6 * Math.cos(th)]; return anchorShape(n, dw); };
  for (let rot = 0; rot < 8; rot++) {
    const s = at(rot); const st = s.stub;
    assert.ok(Math.abs(Math.hypot(st.x1 - 50, st.z1 - 50) - 6) < 1e-9, 'the ring stays on the plot edge');
    assert.ok(Math.abs(Math.hypot(st.x0 - 50, st.z0 - 50) - 2) < 1e-9, 'the door stays at its place');
    const th = rot * Math.PI / 4; assert.ok(Math.abs((st.x1 - st.x0) * Math.sin(th) + (st.z1 - st.z0) * Math.cos(th) - 4) < 1e-9, 'the stub points out of the door, along the way it faces');
  }
});

test('the road mesh draws a road under a gate or a toll house (kind 2) and nothing where a bridge stands', () => {
  const flat = lines => lines.flatMap(l => [l.kind, 0, l.pts.length / 2, ...l.pts]);
  const gate = buildRoadMesh(flat([{ kind: 2, pts: [0, -3.8, 0, 3.8] }]), 1.15);
  assert.ok(gate.idx.length >= 12 && gate.x.length > 6, 'a ribbon under the gate');
  assert.ok(gate.z.every(z => z > -3.8 - 2 && z < 3.8 + 2) && Math.max(...gate.x) - Math.min(...gate.x) < 4, 'between its two nodes and narrower than the building');
  // no line comes from the core for a bridge or a drawbridge, so no geometry
  const none = buildRoadMesh(flat([]), 1.15);
  assert.equal(none.idx.length, 0); assert.equal(none.x.length, 0);
  // a road that ends at a bridge node stops there: its line does not reach over the deck
  const road = buildRoadMesh(flat([{ kind: 1, pts: [0, 0, 6, 0, 12, 0] }]), 1.15);
  assert.ok(Math.max(...road.x) < 12 + 1.15 * 1.4 + 0.01, 'the road ends at its node');
});
