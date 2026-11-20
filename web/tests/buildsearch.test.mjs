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

test('resource searches favor producers and match alternate recipes', () => {
  const search = buildSearch([
    { id: 9, category: 3, name: 'Iron Mine', outputs: ['Iron ore'] },
    { id: 12, category: 3, name: 'Smelter', outputs: ['Iron'] },
    { id: 18, category: 1, name: 'Hunter’s Lodge', description: 'Meat can become smoked meat.' },
    { id: 42, category: 3, name: 'Smokehouse', outputs: ['Smoked fish', 'Smoked meat'] },
  ]);
  assert.deepEqual(search('iron', -1), [12, 9]);
  assert.deepEqual(search('ironore', -1), [9]);
  assert.deepEqual(search('smoked meat', -1), [42, 18]);
  assert.deepEqual(search('smok mea', 3), [42]);
});

test('stables can be found by name, horses and transport terms', () => {
  const search = buildSearch([{ id: 47, category: 5, name: 'Stable', keywords: ['stables', 'horse', 'horses', 'packhorse', 'caravan', 'transport'] }]);
  for (const query of ['stable', 'stables', 'horse', 'packhorse', 'caravan', 'transport']) assert.deepEqual(search(query, -1), [47]);
});
