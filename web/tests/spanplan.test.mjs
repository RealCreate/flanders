import test from 'node:test';
import assert from 'node:assert/strict';
import { planSpan, supportPositions, deckHeight, WIDTH, PIER_GAP } from '../src/render/spanplan.ts';

const base = (length, tier, extra = {}) => ({ length, tier, hA: 6, hB: 6, bed: () => -1.4, options: 0, ...extra });

test('a short span needs no supports, a long one gets them evenly spaced between the banks', () => {
  for (const tier of [0, 1, 2, 3]) assert.deepEqual(supportPositions(8, tier), [], `tier ${tier}: a short crossing has none`);
  const p = supportPositions(24, 0); assert.ok(p.length >= 3, `wood: ${p.length}`);
  const gaps = p.slice(1).map((v, i) => v - p[i]); assert.ok(gaps.every(g => Math.abs(g - gaps[0]) < 1e-9 && g <= PIER_GAP[0] + 1e-9), 'evenly spaced, no gap wider than the tier allows');
  assert.ok(p.every(s => s > -12 + 1.6 && s < 12 - 1.6), 'all over the water, none on the banks');
  assert.ok(supportPositions(24, 3).length < p.length, 'a great stone bridge needs fewer piers than a wooden one');
});

test('supports reach from the bed up to the deck', () => {
  const prims = planSpan(base(24, 0)), deck = deckHeight(base(24, 0), 0);
  const posts = prims.filter(q => q.lh > 4 && q.lt < 0.5);
  assert.ok(posts.length >= 6, `wooden trestles: ${posts.length}`);
  for (const q of posts) { const bottom = q.y - q.lh / 2, top = q.y + q.lh / 2; assert.ok(bottom < -1.5 && Math.abs(top - deckHeight(base(24, 0), q.s)) < 0.01, `post at ${q.s}: ${bottom.toFixed(2)}..${top.toFixed(2)} (deck ${deck.toFixed(2)})`); }
});

test('tiers look different: wider decks, stone parapets and a hump', () => {
  assert.ok(WIDTH.every((w, i) => i === 0 || w > WIDTH[i - 1]), 'wider each tier');
  const colors = t => new Set(planSpan(base(20, t)).map(q => q.color)); assert.notDeepEqual([...colors(0)], [...colors(2)]);
  assert.ok(deckHeight(base(20, 2), 0) > deckHeight(base(20, 2), -10) + 0.3, 'a stone bridge arches over the water');
  assert.ok(Math.abs(deckHeight(base(20, 0), 0) - deckHeight(base(20, 0), -10)) < 1e-9, 'a wooden one is level');
  const wood = planSpan(base(20, 0)).filter(q => q.lh > 1.0 && q.lh < 1.3 && q.lt < 0.3).length, stoneP = planSpan(base(20, 2)).filter(q => q.lt > 0.3 && q.lt < 0.4).length;
  assert.ok(wood > 0 && stoneP > 10, 'posts on wood, a parapet on stone');
});

test('the deck follows banks at different heights and optional designs add parts', () => {
  const slope = base(20, 1, { hA: 5, hB: 7 }); assert.ok(Math.abs(deckHeight(slope, -10) - 5.55) < 1e-9 && Math.abs(deckHeight(slope, 10) - 7.55) < 1e-9);
  const plain = planSpan(base(20, 1)).length, lamps = planSpan(base(20, 1, { options: 1 })).length, flags = planSpan(base(20, 1, { options: 2 })).length;
  assert.equal(lamps - plain, 8, 'two lanterns and four posts: 4 posts + 4 lamps'); assert.equal(flags - plain, 4, 'a pole and a cloth at each end');
  assert.ok(planSpan(base(20, 1)).every(q => Number.isFinite(q.s + q.t + q.y + q.ls + q.lt + q.lh)));
});
