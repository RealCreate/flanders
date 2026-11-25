import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDevice, touchDefaults } from '../src/device.ts';

test('a computer stays a desktop, touch screen or not', () => {
  assert.equal(classifyDevice({ coarse: false, shortSide: 900 }), 'desktop');
  assert.equal(classifyDevice({ coarse: false, shortSide: 400, maxTouchPoints: 10, userAgent: 'Windows' }), 'desktop');
});
test('a finger-driven screen is a phone below 600 css pixels, a tablet above', () => {
  assert.equal(classifyDevice({ coarse: true, shortSide: 390 }), 'phone');
  assert.equal(classifyDevice({ coarse: true, shortSide: 768 }), 'tablet');
  assert.equal(classifyDevice({ coarse: true, shortSide: 834 }), 'tablet');
});
test('iPadOS asking for the desktop site is still a tablet', () => {
  assert.equal(classifyDevice({ coarse: false, shortSide: 820, maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }), 'tablet');
  assert.equal(classifyDevice({ coarse: false, shortSide: 820, maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }), 'desktop');
});
test('touch devices start without multisampling and with a frame limit; desktops get no override', () => {
  for (const c of ['phone', 'tablet']) { const d = touchDefaults(c); assert.equal(d.antialias, false); assert.equal(d.fpsCap, 60); assert.ok(d.pixelCap <= 1.5); }
  assert.equal(touchDefaults('phone').quality, 'low');
  assert.equal(touchDefaults('desktop'), null);
});
