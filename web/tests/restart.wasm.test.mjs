// Restart end to end under node with the real core: an owner signs commands (a restart among them), a replica that trusts only that owner's key applies them the way the game does
// (net/validate.ts decides what is accepted, net/sync.ts judges the hashes), and both end up in the same village. See docs/RESTART.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyCmd, stepTo } from '../src/commands.ts';
import { parseCmd, Sequence } from '../src/net/validate.ts';
import { ReplicaTrack } from '../src/net/sync.ts';
import { resumeFromCheckpoint, checksum } from '../src/checkpoint.ts';
import { restartCmd, rebaseLog } from '../src/restart.ts';
const core = createRequire(import.meta.url)('./.wasm/game_core.js');
const { World, world_restore } = core;
const SEED = 1337n, enc = new TextEncoder();
const NAMES = core.state_hash_part_names().split(',');

async function keys() { const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']); return { priv: kp.privateKey, pub: kp.publicKey }; }
const sign = async (k, cmd) => { const s = JSON.stringify(cmd); return { cmd: s, sig: Buffer.from(await crypto.subtle.sign('Ed25519', k.priv, enc.encode(s))).toString('base64') }; };
const verify = async (pub, m) => crypto.subtle.verify('Ed25519', pub, Buffer.from(m.sig, 'base64'), enc.encode(m.cmd));

/** A village's owner: applies a command to the world, then signs it with the next number of the current epoch (the game's `commit`). */
class Owner {
  constructor(k) { this.k = k; this.w = new World(SEED, 0, 0); this.log = []; this.n = 0; this.epoch = 0; }
  async do(cmd, ticks = 0) { for (let i = 0; i < ticks; i++) this.w.step(); const full = { ...cmd, tick: Number(this.w.tick()), n: this.n++, ...(this.epoch ? { e: this.epoch } : {}) }; applyCmd(this.w, full); const s = await sign(this.k, full); this.log.push(s); return s; }
  async restart() { const c = restartCmd(this.epoch + 1), old = this.log.slice(); this.epoch++; this.n = 1; applyCmd(this.w, c); const s = await sign(this.k, c); this.log = [s]; return { signed: s, archived: old }; }
}

/** The copy another player keeps of that village, following what main.ts's onCmd does. */
class Replica {
  constructor(ownerPub) { this.pub = ownerPub; this.w = new World(SEED, 0, 0); this.seq = new Sequence(); this.track = new ReplicaTrack(); this.dropped = []; this.log = []; }
  async receive(m) {
    if (!(await verify(this.pub, m))) { this.dropped.push('bad signature'); return; }
    const c = parseCmd(m.cmd); if (!c) { this.dropped.push('nonsense'); return; }
    const k = this.seq.classify(c);
    if (k !== 'ok') { this.dropped.push(k); return; }
    if (c.op === 'restart') { this.w = new World(SEED, 0, 0); applyCmd(this.w, c); this.track.restarted(c.e); this.log = [c]; return; }
    stepTo(this.w, c.tick); applyCmd(this.w, c); this.track.applied(c.op); this.log.push(c);
  }
  judge(owner) {
    const t = Number(owner.w.tick()); const msg = { tick: t, hash: owner.w.state_hash().toString(), c: owner.log.length, p: Array.from(owner.w.state_hash_parts(), x => x.toString()), tools: false, e: owner.epoch };
    return this.track.judge(msg, this.w, NAMES, tt => { stepTo(this.w, tt); return true; }, 0).kind;
  }
}

const BUILD = [['place', { kind: 0, x: 12, y: 4, rot: 0 }], ['place', { kind: 1, x: -14, y: 6, rot: 0 }], ['level', { x: 10, y: 22, kind: 8 }], ['place', { kind: 0, x: 18, y: 8, rot: 0 }], ['place', { kind: 28, x: 0, y: 14, rot: 0 }]];
const play = async (o, rs) => { for (const [op, f] of BUILD) { const s = await o.do({ op, ...f }, 7); for (const r of rs) await r.receive(s); } };

test('a reserve command switches an old history at the same tick for its owner and a late joiner', async () => {
  const k = await keys();
  const owner = new Owner(k);
  owner.w = World.new_legacy(SEED, 0, 0);
  const peer = new Replica(k.pub);
  peer.w = World.new_legacy(SEED, 0, 0);
  await play(owner, []);
  assert.equal(owner.w.estate_active(), false);
  await owner.do({ op: 'reserve', x: 90, y: 70 }, 65);
  assert.equal(owner.w.estate_active(), true);
  for (const entry of owner.log) await peer.receive(entry);
  assert.deepEqual(peer.dropped, []);
  assert.deepEqual([...peer.w.reserves()], [90, 70]);
  stepTo(owner.w, 400);
  stepTo(peer.w, 400);
  assert.equal(peer.w.state_hash(), owner.w.state_hash());
  const archive = rebaseLog([{ ...restartCmd(1), kind: 1 }], 2);
  const reloaded = World.new_legacy(SEED, 0, 0);
  applyCmd(reloaded, archive[0]);
  assert.equal(reloaded.estate_active(), true);
});

test('an owner restarts: the replica becomes the new village, and both agree through the old life, the restart and the new one', async () => {
  const k = await keys(), owner = new Owner(k), rep = new Replica(k.pub);
  await play(owner, [rep]);
  assert.equal(rep.judge(owner), 'match', 'in step before the restart');
  assert.notEqual(owner.w.building_count(), 1);
  const { signed } = await owner.restart();
  assert.equal(owner.w.state_hash(), new World(SEED, 0, 0).state_hash(), 'the owner is back to a brand-new village');
  assert.equal(owner.w.tick(), 0n);
  await rep.receive(signed);
  assert.equal(rep.seq.epoch, 1); assert.equal(rep.track.count, 1);
  assert.equal(rep.w.state_hash(), owner.w.state_hash(), 'the replica reset with it');
  assert.equal(rep.judge(owner), 'match');
  await play(owner, [rep]);   // the new life, with the numbering and the clock starting again
  assert.equal(rep.judge(owner), 'match');
  assert.equal(rep.w.state_hash(), owner.w.state_hash());
  assert.deepEqual(rep.dropped, []);
  // and a brand-new world given only the commands of this epoch is the same village
  const fresh = new World(SEED, 0, 0); for (const m of owner.log) { const c = JSON.parse(m.cmd); stepTo(fresh, c.tick); applyCmd(fresh, c); }
  assert.equal(fresh.state_hash(), owner.w.state_hash());
});

test('a newcomer who is sent only the active history gets the owner\'s new village (and a newcomer is never sent the archive)', async () => {
  const k = await keys(), owner = new Owner(k);
  await play(owner, []); await owner.restart(); await play(owner, []);
  const rep = new Replica(k.pub);
  for (const m of owner.log) await rep.receive(m);
  assert.equal(rep.seq.epoch, 1); assert.deepEqual(rep.dropped, []);
  assert.equal(Number(rep.w.tick()), Number(owner.w.tick()));
  assert.equal(rep.w.state_hash(), owner.w.state_hash());
});

test('replaying the signed history of the old life after a restart does nothing, and nobody else can restart your village', async () => {
  const k = await keys(), other = await keys(), owner = new Owner(k), rep = new Replica(k.pub);
  await play(owner, [rep]);
  const { signed, archived } = await owner.restart(); await rep.receive(signed);
  await play(owner, [rep]);
  const before = rep.w.state_hash();
  for (const m of archived) await rep.receive(m);   // a replay of the whole old epoch, correctly signed by the owner
  await rep.receive(signed);                         // and of the restart itself
  assert.equal(rep.w.state_hash(), before, 'the village did not move');
  assert.ok(rep.dropped.length === archived.length + 1 && rep.dropped.every(d => d === 'dup'), rep.dropped.join());
  // a restart signed by a stranger is not the owner's
  const evil = await sign(other, restartCmd(5));
  await rep.receive(evil);
  assert.equal(rep.w.state_hash(), before); assert.equal(rep.seq.epoch, 1); assert.equal(rep.dropped.at(-1), 'bad signature');
  // a stranger's replica of THEIR village is untouched by our owner's restart: replicas are keyed by owner
  const theirs = new Replica(other.pub); await theirs.receive(signed);
  assert.equal(theirs.seq.epoch, 0); assert.equal(theirs.dropped.at(-1), 'bad signature');
});

test('a replica that missed the restart notices and asks for the history instead of drifting', async () => {
  const k = await keys(), owner = new Owner(k), rep = new Replica(k.pub);
  await play(owner, [rep]);
  await owner.restart();   // (lost on the way)
  const next = await owner.do({ op: 'place', kind: 0, x: 12, y: 4, rot: 0 }, 5);
  await rep.receive(next);
  assert.deepEqual(rep.dropped, ['gap'], 'a command of an epoch we do not know yet: not applied, nothing punished');
  assert.equal(rep.judge(owner), 'wait', 'the hash of the new epoch is a command we are missing');
  // their history arrives: replayed from the start it gives the owner's village
  const again = new Replica(k.pub); for (const m of owner.log) await again.receive(m);
  assert.equal(again.judge(owner), 'match');
});

test('bringing the archived village back gives exactly the village that was archived', async () => {
  const k = await keys(), owner = new Owner(k);
  await play(owner, []); for (let i = 0; i < 400; i++) owner.w.step();
  const hash = owner.w.state_hash(), tick = Number(owner.w.tick()), buildings = owner.w.building_count();
  const { archived } = await owner.restart(); await play(owner, []);
  const cmds = rebaseLog(archived.map(m => JSON.parse(m.cmd)), owner.epoch + 1);
  const signed = []; for (const c of cmds) signed.push(await sign(k, c));
  const w = new World(SEED, 0, 0); for (const c of cmds) { stepTo(w, c.tick); applyCmd(w, c); } stepTo(w, tick);
  assert.equal(w.building_count(), buildings); assert.equal(w.state_hash(), hash, 'the restored village is the archived one');
  // and a replica fed the re-signed history agrees (it sees the restart first, so it drops what it had)
  const rep = new Replica(k.pub); for (const m of owner.log) await rep.receive(m);
  for (const m of signed) await rep.receive(m);
  assert.equal(rep.seq.epoch, owner.epoch + 1); assert.deepEqual(rep.dropped, []);
  stepTo(rep.w, tick); assert.equal(rep.w.state_hash(), hash);
});

test('a checkpoint taken before a restart is refused for the new history, and the world a checkpoint restores is exact', async () => {
  const k = await keys(), owner = new Owner(k);
  await play(owner, []);
  const bytes = owner.w.snapshot(), cp = { meta: { rules: 'r', v: 3, site: 0, epoch: 0, cmds: owner.log.length, lastCmd: owner.log.at(-1).cmd, tick: Number(owner.w.tick()), savedAt: 0, hash: String(owner.w.state_hash()), sum: checksum(bytes) }, bytes };
  const hist = log => log.map(m => ({ cmd: m.cmd, tick: JSON.parse(m.cmd).tick }));
  const w = resumeFromCheckpoint(cp, { rules: 'r', v: 3, site: 0, epoch: 0 }, hist(owner.log), world_restore);
  assert.ok(w && w.state_hash() === owner.w.state_hash(), 'before a restart it resumes');
  await owner.restart(); await play(owner, []);
  assert.equal(resumeFromCheckpoint(cp, { rules: 'r', v: 3, site: 0, epoch: 1 }, hist(owner.log), world_restore), null);
  // even forged to look like it fits (same epoch field), the commands it names are not those of the new history
  assert.equal(resumeFromCheckpoint({ ...cp, meta: { ...cp.meta, epoch: 1 } }, { rules: 'r', v: 3, site: 0, epoch: 1 }, hist(owner.log), world_restore), null);
});
