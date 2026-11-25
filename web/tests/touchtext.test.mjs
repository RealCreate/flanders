import test from 'node:test';
import assert from 'node:assert/strict';
import { touchWording } from '../src/touchtext.ts';

test('mouse words become touch words', () => {
  assert.equal(touchWording('Click the ground to build'), 'Tap the ground to build');
  assert.equal(touchWording('right-click sends the selected army there'), 'hold sends the selected army there');
  assert.equal(touchWording('Right-click to cancel'), 'Hold to cancel');
  assert.equal(touchWording('click to select · Shift+click adds · double-click selects every army in view'), 'tap to select · tap with Select more on adds · double-tap selects every army in view');
  assert.equal(touchWording('Click twice to clear it'), 'Tap twice to clear it');
  assert.equal(touchWording('when clicked, and clicking again'), 'when tapped, and tapping again');
});
test('text without mouse words is unchanged, and words that only contain "click" are left alone', () => {
  assert.equal(touchWording('Plant trees, 4 wide'), 'Plant trees, 4 wide');
  assert.equal(touchWording('a clickable banner'), 'a clickable banner');
});
