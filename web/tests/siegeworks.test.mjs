import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIEGE_STRIDE, parseSiege } from '../src/render/siegeworks.ts';

test('the siege record is seven numbers wide and the core writes it that way', () => {
  assert.equal(SIEGE_STRIDE, 7);
  const core = readFileSync(new URL('../../crates/game-core/src/siege.rs', import.meta.url), 'utf8');
  assert.match(core, /\[0\.0, t\.x, t\.y, t\.face, .*t\.state as f32, t\.carried as f32\]/);
  assert.match(core, /\[1\.0, s\.x, s\.y, s\.face, .*s\.state as f32, 0\.0\]/);
});

test('towers and saps are told apart', () => {
  const items = parseSiege([0, 10, 20, 1.5, 0.75, 1, 4, 1, 30, 40, 0, 0.5, 0, 0]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { kind: 'tower', x: 10, z: 20, face: 1.5, share: 0.75, state: 1, carried: 4 });
  assert.equal(items[1].kind, 'sap'); assert.equal(items[1].share, 0.5);
  assert.deepEqual(parseSiege([]), []);
  assert.equal(parseSiege([0, 1, 2]).length, 0, 'a cut-off record is ignored');
});
