// The delivery rules of multiplayer (net/link.ts): putting commands in order, noticing gaps, deciding when to send again, judging a link, forgiving a hiccup. No network, no game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Inbox, Retx, Tail, LinkMonitor, Backoff, Strikes, rangeFrom, chunks, headOf } from '../src/net/link.ts';
import { sanitizeHb, sanitizeWant, sanitizeMore, sanitizeEcho } from '../src/net/validate.ts';

const c = (n, tick = n, extra = {}) => ({ op: 'place', n, tick, ...extra });
const ns = res => res.out.map(x => x.n);

test('commands in order are delivered at once', () => {
  const b = new Inbox();
  assert.deepEqual(ns(b.push(c(0))), [0]);
  assert.deepEqual(ns(b.push(c(1))), [1]);
  assert.deepEqual(b.ack, { e: 0, n: 1 });
});

test('a command ahead of a gap is held, the gap is asked for, and everything is released once it is filled', () => {
  const b = new Inbox();
  b.push(c(0));
  const r = b.push(c(3));
  assert.deepEqual(r.out, []); assert.equal(r.askFrom, 1); assert.equal(b.heldCount, 1);
  assert.deepEqual(ns(b.push(c(4))), []);
  assert.deepEqual(ns(b.push(c(2))), [], 'still missing 1');
  assert.deepEqual(ns(b.push(c(1))), [1, 2, 3, 4], 'the gap is filled: all of it, in order');
  assert.equal(b.heldCount, 0); assert.equal(b.ack.n, 4);
});

test('duplicates and reordering never apply a command twice or out of order', () => {
  const b = new Inbox(); const got = [];
  for (const n of [2, 0, 2, 1, 0, 3, 1, 3, 5, 4, 4, 5]) got.push(...ns(b.push(c(n))));
  assert.deepEqual(got, [0, 1, 2, 3, 4, 5]);
});

test('a sender that says nothing lies between is believed: numbers that were never used are not a gap', () => {
  const b = new Inbox(); b.push(c(0));
  assert.deepEqual(ns(b.push(c(5), false, 0)), [5], 'their command before this one is number 0, which we have');
  const r = b.push(c(9), false, 7); assert.deepEqual(r.out, []); assert.equal(r.askFrom, 6, 'but their command 7 is one we do not have');
});

test('testing-tool commands count for the numbering and are never applied', () => {
  const b = new Inbox(); const got = [];
  got.push(...ns(b.push(c(0)))); b.push({ n: 1, tick: 0 }, true); got.push(...ns(b.push(c(2)))); b.push({ n: 3, tick: 0 }, true);
  assert.deepEqual(got, [0, 2]); assert.deepEqual(b.ack, { e: 0, n: 3 }, 'the ack covers the tools, so the sender does not send them again');
});

test('a command from a life we have not seen the start of asks for the whole history; the restart releases it', () => {
  const b = new Inbox(); b.push(c(0)); b.push(c(1));
  const r = b.push(c(1, 5, { e: 1 })); assert.equal(r.askFull, true); assert.deepEqual(r.out, []);
  const s = b.push({ op: 'restart', n: 0, tick: 0, e: 1 });
  assert.deepEqual(s.out.map(x => x.op), ['restart', 'place'], 'the restart came, and what waited behind it');
  assert.deepEqual(b.ack, { e: 1, n: 1 });
  assert.deepEqual(ns(b.push(c(0, 0, { e: 0 }))), [], 'the old life is over');
});

test('a whole history replaces what we knew and releases what was held behind it', () => {
  const b = new Inbox(); b.push(c(0)); b.push(c(7));
  const r = b.loadLog([c(0), c(1), c(2), c(3), c(4), c(5), c(6)]);
  assert.deepEqual(ns(r), [7]); assert.equal(b.ack.n, 7);
  const t = new Inbox(); t.loadLog([c(0), c(1)], 3); assert.equal(t.ack.n, 3, 'the tools that were left out of the history are counted');
});

test('a command whose clock runs backwards is refused, and the inbox does not spin on it', () => {
  const b = new Inbox(); b.push(c(0, 100));
  const r = b.push(c(1, 50)); assert.equal(r.bad, true); assert.deepEqual(r.out, []); assert.equal(b.ack.n, 0);
});

test('what is held is bounded', () => {
  const b = new Inbox();
  for (let n = 2; n < 2 + Inbox.MAX_HELD + 50; n++) b.push(c(n));
  assert.ok(b.heldCount <= Inbox.MAX_HELD);
});

const entry = (n, e = 0) => ({ cmd: JSON.stringify({ op: 'place', n, tick: n, ...(e ? { e } : {}) }), sig: 's' });

test('the part of a history after a number is found, with the number before it', () => {
  const log = [0, 1, 2, 4, 5, 9].map(n => entry(n));
  let r = rangeFrom(log, 0, 4); assert.deepEqual(r.items.map(x => headOf(x.cmd).n), [4, 5, 9]); assert.equal(r.after, 2);
  r = rangeFrom(log, 0, 3); assert.deepEqual(r.items.map(x => headOf(x.cmd).n), [4, 5, 9], 'number 3 was never used'); assert.equal(r.after, 2);
  r = rangeFrom(log, 0, 0); assert.equal(r.items.length, 6); assert.equal(r.after, -1);
  r = rangeFrom(log, 0, 10); assert.equal(r.items.length, 0);
  assert.equal(rangeFrom(log, 1, 0).full, true, 'a request about another epoch needs the whole history');
  assert.equal(rangeFrom([], 0, 0).full, false);
});

test('a range is cut into pieces that each know the number before them', () => {
  const log = Array.from({ length: 10 }, (_, n) => entry(n));
  const parts = chunks(log, -1, 4);
  assert.deepEqual(parts.map(p => [p.after, p.cmds.length]), [[-1, 4], [3, 4], [7, 2]]);
});

test('the tail of a history is cached and follows it', () => {
  const t = new Tail(); const log = [entry(0), entry(1)];
  assert.deepEqual(t.of(log), { e: 0, n: 1 }); log.push(entry(2)); assert.deepEqual(t.of(log), { e: 0, n: 2 }); assert.equal(t.of([]), null);
});

test('resending: first contact sends at once, a stuck ack is retried with growing pauses, progress is given time', () => {
  const r = new Retx(); const tail = { e: 0, n: 10 };
  assert.deepEqual(r.plan(0, { e: 0, n: 4 }, tail), { kind: 'more', from: 5 }, 'first ack: send what is missing');
  assert.deepEqual(r.plan(500, { e: 0, n: 4 }, tail), { kind: 'none' }, 'a moment ago');
  assert.deepEqual(r.plan(1600, { e: 0, n: 4 }, tail), { kind: 'more', from: 5 }, 'no progress: again');
  assert.deepEqual(r.plan(3000, { e: 0, n: 4 }, tail), { kind: 'none' }, 'the pause doubled');
  assert.deepEqual(r.plan(5000, { e: 0, n: 4 }, tail), { kind: 'more', from: 5 });
  assert.deepEqual(r.plan(5100, { e: 0, n: 7 }, tail), { kind: 'none' }, 'it moved: give it time');
  assert.deepEqual(r.plan(5200, { e: 0, n: 10 }, tail), { kind: 'none' }, 'caught up');
  assert.deepEqual(r.plan(9000, { e: 0, n: 10 }, { e: 0, n: 11 }), { kind: 'more', from: 11 }, 'a new command they have not acked yet');
  assert.deepEqual(r.plan(0, null, tail), { kind: 'none' }); assert.deepEqual(new Retx().plan(0, { e: 0, n: 1 }, null), { kind: 'none' });
});

test('resending never floods: the pause grows to a ceiling', () => {
  const r = new Retx(); let t = 0, sent = 0; r.plan(t, { e: 0, n: 0 }, { e: 0, n: 5 }); sent++;
  for (; t < 120_000; t += 250) if (r.plan(t, { e: 0, n: 0 }, { e: 0, n: 5 }).kind === 'more') sent++;
  assert.ok(sent < 20, `a silent peer got ${sent} resends in two minutes`);
});

test('another epoch needs the whole history, and not too often', () => {
  const r = new Retx(); const tail = { e: 2, n: 5 };
  assert.deepEqual(r.plan(0, { e: 0, n: 40 }, tail), { kind: 'full' });
  assert.deepEqual(r.plan(2000, { e: 0, n: 40 }, tail), { kind: 'none' });
  assert.deepEqual(r.plan(100_000, { e: 0, n: 40 }, tail), { kind: 'full' });
  assert.deepEqual(r.plan(100_100, { e: 2, n: 5 }, tail), { kind: 'none' });
});

test('a link is good, weak, then lost as the silence grows; a sign of life brings it back', () => {
  const m = new LinkMonitor(0);
  assert.equal(m.state(1000), 'good'); assert.equal(m.state(LinkMonitor.WEAK + 1), 'weak'); assert.equal(m.state(LinkMonitor.LOST + 1), 'lost');
  m.heard(LinkMonitor.LOST + 2); assert.equal(m.state(LinkMonitor.LOST + 3), 'good');
  m.pong(100); m.pong(200); assert.ok(m.rtt > 100 && m.rtt < 200); m.pong(-5); m.pong(1e9); assert.ok(m.rtt < 200);
});

test('pauses grow, are capped, and start again after a success', () => {
  const b = new Backoff(1000, 8000);
  assert.deepEqual([b.next(), b.next(), b.next(), b.next(), b.next()], [1000, 2000, 4000, 8000, 8000]);
  b.reset(); assert.equal(b.next(), 1000);
});

test('a hiccup is forgiven, a stream of garbage is shut out for a while and then let in again', () => {
  const s = new Strikes(0);
  for (let i = 0; i < 20; i++) assert.equal(s.add(i * 6000), false, 'one every six seconds fades away');
  const t = new Strikes(0); let cut = false;
  for (let i = 0; i < 30; i++) cut ||= t.add(i * 10);
  assert.ok(cut && t.banned(1000)); assert.ok(!t.banned(400_000), 'five minutes later it may try again');
});

test('heartbeat, request and piece-of-history messages are checked field by field', () => {
  assert.deepEqual(sanitizeHb({ ts: 5, e: 1, n: -1, junk: 1 }), { ts: 5, e: 1, n: -1 });
  for (const bad of [null, [], { ts: 'x', e: 0, n: 0 }, { ts: 1, e: -1, n: 0 }, { ts: 1, e: 0, n: -2 }, { ts: 1, e: 0, n: 1.5 }, { ts: Infinity, e: 0, n: 0 }]) assert.equal(sanitizeHb(bad), null, JSON.stringify(bad));
  assert.deepEqual(sanitizeWant({ t: 1 }), { t: 1 }); assert.deepEqual(sanitizeWant({ t: 2, e: 0, from: 5 }), { t: 2, e: 0, from: 5 });
  for (const bad of [null, { t: 3 }, { t: 2, e: 0 }, { t: 2, e: 0, from: -1 }, { t: 2, e: 'a', from: 1 }]) assert.equal(sanitizeWant(bad), null);
  assert.deepEqual(sanitizeMore({ after: 3, cmds: [] }), { after: 3, cmds: [] });
  for (const bad of [null, { after: -2, cmds: [] }, { after: 0, cmds: 'x' }, { after: 0, cmds: new Array(601).fill({}) }]) assert.equal(sanitizeMore(bad), null);
  assert.equal(sanitizeEcho({ ts: 3 }), 3); assert.equal(sanitizeEcho({ ts: 'x' }), null);
});
