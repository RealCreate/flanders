import test from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_MS, REVIEW_AFTER_MS, STEWARD_SHIFT, VillageWatch, stewardRisks } from '../src/steward.ts';

test('closing the game never creates a simulation debt and an old save opens held', () => {
  const watch = new VillageWatch();
  watch.mode = 'steward';
  watch.openSave(40_000, 91 * 24 * 60 * 60 * 1000);
  assert.deepEqual(watch.review, { ticks: 0, closed: true });
  assert.equal(watch.pace(4, false), 0);
  watch.resume(41_000);
  assert.equal(watch.pace(2, false), 2);
  watch.openSave(42_000, -30_000);
  assert.equal(watch.review, null);
});

test('a hidden tab pauses immediately and a quick tab switch resumes', () => {
  const watch = new VillageWatch();
  watch.resume(1);
  watch.observe(2, true);
  assert.equal(watch.away, true);
  assert.equal(watch.pace(4, false), 0);
  assert.equal(watch.allowStep(() => undefined), false);
  watch.present(8);
  assert.equal(watch.away, false);
  assert.equal(watch.review, null);
  assert.equal(watch.pace(4, false), 4);
  watch.observe(9, true);
  watch.present(9 + REVIEW_AFTER_MS);
  assert.equal(watch.review.ticks, 0);
  assert.equal(watch.pace(4, false), 0);
});

test('an idle visible village waits for explicit resume', () => {
  const watch = new VillageWatch();
  watch.resume(27);
  watch.observe(27 + IDLE_MS - 1, false);
  assert.equal(watch.pace(2, false), 2);
  watch.observe(27 + IDLE_MS, false);
  assert.equal(watch.pace(2, false), 0);
  watch.present(31 + IDLE_MS);
  assert.equal(watch.pace(2, false), 0);
  watch.resume(41 + IDLE_MS);
  assert.equal(watch.pace(2, false), 2);
});

test('the optional steward works at normal speed for one day at most', () => {
  const watch = new VillageWatch();
  watch.mode = 'steward';
  watch.observe(3, true);
  assert.equal(watch.pace(4, false), 1);
  assert.equal(watch.pace(0, false), 0);
  for (let i = 0; i < STEWARD_SHIFT; i++) {
    assert.equal(watch.allowStep(() => undefined), true);
    watch.afterStep(() => undefined);
  }
  assert.equal(watch.allowStep(() => undefined), false);
  assert.equal(watch.pace(4, false), 0);
  watch.present(3 + 2_000 * STEWARD_SHIFT);
  assert.equal(watch.review.ticks, STEWARD_SHIFT);
  assert.equal(watch.review.stop, 'shift');
});

test('the steward holds both existing danger and new danger before another tick', () => {
  const watch = new VillageWatch();
  watch.mode = 'steward';
  watch.observe(1, true);
  assert.equal(watch.allowStep(() => 'raid'), false);
  watch.present(2);
  assert.equal(watch.review.stop, 'raid');
  assert.equal(watch.review.ticks, 0);
  watch.resume(3);
  watch.observe(4, true);
  assert.equal(watch.allowStep(() => undefined), true);
  watch.afterStep(() => 'fire');
  assert.equal(watch.allowStep(() => undefined), false);
  watch.present(2104);
  assert.equal(watch.review.stop, 'fire');
  assert.equal(watch.review.ticks, 1);
  assert.deepEqual(stewardRisks(1 | 4 | 32), ['battle', 'fire', 'wood']);
});

test('a committed multiplayer battle keeps its pace during a pause or absence', () => {
  const watch = new VillageWatch();
  watch.openSave(11, REVIEW_AFTER_MS);
  watch.observe(12, true);
  assert.equal(watch.pace(0, true), 1);
  assert.equal(watch.pace(4, true), 1);
  assert.equal(watch.pace(4, false), 0);
});
