import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ICONS, ICON_NAMES, KIND_ICON_NAMES, UNIT_ICON_NAMES, CAT_ICON_NAMES, icon, kindIcon, unitIcon } from '../src/ui/icons.ts';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const slug = s => s.toLowerCase().replace(/[^a-z]/g, '');

/** A small well-formedness check: tags nest and close, attributes are quoted, and there is one root. */
function checkXml(s) {
  const stack = []; let roots = 0, i = 0;
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/y;
  while (i < s.length) {
    if (s[i] !== '<') { assert.ok(!/[<>]/.test(s[i]), `stray ${s[i]} at ${i}`); i++; continue; }
    tag.lastIndex = i; const m = tag.exec(s);
    assert.ok(m, `bad tag at ${i}: ${s.slice(i, i + 50)}`);
    const [all, close, name, , self] = m;
    if (close) { assert.equal(stack.pop(), name, `unbalanced </${name}>`); } else if (!self) { if (!stack.length) roots++; stack.push(name); } else if (!stack.length) roots++;
    i += all.length;
  }
  assert.equal(stack.length, 0, 'unclosed tags'); assert.equal(roots, 1, 'one root element');
}

test('every resource has an icon of its own', () => {
  const keys = [...read('../src/data.ts').matchAll(/key: '(\w+)', name:/g)].map(m => m[1]);
  assert.equal(keys.length, 12);
  for (const k of keys) assert.ok(ICONS[k], `resource ${k}`);
});

test('every building in the catalog has an icon, in catalog order', () => {
  const names = [...read('../../crates/game-core/src/catalog.rs').matchAll(/^\s*Def \{ name: "([^"]+)"/gm)].map(m => m[1]);
  assert.equal(KIND_ICON_NAMES.length, names.length, 'one icon name per building kind');
  names.forEach((n, i) => { assert.equal(KIND_ICON_NAMES[i], slug(n), `kind ${i} ${n}`); assert.ok(ICONS[KIND_ICON_NAMES[i]], `icon for ${n}`); });
  assert.equal(new Set(KIND_ICON_NAMES).size, names.length, 'no two kinds share an icon');
});

test('every unit has an icon', () => {
  const names = [...read('../../crates/game-core/src/military.rs').matchAll(/UnitDef \{ name: "([^"]+)"/g)].map(m => m[1]);
  assert.equal(UNIT_ICON_NAMES.length, names.length);
  names.forEach((n, i) => { assert.equal(UNIT_ICON_NAMES[i], slug(n)); assert.ok(ICONS[slug(n)]); });
});

test('the actions, statuses and events the interface needs are all drawn', () => {
  for (const n of ['muster', 'halt', 'home', 'split', 'merge', 'attack', 'shield', 'trade', 'peace', 'alliance', 'envoy', 'marriage', 'war', 'caravan', 'fire', 'plague', 'hunger', 'cold', 'raid', 'happy', 'content', 'neutral', 'sad', 'pop', 'army', 'worker']) assert.ok(ICONS[n], n);
  for (const n of CAT_ICON_NAMES) assert.ok(ICONS[n], `category icon ${n}`);
});

test('all the markup is well formed, in colour and one-colour, at any size', () => {
  assert.ok(ICON_NAMES.length >= 100);
  for (const n of ICON_NAMES) {
    for (const o of [{}, { mono: true }, { title: 'A & "B" <c>' }]) {
      const s = icon(n, 20, o); checkXml(s);
      assert.match(s, /viewBox="0 0 24 24"/); assert.match(s, /width="20" height="20"/);
      assert.ok(!/<script|on\w+=|javascript:|href=/i.test(s), `${n}: nothing active in the markup`);
    }
    assert.ok(!/#[0-9a-f]{6}/i.test(icon(n, 20, { mono: true }).replace(/(?:fill|stroke)="currentColor"/g, '')), `${n}: mono has no fixed colours left`);
    assert.ok(/currentColor/.test(icon(n, 20, { mono: true })));
    for (const d of ICONS[n].matchAll(/ d="([^"]*)"/g)) assert.ok(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/.test(d[1]), `${n}: path data ${d[1].slice(0, 30)}`);
  }
});

test('unknown names fall back to a question mark, and ids map to icons', () => {
  assert.equal(icon('nope', 16), icon('unknown', 16));
  assert.equal(kindIcon(0, 16), icon('house', 16)); assert.equal(unitIcon(3, 16), icon('knight', 16)); assert.equal(kindIcon(999, 16), icon('unknown', 16));
});

test('icon names used in the source all exist', () => {
  const names = new Set(); const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (f === 'wasm') continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|css)$/.test(f)) { const t = readFileSync(p, 'utf8'); for (const m of t.matchAll(/\b(?:icon|withIcon)\('([\w-]+)'/g)) names.add(m[1]); } } };
  walk(new URL('../src', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
  for (const n of names) assert.ok(ICONS[n], `icon('${n}') is used but not drawn`);
});

/** Emoji draw differently (or not at all) on each system, so none may be used as an icon. Plain typographic marks are fine. */
test('no emoji remain in the source', () => {
  const allowed = new Set([...'✓✕✗●☐☑▸▾◂▴']);   // plain text glyphs that every font has
  const root = new URL('../src', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
  const bad = [];
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (f === 'wasm') continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|css|html)$/.test(f)) readFileSync(p, 'utf8').split('\n').forEach((line, i) => { for (const ch of line) if ((/\p{Extended_Pictographic}|\p{Emoji_Presentation}|️/u.test(ch)) && !allowed.has(ch)) bad.push(`${relative(root, p)}:${i + 1} ${ch}`); }); } };
  walk(root);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const ch of html) if (/\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(ch)) bad.push(`index.html ${ch}`);
  assert.deepEqual(bad, []);
});
