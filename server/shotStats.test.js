// Run with "npm test".
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCORING, cleanScoring, shotChartAllowed, shotCounts } from './shotStats.js';

test('the shot chart is off unless the flag is set to 1 for the team', () => {
  assert.equal(shotChartAllowed({ id: 1, shot_efficiency_chart: 0 }), false);
  assert.equal(shotChartAllowed({ id: 1 }), false);
  assert.equal(shotChartAllowed({ id: 1, shot_efficiency_chart: null }), false);
  assert.equal(shotChartAllowed(undefined), false);
  assert.equal(shotChartAllowed({ id: 1, shot_efficiency_chart: 1 }), true);
});

test('field goal attempts are counted for each player; free throws and the other team are not', () => {
  const e = (side, player, type) => ({ side, player, type });
  const out = shotCounts([e('us', 4, 'm2'), e('us', 4, 'x2'), e('us', 4, 'm1'), e('us', 7, 'x3'), e('us', 9, 'reb'), e('us', null, 'm3'), e('them', 4, 'm3')]);
  assert.deepEqual(out.players, [{ id: 4, m2: 1, x2: 1, m3: 0, x3: 0 }, { id: 7, m2: 0, x2: 0, m3: 0, x3: 1 }]);
  assert.deepEqual(out.played.sort(), [4, 7, 9]);
});

test('scoring choices: everything is a switch, and what is missing keeps what was there', () => {
  assert.deepEqual(cleanScoring(null), DEFAULT_SCORING);
  assert.equal(DEFAULT_SCORING.forced, false);
  assert.equal(DEFAULT_SCORING.place, false);
  const saved = cleanScoring({ blk: false, forced: true, place: 'yes', other: 1 });
  assert.equal(saved.blk, false);
  assert.equal(saved.forced, true);
  assert.equal(saved.place, false);
  assert.equal('other' in saved, false);
  assert.equal(cleanScoring({ reb: false }, saved).forced, true);
});
