// Looks for parts that float in the air or roofs drawn twice in every building at every tier, with and without design options.
// Needs Playwright (not a dependency of the project) and the built game being served: `npm run build && npx vite preview`, then `node tests/audit-models.mjs`.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:4173/?world=audit';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 500, height: 300 } });
p.on('dialog', d => d.accept());
await p.goto(url); await p.click('#found');
await p.waitForFunction(() => window.__dbg && window.__dbg.lv, null, { timeout: 120000, polling: 500 });
const res = await p.evaluate(() => {
  const out = {}, skip = new Set([24, 32, 33, 34, 37, 38]);
  for (let k = 0; k <= 40; k++) { if (skip.has(k)) continue; for (const t of [0, 1, 2, 3]) for (const o of [0, 15]) { const r = window.__dbg.audit(k, t, o); if (r.length) out[`kind ${k} tier ${t} options ${o}`] = r.slice(0, 4); } }
  return out;
});
await b.close();
for (const [k, v] of Object.entries(res)) console.log(k, JSON.stringify(v));
if (Object.keys(res).length) { console.error(`${Object.keys(res).length} models have loose parts`); process.exit(1); }
console.log('all models clean');
