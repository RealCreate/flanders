import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// The version comes from package.json (the one source of truth); the short commit from git when it is there (a download without .git just shows no marker).
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
let commit = ''; try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* no git: no marker */ }
// Every build knows when it was made and has an id; `version.json` (written next to the game) tells a running page which build is deployed, so players are moved to the latest one (src/update.ts).
const buildTime = Math.floor(Date.now() / 1000);
const appId = `${version}-${commit || 'nogit'}-${buildTime}`;
const versionFile = { name: 'flanders-version-file', apply: 'build' as const, generateBundle() { (this as unknown as { emitFile(f: { type: 'asset'; fileName: string; source: string }): void }).emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: appId, time: buildTime, version, commit }) }); } };


// Hosts allowed to reach `vite preview` (the built game) through a tunnel. Quick Cloudflare tunnels get a random *.trycloudflare.com name;
// add your own domain with ALLOWED_HOSTS=game.example.com,other.example.com. The dev server (`npm run dev`) is left on localhost only: do not tunnel that one.
const extra = (process.env.ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean);

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version), __APP_COMMIT__: JSON.stringify(commit), __APP_ID__: JSON.stringify(appId), __BUILD_TIME__: String(buildTime) },
  plugins: [versionFile],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    // three.js and the networking library change rarely: in their own files a visitor's browser keeps them cached across game updates
    rollupOptions: { output: { manualChunks: (id: string) => (id.includes('/node_modules/three/') ? 'three' : /\/node_modules\/(trystero|@trystero-p2p)\//.test(id) ? 'p2p' : undefined) } },
  },
  base: './',   // relative links, so the build works from a sub-path such as https://user.github.io/flanders/
  preview: { host: '127.0.0.1', port: 4173, allowedHosts: ['.trycloudflare.com', ...extra] },
});
