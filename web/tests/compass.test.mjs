import test from 'node:test';
import assert from 'node:assert/strict';
import { compassWord } from '../src/ui/compass.ts';
test('compass words follow the map: +x east, +z south', () => {
  assert.equal(compassWord(1, 0), 'east'); assert.equal(compassWord(0, 1), 'south');
  assert.equal(compassWord(-1, -1), 'north-west'); assert.equal(compassWord(0, -1), 'north');
  assert.equal(compassWord(Math.cos(2.4), Math.sin(2.4)), 'south-west');
});
