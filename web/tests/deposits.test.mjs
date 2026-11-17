import test from 'node:test';
import assert from 'node:assert/strict';
import { deposit_near } from '../src/render/depositcull.ts';

test('a deposit is drawn only within the view radius of the camera target', () => {
  assert.equal(deposit_near(10, 0, 0, 0, 10), true);
  assert.equal(deposit_near(10.1, 0, 0, 0, 10), false);
  assert.equal(deposit_near(-300, 400, 0, 0, 500), true);
  assert.equal(deposit_near(-300, 400, 0, 0, 499), false);
  assert.equal(deposit_near(1000, 1000, 0, 0, 200), false);
});
