// The whole room (net/room.ts) on a simulated network: commands must arrive complete and in order whatever the network does, and connections must come back by themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Clock, Net, Player, everyoneHasEveryone } from './netsim.mjs';

async function world(names, cfg = {}, seed = 7) {
  const clock = new Clock(), net = new Net(clock, seed); Object.assign(net.cfg, cfg);
  const players = []; for (const n of names) players.push(await Player.make(n, net, clock));
  return { clock, net, players };
}
/** Run until everybody holds everybody's history, or give up after `limit` ms; returns the virtual time it took. */
async function converge(w, limit = 120_000) {
  const t0 = w.clock.t;
  while (w.clock.t - t0 < limit) { if (await everyoneHasEveryone(w.players)) return w.clock.t - t0; await w.clock.advance(500); }
  return -1;
}
const talk = async (players, each, gap = 100, w) => { for (let i = 0; i < each; i++) { for (const p of players) await p.say(); await w.clock.advance(gap); } };

test('three players on a clean network: everybody gets everything, in order, once', async () => {
  const w = await world(['a', 'b', 'c']);
  await w.clock.advance(4000);
  await talk(w.players, 40, 100, w);
  assert.ok(await converge(w) >= 0, 'did not converge');
  for (const p of w.players) assert.equal(p.outOfOrder, 0);
  assert.ok(w.players.every(p => p.room.peers.size === 2));
});

test('commands issued before anybody has met are delivered when they meet', async () => {
  const w = await world(['a', 'b']);
  for (let i = 0; i < 25; i++) await w.players[0].say();
  await w.clock.advance(5000);
  assert.ok(await converge(w) >= 0);
});

test('heavy loss, repeats and delays: everything still arrives, in order', async () => {
  const w = await world(['a', 'b', 'c'], { loss: 0.3, dup: 0.2, latency: [20, 400] }, 11);
  await w.clock.advance(6000);
  await talk(w.players, 60, 150, w);
  const took = await converge(w, 300_000);
  assert.ok(took >= 0, 'did not converge under 30% loss');
  for (const p of w.players) assert.equal(p.outOfOrder, 0);
});

test('a link that reorders messages: still complete and in order', async () => {
  const w = await world(['a', 'b', 'c'], { reorder: true, latency: [10, 800], dup: 0.1 }, 3);
  await w.clock.advance(6000);
  await talk(w.players, 40, 120, w);
  assert.ok(await converge(w, 200_000) >= 0);
  for (const p of w.players) assert.equal(p.outOfOrder, 0);
});

test('commands that arrive before the introduction are not lost (the old code dropped them)', async () => {
  // the hello is slow (it waits for a signature on the other side); the commands are fast: they overtake it
  const w = await world(['a', 'b'], { latency: [5, 10], discover: 500 });
  const [a, b] = w.players;
  const orig = a.room.helloTo.bind(a.room);
  a.room.helloTo = conn => new Promise(res => w.clock.after(() => res(orig(conn)), 400));   // the hello is slow, the commands are fast: they overtake it
  await w.clock.advance(600);
  for (let i = 0; i < 10; i++) { await a.say(); await w.clock.advance(30); }
  assert.ok(await converge(w, 60_000) >= 0, 'lost commands that came before the hello');
  assert.equal(b.outOfOrder, 0);
});

test('a dropped connection that comes back sends only what was missed, not the whole history', async () => {
  const w = await world(['a', 'b']);
  const [a, b] = w.players;
  await w.clock.advance(4000);
  await talk([a, b], 100, 50, w); assert.ok(await converge(w) >= 0);
  const loaded = b.logsLoaded.get(a.id.pub) ?? 0;
  w.net.drop('a', 'b');
  for (let i = 0; i < 10; i++) { await a.say(); await w.clock.advance(100); }
  await w.clock.advance(3000); w.net.discover();
  assert.ok(await converge(w, 60_000) >= 0, 'did not catch up after the connection came back');
  assert.equal(b.logsLoaded.get(a.id.pub) ?? 0, loaded, 'the whole history was sent again for a short break');
  assert.equal(b.outOfOrder, 0);
});

test('a player who reopens the room under a new id is recognised: the rest is sent, not everything', async () => {
  const w = await world(['a', 'b']);
  const [a, b] = w.players;
  await w.clock.advance(4000);
  await talk([a, b], 60, 50, w); assert.ok(await converge(w) >= 0);
  const loaded = b.logsLoaded.get(a.id.pub) ?? 0;
  // a's connection goes quiet without anybody being told; a notices nothing is arriving and opens the room again
  w.net.silence('a', 'b');
  for (let i = 0; i < 6; i++) { await a.say(); await w.clock.advance(200); }
  await w.clock.advance(25_000);
  assert.ok(a.room.rejoins >= 1, 'the quiet connection was not replaced');
  w.net.restore('a', 'b');
  await w.clock.advance(5000);
  assert.ok(await converge(w, 90_000) >= 0, 'did not catch up after the room was opened again');
  assert.equal(b.logsLoaded.get(a.id.pub) ?? 0, loaded, 'their whole history was loaded again');
});

test('a link that goes quiet for a minute and returns: everything is delivered', async () => {
  const w = await world(['a', 'b', 'c']);
  await w.clock.advance(4000);
  await talk(w.players, 20, 100, w); assert.ok(await converge(w) >= 0);
  w.net.silence('a', 'c');
  await talk(w.players, 30, 1500, w);
  w.net.restore('a', 'c');
  assert.ok(await converge(w, 200_000) >= 0, 'did not converge after a partition');
  for (const p of w.players) assert.equal(p.outOfOrder, 0);
});

test('testing-tool commands are never delivered, never stall the numbering and are not sent again and again', async () => {
  const w = await world(['a', 'b']);
  const [a, b] = w.players;
  await w.clock.advance(4000);
  for (let i = 0; i < 30; i++) { await a.say({}, i % 3 === 1); await w.clock.advance(100); }
  await a.say({}, true); await a.say({}, true);   // the history ends on tools
  assert.ok(await converge(w) >= 0);
  assert.ok(!b.view.get(a.id.pub).some(c => c.op === 'cheat'));
  const before = w.net.sent; await w.clock.advance(30_000);
  assert.ok(w.net.sent - before < 120, `${w.net.sent - before} messages in 30 s of quiet: something is being resent`);
});

test('a history sent whole (a restart taken back) replaces ours and what follows still applies', async () => {
  const w = await world(['a', 'b']);
  const [a, b] = w.players;
  await w.clock.advance(4000);
  await talk([a, b], 10, 100, w); assert.ok(await converge(w) >= 0);
  // a starts again: a new epoch, announced by a signed restart command, then more commands
  const r = await a.id.sign({ op: 'restart', tick: 0, n: 0, e: 1 }); a.log.length = 0; a.log.push(r); a.n = 1; a.room.broadcastCmd(r);
  for (let i = 0; i < 5; i++) { await a.say({ e: 1 }); await w.clock.advance(100); }
  await w.clock.advance(8000);
  assert.deepEqual(b.ns(a), [0, 1, 2, 3, 4, 5], 'b follows a into the new life');
});

test('somebody who sends garbage is shut out for a while, and forgiven afterwards; nobody else is affected', async () => {
  const w = await world(['a', 'b', 'c']);
  const [a, b, c] = w.players;
  await w.clock.advance(4000);
  const bad = c.room.ch.cmd;
  for (let i = 0; i < 60; i++) await bad.send({ cmd: 'x', sig: 'y' });
  await w.clock.advance(1000);
  await c.say(); await w.clock.advance(2000);
  assert.equal(a.ns(c).length, 0, 'while cut off, even their good commands are ignored');
  await w.clock.advance(310_000);
  await c.say({}); await w.clock.advance(5000);
  assert.ok(a.ns(c).length >= 1, 'forgiven after the pause (the history arrives again)');
  await a.say(); await b.say(); assert.ok(await converge({ ...w, players: [a, b] }) >= 0);
});

test('link quality: a good link reports its round trip, a silent one goes weak and then lost', async () => {
  const w = await world(['a', 'b']);
  const [a] = w.players;
  await w.clock.advance(10_000);
  let l = a.room.links()[0]; assert.equal(l.state, 'good'); assert.ok(l.rtt > 20 && l.rtt < 400, `rtt ${l.rtt}`);
  w.net.silence('a', 'b'); await w.clock.advance(9000);
  assert.equal(a.room.links()[0].state, 'weak'); await w.clock.advance(9000);
  assert.ok(!a.room.links().length || a.room.links()[0].state === 'lost' || a.room.rejoins >= 1);
  assert.ok(a.status.some(s => /unstable|Reconnecting|Alone/.test(s)), 'the player is told: ' + a.status.slice(-4).join(' | '));
});

test('nobody around: the room is opened again now and then, with growing pauses', async () => {
  const w = await world(['a']);
  const [a] = w.players;
  await w.clock.advance(300_000);
  assert.ok(a.room.rejoins >= 2 && a.room.rejoins <= 8, `rejoined ${a.room.rejoins} times in five minutes`);
});

test('offline: no reconnecting while the network is down, and the player is told', async () => {
  const w = await world(['a', 'b']);
  const [a] = w.players;
  await w.clock.advance(5000);
  a.online = false; w.net.silence('a', 'b'); await w.clock.advance(120_000);
  assert.equal(a.room.rejoins, 0);
  assert.ok(a.status.some(s => /Offline/.test(s)));
  a.online = true; w.net.restore('a', 'b'); a.wake(); await w.clock.advance(60_000);
  assert.ok(await converge(w, 60_000) >= 0);
});

test('hellos are verified: a hello addressed to somebody else is not accepted', async () => {
  const w = await world(['a', 'b', 'c']);
  await w.clock.advance(4000);
  const [a, b, c] = w.players;
  assert.equal(a.hellos.filter(h => h.pub === c.id.pub).length >= 1, true);
  // c replays the hello it once sent to b to a: the signature covers who it is for
  const h = { pub: c.id.pub, site: 1, name: 'c', tick: 0, world: 'w', v: 4, rules: 'aa', b: 1 };
  const before = a.hellos.length;
  const sig = (await b.id.sign({ op: 'place', tick: 0, n: 0 })).sig;   // a signature by the wrong key over something else
  await b.room.ch.hello.send({ ...h, sig });
  await w.clock.advance(1000);
  assert.equal(a.hellos.length, before, 'a forged hello was accepted');
});

test('chaos: loss, repeats, reordering, silent partitions and dropped connections all at once, over several seeds', async () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const w = await world(['a', 'b', 'c', 'd'], { loss: 0.15, dup: 0.15, reorder: seed % 2 === 0, latency: [10, 500] }, seed);
    const pairs = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['a', 'd']];
    await w.clock.advance(5000);
    for (let round = 0; round < 40; round++) {
      for (const p of w.players) if (w.net.rand() < 0.6) await p.say({}, w.net.rand() < 0.05);
      const [x, y] = pairs[Math.floor(w.net.rand() * pairs.length)];
      const roll = w.net.rand();
      if (roll < 0.1) w.net.drop(x, y); else if (roll < 0.2) w.net.silence(x, y); else if (roll < 0.4) { w.net.restore(x, y); w.net.discover(); }
      await w.clock.advance(300 + Math.floor(w.net.rand() * 1500));
    }
    for (const [x, y] of pairs) w.net.restore(x, y);
    w.net.discover();
    assert.ok(await converge(w, 600_000) >= 0, `seed ${seed}: did not converge`);
    for (const p of w.players) assert.equal(p.outOfOrder, 0, `seed ${seed}: ${p.name} saw a command out of order`);
  }
});
