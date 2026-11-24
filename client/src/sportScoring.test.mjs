import test from 'node:test';
import assert from 'node:assert/strict';
import { SPORT_DEFS, SPORT_POINTS, credit, lineText, playOf, playText, sportDef, sportOfEvents, sportScore, statText, sumTallies, tallyOf } from './sportScoring.ts';
import { SPORT_POINTS as SERVER_POINTS, byPart, credit as serverCredit, finalScore, isSportPlay } from '../../server/sportPoints.js';
import { winLinks } from './wins.ts';

let made = 0;
/** A play: whose, by which player, what, in which part of the game, and how many when it has an amount. */
const ev = (side, player, type, period = 1, v) => ({ id: `e${++made}`, side, player, type, period, ...(v === undefined ? {} : { v }) });
const col = (def, key) => def.columns.find((c) => c.key === key);
const text = (def, key, tally, games) => statText(col(def, key), tally, games);

test('the server and the app agree on what every play is worth', () => {
  assert.deepEqual(SERVER_POINTS, SPORT_POINTS);
  assert.ok(isSportPlay('fb:td') && !isSportPlay('m2') && !isSportPlay('toString'));
});

test('every sport is laid out from plays that exist, and names no play twice', () => {
  for (const def of Object.values(SPORT_DEFS)) {
    const types = def.plays.map((p) => p.type);
    assert.equal(new Set(types).size, types.length, def.kind);
    for (const type of [...def.groups.flatMap((g) => g.plays), ...def.them]) assert.ok(types.includes(type), `${def.kind} has a button for ${type}`);
    for (const p of def.plays) if (p.also) assert.ok(types.includes(p.also.type), `${p.type} asks for ${p.also.type}`);
    for (const key of def.line) assert.ok(col(def, key), `${def.kind} sums a player up with ${key}`);
    assert.equal(new Set(def.columns.map((c) => c.key)).size, def.columns.length);
    assert.equal(new Set(def.wins.map((c) => c.key)).size, def.wins.length);
  }
  assert.equal(sportDef('basketball'), null);
  assert.equal(sportDef(null), null);
  assert.equal(sportDef('baseball').kind, 'baseball');
});

test('baseball: a batting line, runs by inning, and a home run that is its own run and run batted in', () => {
  const def = SPORT_DEFS.baseball;
  const game = [
    ev('us', 7, 'bb:1b'), ev('us', 7, 'bb:2b'), ev('us', 7, 'bb:k'), ev('us', 7, 'bb:bb'), ev('us', 7, 'bb:out', 2),
    ev('us', 9, 'bb:hr', 2), ev('us', 7, 'bb:run', 2), ev('us', 9, 'bb:rbi', 2), ev('us', 9, 'bb:sac', 3),
    ev('us', 3, 'bb:pk'), ev('us', 3, 'bb:pk', 2), ev('us', 3, 'bb:ph', 2), ev('us', 4, 'bb:e', 2),
    ev('them', null, 'bb:run', 2), ev('them', null, 'bb:run', 3), ev('them', null, 'bb:run', 3),
  ];
  const us = tallyOf(game, 'us');
  const seven = us.players.get(7);
  // Two hits in four at bats, and a walk: the walk is no at bat, and counts for getting on base.
  assert.equal(text(def, 'ab', seven), '4');
  assert.equal(text(def, 'h', seven), '2');
  assert.equal(text(def, 'avg', seven), '.500');
  assert.equal(text(def, 'obp', seven), '.600');
  assert.equal(text(def, 'slg', seven), '.750');
  assert.equal(text(def, 'r', seven), '1');
  const nine = us.players.get(9);
  assert.equal(text(def, 'hr', nine), '1');
  assert.equal(text(def, 'r', nine), '1');
  assert.equal(text(def, 'rbi', nine), '2');
  // A sacrifice is no at bat.
  assert.equal(text(def, 'ab', nine), '1');
  assert.equal(text(def, 'pk', us.players.get(3)), '2');
  assert.equal(text(def, 'e', us.total), '1');
  // Someone with no at bats has no average to show.
  assert.equal(text(def, 'avg', us.players.get(3)), '–');
  assert.equal(lineText(def, seven), '2 H · 4 AB · 1 R · 0 RBI · 1 BB · 1 K');
  const score = sportScore(def, game, { period: 3, status: 'live' });
  assert.deepEqual(score.parts, [{ us: 0, them: 0 }, { us: 2, them: 1 }, { us: 0, them: 2 }]);
  assert.deepEqual([score.us, score.them], [2, 3]);
  assert.deepEqual(finalScore(game, { period: 3, status: 'live' }), { us: 2, them: 3 });
  assert.equal(sportOfEvents(game).kind, 'baseball');
});

test('football: points by the kind of score, yards added up, and a loss taken off', () => {
  const def = SPORT_DEFS.football;
  const game = [
    ev('us', 22, 'fb:rush', 1, 12), ev('us', 22, 'fb:rush', 1, -3), ev('us', 22, 'fb:rush', 1, 0),
    ev('us', 12, 'fb:comp', 1, 20), ev('us', 80, 'fb:rec', 1, 20), ev('us', 12, 'fb:inc'), ev('us', 12, 'fb:int', 2),
    ev('us', 80, 'fb:td', 2), ev('us', 12, 'fb:ptd', 2), ev('us', 3, 'fb:xp', 2), ev('us', 3, 'fb:fg', 3), ev('us', null, 'fb:sfty', 4),
    ev('us', 55, 'fb:tkl'), ev('us', 55, 'fb:sack'), ev('us', 21, 'fb:dint', 3), ev('us', null, 'fb:pen', 3, 10),
    ev('them', null, 'fb:td', 1), ev('them', null, 'fb:two', 1),
  ];
  const us = tallyOf(game, 'us');
  const back = us.players.get(22);
  assert.equal(text(def, 'car', back), '3');
  assert.equal(text(def, 'ryd', back), '9');
  assert.equal(text(def, 'ypc', back), '3.0');
  const qb = us.players.get(12);
  assert.deepEqual([text(def, 'cmp', qb), text(def, 'att', qb), text(def, 'pyd', qb), text(def, 'ptd', qb), text(def, 'int', qb)], ['1', '3', '20', '1', '1']);
  assert.deepEqual([text(def, 'rec', us.players.get(80)), text(def, 'recyd', us.players.get(80)), text(def, 'pts', us.players.get(80))], ['1', '20', '6']);
  // A sack is a tackle too.
  assert.equal(text(def, 'tkl', us.players.get(55)), '2');
  const score = sportScore(def, game, { period: 4, status: 'final' });
  assert.deepEqual([score.us, score.them], [6 + 1 + 3 + 2, 8]);
  assert.deepEqual(finalScore(game, { period: 4, status: 'final' }), { us: 12, them: 8 });
  assert.deepEqual([def.periodName(2), def.periodName(5), def.periodName(6)], ['Q2', 'OT', 'OT2']);
  assert.equal(playText(game[0]), 'Rush, 12 yards');
  assert.equal(playText(game[1]), 'Rush, 3 yards lost');
  assert.equal(playText(game[2]), 'Rush, no gain');
  assert.equal(playText(ev('us', 1, 'fb:rush', 1, 1)), 'Rush, 1 yard');
  assert.equal(playText(game[7]), 'Touchdown');
  // What is set against winning: the turnover margin is takeaways less giveaways.
  const g = { us: us.total, them: tallyOf(game, 'them').total };
  assert.equal(def.wins.find((w) => w.key === 'tom').value(g), 0);
  assert.equal(def.wins.find((w) => w.key === 'yds').value(g), 29);
  assert.equal(Math.round(def.wins.find((w) => w.key === 'cmp').value(g)), 33);
});

test('volleyball: an error is the other side\'s point, and the score is sets won', () => {
  const def = SPORT_DEFS.volleyball;
  assert.deepEqual(credit(ev('us', 4, 'vb:ae')), { side: 'them', pts: 1 });
  assert.deepEqual(credit(ev('us', 4, 'vb:kill')), { side: 'us', pts: 1 });
  assert.deepEqual(credit(ev('them', null, 'vb:pt')), { side: 'them', pts: 1 });
  assert.equal(credit(ev('us', 4, 'vb:dig')), null);
  assert.deepEqual(serverCredit(ev('us', 4, 'vb:se')), { side: 'them', pts: 1 });
  // Basketball's plays still score as they did.
  assert.deepEqual(serverCredit({ side: 'them', type: 'm3' }), { side: 'them', pts: 3 });
  assert.equal(serverCredit({ side: 'us', type: 'reb' }), null);
  const set = (period, usPts, themPts) => [...Array.from({ length: usPts }, () => ev('us', 4, 'vb:kill', period)), ...Array.from({ length: themPts }, () => ev('them', null, 'vb:pt', period))];
  // Won 25-20, lost 10-25, and ahead 8-5 in the third.
  const game = [...set(1, 25, 20), ...set(2, 10, 25), ...set(3, 8, 5)];
  const live = sportScore(def, game, { period: 3, status: 'live' });
  assert.deepEqual([live.us, live.them], [1, 1]);
  assert.deepEqual(live.points, { us: 8, them: 5 });
  assert.deepEqual(finalScore(game, { period: 3, status: 'live' }), { us: 1, them: 1 });
  // Once it is over, the set being played counts too. Fewer points in all, and the match won.
  const over = sportScore(def, game, { period: 3, status: 'final' });
  assert.deepEqual([over.us, over.them], [2, 1]);
  assert.deepEqual(finalScore(game, { period: 3, status: 'final' }), { us: 2, them: 1 });
  assert.deepEqual(byPart(game), [{ us: 25, them: 20 }, { us: 10, them: 25 }, { us: 8, them: 5 }]);
  // Hitting percentage: kills less errors, over every swing.
  const hitter = tallyOf([ev('us', 9, 'vb:kill'), ev('us', 9, 'vb:kill'), ev('us', 9, 'vb:kill'), ev('us', 9, 'vb:ae'), ev('us', 9, 'vb:att'), ev('us', 9, 'vb:att'), ev('us', 9, 'vb:att'), ev('us', 9, 'vb:att')], 'us').players.get(9);
  assert.equal(text(def, 'ta', hitter), '8');
  assert.equal(text(def, 'hit', hitter), '.250');
  // More errors than kills is below zero, and written so.
  assert.equal(text(def, 'hit', tallyOf([ev('us', 9, 'vb:ae'), ev('us', 9, 'vb:ae'), ev('us', 9, 'vb:kill'), ev('us', 9, 'vb:att')], 'us').total), '-.250');
});

test('numbers add up over games, and a rate is worked out again from the totals', () => {
  const def = SPORT_DEFS.baseball;
  const one = tallyOf([ev('us', 1, 'bb:1b'), ev('us', 1, 'bb:out')], 'us').total;
  const two = tallyOf([ev('us', 1, 'bb:out'), ev('us', 1, 'bb:out')], 'us').total;
  const both = sumTallies([one, two]);
  assert.equal(text(def, 'ab', both), '4');
  assert.equal(text(def, 'avg', both), '.250');
  // Per game: at bats are shared out, the average is not.
  assert.equal(text(def, 'ab', both, 2), '2.0');
  assert.equal(text(def, 'avg', both, 2), '.250');
  assert.equal(playOf('bb:hr').title, 'Home run');
  assert.equal(playOf('m2'), null);
});

test('what wins is worked out for a sport\'s own numbers', () => {
  const def = SPORT_DEFS.volleyball;
  // More aces in the games won by more.
  const games = [
    [5, 25, 10],
    [3, 25, 20],
    [1, 20, 25],
    [0, 12, 25],
  ].map(([aces, scoreUs, scoreThem]) => ({ us: tallyOf(Array.from({ length: aces }, () => ev('us', 2, 'vb:ace')), 'us').total, them: tallyOf([], 'them').total, scoreUs, scoreThem }));
  const { rows, wins, losses } = winLinks(games, def.wins);
  assert.deepEqual([wins, losses], [2, 2]);
  // Only what was tracked is listed.
  assert.deepEqual(rows.map((r) => r.key), ['ace']);
  assert.ok(rows[0].r > 0.9);
  assert.equal(rows[0].inWins, 4);
  assert.equal(rows[0].inLosses, 0.5);
});
