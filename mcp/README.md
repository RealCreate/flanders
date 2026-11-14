# Flanders MCP server

Lets an AI agent play Flanders through a normal browser tab, under the same rules as a human player.

```
agent ──MCP (stdio)──▶ server.mjs ──WebSocket (127.0.0.1)──▶ game tab (web/src/agent.ts) ──▶ the same World calls and signed commands as a click
```

## Run it

1. Start the game (`cd web && npm run dev`, or serve `web/dist`).
2. Add the server to your MCP client, for example:
   ```json
   { "mcpServers": { "flanders": { "command": "node", "args": ["/path/to/flanders/mcp/server.mjs", "--game", "http://localhost:5173"] } } }
   ```
3. The server prints a link on stderr (`...?agent=8765&token=...&player=agent`). Open it in a browser tab. The agent plays as its own player (`player=agent` keeps its village and keys apart from yours), and a badge at the bottom left shows what it is doing, with **Pause** and **Disconnect**.

## Tools

`observe`, `catalog`, `buildings`, `probe`, `can_place`, `place`, `upgrade`, `option`, `demolish`, `repair`, `train`, `garrison`, `drawbridge`, `form_army`, `march_army`, `recall_army`, `rivals`, `wait`, `game_rules`
(and `attack`, only when attacking is switched on).

## Guardrails

- **Same rules as a person.** Every action is applied by the game itself (build radius, cost, terrain, workforce, ...) and sent to the other players as a signed command. There are no testing tools: no cheats, no free resources, no levelling the ground, no model village, no resets, no game speed.
- **Speed handicap.** At most one action every 2.5 s and 15 actions a minute (`--gap-ms`, `--per-minute`; `&pace=slow` in the link halves that again), reads are limited too, and a session has a budget of 3000 actions. The agent cannot change the game speed, so it plays in real time. The game tab enforces the same limits on its own, so a client that skips this server still cannot go faster.
- **Fenced off.** Demolishing needs `confirm: true` and is limited to 4 a minute. Attacking another player is **off** unless you start the server with `--allow-attack` *and* open the game with `allow_attack=1`, and then every attack still needs `confirm_attack: true`.
- **Local only.** The socket listens on 127.0.0.1, accepts only localhost origins and needs the random token from the link.
- **You stay in charge.** Pause/Resume and Disconnect on the badge; while paused every call is refused.

Tests: `npm test` (guardrails).
