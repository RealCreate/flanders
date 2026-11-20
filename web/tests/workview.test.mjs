import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRows, parseTotals, verdict, keep, understaffed, group, workNote, kindOutputs, stepWant, ST, parseProductionProblems, productionProblemText } from '../src/workview.ts';

// staffing_flat: kind, max, want, staff, scaled. buildings_flat (stride 10): kind, tier, x, z, _, pad, status, pct, workers, residents
const S = [1, 4, -1, 4, 0,   0, 0, -1, 0, 0,   1, 2, 2, 1, 1,   4, 2, 0, 0, 0,   1, 4, -1, 1, 0];
const B = (kind, tier, status) => [kind, tier, 0, 0, 0, 0, status, 0, 0, 0];
const bld = [...B(1, 0, 0), ...B(0, 0, 4), ...B(1, 0, ST.wait), ...B(4, 1, 0), ...B(1, 0, ST.full)];
const rows = parseRows(S, bld);

test('production notes show the missing amount and distinguish protected stock from full stores', () => {
  const problems = parseProductionProblems([1, 9, 2, 0, 2, 0, 3, -20, 3, 11, 2, 1]);
  assert.match(productionProblemText(problems[0], 'charcoal'), /Needs 2 charcoal.*0 stored, 2 short/);
  assert.match(productionProblemText(problems[1], 'wood'), /above the reserve.*0 available/);
  assert.match(productionProblemText(problems[2], 'tools'), /room for 2 tools.*1 storage space/);
  assert.deepEqual(parseProductionProblems([]), []);
});

test('rows skip buildings that employ nobody and carry tier and status', () => {
  assert.deepEqual(rows.map(r => r.idx), [0, 2, 3, 4]);
  assert.equal(rows[2].tier, 1); assert.equal(rows[1].status, ST.wait); assert.equal(rows[1].scaled, true);
});

test('totals are read in order', () => {
  const t = parseTotals([20, 14, 4, 2, 1, 16, 12, 2, 87, 5]);
  assert.deepEqual(t, { adults: 20, workers: 14, children: 4, elders: 2, sick: 1, jobs: 16, placed: 12, idle: 2, eff: 87, promised: 5 });
});

test('verdicts: paused and unstaffed win over production status', () => {
  assert.equal(verdict(rows[2]), 'paused');
  assert.equal(verdict(rows[1]), 'no input');
  assert.equal(verdict(rows[3]), 'store full');
  assert.equal(verdict(rows[0]), 'working');
  assert.equal(verdict({ ...rows[0], staff: 0 }), 'unstaffed');
  assert.equal(verdict(rows[1], false), 'working');
});

test('understaffed means short of what is wanted; a paused building is not short', () => {
  assert.equal(understaffed(rows[0]), false);
  assert.equal(understaffed(rows[1]), true);   // wants 2, has 1
  assert.equal(understaffed(rows[2]), false);   // paused
  assert.equal(understaffed(rows[3]), true);   // auto, 1 of 4
});

test('filters', () => {
  const ids = f => rows.filter(r => keep(r, f)).map(r => r.idx);
  assert.deepEqual(ids('all'), [0, 2, 3, 4]);
  assert.deepEqual(ids('paused'), [3]);
  assert.deepEqual(ids('manual'), [2, 3]);
  assert.deepEqual(ids('understaffed'), [2, 4]);
  assert.deepEqual(ids('problems'), [2, 4]);
});

test('grouping by kind, sorting and group totals', () => {
  const g = group(rows);
  assert.deepEqual(g.map(x => x.kind), [1, 4]);
  assert.deepEqual([g[0].staff, g[0].max, g[0].manual, g[0].paused, g[0].rows.length], [6, 10, 1, 0, 3]);
  assert.deepEqual(group(rows, 'paused').map(x => x.kind), [4]);
  assert.deepEqual(group(rows, 'all', 'workers').map(x => x.kind), [1, 4]);
  assert.deepEqual(group(rows, 'all', 'short').map(x => x.kind), [1, 4]);
  assert.deepEqual(group([], 'all'), []);
});

test('the note says what is wrong with the hands', () => {
  const t = (o) => ({ adults: 0, workers: 0, children: 0, elders: 0, sick: 0, jobs: 10, placed: 0, idle: 0, eff: 100, promised: 0, ...o });
  assert.match(workNote(t({ jobs: 0 })), /no workplaces/);
  assert.match(workNote(t({ workers: 4, promised: 6 })), /scaled back/);
  assert.match(workNote(t({ workers: 6 })), /4 jobs have nobody/);
  assert.match(workNote(t({ workers: 12, idle: 2 })), /2 workers have nothing/);
  assert.match(workNote(t({ workers: 10 })), /Every job is filled/);
});

test('what a kind makes per day comes from the ledger gains', () => {
  const lines = [{ cat: 1, res: 10, gain: 60 }, { cat: 1, res: 3, gain: 0 }, { cat: 2, res: 10, gain: 90 }, { cat: 1, res: 5, gain: 120 }];
  assert.deepEqual(kindOutputs(lines, 240, 1), [[5, 120], [10, 60]]);
  assert.deepEqual(kindOutputs(lines, 120, 1), [[5, 240], [10, 120]]);
  assert.deepEqual(kindOutputs(lines, 10, 1), []);
});

test('+ and - step the wanted workers inside 0..max, and auto stays auto when full', () => {
  assert.equal(stepWant({ want: -1, max: 4, staff: 4 }, -1), 3);
  assert.equal(stepWant({ want: 3, max: 4, staff: 3 }, 1), 4);
  assert.equal(stepWant({ want: 0, max: 4, staff: 0 }, -1), 0);
  assert.equal(stepWant({ want: -1, max: 4, staff: 2 }, 1), 3);
  assert.equal(stepWant({ want: 2, max: 4, staff: 2 }, 1), 3);
});
