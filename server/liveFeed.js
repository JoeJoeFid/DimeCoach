// A game being scored, turned into what a follower watches: each play as a line that can be read
// out, with the score as it stood after it. Nothing here touches the database, so it can be tested
// on its own.

const POINTS = { p1: 1, m1: 1, m2: 2, m3: 3 };

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
  return list.map((e, i) => {
    const pts = POINTS[e.type] || 0;
    if (e.side === 'us') us += pts;
    else them += pts;
    const prev = list[i - 1];
    // A rebound by the team is offensive when it came off the team's own miss: said outright on newer plays, read from the play before on older ones.
    const off = e.type === 'reb' && e.side === 'us' && (e.for !== undefined ? e.for !== null : !!prev && prev.side === 'us' && (prev.type === 'x2' || prev.type === 'x3'));
    return {
      id: String(e.id),
      side: e.side === 'them' ? 'them' : 'us',
      type: e.type,
      who: who(e.side, e.player),
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
