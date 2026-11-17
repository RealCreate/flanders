// What wells, yards and towers reach: the coverage rules the interface draws (src/coverage.ts), under plain node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRadii, describe, labelFor, ringParams, coverState, uncoveredByWells, wallsOutOfReach, styleOf, STRIDE, FX_FIRE_FULL, FX_FIRE_HALF, FX_SPARK_GUARD, FX_YARD_HELP, FX_SHOOT, FX_SHOOT_MIN } from '../src/coverage.ts';

// the shape the core gives (radii.rs): a well and a tower
const WELL = parseRadii('[{"r":18,"fx":0,"pct":100},{"r":36,"fx":1,"pct":50},{"r":16,"fx":2,"pct":50}]');
const TOWER = parseRadii('[{"r":22,"fx":4,"pct":100}]');
const row = (kind, x, z, extra = {}) => [kind, extra.tier ?? 0, x, z, 0, 0, 4, 0, extra.staff ?? 0, 0];
const flat = rows => Float32Array.from(rows.flat());

test('radii are read as given and empty answers are fine', () => {
  assert.deepEqual(WELL.map(e => e.r), [18, 36, 16]);
  assert.deepEqual(parseRadii('[]'), []);
  assert.deepEqual(parseRadii('[{"r":0,"fx":0,"pct":1}]'), [], 'a zero radius draws nothing');
});

test('the words for a well and a tower come from the radii', () => {
  assert.equal(labelFor(WELL), 'Fire help: 18 full / 36 half');
  const lines = describe(WELL); assert.equal(lines.length, 2);
  assert.match(lines[1].text, /within 16/);
  assert.equal(describe(TOWER)[0].text, 'Archers shoot 22'); assert.equal(describe(TOWER)[0].icon, 'archer');
  assert.match(describe([...TOWER, { r: 5, fx: FX_SHOOT_MIN, pct: 100 }])[0].text, /not closer than 5/);
  assert.match(describe([{ r: 45, fx: FX_YARD_HELP, pct: 100 }])[0].text, /within 45/);
  assert.deepEqual(describe([]), []);
});

test('rings: blue for water, orange-red for shooting, a minimum range is dashed', () => {
  assert.ok(styleOf(FX_FIRE_FULL).color !== styleOf(FX_SHOOT).color);
  assert.equal(styleOf(FX_SHOOT_MIN).dashed, true); assert.equal(styleOf(FX_SHOOT).dashed, false);
  assert.equal(styleOf(FX_FIRE_HALF).dashed, false); assert.equal(styleOf(FX_SPARK_GUARD).dashed, true);
  assert.ok(styleOf(999).color, 'an unknown effect still draws');
});

test('ring geometry: a round outline, a thin rim, bounded cost', () => {
  for (const r of [16, 18, 22, 27.5, 36, 45]) {
    const p = ringParams(r);
    assert.ok(p.segments >= 48 && p.segments <= 128 && p.segments % 8 === 0, `segments ${p.segments}`);
    assert.ok(p.stacks >= 4 && p.stacks <= 12);
    assert.ok(p.rim > 0 && p.rim <= 0.045, 'the rim stays thin');
    assert.ok(p.rim * r <= 1.5, `rim of ${(p.rim * r).toFixed(2)} units on r=${r}`);
  }
  assert.ok(ringParams(45).segments >= ringParams(16).segments, 'bigger rings get at least as many segments');
});

test('which buildings a well covers: full, half, or none', () => {
  const wells = [{ x: 0, z: 0 }];
  assert.equal(coverState(10, 0, wells, 18, 36), 2);
  assert.equal(coverState(18, 0, wells, 18, 36), 2, 'the edge counts, as in the core (<=)');
  assert.equal(coverState(18.1, 0, wells, 18, 36), 1);
  assert.equal(coverState(36, 0, wells, 18, 36), 1);
  assert.equal(coverState(36.1, 0, wells, 18, 36), 0);
  assert.equal(coverState(0, 5, [], 18, 36), 0, 'no wells, no cover');
  assert.equal(coverState(30, 0, [{ x: 0, z: 0 }, { x: 25, z: 0 }], 18, 36), 2, 'the nearer well decides');
});

test('the list of buildings no well reaches', () => {
  const f = flat([row(16, 0, 0), row(0, 10, 0), row(0, 30, 0), row(0, 60, 0), row(1, 0, 40), row(2, 100, 100), row(0, 200, 0, { tier: 2 })]);
  const burns = (k, t) => k !== 2 && t < 2;
  assert.deepEqual(uncoveredByWells(f, 16, 18, 36, burns), [3, 4], 'the farm at 40 and the house at 60; the well itself, the wall and the stone house are left out');
  assert.deepEqual(uncoveredByWells(flat([row(0, 5, 5)]), 16, 18, 36, burns), [0], 'no well at all: everything that burns is bare');
  assert.deepEqual(uncoveredByWells(new Float32Array(0), 16, 18, 36, burns), []);
  assert.equal(STRIDE, 10);
});

test('wall pieces no manned tower reaches', () => {
  const walls = new Set([2, 22]);
  const f = flat([row(3, 0, 0), row(2, 10, 0), row(2, 22, 0), row(2, 30, 0), row(22, 0, 25), row(0, 99, 99)]);
  assert.deepEqual(wallsOutOfReach(f, walls, [{ x: 0, z: 0, r: 22 }]), [3, 4], 'beyond 22 from the tower; the house is not a wall');
  assert.deepEqual(wallsOutOfReach(f, walls, [{ x: 0, z: 0, r: 22 }, { x: 30, z: 0, r: 22 }]), [4], 'a second tower covers the far piece');
  assert.deepEqual(wallsOutOfReach(f, walls, []), [1, 2, 3, 4], 'no manned tower: every piece is bare');
});
