// Restart (see docs/RESTART.md): the epoch rules, the checks on a restart command, the archive, the confirmation dialog's state machine. No game, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCmd, parseCmd, sanitizeHash, Sequence, PEER_OPS, MAX_EPOCH } from '../src/net/validate.ts';
import { ReplicaTrack, WAIT_MS } from '../src/net/sync.ts';
import { checkpointFits } from '../src/checkpoint.ts';
import { validSavedLog } from '../src/commands.ts';
import { restartCmd, epochOfHistory, rebaseLog, validArchive, cooldownLeft, restartBlocker, lossLines, confirms, RestartFlow, RESTART_COOLDOWN_MS, ARM_MS, CONFIRM_WORD } from '../src/restart.ts';

const ok = o => sanitizeCmd({ tick: 5, n: 1, ...o });
const facts = (o = {}) => ({ replaying: false, busy: false, battle: false, armiesAway: false, now: 1_000_000, days: 42, buildings: 60, population: 80, soldiers: 12, terrainEdits: 5, ...o });

test('a restart command is the very first command of a new epoch and nothing else', () => {
  assert.ok(PEER_OPS.includes('restart'));
  assert.deepEqual(ok({ op: 'restart', tick: 0, n: 0, e: 3 }), { op: 'restart', tick: 0, n: 0, e: 3 });
  for (const bad of [{ e: 0 }, {}, { e: -1 }, { e: 1.5 }, { e: MAX_EPOCH + 1 }, { e: '2' }, { e: 2, tick: 7 }, { e: 2, n: 4 }]) assert.equal(ok({ op: 'restart', tick: 0, n: 0, ...bad }), null, JSON.stringify(bad));
  assert.deepEqual(restartCmd(2), { op: 'restart', tick: 0, n: 0, e: 2 });
  assert.deepEqual(parseCmd(JSON.stringify(restartCmd(9))), restartCmd(9));
});

test('an ordinary command may carry an epoch, but only a sane one', () => {
  assert.equal(ok({ op: 'place', kind: 1, x: 0, y: 0, e: 2 }).e, 2);
  assert.equal(ok({ op: 'place', kind: 1, x: 0, y: 0 }).e, undefined);
  assert.equal(ok({ op: 'place', kind: 1, x: 0, y: 0, e: -1 }), null);
  assert.equal(ok({ op: 'place', kind: 1, x: 0, y: 0, e: 1e9 }), null);
});

test('a live restart moves the sequence into the new epoch, and its clock and numbering start again', () => {
  const s = new Sequence();
  assert.equal(s.classify({ op: 'place', n: 0, tick: 10 }), 'ok');
  assert.equal(s.classify({ op: 'place', n: 1, tick: 900 }), 'ok');
  assert.equal(s.classify({ op: 'restart', n: 0, tick: 0, e: 1 }), 'ok');
  assert.equal(s.epoch, 1);
  assert.equal(s.classify({ op: 'place', n: 1, tick: 3, e: 1 }), 'ok', 'the new life counts from 1 at tick 3, though the old one was at tick 900');
  assert.equal(s.classify({ op: 'place', n: 2, tick: 2, e: 1 }), 'bad', 'inside an epoch the clock still only grows');
});

test('commands of an epoch that is over are dropped quietly: a restart cannot be undone by replaying the old history', () => {
  const s = new Sequence();
  s.classify({ op: 'place', n: 0, tick: 10 }); s.classify({ op: 'restart', n: 0, tick: 0, e: 1 }); s.classify({ op: 'place', n: 1, tick: 5, e: 1 });
  assert.equal(s.classify({ op: 'place', n: 2, tick: 50 }), 'dup', 'an old-epoch command');
  assert.equal(s.classify({ op: 'place', n: 7, tick: 5000 }), 'dup', 'even one with big numbers');
  assert.equal(s.classify({ op: 'restart', n: 0, tick: 0, e: 1 }), 'dup', 'the same restart again');
  assert.equal(s.epoch, 1); assert.equal(s.lastN, 1, 'the sequence is untouched');
  assert.equal(s.classify({ op: 'restart', n: 0, tick: 0, e: 2 }), 'ok', 'a later restart works');
  assert.equal(s.classify({ op: 'restart', n: 0, tick: 0, e: 1 }), 'dup', 'a restart of an older epoch does not take us back');
});

test('a command from an epoch whose restart we never saw asks for the history instead of punishing anybody', () => {
  const s = new Sequence(); s.classify({ op: 'place', n: 0, tick: 10 });
  assert.equal(s.classify({ op: 'place', n: 1, tick: 4, e: 2 }), 'gap');
  assert.equal(s.epoch, 0);
});

test('a history is one epoch: its restart first, nothing of another epoch after it', () => {
  const r = restartCmd(2), a = { op: 'place', n: 1, tick: 4, e: 2 }, b = { op: 'place', n: 2, tick: 9, e: 2 };
  assert.equal(Sequence.checkLog([r, a, b]).length, 3);
  assert.equal(Sequence.epochOf([r, a, b]), 2);
  assert.equal(Sequence.checkLog([a, b]).length, 0, 'a later epoch without its restart');
  assert.equal(Sequence.checkLog([r, a, { op: 'place', n: 3, tick: 10, e: 1 }]).length, 2, 'an older command in the middle ends it');
  assert.equal(Sequence.checkLog([r, a, { ...restartCmd(3) }]).length, 2, 'a second restart in the middle ends it (it would be its own history)');
  assert.equal(Sequence.checkLog([{ op: 'place', n: 0, tick: 1 }, { op: 'place', n: 1, tick: 2 }]).length, 2, 'epoch 0 needs no restart');
  assert.equal(Sequence.checkLog([{ op: 'place', n: 0, tick: 1 }, restartCmd(1)]).length, 1, 'a restart in the middle of epoch 0 is not a history');
  const s = new Sequence(); s.resetTo([r, a, b]); assert.equal(s.epoch, 2); assert.equal(s.lastN, 2); assert.equal(s.lastTick, 9);
});

test('hash messages carry the epoch', () => {
  assert.equal(sanitizeHash({ tick: 1, hash: '5', c: 1, p: ['1'], tools: false, e: 3 }).e, 3);
  assert.equal(sanitizeHash({ tick: 1, hash: '5', c: 1, p: ['1'] }).e, 0, 'an older build sends none');
  assert.equal(sanitizeHash({ tick: 1, hash: '5', c: 1, p: ['1'], e: -2 }), null);
  assert.equal(sanitizeHash({ tick: 1, hash: '5', c: 1, p: ['1'], e: 'x' }), null);
});

const fake = (tick, parts) => ({ t: tick, parts, tick() { return BigInt(this.t); }, state_hash() { return BigInt(this.parts.reduce((a, b) => a * 31 + b, 7)); }, state_hash_parts() { return this.parts.map(BigInt); } });
const hmsg = (w, c, e) => ({ tick: w.t, hash: w.state_hash().toString(), c, p: w.parts.map(String), tools: false, e });
const adv = w => t => { while (w.t < t) w.t++; return true; };

test("a copy compares hashes only inside the owner's current epoch", () => {
  const tr = new ReplicaTrack(); tr.reset(['place', 'place'], 0);
  const mine = fake(10, [1, 2, 3]);
  assert.equal(tr.judge(hmsg(fake(10, [1, 2, 3]), 2, 0), mine, ['a', 'b', 'c'], adv(mine), 0).kind, 'match');
  // the owner restarts: their next hash is of epoch 1 and we have not seen the restart yet: that is a missing command, not a desync
  const after = fake(0, [9, 9, 9]);
  assert.deepEqual(tr.judge(hmsg(after, 1, 1), mine, ['a', 'b', 'c'], adv(mine), 100), { kind: 'wait', missing: 1 });
  assert.equal(mine.t, 10, 'the copy is not run on while waiting');
  assert.equal(tr.judge(hmsg(after, 1, 1), mine, ['a', 'b', 'c'], adv(mine), 100 + WAIT_MS + 1).kind, 'lost');
  // the restart arrives and is applied: the copy is a new village at tick 0 with one command
  tr.restarted(1); mine.t = 0; mine.parts = [9, 9, 9];
  assert.equal(tr.epoch, 1); assert.equal(tr.count, 1); assert.equal(tr.lastGood, null);
  assert.equal(tr.judge(hmsg(after, 1, 1), mine, ['a', 'b', 'c'], adv(mine), 200).kind, 'match');
  // a hash of the old life still on its way is stale, never a mismatch
  assert.equal(tr.judge(hmsg(fake(500, [1, 2, 3]), 40, 0), mine, ['a', 'b', 'c'], adv(mine), 300).kind, 'stale');
});

test('a checkpoint of an older epoch never stands in for the new history', () => {
  const now = { rules: 'r', v: 3, site: 0, epoch: 1 };
  const history = [{ cmd: 'x', tick: 0 }, { cmd: 'y', tick: 4 }];
  const cp = (epoch) => ({ meta: { rules: 'r', v: 3, site: 0, epoch, cmds: 2, lastCmd: 'y', tick: 9, savedAt: 0, hash: '1', sum: 0 }, bytes: new Uint8Array([1]) });
  assert.equal(checkpointFits(cp(1), now, history), true);
  assert.equal(checkpointFits(cp(0), now, history), false, 'taken before the restart');
  assert.equal(checkpointFits(cp(undefined), now, history), false);
  assert.equal(checkpointFits(cp(undefined), { ...now, epoch: 0 }, history), true, 'a village never restarted still resumes');
});

const entry = c => ({ cmd: JSON.stringify(c), sig: 'sig' });
test('a saved history is read back as one epoch', () => {
  const log = [restartCmd(2), { op: 'place', kind: 0, x: 1, y: 2, tick: 5, n: 1, e: 2 }, { op: 'place', kind: 0, x: 3, y: 2, tick: 6, n: 2, e: 2 }].map(entry);
  assert.equal(validSavedLog(log).length, 3);
  assert.equal(validSavedLog(log.slice(1)).length, 0, 'a later epoch must begin with its restart');
  assert.equal(validSavedLog([...log, entry({ op: 'place', kind: 0, x: 1, y: 2, tick: 9, n: 3 })]).length, 3, 'an old-epoch command cannot be appended');
  assert.equal(validSavedLog([entry({ op: 'place', kind: 0, x: 1, y: 2, tick: 1, n: 0 }), entry(restartCmd(1))]).length, 1);
  assert.equal(epochOfHistory([restartCmd(2), { op: 'place', e: 2 }]), 2);
  assert.equal(epochOfHistory([{ op: 'place' }, { op: 'place' }]), 0);
  assert.equal(epochOfHistory([{ op: 'place', e: 2 }]), null);
  assert.equal(epochOfHistory([]), 0);
});

test('bringing an archive back re-numbers it into the new epoch and keeps every command', () => {
  const old = [{ op: 'cheat', kind: 3, tick: 0, n: 0 }, { op: 'place', kind: 0, x: 1, y: 2, tick: 7, n: 1 }, { op: 'place', kind: 1, x: 9, y: 2, tick: 9, n: 5 }];
  const out = rebaseLog(old, 4);
  assert.deepEqual(out.map(c => c.op), ['restart', 'cheat', 'place', 'place']);
  assert.deepEqual(out.map(c => c.n), [0, 1, 2, 3]);
  assert.ok(out.every(c => c.e === 4));
  assert.deepEqual(out.map(c => c.tick), [0, 0, 7, 9]);
  assert.equal(out[2].x, 1); assert.equal(old[1].e, undefined, 'the archive itself is not touched');
  assert.equal(Sequence.checkLog(out).length, 4);
  // an archive that was itself a later epoch loses its own restart command, not its commands
  const again = rebaseLog(out, 5);
  assert.deepEqual(again.map(c => c.op), ['restart', 'cheat', 'place', 'place']); assert.ok(again.every(c => c.e === 5));
});

test('an archive read from storage is checked', () => {
  const good = { format: 'flanders-archive', version: 1, epoch: 0, log: [entry({ op: 'x' })], site: 0, name: 'A', savedAt: 1, tick: 5, archivedAt: 2, days: 9, buildings: 4 };
  assert.equal(validArchive(good).days, 9);
  for (const bad of [null, {}, { ...good, format: 'x' }, { ...good, log: [] }, { ...good, log: [{ cmd: 1, sig: 2 }] }, { ...good, epoch: -1 }, { ...good, site: 'a' }, { ...good, version: 2 }]) assert.equal(validArchive(bad), null);
});

test('a second restart has to wait', () => {
  assert.equal(cooldownLeft(null, 5), 0); assert.equal(cooldownLeft(1000, 1000 + RESTART_COOLDOWN_MS), 0);
  assert.equal(cooldownLeft(1000, 1500), RESTART_COOLDOWN_MS - 500);
});

test('a restart is refused in the middle of a fight, while armies are out, while watching a replay or while saving', () => {
  assert.equal(restartBlocker(facts()), null);
  for (const k of ['replaying', 'busy', 'battle', 'armiesAway']) assert.ok(restartBlocker(facts({ [k]: true })), k);
  assert.match(restartBlocker(facts({ lastRestartAt: 1_000_000 - 1000 })), /minute/);
  assert.equal(restartBlocker(facts({ lastRestartAt: 1_000_000 - RESTART_COOLDOWN_MS })), null);
});

test('the dialog says exactly what is lost, including the day count', () => {
  const t = lossLines(facts()).join('\n');
  for (const word of [/building/i, /ground|land/i, /resource/i, /soldiers/i, /treat/i, /deposit/i, /42 days/]) assert.match(t, word);
});

test('the typed phrase is the village name or the word, in any case', () => {
  assert.ok(confirms('  restart ', 'Aldric')); assert.ok(confirms(CONFIRM_WORD, '')); assert.ok(confirms('ALDRIC', 'Aldric'));
  assert.ok(!confirms('', 'Aldric')); assert.ok(!confirms('', '')); assert.ok(!confirms('yes', 'Aldric')); assert.ok(!confirms('Aldri', 'Aldric'));
});

test("the dialog: nothing happens until the phrase is typed and a moment has passed; it can be cancelled until it is working", () => {
  const f = new RestartFlow('Aldric');
  assert.equal(f.state, 'closed'); assert.equal(f.canConfirm(0), false); assert.equal(f.confirm(0), false);
  assert.equal(f.open(facts({ now: 1000 })), 'asking');
  f.type('Aldric');
  assert.equal(f.canConfirm(1000 + ARM_MS - 1), false, 'too soon after opening');
  assert.equal(f.confirm(1000 + ARM_MS - 1), false); assert.equal(f.state, 'asking');
  f.type('Aldri'); assert.equal(f.canConfirm(1000 + ARM_MS), false, 'a wrong phrase');
  f.type('restart'); assert.equal(f.canConfirm(1000 + ARM_MS), true);
  assert.equal(f.confirm(1000 + ARM_MS), true); assert.equal(f.state, 'working');
  f.type('changed'); assert.equal(f.typed, 'restart', 'typing is ignored while working');
  f.cancel(); assert.equal(f.state, 'working', 'it cannot be cancelled half way');
  assert.equal(f.confirm(1000 + ARM_MS), false, 'and cannot be started twice');
  f.fail('no room'); assert.equal(f.state, 'asking'); assert.equal(f.error, 'no room'); assert.equal(f.canConfirm(1000 + ARM_MS), true);
  f.cancel(); assert.equal(f.state, 'closed');
});

test('the dialog does not open when the game cannot restart, and says why', () => {
  const f = new RestartFlow('Aldric');
  assert.equal(f.open(facts({ battle: true })), 'blocked'); assert.match(f.blockedBy, /battle/);
  f.type('RESTART'); assert.equal(f.canConfirm(1e9), false); assert.equal(f.confirm(1e9), false);
  f.cancel(); assert.equal(f.state, 'closed');
  assert.equal(f.open(facts()), 'asking'); f.done(); assert.equal(f.state, 'closed');
});
