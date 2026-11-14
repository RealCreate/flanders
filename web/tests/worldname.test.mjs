import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanWorld, withWorld, inviteLink, DEFAULT_WORLD } from '../src/worldname.ts';

test('names are normalised so friends land in the same room', () => {
  assert.equal(cleanWorld('Flanders'), 'flanders'); assert.equal(cleanWorld('  Hainaut  '), 'hainaut'); assert.equal(cleanWorld('Big   Map'), 'big map');
});
test('empty, missing or hostile names fall back or lose their markup', () => {
  assert.equal(cleanWorld(''), DEFAULT_WORLD); assert.equal(cleanWorld(null), DEFAULT_WORLD); assert.equal(cleanWorld('   '), DEFAULT_WORLD);
  assert.equal(cleanWorld('<img src=x onerror=1>'), 'img src=x onerror=1'); assert.equal(cleanWorld('a‮b\u0000c'), 'abc');
  assert.equal(cleanWorld('x'.repeat(100)).length, 40);
});
test('numeric seeds survive', () => { assert.equal(cleanWorld('12345'), '12345'); });
test('the address keeps other parameters and carries the world', () => {
  assert.equal(withWorld('https://a.example/flanders/?player=x', 'Brabant'), 'https://a.example/flanders/?player=x&world=brabant');
  assert.equal(withWorld('https://a.example/flanders/?world=old', 'zeeland'), 'https://a.example/flanders/?world=zeeland');
});
test('an invite link carries the world and nothing private', () => {
  const l = inviteLink('https://a.example/flanders/?agent=8765&token=secret&player=me&cheats=1#x', 'Holland');
  assert.equal(l, 'https://a.example/flanders/?world=holland');
});
