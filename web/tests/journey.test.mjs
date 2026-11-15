// The maths of journeys between villages: where a procession is on its road, how a road is trimmed, who walks in each kind of procession.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JK, makeRoad, pointAt, headingAt, trim, fade, progress, TickClock, party, spanOf, cartsFor, parseJourneys, describe, JOURNEY_STRIDE } from '../src/render/journey.ts';

const L = [0, 0, 30, 0, 30, 40, 90, 40];   // 30 east, 40 south, 60 east: 130 long

test('a road measures itself and a point on it lies on the polyline, in order', () => {
  const r = makeRoad(L); assert.equal(r.len, 130);
  let prev = -1;
  for (let s = 0; s <= 130; s += 5) {
    const p = pointAt(r, s);
    const onLine = (p.z === 0 && p.x >= 0 && p.x <= 30) || (p.x === 30 && p.z >= 0 && p.z <= 40) || (p.z === 40 && p.x >= 30 && p.x <= 90);
    assert.ok(onLine, `s=${s} at ${p.x},${p.z}`);
    const along = p.x + p.z; assert.ok(along > prev, 'monotone'); prev = along;   // (this road only ever goes east and south)
  }
  assert.deepEqual([pointAt(r, -5).x, pointAt(r, 999).x], [0, 90], 'clamped to the ends');
});

test('figures face the way the road goes and turn round a corner gradually', () => {
  const r = makeRoad(L);
  assert.ok(Math.abs(pointAt(r, 10).yaw - Math.PI / 2) < 1e-9, 'east');
  const a = headingAt(r, 20), b = headingAt(r, 28), c = headingAt(r, 30), d = headingAt(r, 32), e = headingAt(r, 45);
  assert.ok(Math.abs(a - Math.PI / 2) < 1e-9 && Math.abs(e) < 1e-9, 'east, then south');
  assert.ok(b < a && b > c && c > d && d > e - 1e-9, `a smooth turn: ${[a, b, c, d, e].map(v => v.toFixed(2))}`);
});

test('trimming takes the ends off a road and keeps its corners', () => {
  const t = trim(L, 10, 20), r = makeRoad(t);
  assert.ok(Math.abs(r.len - 100) < 1e-9); assert.deepEqual(t.slice(0, 2), [10, 0]); assert.deepEqual(t.slice(-2), [70, 40]);
  assert.deepEqual(t.slice(2, 6), [30, 0, 30, 40]);
  assert.deepEqual(trim(L, 100, 100), L, 'a road too short to trim is kept whole');
});

test('a figure grows in at the start of the road and shrinks away at the end', () => {
  assert.equal(fade(-1, 100), 0); assert.equal(fade(0, 100), 0); assert.equal(fade(50, 100), 1); assert.equal(fade(100, 100), 0); assert.equal(fade(101, 100), 0);
  let prev = 0; for (let s = 0; s <= 3; s += 0.25) { const f = fade(s, 100); assert.ok(f >= prev); prev = f; }
});

test('progress runs from 0 at setting out to 1 on the tick the effect happens', () => {
  const j = { kind: JK.ENVOY, to: 7, a: 0, b: 0, escort: 0, start: 100, arrive: 300 };
  assert.deepEqual([progress(j, 50), progress(j, 100), progress(j, 200), progress(j, 300), progress(j, 999)], [0, 0, 0.5, 1, 1]);
});

test('the tick drawn only moves forward, never runs past the next tick, does not creep while paused and jumps when the copy is rebuilt', () => {
  const c = new TickClock(); let prev = -1, t = 0;
  for (let f = 0; f < 600; f++) {
    t += 1 / 60; const tick = Math.floor(t * 2.5);   // 2.5 ticks a second, 60 frames a second
    const s = c.update(tick, t, 1 / 60); assert.ok(s >= prev - 1e-9, `frame ${f} went back: ${s} < ${prev}`); assert.ok(s < tick + 1, `frame ${f}: ${s} ahead of tick ${tick}`); prev = s;
  }
  const paused = Math.floor(t * 2.5);
  for (let f = 0; f < 600; f++) { t += 1 / 60; const s = c.update(paused, t, 1 / 60); assert.ok(s < paused + 1 && s >= prev - 1e-9); prev = s; }
  c.update(1000, t + 1, 1 / 60); assert.ok(c.shown >= 1000 - 1e-6 && c.shown < 1001, 'a rebuilt copy jumps rather than glides');
});

test('each kind of journey has its own cast', () => {
  const mk = (kind, extra = {}) => ({ kind, to: 7, a: 0, b: 40, escort: 0, start: 0, arrive: 100, ...extra });
  const sig = (j) => party(j).map(u => u.role).sort().join(',');
  const kinds = [JK.TRADE, JK.PEACE, JK.ALLIANCE, JK.ENVOY, JK.MARRIAGE, JK.WAR, JK.CARAVAN];
  assert.equal(new Set(kinds.map(k => sig(mk(k)))).size, kinds.length, 'every kind looks different');
  const has = (j, role) => party(j).some(u => u.role === role);
  assert.ok(has(mk(JK.TRADE), 'courier') && has(mk(JK.PEACE), 'white-flag') && has(mk(JK.PEACE), 'olive') && has(mk(JK.ENVOY), 'gift-horse') && has(mk(JK.MARRIAGE), 'carriage') && has(mk(JK.WAR), 'war-rider'));
  assert.equal(party(mk(JK.ALLIANCE)).filter(u => u.role === 'standard').length, 2, 'two banners');
  assert.equal(party(mk(JK.WAR)).length, 1, 'war rides alone');
  assert.ok(party(mk(JK.MARRIAGE)).filter(u => u.role === 'outrider').length >= 3, 'riders with the carriage');
  assert.ok(!has(mk(JK.CARAVAN), 'guard-rider') && has(mk(JK.CARAVAN, { escort: 3 }), 'guard-rider'), 'an escort rides only when sent');
});

test('a bigger caravan has more carts, up to six, and a longer line', () => {
  assert.deepEqual([1, 90, 91, 200, 300, 500].map(cartsFor), [1, 1, 2, 3, 4, 6]);
  const cart = (b) => party({ kind: JK.CARAVAN, to: 7, a: 0, b, escort: 0, start: 0, arrive: 10 });
  assert.equal(cart(500).filter(u => u.role === 'cart').length, 6); assert.ok(spanOf(cart(500)) > spanOf(cart(50)));
});

test('the core list is read in sevens and a journey is described by its parties', () => {
  const j = parseJourneys([6, 7, 0, 50, 2, 10, 300, 4, 7, 0, 0, 0, 20, 90]); assert.equal(j.length, 2); assert.equal(JOURNEY_STRIDE, 7);
  assert.deepEqual(j[0], { kind: 6, to: 7, a: 0, b: 50, escort: 2, start: 10, arrive: 300 });
  assert.equal(describe(j[0], 'you', 'Gerald', 'wood'), 'Caravan from you to Gerald: 50 wood');
  assert.ok(describe(j[1], 'Anna', 'you').includes('Wedding'));
});
