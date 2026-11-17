import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_SIZES, DEFAULT_LEVEL_SIZE, nextLevelSize, levelSizesValid } from '../src/leveltool.ts';
import { sanitizeCmd, parseCmd, PEER_OPS } from '../src/net/validate.ts';

test('the sizes are inside what the core accepts and the R key cycles through them', () => {
  assert.ok(levelSizesValid()); assert.ok(LEVEL_SIZES.includes(DEFAULT_LEVEL_SIZE));
  let r = LEVEL_SIZES[0]; const seen = [];
  for (let i = 0; i < LEVEL_SIZES.length; i++) { seen.push(r); r = nextLevelSize(r); }
  assert.deepEqual(seen, LEVEL_SIZES); assert.equal(r, LEVEL_SIZES[0], 'wraps round');
  assert.equal(nextLevelSize(7), DEFAULT_LEVEL_SIZE);
});

test('level is a command peers may send, with a sane middle and radius', () => {
  assert.ok(PEER_OPS.includes('level'));
  assert.deepEqual(sanitizeCmd({ op: 'level', tick: 4, n: 2, x: -12, y: 30, kind: 8, evil: 1 }), { op: 'level', tick: 4, n: 2, x: -12, y: 30, kind: 8 });
  for (const bad of [{ kind: 2 }, { kind: 15 }, { kind: 8.5 }, { x: 1.5, kind: 8 }, { x: 5000, kind: 8 }, { y: -5000, kind: 8 }, { x: 0, kind: 8, y: undefined }, { x: 'a', y: 0, kind: 8 }, {}])
    assert.equal(sanitizeCmd({ op: 'level', tick: 1, n: 1, x: 0, y: 0, ...bad }), null, JSON.stringify(bad));
  assert.equal(parseCmd(JSON.stringify({ op: 'level', tick: 1, n: 1, x: 3, y: 4 })), null, 'a radius is required');
});

test('the target height: Auto is the default, a chosen height is kept to half units inside the core\'s range and travels with the command', async () => {
  const { clampLevelHeight, levelHeightLabel, levelWork, LEVEL_AUTO } = await import('../src/leveltool.ts');
  assert.equal(LEVEL_AUTO, -1);
  assert.equal(clampLevelHeight(7.26), 7.5); assert.equal(clampLevelHeight(0), 1); assert.equal(clampLevelHeight(99), 24); assert.equal(clampLevelHeight(NaN), LEVEL_AUTO);
  assert.equal(levelHeightLabel(-1), 'Auto'); assert.equal(levelHeightLabel(6), '6.0');
  assert.deepEqual(levelWork(3, 5), { kind: 'fill', by: 2 }); assert.deepEqual(levelWork(5, 3), { kind: 'cut', by: 2 }); assert.equal(levelWork(5, 5.1).kind, 'even');
  const ok = { op: 'level', tick: 4, n: 2, x: -12, y: 30, kind: 8 };
  assert.deepEqual(sanitizeCmd({ ...ok, h: 7.5 }), { ...ok, h: 7.5 }, 'an explicit height is kept');
  assert.deepEqual(sanitizeCmd(ok), ok, 'older logs without a height mean Auto');
  assert.deepEqual(sanitizeCmd({ ...ok, h: -1 }), { ...ok, h: -1 });
  for (const h of [0.5, 24.5, 1000, 'a', null, NaN]) assert.equal(sanitizeCmd({ ...ok, h }), null, `h ${h}`);
});
