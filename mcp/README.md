# Flanders MCP server (headless)

An AI agent plays Flanders through MCP with **no browser and no UI at all**. The game's Rust core, the same one the web game runs, is loaded into this Node process, so every action is decided by the game's own rules (cost, terrain, border, workforce, ...). There are no cheat tools.

```
agent ──MCP (stdio)──▶ server.mjs ──▶ engine.mjs ──▶ the game core (WebAssembly, in-process)
```

## Run it
Needs Node 22, plus Rust and `wasm-pack` once, to build the core for Node:
```
cd mcp
npm ci
npm run wasm          # builds the game core into mcp/wasm (not committed)
```
Add it to your MCP client:
```json
{ "mcpServers": { "flanders": { "command": "node", "args": ["/path/to/flanders/mcp/server.mjs", "--world", "flanders", "--save", "/path/to/game.json"] } } }
```
- `--world NAME` picks the map: the same names as the game's links, so `flanders` is the same land as `?world=flanders` in the browser.
- `--save FILE` keeps the game. The world is deterministic, so a save is only the list of actions with the tick of each; the next run replays it and arrives at exactly the same village. Without `--save` the game ends with the session.

## Tools (five, on purpose)
| tool | what it does |
|---|---|
| `status` | one small object: time, people, stores and their rates, army, danger, a waiting decision, and the next goals |
| `info` | the building table (id, name, radius, cost), or `info {kind}` for one; `units: true` lists soldiers |
| `look` | `buildings` (counts by kind plus a page), `land` (a small height map and deposits), `deposits`, `armies` (and neutral places), `prices` |
| `act` | a **batch** of actions, each a short array, done in order (see below) |
| `advance` | run 1-1200 ticks; pauses early at raids, fires, famine, plague or a decision |

Actions (`act`): `["place",kind,dx,dy,rot?,search?]`, `["up",idx]`, `["opt",idx,bit,on?]`, `["demo",idx,true]`, `["fix",idx]`, `["gar",idx,archers]`, `["draw",idx,up]`, `["gate",idx,closed]`, `["field",idx,mode]`, `["train",kind,n]`, `["hero"]`, `["form",s,a,w,k,c]`, `["march",id,dx,dy]`, `["recall",id]`, `["visit",id]`, `["decide",n]`. Coordinates are relative to the town hall (x east, y south). Mines, quarries and clay pits **snap** to the nearest matching deposit, and `search` tries nearby spots, so a placement is usually one action, not a probe-and-retry loop.

## Why it is cheap
- Replies are one line of JSON with arrays and numbers, no prose: a `status` is 300-500 characters, an `act` reply a few dozen, an `advance` 50-150.
- Actions are batched (up to 40 per call), so a turn is one call.
- Static data is fetched on demand: the building table is about 1 000 characters instead of the 24 000 of full descriptions; details of one kind are a separate call.
- `look buildings` is paged and summarised, never the whole village.
- A repeating event (a starving village raises "famine" every tick) pauses `advance` at most once every 120 ticks and is reported as `famine x9`, so a call never ends after one tick.
- The five tools and the rules cost about 3 700 characters (roughly 1 000 tokens) of context, once per session.
- Measured: 20 game days of a scripted player took 222 calls and about 30 000 characters of traffic in total (a real agent needs far fewer calls). `npm test` enforces size limits on every reply.

## Limits (be honest)
- **Single player.** The headless game is your own village on the map nearest the centre. It does not connect to other players (that is peer-to-peer WebRTC in the browser), so no trade, treaties, envoys or attacks on other villages. Raids by bandits, plague, fire, famine, harvests and decisions all happen.
- **Time only moves when the agent says so.** `advance` is the clock, so there is no real-time pressure and no pace limit; the cap is 1200 ticks a call. (A game day is 240 ticks.)
- Saves made here are not browser saves and cannot be opened in the game.

## The old browser bridge
`browser-bridge.mjs` is the previous server: it drives a game in a browser tab over a local WebSocket, with human-pace limits (see `guardrails.mjs` and `web/src/agent.ts`). It is kept for playing alongside people in a shared world; it needs the game open in a tab.

Tests: `npm test` (the bridge guardrails, the headless engine: rules, no cheats, save and load, size limits, and the server end to end over the MCP protocol).
