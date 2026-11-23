// Run with "npm test". Node reads the TypeScript file directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLD_MISSES, RUN_MAKES, attemptsOf, efficiency, hasOrder, sections, streaks, tally } from './shots.ts';

let n = 0;
const ev = (type, player = 1, period = 1, side = 'us') => ({ id: `e${n++}`, side, player, type, period, clock: null, at: n });

test('attempts come out in the order they were put in, with the score after each', () => {
  const list = attemptsOf([ev('m2'), ev('x3', 2), ev('m1'), ev('reb'), ev('m3', 2), ev('m2', 9, 1, 'them'), ev('x1')]);
  assert.deepEqual(list.map((a) => [a.kind, a.made, a.player]), [[2, true, 1], [3, false, 2], [1, true, 1], [3, true, 2], [1, false, 1]]);
  assert.deepEqual(list.map((a) => a.score), [2, 2, 3, 6, 6]);
  assert.deepEqual(list.map((a) => a.points), [2, 0, 1, 3, 0]);
});

test('a point with no shot behind it moves the score and is not an attempt', () => {
  const list = attemptsOf([ev('p1'), ev('m2')]);
  assert.equal(list.length, 1);
  assert.equal(list[0].score, 3);
});

test('a play put in late for an earlier period is placed in that period, keeping its turn within it', () => {
  const a = ev('m2', 1, 1);
  const b = ev('x2', 1, 2);
  const c = ev('m3', 2, 1);
  const list = attemptsOf([a, b, c]);
  assert.deepEqual(list.map((x) => x.id), [a.id, c.id, b.id]);
  assert.deepEqual(list.map((x) => x.score), [2, 5, 5]);
});

test('plays brought in from a file have no order', () => {
  assert.equal(hasOrder([ev('m2')]), true);
  assert.equal(hasOrder([{ ...ev('m2'), id: 'imp3' }]), false);
});

test('attempts are cut into their periods with totals for each', () => {
  const list = attemptsOf([ev('m2', 1, 1), ev('x3', 1, 1), ev('m1', 1, 1), ev('x1', 1, 1), ev('m3', 1, 2), ev('x2', 1, 5)]);
  const s = sections(list);
  assert.deepEqual(s.map((x) => [x.period, x.start, x.end]), [[1, 0, 4], [2, 4, 5], [5, 5, 6]]);
  assert.deepEqual(s[0].totals, { fgm: 1, fga: 2, tpm: 0, tpa: 1, ftm: 1, fta: 2, pts: 3 });
  assert.deepEqual(s[1].totals, { fgm: 1, fga: 1, tpm: 1, tpa: 1, ftm: 0, fta: 0, pts: 3 });
});

test('a game all in one period is one undivided section, and no attempts is no sections', () => {
  assert.equal(sections(attemptsOf([ev('m2'), ev('x2'), ev('m1')])).length, 1);
  assert.deepEqual(sections([]), []);
});

test('totals count threes as field goals too', () => {
  assert.deepEqual(tally(attemptsOf([ev('m3'), ev('x3'), ev('m2'), ev('x1')])), { fgm: 2, fga: 3, tpm: 1, tpa: 2, ftm: 0, fta: 1, pts: 5 });
});

test('the thresholds are 4 straight makes and 5 straight misses', () => {
  assert.equal(RUN_MAKES, 4);
  assert.equal(COLD_MISSES, 5);
});

test('four made field goals in a row is a run; three is not', () => {
  assert.deepEqual(streaks(attemptsOf([ev('x2'), ev('m2'), ev('m3'), ev('m2'), ev('m2'), ev('x2')])), [{ kind: 'run', from: 1, to: 4, count: 4 }]);
  assert.deepEqual(streaks(attemptsOf([ev('m2'), ev('m3'), ev('m2'), ev('x2')])), []);
});

test('five missed field goals in a row is a cold stretch; four is not', () => {
  assert.deepEqual(streaks(attemptsOf([ev('m2'), ev('x2'), ev('x3'), ev('x2'), ev('x2'), ev('x3')])), [{ kind: 'cold', from: 1, to: 5, count: 5 }]);
  assert.deepEqual(streaks(attemptsOf([ev('x2'), ev('x3'), ev('x2'), ev('x2'), ev('m2')])), []);
});

test('free throws are ignored by streaks: they neither count nor end one', () => {
  const list = attemptsOf([ev('m2'), ev('m2'), ev('x1'), ev('x1'), ev('m3'), ev('m2'), ev('m1')]);
  assert.deepEqual(streaks(list), [{ kind: 'run', from: 0, to: 5, count: 4 }]);
  assert.deepEqual(streaks(attemptsOf([ev('m1'), ev('m1'), ev('m1'), ev('m1'), ev('m1')])), []);
});

test('a run and a cold stretch in the same game are both found', () => {
  const makes = [1, 2, 3, 4].map(() => ev('m2'));
  const misses = [1, 2, 3, 4, 5, 6].map(() => ev('x2'));
  assert.deepEqual(streaks(attemptsOf([...makes, ...misses])).map((s) => [s.kind, s.count]), [['run', 4], ['cold', 6]]);
});

const season = [
  { played: [1, 2, 3], players: [{ id: 1, m2: 3, x2: 3, m3: 1, x3: 3 }, { id: 2, m2: 0, x2: 0, m3: 2, x3: 2 }] },
  { played: [1, 2], players: [{ id: 1, m2: 1, x2: 1, m3: 0, x3: 0 }] },
];

test('both kinds on: attempts per game and points per shot for each player, and the team average', () => {
  const { rows, average } = efficiency(season, { two: true, three: true });
  const p1 = rows.find((r) => r.id === 1);
  assert.deepEqual([p1.games, p1.attempts, p1.made, p1.points], [2, 12, 5, 11]);
  assert.equal(p1.perGame, 6);
  assert.equal(p1.pps, 11 / 12);
  const p2 = rows.find((r) => r.id === 2);
  // Player 2 took no shots in the second game and still played in it.
  assert.deepEqual([p2.games, p2.attempts, p2.perGame, p2.pps], [2, 4, 2, 1.5]);
  assert.equal(average, 17 / 16);
  // Player 3 played and never shot: no dot.
  assert.equal(rows.some((r) => r.id === 3), false);
});

test('only twos, and only threes', () => {
  const two = efficiency(season, { two: true, three: false });
  assert.deepEqual(two.rows.map((r) => [r.id, r.attempts, r.points]), [[1, 8, 8]]);
  assert.equal(two.average, 1);
  const three = efficiency(season, { two: false, three: true });
  assert.deepEqual(three.rows.map((r) => [r.id, r.attempts, r.points]).sort(), [[1, 4, 3], [2, 4, 6]]);
  assert.equal(three.average, 9 / 8);
});

test('both kinds off: nothing to count', () => {
  assert.deepEqual(efficiency(season, { two: false, three: false }), { rows: [], average: null });
});
