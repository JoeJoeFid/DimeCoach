// What a team tracks while scoring a game, and the numbers behind the shot volume and efficiency
// chart. Nothing here touches the database, so it can be tested on its own.

/** What the scoring pad asks for until a team says otherwise. The last three are extras, off to begin with. */
export const DEFAULT_SCORING = { reb: true, ast: true, stl: true, blk: true, to: true, pf: true, forced: false, place: false, halves: false };

/** A team's scoring choices as sent or as stored: every switch present, each one true or false. */
export function cleanScoring(value, base = DEFAULT_SCORING) {
  const v = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_SCORING)) out[k] = typeof v[k] === 'boolean' ? v[k] : !!base[k];
  return out;
}

/** Whether a team may see the shot volume and efficiency chart: only when the system administrator has turned it on for that team. */
export const shotChartAllowed = (team) => !!team && Number(team.shot_efficiency_chart) === 1;

/**
 * One game's field goal attempts by the team, player by player: twos and threes, made and missed.
 * `played` is everyone on the team with any stat in the game, which is what "per game" divides by.
 * Free throws are left out, and so are attempts not given to a player.
 */
export function shotCounts(events) {
  const players = new Map();
  const played = new Set();
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.side !== 'us' || !Number.isInteger(e.player)) continue;
    played.add(e.player);
    if (!['m2', 'x2', 'm3', 'x3'].includes(e.type)) continue;
    if (!players.has(e.player)) players.set(e.player, { id: e.player, m2: 0, x2: 0, m3: 0, x3: 0 });
    players.get(e.player)[e.type]++;
  }
  return { players: [...players.values()], played: [...played] };
}
