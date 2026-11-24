// A game being scored, turned into what a follower watches: each play as a line that can be read
// out, with the score as it stood after it. Nothing here touches the database, so it can be tested
// on its own.

import { credit } from './sportPoints.js';

/**
 * The plays in the order they were put in. `nameOf` gives what a follower may be told about one
 * of the team's players, and `oppName` what the other team is called. Each play carries the score
 * after it; a rebound says whether it was offensive, an assist which shot it set up, and a forced
 * turnover or shooting foul what made it so.
 */
export function livePlays(events, { nameOf, oppName, oppPlayers = [] }) {
  const list = Array.isArray(events) ? events : [];
  const byId = new Map(list.map((e) => [e.id, e]));
  const who = (side, player) => {
    if (side === 'us') return player === null || player === undefined ? '' : nameOf(player);
    const label = oppPlayers.find((p) => p.id === player)?.label;
    return label ? `${oppName} #${label}` : oppName;
  };
  let us = 0;
  let them = 0;
  // Volleyball is scored a set at a time: the score read out starts again with each one.
  const bySets = list.some((e) => typeof e.type === 'string' && e.type.startsWith('vb:'));
  let part = 0;
  return list.map((e, i) => {
    if (bySets && (Number(e.period) || 1) !== part) {
      part = Number(e.period) || 1;
      us = 0;
      them = 0;
    }
    const scored = credit(e);
    if (scored?.side === 'us') us += scored.pts;
    else if (scored) them += scored.pts;
    const prev = list[i - 1];
    // A rebound by the team is offensive when it came off the team's own miss: said outright on newer plays, read from the play before on older ones.
    const off = e.type === 'reb' && e.side === 'us' && (e.for !== undefined ? e.for !== null : !!prev && prev.side === 'us' && (prev.type === 'x2' || prev.type === 'x3'));
    return {
      id: String(e.id),
      side: e.side === 'them' ? 'them' : 'us',
      type: e.type,
      who: who(e.side, e.player),
      // Whether it put points on the board, and for which side: an error can score for the other one.
      ...(scored ? { scored: scored.side } : {}),
      ...(Number.isFinite(e.v) ? { v: e.v } : {}),
      period: Number(e.period) || 1,
      us,
      them,
      ...(e.type === 'reb' ? { off } : {}),
      // The shot an assist set up, so the two can be read as one line.
      ...(e.type === 'ast' && typeof e.for === 'string' && byId.has(e.for) ? { shot: e.for } : {}),
      ...(e.type === 'to' && e.forced ? { forced: true, by: e.by !== undefined ? who(e.side === 'us' ? 'them' : 'us', e.by) : '' } : {}),
      ...(e.type === 'pf' && e.fts ? { fts: e.fts } : {}),
      ...(Number.isFinite(e.x) && Number.isFinite(e.y) ? { x: e.x, y: e.y } : {}),
      ...(Array.isArray(e.path) && e.path.length > 1 ? { path: e.path } : {}),
    };
  });
}
