import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBackup, checkBackup } from '../src/backup.ts';

const b64 = a => Buffer.from(a).toString('base64');
async function identity() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return JSON.stringify({ priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64(await crypto.subtle.exportKey('raw', kp.publicKey)) });
}
const save = (n = 2) => JSON.stringify({ site: 0, name: 'x', savedAt: 1, tick: 10, log: Array.from({ length: n }, (_, i) => ({ cmd: JSON.stringify({ op: 'hero', tick: i, n: i }), sig: 'AAAA' })) });
const file = items => ({ format: 'flanders-backup', version: 1, created: '2026-01-01T00:00:00Z', items });

test('a backup of a real key and save is accepted', async () => {
  const items = { 'flanders:identity': await identity(), 'flanders:save:v7:flanders': save(), 'flanders:name': 'Aldric' };
  assert.deepEqual(Object.keys(await checkBackup(file(items))).sort(), Object.keys(items).sort());
});
test('collectBackup takes only known keys and leaves secrets such as the TURN password out', () => {
  const store = new Map([['flanders:identity', '{}'], ['flanders:turn', 'secret'], ['flanders:save:v7:w', '{}'], ['other:thing', '1'], ['flanders:settings', '{}']]);
  const storage = { get length() { return store.size; }, key: i => [...store.keys()][i], getItem: k => store.get(k) ?? null };
  assert.deepEqual(Object.keys(collectBackup(storage).items).sort(), ['flanders:identity', 'flanders:save:v7:w']);
});
test('foreign keys, wrong formats and non-strings are refused', async () => {
  await assert.rejects(checkBackup(null)); await assert.rejects(checkBackup({ format: 'x' }));
  await assert.rejects(checkBackup(file({ 'flanders:turn': 'x' })), /unexpected/);
  await assert.rejects(checkBackup(file({ 'evil': 'x' })), /unexpected/);
  await assert.rejects(checkBackup(file({ 'flanders:name': 5 })), /unexpected/);
  await assert.rejects(checkBackup(file({})), /empty/);
});
test('a key whose public half does not match is refused', async () => {
  const a = JSON.parse(await identity()), b = JSON.parse(await identity());
  await assert.rejects(checkBackup(file({ 'flanders:identity': JSON.stringify({ priv: a.priv, pub: b.pub }) })), /does not match/);
});
test('a private key of the wrong type is refused', async () => {
  const bad = { priv: { kty: 'RSA', n: 'x', e: 'AQAB' }, pub: 'A'.repeat(44) };
  await assert.rejects(checkBackup(file({ 'flanders:identity': JSON.stringify(bad) })), /not valid/);
  await assert.rejects(checkBackup(file({ 'flanders:identity': '{' })), /damaged/);
});
test('damaged or oversized saves are refused', async () => {
  await assert.rejects(checkBackup(file({ 'flanders:save:v7:w': '{' })), /damaged/);
  await assert.rejects(checkBackup(file({ 'flanders:save:v7:w': JSON.stringify({ site: 0, tick: 1, log: [{ cmd: 5, sig: 'x' }] }) })), /not valid/);
  await assert.rejects(checkBackup(file({ 'flanders:save:v7:w': JSON.stringify({ site: -1, tick: 1, log: [] }) })), /not valid/);
  await assert.rejects(checkBackup(file({ 'flanders:save:v7:w': JSON.stringify({ site: 0, tick: 1, log: new Array(60001).fill({ cmd: '{}', sig: 'x' }) }) })), /not valid/);
});
