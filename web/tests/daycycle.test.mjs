import test from 'node:test';
import assert from 'node:assert/strict';
import { dayPhase, sunElevation, nightFactor, clockText, DAY_TICKS } from '../src/daycycle.ts';

test('the game opens in the morning and a day lasts 240 ticks', () => {
  assert.ok(sunElevation(dayPhase(0)) > 0, 'tick 0 is daylight');
  assert.ok(Math.abs(dayPhase(DAY_TICKS) - dayPhase(0)) < 1e-9, 'a day later it is the same time');
  assert.ok(dayPhase(12345.6) >= 0 && dayPhase(12345.6) < 1);
});
test('noon is bright, midnight is dark, and it is dim around sunset', () => {
  assert.equal(nightFactor(0.5), 0); assert.equal(nightFactor(0), 1);
  assert.ok(nightFactor(0.75) > 0.2 && nightFactor(0.75) < 0.9, 'twilight at sunset');
  assert.ok(sunElevation(0.5) > 50 && sunElevation(0) < -50 && Math.abs(sunElevation(0.25)) < 1e-9);
});
test('night falls smoothly: no jump between neighbouring moments', () => {
  let last = nightFactor(0); for (let i = 1; i <= 2400; i++) { const n = nightFactor(i / 2400); assert.ok(Math.abs(n - last) < 0.02, 'jump at ' + i); last = n; }
});
test('the clock reads 06:00 at sunrise and 12:00 at noon', () => {
  assert.equal(clockText(0.25), '06:00'); assert.equal(clockText(0.5), '12:00'); assert.equal(clockText(0), '00:00'); assert.equal(clockText(0.999), '23:58');
});
