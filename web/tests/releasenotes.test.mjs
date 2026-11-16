import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RELEASES, renderNotes } from '../src/releasenotes.ts';
import { VERSION, versionLabel } from '../src/version.ts';

const SEMVER = /^\d+\.\d+\.\d+$/;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const parts = v => v.split('.').map(Number);
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

test('the version is semver and the newest release notes entry is that version', () => {
  assert.match(pkg.version, SEMVER);
  assert.equal(RELEASES[0].version, pkg.version);
  assert.match(VERSION, SEMVER);   // (outside vite the placeholder is still a valid number)
  assert.ok(versionLabel().startsWith('Version '));
});
test('releases are newest first with unique semver versions and real dates', () => {
  for (const r of RELEASES) { assert.match(r.version, SEMVER); assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(!Number.isNaN(Date.parse(r.date)), r.date); assert.ok(r.title.length > 0); }
  for (let i = 1; i < RELEASES.length; i++) {
    assert.ok(newer(RELEASES[i - 1].version, RELEASES[i].version), `${RELEASES[i - 1].version} before ${RELEASES[i].version}`);
    assert.ok(RELEASES[i - 1].date >= RELEASES[i].date, 'dates do not go forward down the page');
  }
});
test('every release lists at least one item and no item is empty', () => {
  for (const r of RELEASES) {
    const all = [...r.added, ...r.changed, ...r.fixed];
    assert.ok(all.length > 0, r.version);
    for (const i of all) assert.ok(i.trim().length > 0 && !/[\u{1F300}-\u{1FAFF}]/u.test(i), i);
  }
});
test('the page lists every release in order with its groups, and escapes text', () => {
  const html = renderNotes();
  let at = -1;
  for (const r of RELEASES) { const i = html.indexOf(`<h3>${r.version} `); assert.ok(i > at, r.version); at = i; }
  assert.equal((html.match(/<li>/g) ?? []).length, RELEASES.reduce((n, r) => n + r.added.length + r.changed.length + r.fixed.length, 0));
  assert.ok(html.includes('<h4>New</h4>') && html.includes('<h4>Changed</h4>') && html.includes('<h4>Fixed</h4>'));
  const evil = renderNotes([{ version: '9.9.9', date: '2030-01-01', title: '<b>x</b>', added: ['<img src=x onerror=1>'], changed: [], fixed: [] }]);
  assert.ok(!evil.includes('<img') && !evil.includes('<b>') && !evil.includes('<h4>Changed'));
});
