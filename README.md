# Flanders

A medieval, serverless multiplayer village builder: a deterministic Rust/WASM core (`crates/game-core`), a three.js client (`web/`), peer-to-peer play with signed commands, and an MCP server (`mcp/`) so an AI agent can play under the same rules.

## Run it
Needs Rust with the wasm target, `wasm-pack` and Node 22:

```
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
cd web && npm ci && npm run dev
```

`npm run dev` and `npm run build` rebuild the wasm first (it lives in `web/src/wasm/`, which is not committed), so a pull that changes `crates/` is picked up on the next start. If you run `vite` directly, run `npm run wasm` yourself first, or you get errors like "does not provide an export named …".

## Playing with friends
See [docs/HOSTING.md](docs/HOSTING.md): how to share a build safely (static hosting or a Cloudflare tunnel) and what to know about it. Display settings (quality, shadows, anti-aliasing, frame rate limit, …) are under **Settings → Display** (the ⚙ button in the top bar).

## Your village is stored in your browser
Save a backup file under **Settings → Data & network → Your data**, and restore it on another browser or computer. The file contains your private signing key.

Closing the game saves the village at its current time. A hidden tab or two minutes without input pauses the village by default. Under **Settings → While away**, choose *Let steward work* to allow up to one village day of routine work while the tab stays open (the steward's report and recovery buttons are at the top of the **Village** tab). The steward stops for threats, shortages, and decisions. A battle with another player that has already started continues at normal speed while the game is open.

## Security
See [docs/SECURITY.md](docs/SECURITY.md) for the threat model, what was hardened and what is still open.

## Tests
```
cargo test --release -p game-core     # the game rules
cd web && npm test && npm run test:demo
cd mcp && npm ci && npm test
```
`cargo test` includes a hostile-input fuzz test of every network command. CI (`.github/workflows/ci.yml`) runs all of these plus `tsc`, the production build, `npm audit` and `cargo audit`.
