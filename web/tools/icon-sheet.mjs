// Dev only: writes web/icon-sheet.html, a contact sheet of every icon (colour at four sizes, one-colour, on dark wood) so the set can be reviewed in one view.
// Run:  node --experimental-strip-types tools/icon-sheet.mjs   then open web/icon-sheet.html
import { writeFileSync, readFileSync } from 'node:fs';
import { ICONS, ICON_NAMES, KIND_ICON_NAMES, UNIT_ICON_NAMES, icon } from '../src/ui/icons.ts';

const src = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');
const res = [...src.matchAll(/key: '(\w+)', name:/g)].map(m => m[1]);
const used = new Set([...res, ...KIND_ICON_NAMES, ...UNIT_ICON_NAMES]);
const groups = [
  ['Resources', res],
  ['Buildings (in catalog order)', KIND_ICON_NAMES],
  ['Units', UNIT_ICON_NAMES],
  ['Everything else: actions, status, events, interface, pen shapes', ICON_NAMES.filter(n => !used.has(n))],
];
const cell = n => `<figure><div class="row"><span class="p">${icon(n, 16)}${icon(n, 24)}${icon(n, 32)}${icon(n, 48)}</span><span class="m">${icon(n, 24, { mono: true })}</span><span class="d">${icon(n, 24)}${icon(n, 16)}</span></div><figcaption>${n}</figcaption></figure>`;
const html = `<!doctype html><meta charset="utf-8"><title>Flanders icons</title><style>
body{margin:20px;background:#efe4c8;color:#38281a;font:15px Georgia,serif}h2{border-bottom:1px solid #cdb98d;margin-top:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:8px}figure{margin:0;padding:6px 8px;border:1px solid #cdb98d;border-radius:3px;background:#e4d5b0}
.row{display:flex;align-items:center;gap:10px}.p{display:flex;align-items:flex-end;gap:6px}.m{color:#38281a}.d{background:#221a13;padding:4px 6px;border-radius:3px;display:flex;gap:6px;align-items:center}
.d svg{filter:drop-shadow(0 0 1px #efe4c8)}figcaption{font:12px monospace;margin-top:4px;color:#6e5a43}svg.gi{display:block}
</style><h1>Flanders icons (${ICON_NAMES.length})</h1><p>Left: colour at 16, 24, 32 and 48 px. Middle: one-colour (<code>mono</code>, currentColor). Right: on dark wood, as in the top bar.</p>
${groups.map(([t, names]) => `<h2>${t} (${names.length})</h2><div class="grid">${names.map(cell).join('')}</div>`).join('')}`;
writeFileSync(new URL('../icon-sheet.html', import.meta.url), html);
console.log(`icon-sheet.html: ${ICON_NAMES.length} icons`);
