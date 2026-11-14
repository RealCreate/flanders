import assert from 'node:assert/strict';
import { Guard, Limiter } from '../guardrails.mjs';

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
// a pause stops everything, and the session budget caps the total
{
  t = 0; const g = new Guard({ gapMs: 0, perMinute: 1000, maxActions: 2 }, now);
  g.paused = true; assert.match(g.check('observe').error, /paused/); g.paused = false;
  assert.equal(g.check('place'), null); assert.equal(g.check('place'), null); assert.match(g.check('place').error, /budget/);
}
assert.ok(new Limiter(1, 1));
console.log('guardrails ok');
