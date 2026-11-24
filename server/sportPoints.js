// What each play is worth in the sports that are not basketball, for adding up a score.
//
// The plays themselves, their names and the stats made from them are the app's
// (client/src/sportScoring.ts). The server only keeps a game's plays and adds up its score, so
// this is all of them it needs to know. A minus is points for the other side: a volleyball error
// is the team's own stat and the other team's point. client/src/sportScoring.test.mjs checks that
// this list and the app's say the same.
export const SPORT_POINTS = {
  // Baseball and softball: a run is a run, and a home run is the batter's own.
  'bb:1b': 0, 'bb:2b': 0, 'bb:3b': 0, 'bb:hr': 1, 'bb:bb': 0, 'bb:hbp': 0, 'bb:roe': 0, 'bb:sac': 0, 'bb:k': 0, 'bb:out': 0,
  'bb:run': 1, 'bb:rbi': 0, 'bb:sb': 0, 'bb:cs': 0, 'bb:pk': 0, 'bb:pbb': 0, 'bb:ph': 0, 'bb:e': 0,
  // Football.
  'fb:td': 6, 'fb:xp': 1, 'fb:two': 2, 'fb:fg': 3, 'fb:sfty': 2, 'fb:ptd': 0, 'fb:rush': 0, 'fb:comp': 0, 'fb:rec': 0, 'fb:inc': 0, 'fb:int': 0, 'fb:fum': 0,
  'fb:tkl': 0, 'fb:sack': 0, 'fb:dint': 0, 'fb:fr': 0, 'fb:pd': 0, 'fb:pen': 0,
  // Volleyball: every rally is a point for one side.
  'vb:kill': 1, 'vb:ace': 1, 'vb:blk': 1, 'vb:oe': 1, 'vb:pt': 1, 'vb:ae': -1, 'vb:se': -1, 'vb:re': -1, 'vb:err': -1, 'vb:att': 0, 'vb:dig': 0, 'vb:ast': 0, 'vb:srv': 0,
};
const BASKETBALL = { m1: 1, m2: 2, m3: 3, p1: 1 };
export const isSportPlay = (type) => Object.hasOwn(SPORT_POINTS, type);
/** A game won by sets, told from its plays. */
const bySets = (events) => events.some((e) => typeof e.type === 'string' && e.type.startsWith('vb:'));

/** Who a play scores for, and how many: null for one that scores nothing. */
export function credit(e) {
  const p = Object.hasOwn(BASKETBALL, e.type) ? BASKETBALL[e.type] : SPORT_POINTS[e.type] || 0;
  if (!p) return null;
  const side = e.side === 'them' ? 'them' : 'us';
  return { side: p > 0 ? side : side === 'us' ? 'them' : 'us', pts: Math.abs(p) };
}
/** The points each side scored in each part of the game. */
export function byPart(events) {
  const parts = [];
  for (const e of events) {
    const c = credit(e);
    if (!c) continue;
    const i = Math.max(1, Number(e.period) || 1) - 1;
    parts[i] ||= { us: 0, them: 0 };
    parts[i][c.side] += c.pts;
  }
  return Array.from(parts, (p) => p || { us: 0, them: 0 });
}
/**
 * A game's score: the points added up, or for a game won by sets, the sets each side has won. A
 * set counts once the game has moved past it or is over.
 */
export function finalScore(events, state) {
  const parts = byPart(events);
  if (!bySets(events)) return { us: parts.reduce((n, p) => n + p.us, 0), them: parts.reduce((n, p) => n + p.them, 0) };
  let us = 0;
  let them = 0;
  parts.forEach((p, i) => {
    if (i + 1 >= (Number(state?.period) || 1) && state?.status !== 'final') return;
    if (p.us > p.them) us++;
    else if (p.them > p.us) them++;
  });
  return { us, them };
}
