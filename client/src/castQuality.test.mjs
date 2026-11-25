import test from 'node:test';
import assert from 'node:assert/strict';
import { autoStart, autoStep, bitsOf } from './castQuality.ts';

/** Runs the rule over what the sender said, one piece every four seconds, and gives where it ended up. */
const run = (a, said, from = 0) => {
  let t = from;
  for (const s of said) {
    t += 4000;
    a = autoStep(a, s, t);
  }
  return [a, t];
};
const good = (q, n) => Array.from({ length: n }, () => ({ behind: 0, rate: 2.5 * bitsOf(q) }));

test('pieces piling up bring the quality down a step, once it has settled', () => {
  let a = autoStart('medium', 0);
  a = autoStep(a, { behind: 3 }, 4000);
  assert.equal(a.at, 'medium');
  a = autoStep(a, { behind: 4 }, 8000);
  assert.equal(a.at, 'sd');
  // What is waiting is still the old size: nothing more is done straight away.
  a = autoStep(a, { behind: 4 }, 12000);
  assert.equal(a.at, 'sd');
  a = autoStep(a, { behind: 4 }, 16000);
  assert.equal(a.at, 'low');
  a = autoStep(a, { behind: 8 }, 40000);
  assert.equal(a.at, 'lowest');
});

test('far behind goes straight to the lightest, and a stalled piece does not wait to settle', () => {
  assert.equal(autoStep(autoStart('high', 0), { behind: 6 }, 9000).at, 'lowest');
  assert.equal(autoStep(autoStart('high', 0), { behind: 0, stalled: true }, 1000).at, 'medium');
});

test('a connection with room to spare goes up in one change, to what it can carry, and no further than Auto goes', () => {
  let [a, t] = run(autoStart('low', 0), good('medium', 4));
  assert.equal(a.at, 'low', 'not before it has been steady a while');
  [a, t] = run(a, good('medium', 1), t);
  assert.equal(a.at, 'medium', 'straight there, not by way of 480p');
  [a] = run(a, good('high', 12), t);
  assert.equal(a.at, 'medium', 'High is for choosing by hand');
  [a] = run(autoStart('lowest', 0), good('sd', 5));
  assert.equal(a.at, 'sd', 'only as far as the pieces have been going fast enough for');
});

test('one slow piece, or anything waiting, starts the count again', () => {
  let [a, t] = run(autoStart('sd', 0), [...good('medium', 4), { behind: 0, rate: bitsOf('sd') }, ...good('medium', 3)]);
  assert.equal(a.at, 'sd');
  [a, t] = run(a, [{ behind: 2 }, ...good('medium', 3)], t);
  assert.equal(a.at, 'sd');
  [a] = run(a, good('medium', 1), t);
  assert.equal(a.at, 'medium');
});

test('a step up that has to be undone is left alone for a while, longer each time', () => {
  let [a, t] = run(autoStart('sd', 0), good('medium', 5));
  assert.equal(a.at, 'medium');
  [a, t] = run(a, [{ behind: 3 }, { behind: 3 }], t);
  assert.equal(a.at, 'sd');
  [a, t] = run(a, good('medium', 20), t);
  assert.equal(a.at, 'sd', 'still left alone 80 seconds on');
  [a, t] = run(a, good('medium', 12), t);
  assert.equal(a.at, 'medium', 'tried again after two minutes');
  [a, t] = run(a, [{ behind: 3 }, { behind: 3 }], t);
  assert.equal(a.at, 'sd');
  [a] = run(a, good('medium', 45), t);
  assert.equal(a.at, 'sd', 'four minutes this time');
});
