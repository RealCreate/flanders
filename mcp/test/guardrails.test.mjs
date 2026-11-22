import assert from 'node:assert/strict';
import { Guard, Limiter, MAX_GIFT } from '../guardrails.mjs';

let t = 0; const now = () => t;

// the handicap: a minimum gap between actions, and a budget per minute
{
  const g = new Guard({ gapMs: 2500, perMinute: 3 }, now);
  assert.equal(g.check('place', {}), null, 'first action goes through');
  const r = g.check('place', {}); assert.ok(r && r.retry_after_ms > 0, 'a second action right away is refused'); 
  t += 2600; assert.equal(g.check('upgrade', {}), null);
  t += 2600; assert.equal(g.check('train', {}), null);
  t += 2600; const over = g.check('place', {}); assert.ok(over && /slow down/.test(over.error), 'the per-minute budget is enforced');
  t += 60000; assert.equal(g.check('place', {}), null, 'and it refills');
}
// reading the game is cheap but still limited
{
  t = 0; const g = new Guard({ lookGapMs: 300, lookPerMinute: 5 }, now);
  assert.equal(g.check('observe'), null); assert.ok(g.check('observe'), 'reads are spaced too');
  for (let i = 0; i < 4; i++) { t += 400; assert.equal(g.check('observe'), null); }
  t += 400; assert.ok(g.check('observe'), 'reads have a per-minute budget');
}
// no testing tools, no unknown tools
{
  t = 0; const g = new Guard({}, now);
  for (const bad of ['cheat', 'flatten', 'model_village', 'reset', 'give_resources', 'set_speed', 'delete_save']) assert.match(g.check(bad).error, /testing tool/);
  assert.match(g.check('rm_rf').error, /unknown tool/);
}
// demolishing needs a confirmation, and is rate limited on top
{
  t = 0; const g = new Guard({ gapMs: 0, perMinute: 1000 }, now);
  assert.match(g.check('demolish', { idx: 3 }).error, /confirm/);
  for (let i = 0; i < 4; i++) assert.equal(g.check('demolish', { idx: 3, confirm: true }), null);
  assert.match(g.check('demolish', { idx: 3, confirm: true }).error, /too many demolitions/);
}
// attacking other players is off unless the human switched it on, and then still needs a confirmation
{
  t = 0; assert.match(new Guard({ gapMs: 0 }, now).check('attack', { confirm_attack: true }).error, /switched off/);
  const g = new Guard({ allowAttack: true, gapMs: 0 }, now);
  assert.match(g.check('attack', {}).error, /confirm_attack/);
  assert.equal(g.check('attack', { confirm_attack: true }), null);
}
// diplomacy: reading is free, a marriage needs confirm, a gift is capped, war is as fenced as an attack, and every call must name a village
{
  t = 0; const g = new Guard({ gapMs: 0, perMinute: 1000, lookGapMs: 0, lookPerMinute: 1000 }, now);
  assert.equal(g.check('relations'), null);
  assert.equal(g.check('envoy', { key: 'abc' }), null);
  assert.match(g.check('envoy', {}).error, /village's key/); assert.match(g.check('envoy', { key: 7 }).error, /village's key/);
  assert.match(g.check('marriage', { key: 'abc' }).error, /confirm/); assert.equal(g.check('marriage', { key: 'abc', confirm: true }), null);
  assert.equal(g.check('gift', { key: 'abc', amount: MAX_GIFT }), null);
  for (const amount of [0, -5, MAX_GIFT + 1, 2.5, '50', undefined]) assert.match(g.check('gift', { key: 'abc', amount }).error, /a gift carries/);
  assert.equal(g.check('alliance', { key: 'abc' }), null);
  assert.match(g.check('declare_war', { key: 'abc', confirm_attack: true }).error, /switched off/, 'war is off unless the human allows attacks');
  const war = new Guard({ allowAttack: true, gapMs: 0 }, now);
  assert.match(war.check('declare_war', { key: 'abc' }).error, /confirm_attack/); assert.equal(war.check('declare_war', { key: 'abc', confirm_attack: true }), null);
  const tiny = new Guard({ gapMs: 0, perMinute: 1000, maxActions: 1 }, now);
  assert.equal(tiny.check('envoy', { key: 'abc' }), null); assert.match(tiny.check('gift', { key: 'abc', amount: 5 }).error, /budget/, 'diplomacy counts against the action budget');
}
// a pause stops everything, and the session budget caps the total
{
  t = 0; const g = new Guard({ gapMs: 0, perMinute: 1000, maxActions: 2 }, now);
  g.paused = true; assert.match(g.check('observe').error, /paused/); g.paused = false;
  assert.equal(g.check('place'), null); assert.equal(g.check('place'), null); assert.match(g.check('place').error, /budget/);
}
assert.ok(new Limiter(1, 1));
console.log('guardrails ok');
