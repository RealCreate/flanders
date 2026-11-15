# Serverless transports for multiplayer: comparison

Question: can something replace or supplement the current transport (`web/src/net/p2p.ts`: Trystero 0.27, Nostr relays for signalling, WebRTC data channels for traffic, app id `flanders-medieval-p2p-v7`)?

**Recommendation: keep Trystero/WebRTC as the primary transport. Do not add a public-broker relay (MQTT, ntfy, Nostr-as-data) as a fallback. If a fallback or IP hiding is ever needed, run one tiny WebSocket relay of our own (for example a Cloudflare Worker with a Durable Object per world) and let the existing signing and validation sit on top. No prototype was written: none of the free public options is good enough to be worth shipping behind a flag.**

## What the current transport already does (checked in `node_modules/@trystero-p2p`)

- Signalling over about 30 hard-coded public Nostr relays, 5 used at a time (`defaultRedundancy = 5` in `nostr/dist/index.mjs`). Redundancy is the reliability story: one dead relay does not matter.
- Default ICE servers (`core/dist/peer.mjs`): `stun.l.google.com`, `stun1`, `stun2` (port 19302) and `stun.cloudflare.com:3478`. **Google public STUN is therefore already in use.** Adding it again changes nothing. STUN only reveals a player's public address to the STUN operator; it carries no game data. TURN (optional, `flanders:turn` or `VITE_TURN_*`) is the only thing that rescues symmetric NAT and blocked UDP.
- WebRTC data channels are not governed by `connect-src`, so the CSP (`connect-src 'self' wss:`) only has to allow the relay WebSockets. It does.
- Messages are small (hello, cmd, hash) plus a log of tens of kB, sent once per join and per `onLog`. Data channels deliver them reliably and ordered per sender.

## Constraints any replacement must meet

1. **Per-sender ordering and reliable delivery** (`Sequence.acceptLive` strikes out-of-order commands).
2. **Messages up to tens of kB** (full log), or chunking.
3. **A hash every tick**, so about 5 to 10 small messages per second per client, times N clients received.
4. **CSP:** only `'self'` and `wss:` are allowed. `https:` fetch or EventSource (ntfy publish, Firebase long-polling fallback, PeerJS REST) needs a CSP change in both `index.html` and `public/_headers`. Plain WebSocket works as is.
5. **Hello is bound to the transport peer id.** `helloText` signs `to: peerId` and `check()` maps `peerId -> pub`. A broadcast relay has no authenticated peer id, so the transport would have to use `pub` as the id and sign the hash too (today it is unsigned). That is a real change to the trust model, not only a swap in `p2p.ts`.

## Candidates

| Candidate | Fits sizes | Ordering | Free-tier / public limits | Reliability | Who can read / forge / spam | Player IPs | CSP | Code change |
|---|---|---|---|---|---|---|---|---|
| **Current: Trystero + Nostr + WebRTC** | yes | ordered, reliable (data channel) | no quota; relays only see signalling | good via 5-way relay redundancy; NAT failures remain | signalling readable (world name, who joins); game data is P2P; abuse limited to peers, handled by gates | **peers see each other's IP** (also STUN operators); not usable over Tor | ok | none |
| **Firebase Realtime DB** | yes (SDK writes up to 16 MB; docs) | ordered per listener; node-per-message needs cleanup | Spark: **100 simultaneous connections** (docs), 1 GB stored, 10 GB/month (as given). 8 clients at 5 msg/s each is about 40 msg/s in and 320 out, so the 10 GB cap is reachable in days with full logs. Past the cap the project is throttled or needs a billed plan | Google-grade | needs a project owned by us and an API key shipped in the build; rules must be open to be serverless, so anyone can write or flood and we pay for it. Everything readable | hidden from other players; Google sees them | SDK uses WebSocket to `*.firebasedatabase.app` (`wss:` ok), but falls back to https long-polling (blocked by CSP) | large: SDK dependency (about 100 kB gzip), rewrite of Room around a path per world; not "serverless without an account" |
| **MQTT over WSS** (`wss://broker.emqx.io:8084/mqtt`, `wss://test.mosquitto.org:8081`) | broker default packet limits are not documented on either page; 64 kB to 1 MB is typical, so the log would need chunking and cannot be trusted | MQTT QoS 0/1 is ordered per topic per publisher on one connection | no stated quota; mosquitto asks not to "rely upon it for anything of importance" and says WebSockets and TLS are the likeliest to be down | EMQX is best-effort commercial demo; mosquitto is explicitly experimental | **all messages visible to everyone** (both pages say so); anyone can publish to any topic, so spam/DoS is free (signatures stop forgery only); topic names guessable | hidden from other players; broker sees them | `wss:` ok, nothing to change | medium: about 200 lines of hand-written MQTT 3.1.1 framing or the `mqtt` package (about 80 kB); fixes needed from the constraints above |
| **ntfy.sh** | **no**: max message 4096 bytes (docs). Larger bodies become attachments (15 MB, 100 MB per visitor) fetched over https | ordered per topic | public server rate limits per IP (documented defaults are a burst then a slow refill, far below a tick-rate hash stream) | one operator, donation-funded | topics are readable by anyone who knows the name; anyone can post | hidden from other players; ntfy sees them | publish is an https POST (not allowed by CSP); subscribe could use `wss://ntfy.sh/<topic>/ws` | high and still unfit: hash-per-tick and logs cannot fit the limits |
| **Nostr relays as the data path** (ephemeral kinds 20000+) | events must stay under relay limits (strfry default is 64 kB, many relays lower); log needs chunking | not guaranteed; fan-out across relays reorders and duplicates | relays rate-limit and some require paid or proof-of-work for writes; hash-per-tick would be throttled or dropped | the same relay pool we already use for signalling, but now load-bearing | events are public; anyone can post to the world tag; Nostr signatures use secp256k1, so we would sign twice or add a Schnorr key | hidden from other players; relays see them | `wss:` ok | high: dedup, ordering, chunking and re-sync all reimplemented; abuse of public relays for game traffic will get us blocked |
| **BitTorrent trackers** (Trystero torrent strategy) | n/a | n/a | n/a | WebSocket trackers (webtorrent) come and go | same as Nostr signalling | **still WebRTC**, peers see IPs | `wss:` ok | small, but it only swaps the signalling source, not the transport. Worth keeping as an extra signalling strategy at most |
| **PeerJS cloud** (`0.peerjs.com`) | yes (WebRTC) | yes | one free signalling server, no SLA; the project asks not to depend on it | single point of failure | peer ids guessable, no rooms: we would need a registry | **still WebRTC**, peers see IPs | needs https/wss to the broker | medium, and a single point of failure replaces five redundant relays: worse than today |
| **Own WebSocket relay** (Cloudflare Worker + Durable Object, or any small VM) | yes (messages up to MBs) | ordered per connection | Workers free tier (100k requests/day, WebSocket messages count at 20:1) is enough for small groups; check current terms before relying on it | ours to run | the relay can see traffic (signed, not encrypted) and can rate-limit per connection; abuse control is possible | **hidden from other players**, works from Tor Browser (WebSocket over Tor) | `wss:` to our host, ok if added | small: one relay file plus a `Transport` interface in `p2p.ts` |

## Findings that matter

- **Google STUN is already in the default list.** Nothing to add. The real failures are symmetric NAT and UDP-blocking networks; only TURN or a WebSocket relay helps.
- **No free public endpoint is both permitted for this use and good enough.** Public MQTT brokers explicitly disclaim reliability and show everything to everyone; ntfy's 4 kB message cap rules it out for logs; Nostr relays as a data path would hammer the same relays that discovery depends on; Firebase's Spark plan allows only 100 connections and needs an account of ours plus open write rules.
- **Hiding IPs and supporting Tor means a relay, and the only sensible one is ours.** WebRTC cannot go over Tor, and any shared public broker adds readable traffic and abuse exposure with no upside over a relay we control.
- **Whatever transport is chosen, `p2p.ts` needs the id-binding change above** (use `pub` as the peer id, sign the hash, sign `to` as the recipient's pub). Do this behind a small `Transport` interface (`broadcast`, `send(target)`, `onPeerJoin/Leave`, `onMessage`) so Trystero stays the default.

## If a fallback is wanted later

1. Extract a `Transport` interface from `Room` (about 40 lines moved, no behaviour change).
2. Add a WebSocket transport (one connection to `wss://<our relay>/world/<id>`, JSON frames, server-side per-connection rate limit).
3. Update the CSP `connect-src` to name the relay host.
4. Make signed hello use `pub` for addressing, and sign the hash.

Not verified here: the sandbox cannot reach the public relays or brokers, so real latency and uptime were not measured. The ntfy burst rates and Nostr relay event-size limits are documented defaults recalled from the projects' docs, not fetched in this session.
