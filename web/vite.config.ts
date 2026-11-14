import { defineConfig } from 'vite';

// Hosts allowed to reach `vite preview` (the built game) through a tunnel. Quick Cloudflare tunnels get a random *.trycloudflare.com name;
// add your own domain with ALLOWED_HOSTS=game.example.com,other.example.com. The dev server (`npm run dev`) is left on localhost only: do not tunnel that one.
const extra = (process.env.ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean);

export default defineConfig({
  preview: { host: '127.0.0.1', port: 4173, allowedHosts: ['.trycloudflare.com', ...extra] },
});
