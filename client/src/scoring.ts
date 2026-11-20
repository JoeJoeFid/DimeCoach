// Keeping score: the plays a scorer taps in, and every number worked out from them.
// The server keeps the same list (server/games.js) and only ever adds up the points.

/** A made shot worth 1, 2 or 3; a missed one; or one of the other things a player does. 'p1' is a point with nothing known about how it was scored. */
export type EvType = 'p1' | 'm1' | 'm2' | 'm3' | 'x1' | 'x2' | 'x3' | 'reb' | 'ast' | 'stl' | 'blk' | 'to' | 'pf';
export interface GameEvent {
  id: string;
  side: 'us' | 'them';
  /** A roster player, or one of the opponent's when they are tracked. Null when the play is the team's as a whole. */
  player: number | null;
  type: EvType;
  period: number;
  /** Seconds left in the period, when the scorer is running a clock. */
  clock: number | null;
  at: number;
}
export interface ScoreState {
  /** "score" is just the two scores. "full" is who did what. */
  mode: 'score' | 'full';
  period: number;
  status: 'live' | 'final';
  /** The players on the floor. */
  on: number[];
  timed: boolean;
  period_secs: number;
  clock_left: number | null;
  /** The opponent's players are tracked one by one, not only their score. */
  opp_advanced: boolean;
  opp_players: { id: number; label: string }[];
  /** The name of the file the plays were made from, when they were brought in as totals and not tapped in. */
  imported?: string;
}
export interface Scoresheet {
  id: number;
  scope: 'team' | 'personal';
  plan_id: number | null;
  team_id: number | null;
  player_id: number | null;
  player_name: string;
  title: string;
  date: string;
  state: ScoreState;
  events: GameEvent[];
  us: number;
  them: number;
  status: 'live' | 'final';
  rev: number;
  scorer_id: number | null;
  scorer: string;
  shared: boolean;
  updated_at: string;
  /** Season lists only. */
  opponent?: string;
  team?: string;
  by?: string;
}
export const newState = (mode: ScoreState['mode'] = 'score'): ScoreState => ({ mode, period: 1, status: 'live', on: [], timed: false, period_secs: 480, clock_left: null, opp_advanced: false, opp_players: [] });

export const POINTS: Partial<Record<EvType, number>> = { p1: 1, m1: 1, m2: 2, m3: 3 };
/** How a play reads in the list: "made a 3". */
export const EV_WORDS: Record<EvType, string> = {
  p1: 'point', m1: 'made a free throw', m2: 'made a 2', m3: 'made a 3', x1: 'missed a free throw', x2: 'missed a 2', x3: 'missed a 3',
  reb: 'rebound', ast: 'assist', stl: 'steal', blk: 'block', to: 'turnover', pf: 'foul',
};
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const scoreOf = (events: GameEvent[]) => ({
  us: events.reduce((n, e) => n + (e.side === 'us' ? POINTS[e.type] ?? 0 : 0), 0),
  them: events.reduce((n, e) => n + (e.side === 'them' ? POINTS[e.type] ?? 0 : 0), 0),
});
/** "4:05" from seconds. */
export const clockText = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
/** "Q2", or "OT" after the fourth. */
export const periodName = (p: number) => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `OT${p - 4}`);

/** One player's (or one side's) numbers. */
export interface StatLine {
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
  pf: number;
}
export const emptyLine = (): StatLine => ({ pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 });
export function addTo(line: StatLine, e: GameEvent) {
  line.pts += POINTS[e.type] ?? 0;
  if (e.type === 'm2' || e.type === 'm3') line.fgm++;
  if (e.type === 'm2' || e.type === 'm3' || e.type === 'x2' || e.type === 'x3') line.fga++;
  if (e.type === 'm3') line.tpm++;
  if (e.type === 'm3' || e.type === 'x3') line.tpa++;
  if (e.type === 'm1') line.ftm++;
  if (e.type === 'm1' || e.type === 'x1') line.fta++;
  if (e.type === 'reb' || e.type === 'ast' || e.type === 'stl' || e.type === 'blk' || e.type === 'to' || e.type === 'pf') line[e.type]++;
}
/** The numbers for one side, and within it for each player who did anything. */
export function linesOf(events: GameEvent[], side: 'us' | 'them') {
  const total = emptyLine();
  const players = new Map<number, StatLine>();
  for (const e of events) {
    if (e.side !== side) continue;
    addTo(total, e);
    if (e.player === null) continue;
    if (!players.has(e.player)) players.set(e.player, emptyLine());
    addTo(players.get(e.player)!, e);
  }
  return { total, players };
}
export const sumLines = (lines: StatLine[]) => {
  const out = emptyLine();
  for (const l of lines) for (const k of Object.keys(out) as (keyof StatLine)[]) out[k] += l[k];
  return out;
};
/** The points each side scored in each period. */
export function byPeriod(events: GameEvent[], upTo: number) {
  const out = Array.from({ length: Math.max(upTo, 1) }, () => ({ us: 0, them: 0 }));
  for (const e of events) {
    const p = POINTS[e.type];
    if (!p) continue;
    while (out.length < e.period) out.push({ us: 0, them: 0 });
    out[e.period - 1][e.side] += p;
  }
  return out;
}
