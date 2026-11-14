# Security notes

Flanders has no server, so the things to protect are the players' browsers and their villages. This is the threat model, what the 2026-11 review checked and fixed, and what is still open.

## Who can attack what
| Attacker | Goal | Defence |
|---|---|---|
| Another player (a peer) | Crash or freeze your game; get free soldiers or goods; pretend to be someone else | Three gates for everything from the network (`web/src/net/p2p.ts`, `validate.ts`): a signed hello addressed to the receiver, a signature on every command, strict field, range, size and order checks; per-peer rate limits; peers that keep misbehaving are cut off. The Rust core also refuses absurd arguments: `crates/game-core/tests/hostile_input.rs` throws extreme numbers at every command and must never panic or allocate wildly. |
| A page or link | Run script in the game's origin | Content-Security-Policy (`web/index.html`, and `web/public/_headers` for hosts that read it): scripts only from the site plus WebAssembly, no inline script, no `eval`. Player names are stripped of markup characters. |
| A backup file someone hands you | Plant bad data | Restoring only accepts known keys, limits sizes, checks the Ed25519 key matches its public half, and the saved history is re-validated command by command on load (`web/src/backup.ts`). |
| A local process or crafted link aimed at the agent bridge | Drive the game through the MCP bridge | The bridge is opt-in; the port must be 1024-65535 and the token 8-128 safe characters; the MCP server listens on 127.0.0.1 only, checks Origin, compares the token in constant time, requires it within 5 s, and caps message size and connections. The agent is rate-limited and cannot cheat. |
| Supply chain | Malicious dependency | `npm audit` and `cargo audit` in CI, Dependabot weekly, lockfiles committed. |

## What the review found and fixed
- **Peers could send testing-tool commands** (`cheat`, `flatten`) that were applied to their replica. They are no longer accepted from the network.
- **Unvalidated network data**: any JSON a peer signed went straight into the core. It is now rebuilt field by field (`sanitizeCmd`).
- **Identity could be hijacked**: a peer could announce someone else's public key in an unsigned hello and replay captured commands. The hello is now signed and addressed to the receiver; commands must have strictly increasing numbers and non-decreasing time. The protocol id changed to `v7`, so old clients do not mix with new ones.
- **CPU denial of service**: a command with a huge `tick` made every client simulate millions of ticks, and a history could have unlimited entries. Time jumps, history length and message rates are now limited.
- **Core crashes and runaway memory**, found by the fuzz test: `det_march` with NaN, infinite or far coordinates; `start_raid` with an invalid angle (a 60 GB allocation); `return_army` overflow, and forged returns that could mint up to 100 000 soldiers of each kind (which also froze every client simulating that village). The forged `return` is now clamped to what was really sent away.
- **A throwing replica broke the client**: replay errors are now contained per rival, and that copy is rebuilt from its next history.
- Debug handles (`window.__game`) exist only on localhost or with `?debug=1`.
- Saved histories are re-validated on load, so a damaged save no longer crashes startup.
- The `gate` command was missing from the typed command list; the list is now one source of truth.
- MCP server hardening (above); the page now connects to `127.0.0.1` rather than `localhost`.

## Known limits
- **Peers see your IP address** (WebRTC). Only play with people you accept that from.
- **Economic claims are trusted, within bounds.** The game has no referee. Caravan payment is cross-checked against the sender's copy. Battle loot is now cross-checked too: every player replays the defender's village, so the battle's real result is known and replaces the attacker's claimed survivors and loot (`web/src/ledger.ts`; a lie shows as "claimed false loot" in the neighbours list). It only works when a copy of the defender was watching the battle live; a history loaded later still takes the claim, bounded to 35 % of a full store per army sent. A peer can also accept goods that were not sent, bounded to 500 each time.
- **Replaying a long history costs CPU** for whoever receives it (capped at 300 000 ticks and 40 000 commands, one history per 5 seconds). A malicious peer can still make you wait; leave the world to get rid of them.
- **Your private key is in localStorage**, extractable so it can be backed up. Script running in this origin could read it; the CSP is the defence. A non-extractable key in IndexedDB would block that but rule out backups; backups were chosen.
- A `<meta>` CSP cannot set `frame-ancestors`; use the `_headers` file on a host that supports it to prevent framing.
- The public Nostr relays used for discovery can see that a world name exists and who joins it, not game data.
