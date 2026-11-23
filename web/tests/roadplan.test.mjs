// Where the design options of a road put their things (src/render/roadplan.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { planRoadProps, GAP, VERGE, CLEAR_ENDS } from '../src/render/roadplan.ts';
import { ROAD_OPT } from '../src/render/roadlook.ts';

const line = (opts, pts, tier = 1) => ({ kind: 1, born: 0, tier, opts, pts });
const straight = (len, step = 1.5) => { const p = []; for (let x = 0; x <= len; x += step) p.push(x, 0); return p; };
const count = (props, kind) => props.filter(p => p.kind === kind).length;

test('a road with no design has nothing beside it, and a stub or a gate road never does', () => {
  assert.deepEqual(planRoadProps([line(0, straight(60))]), []);
  assert.deepEqual(planRoadProps([{ kind: 0, born: 0, tier: 0, opts: 15, pts: straight(60) }, { kind: 2, born: 0, tier: 0, opts: 15, pts: straight(60) }]), []);
});

test('trees stand on both verges at an even gap, clear of the two ends', () => {
  const props = planRoadProps([line(ROAD_OPT.trees, straight(100))]);
  assert.ok(props.every(p => p.kind === 'tree'));
  const left = props.filter(p => p.z > 0), right = props.filter(p => p.z < 0);
  assert.ok(left.length >= 9 && right.length >= 9 && Math.abs(left.length - right.length) <= 1, `${left.length} and ${right.length}`);
  for (const p of props) { assert.ok(Math.abs(p.z) > VERGE, `off the road: ${p.z}`); assert.ok(p.x >= CLEAR_ENDS - GAP.tree && p.x <= 100 - CLEAR_ENDS + GAP.tree, 'near the ends only by the jitter'); }
  const xs = left.map(p => p.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] > 4 && xs[i] - xs[i - 1] < 14, 'spaced');
});

test('hedges and flower beds line the verge close to the road, benches and lanterns alternate sides', () => {
  const props = planRoadProps([line(ROAD_OPT.hedges | ROAD_OPT.benches | ROAD_OPT.lanterns, straight(120), 2)]);
  assert.ok(count(props, 'hedge') > 40 && count(props, 'flowers') > 8);
  const benches = props.filter(p => p.kind === 'bench'), lamps = props.filter(p => p.kind === 'lantern');
  assert.ok(benches.length >= 4 && lamps.length >= 7, `${benches.length} benches ${lamps.length} lanterns`);
  lamps.sort((a, b) => a.x - b.x); for (let i = 1; i < lamps.length; i++) assert.ok(Math.sign(lamps[i].z) !== Math.sign(lamps[i - 1].z) || Math.abs(lamps[i].x - lamps[i - 1].x) > GAP.lantern * 1.5, 'alternating');
  for (const h of props.filter(p => p.kind === 'hedge')) assert.ok(Math.abs(h.z) < 3 && Math.abs(h.z) > VERGE, 'close to the road');
});

test('a bench and a lantern face the road, a hedge lies along it', () => {
  const props = planRoadProps([line(ROAD_OPT.benches | ROAD_OPT.hedges, straight(80))]);
  for (const p of props) {
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);   // the local +z of the model
    if (p.kind === 'bench') assert.ok(fz * -Math.sign(p.z) > 0.99, `faces the road (${fz.toFixed(2)})`);
    if (p.kind === 'hedge') assert.ok(Math.abs(Math.cos(p.yaw)) > 0.99, 'long side along the road');
  }
});

test('nothing stands on another road or on bad ground, and no two things share a place', () => {
  const lines = [line(ROAD_OPT.trees | ROAD_OPT.lanterns, straight(100)), line(0, [50, -40, 50, -20, 50, 0, 50, 20, 50, 40])];
  const props = planRoadProps(lines);
  assert.ok(props.length > 10);
  for (const p of props) assert.ok(Math.abs(p.x - 50) > VERGE, `${p.kind} at ${p.x} stands in the crossing road`);
  const wet = planRoadProps([line(ROAD_OPT.trees, straight(100))], (x, z) => x < 50);
  assert.ok(wet.length > 0 && wet.every(p => p.x < 50));
  for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) assert.ok(Math.hypot(props[i].x - props[j].x, props[i].z - props[j].z) > 0.45, 'apart');
});

test('a very short stretch has nothing, and the plan is the same every time', () => {
  assert.deepEqual(planRoadProps([line(15, straight(6))]), []);
  const a = planRoadProps([line(15, straight(90))]), b = planRoadProps([line(15, straight(90))]);
  assert.deepEqual(a, b);
});

test('a curved road gets its things on the outside and the inside of the curve, never on the road', () => {
  const p = []; for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI; p.push(Math.cos(a) * 25, Math.sin(a) * 25); }
  const props = planRoadProps([line(ROAD_OPT.trees | ROAD_OPT.hedges, p)]);
  assert.ok(props.length > 10);
  for (const q of props) { const r = Math.hypot(q.x, q.z); assert.ok(Math.abs(r - 25) > VERGE - 0.3, `${q.kind} at radius ${r.toFixed(2)}`); }
});
