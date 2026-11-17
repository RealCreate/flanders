// Smoke test of the renderers' update methods on a small fixture village, built as the production bundle is (minified too): a `let`/`const` used before its line
// (a temporal dead zone) only shows when the code runs, and once crashed Village.syncFull in the live build. Bundles the class with vite (rolldown), then runs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { build } from 'vite';

const dir = new URL('./.tmp/', import.meta.url);
async function load(entry, minify) {
  const out = await build({
    configFile: false, logLevel: 'silent', root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    build: { write: false, minify, lib: { entry, formats: ['es'], fileName: 'x' }, rollupOptions: { external: ['three'] } },
  });
  const chunk = (Array.isArray(out) ? out[0] : out).output[0];
  mkdirSync(dir, { recursive: true });
  const file = new URL(`bundle-${minify ? 'min' : 'dev'}-${Math.random().toString(36).slice(2)}.mjs`, dir);
  writeFileSync(file, chunk.code);
  return import(file.href);
}

const terrain = { heightAt: (x, z) => Math.sin(x * 0.1) + Math.cos(z * 0.1) };
const radii = new Array(60).fill(3);
/** Buildings (stride 10: kind, tier, x, z, rot, pad height, status, ...): the town hall, a house, a farm, a plaza, a moat piece and a wall. */
const village = tier => Float32Array.from([
  15, tier, 0, 0, 0, 1, 4, 0, 0, 0,   1, 0, 14, 6, 0, 1, 4, 0, 0, 0,   4, 0, -14, 6, 0, 1, 4, 0, 0, 0,
  44, 0, 8, -16, 0, 1, 4, 0, 0, 0,   24, 0, 30, 30, 0, 1, 4, 0, 0, 0,   2, 0, 34, 30, 0, 1, 4, 0, 0, 0,
]);
// lines of the core: kind 0 a stub (door to node), kind 1 a stretch of a road laid by hand
const lines = Float32Array.from([0, 0, 2, 0, 4, 0, 7,   0, 5000, 2, 14, 7, 14, 9,   1, 900, 5, 0, 7, 4, 9, 8, 9, 11, 8, 14, 9]);

for (const minify of [false, true]) {
  test(`Paths.update runs on a village at every castle tier (${minify ? 'minified' : 'unminified'} bundle)`, async () => {
    const { Paths } = await load('src/render/paths.ts', minify);
    for (let tier = 0; tier <= 3; tier++) {
      const p = new Paths(terrain);
      p.update(village(tier), lines, radii, []);
      const g = p.tracks?.geometry ?? p.group.children[0].geometry;
      assert.ok(g.getAttribute('position').count > 0, `tier ${tier}`);
      assert.equal(p.material, tier >= 2 ? 'stone' : 'dirt');
      for (const v of g.getAttribute('position').array) assert.ok(Number.isFinite(v));
      p.update(village(tier), new Float32Array(0), radii, []);   // no roads at all
    }
  });
}
test.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
