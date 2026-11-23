// Run with "npm test".
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIDENCE_STEPS, confidence, correlation, strength, winLinks } from './wins.ts';

const line = (o = {}) => ({ pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, fto: 0, pf: 0, ...o });
const game = (us, scoreUs, scoreThem, them = {}) => ({ us: line(us), them: line(them), scoreUs, scoreThem });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('numbers that rise together are +1, opposite are -1, unrelated are 0', () => {
  near(correlation([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  near(correlation([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  near(correlation([1, 2, 3, 4], [1, -1, -1, 1]), 0);
  near(correlation([1, 2, 3], [1, 3, 2]), 0.5);
});

test('no link can be worked out from two games, or from a number that never changes', () => {
  assert.equal(correlation([1, 2], [3, 4]), null);
  assert.equal(correlation([5, 5, 5], [1, 2, 3]), null);
  assert.equal(correlation([1, 2, 3], [7, 7, 7]), null);
});

test('confidence steps up at 5, 10 and 20 games, and there is no minimum', () => {
  assert.deepEqual(CONFIDENCE_STEPS, { early: 5, fair: 10, solid: 20 });
  assert.deepEqual([0, 1, 4].map((n) => confidence(n).level), [1, 1, 1]);
  assert.deepEqual([5, 9].map((n) => confidence(n).label), ['Early read', 'Early read']);
  assert.deepEqual([10, 19].map((n) => confidence(n).label), ['Fair', 'Fair']);
  assert.deepEqual([20, 60].map((n) => confidence(n).level), [4, 4]);
});

test('strength in words', () => {
  assert.deepEqual([0.1, -0.25, 0.45, -0.7].map(strength), ['Little or none', 'Weak', 'Moderate', 'Strong']);
});

const season = [
  game({ to: 6, ast: 9, fgm: 10, fga: 20 }, 40, 30),
  game({ to: 8, ast: 7, fgm: 9, fga: 20 }, 36, 32),
  game({ to: 12, ast: 8, fgm: 6, fga: 20 }, 28, 34),
  game({ to: 15, ast: 6, fgm: 5, fga: 0 }, 20, 38),
];

test('turnovers move against the margin and come out on top, with averages for wins and losses', () => {
  const { rows, wins, losses, ties } = winLinks(season);
  assert.deepEqual([wins, losses, ties], [2, 2, 0]);
  const to = rows.find((r) => r.key === 'to');
  assert.ok(to.r < -0.95);
  assert.deepEqual([to.inWins, to.inLosses, to.games], [7, 13.5, 4]);
  assert.ok(Math.abs(rows[0].r) >= Math.abs(rows[rows.length - 1].r ?? 0));
});

test('a percentage skips a game with no attempts, and a stat never tracked is left out', () => {
  const { rows } = winLinks(season);
  const fg = rows.find((r) => r.key === 'fgp');
  assert.equal(fg.games, 3);
  assert.equal(fg.rate, true);
  near(fg.inWins, 47.5);
  assert.equal(fg.inLosses, 30);
  assert.equal(rows.some((r) => r.key === 'blk'), false);
  assert.equal(rows.some((r) => r.key === 'pts'), false);
});

test('tied games count towards the link and towards neither average; all wins leaves losses empty', () => {
  const { rows, ties } = winLinks([game({ to: 5 }, 30, 20), game({ to: 9 }, 25, 25), game({ to: 7 }, 28, 22)]);
  assert.equal(ties, 1);
  const to = rows.find((r) => r.key === 'to');
  assert.equal(to.inWins, 6);
  assert.equal(to.inLosses, null);
  assert.ok(to.r < 0);
});

test('a stat with no link to show sorts below every stat that has one', () => {
  const { rows } = winLinks([game({ fga: 20, to: 4 }, 30, 20), game({ fga: 20, to: 9 }, 22, 25), game({ fga: 20, to: 6 }, 28, 24)]);
  assert.equal(rows[0].key, 'to');
  assert.equal(rows[rows.length - 1].r, null);
});

test('with one game there are averages and no link', () => {
  const { rows } = winLinks([game({ to: 5 }, 30, 20)]);
  assert.equal(rows.find((r) => r.key === 'to').r, null);
});
