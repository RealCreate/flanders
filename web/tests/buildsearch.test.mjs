import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearch } from '../src/buildsearch.ts';

const find = buildSearch([
  { id: 22, category: 4, name: 'Gate', description: 'Opens a path through the wall.' },
  { id: 3, category: 4, name: 'Watchtower', keywords: ['Stone Tower'], description: 'Station archers inside.' },
  { id: 5, category: 3, name: 'Sawmill', keywords: ['Planks'] },
  { id: 35, category: 5, name: 'Port', keywords: ['Harbour', 'Harbor'], description: 'Merchant ships call here.' },
  { id: 37, category: 7, name: 'Road' },
  { id: 99, category: 6, name: 'Level Ground', keywords: ['Flatten'] },
]);

test('construction search prioritizes names and finds mixed case, aliases and outputs', () => {
  assert.deepEqual(find('  WATCH-tower ', -1), [3]);
  assert.deepEqual(find('stone tower', -1), [3]);
  assert.deepEqual(find('planks', -1), [5]);
  assert.deepEqual(find('harbor', -1), [35]);
  assert.deepEqual(find('flatten', -1), [99]);
  assert.deepEqual(find('path', -1), [22]);
});

test('search combines with category filters and preserves catalog order when cleared', () => {
  assert.deepEqual(find('harbor', 4), []);
  assert.deepEqual(find('', 4), [22, 3]);
  assert.deepEqual(find('', -1), [22, 3, 5, 35, 37, 99]);
});
