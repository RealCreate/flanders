# Letting someone outside your network play

## How the game connects (why this is easier than it sounds)
There is no game server. Every player's browser runs the game and the browsers talk to each other over WebRTC; they find each other through public Nostr relays (the `trystero` library). So gameplay traffic never passes through anything you host. What a friend needs from you is only **the web page** (the built files in `web/dist`) served over **HTTPS** (signing and WebRTC need a secure context; `localhost` also counts).

That gives three options, safest first:

1. **Host the built page on a static host** (Cloudflare Pages, GitHub Pages, Netlify). Always on, free, and nothing on your computer is exposed. `cd web && npm run build` and publish `web/dist`. This is what I would use for anything longer than a game night.
2. **A Cloudflare quick tunnel from your computer** (below): fastest for tonight, the URL changes every time, and it only works while your computer and the tunnel are running.
3. **A named Cloudflare tunnel on your own domain**, optionally behind Cloudflare Access (only listed emails get in). Same as 2 but with a stable name and a login.

## Quick tunnel, step by step
```
cd web
npm ci
npm run share            # builds the game, then serves it on http://127.0.0.1:4173 (this computer only)
# in a second terminal:
cloudflared tunnel --url http://127.0.0.1:4173
```
`cloudflared` prints an `https://something-random.trycloudflare.com` address: send it to your friend. Both of you open it, choose the same **World** name on the start screen, and you will see each other.

Install `cloudflared` from [Cloudflare's downloads](https://developers.cloudflare.com/tunnel/downloads/) (Windows: `winget install Cloudflare.cloudflared`, macOS: `brew install cloudflared`).

### Safety rules
- **Tunnel only `vite preview` (`npm run share`), never `npm run dev`.** The dev server serves your source files and has file-system routes; the preview server serves only `dist`. `vite.config.ts` pins preview to `127.0.0.1` and lets only `*.trycloudflare.com` hostnames (and anything in `ALLOWED_HOSTS=game.example.com`) reach it; other `Host` headers get a 403 (checked).
- Do not tunnel anything else: no `--url` pointing at the MCP server (`mcp/`), a database, or a folder. Run the tunnel as a normal user, not as administrator.
- A quick tunnel URL is public to anyone who has it. Cloudflare's own docs say quick tunnels are for testing, have no uptime guarantee and a request rate limit ([quick tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)). A recent `cloudflared` can restrict a quick tunnel to listed emails ([changelog](https://developers.cloudflare.com/changelog/post/2026-10-02-protected-quick-tunnels/)); for a private session use that, or a named tunnel with Cloudflare Access.
- Stop the tunnel (Ctrl+C) when you are done.
- The Test panel (cheats) only appears on `localhost` or with `?cheats=1` in the address. Cheat commands are signed and sent to other players, so do not hand out a link containing `?cheats=1`.

### What other players can learn about you
WebRTC connects browsers directly, so **each player can see the others' IP addresses** (that is how it works). Only play with people you are happy to share that with. Your village and signing key live in your browser's local storage; clearing site data deletes them.

## If a friend cannot connect
A tunnel only delivers the page; the game connection itself is WebRTC. Most home networks work with the free STUN servers the library uses by default. Some phone networks and offices (symmetric NAT, blocked UDP) cannot connect peer to peer and need a **TURN relay**. Enter one under **Display settings → Network** (it is kept in that browser and used after a reload). Options: [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/) (its free tier is tied to using their SFU; otherwise it is billed per GB), a free-tier service such as ExpressTURN, or your own `coturn`. The tunnel itself cannot relay WebRTC traffic.

## Not checked from here
The sandbox this was written in cannot reach the Nostr relays, so peer discovery and a real two-computer game through a tunnel were not tested. The preview server's host check was tested with `curl`. If peers never see each other, check the browser console for relay errors and try both players on the same World name with a TURN server set.
