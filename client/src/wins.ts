// What goes with winning: for each stat, how closely the team's number in a game moves with the
// margin the game was won or lost by, and how the stat's average differs between wins and losses.
// One stat at a time, because a season has too few games to weigh them against each other.
// Nothing here draws anything, so it is tested on its own (wins.test.mjs).
import type { StatLine } from './scoring';

/** One game, as this needs it: the team's numbers, the other team's where they are kept, and the score. */
export interface GameNumbers {
  us: StatLine;
  them: StatLine;
  scoreUs: number;
  scoreThem: number;
}
/** The least a game has to say for this: the score. Its numbers are whatever its sport keeps. */
export interface GameMargin {
  scoreUs: number;
  scoreThem: number;
}
export interface WinStat<G = GameNumbers> {
  key: string;
  name: string;
  /** Shown as a percentage. */
  rate?: boolean;
  /** The stat's value in a game, or null when the game has nothing to go on (no shots taken, for a percentage). */
  value: (g: G) => number | null;
}
const pct = (made: number, tried: number) => (tried > 0 ? (made / tried) * 100 : null);
/** Points are left out: the margin is made of them. */
export const WIN_STATS: WinStat[] = [
  { key: 'fgp', name: 'Field goal %', rate: true, value: (g) => pct(g.us.fgm, g.us.fga) },
  { key: 'twop', name: '2-point %', rate: true, value: (g) => pct(g.us.fgm - g.us.tpm, g.us.fga - g.us.tpa) },
  { key: 'tpp', name: '3-point %', rate: true, value: (g) => pct(g.us.tpm, g.us.tpa) },
  { key: 'tpm', name: '3-pointers made', value: (g) => g.us.tpm },
  { key: 'fga', name: 'Shots taken', value: (g) => g.us.fga },
  { key: 'ftp', name: 'Free throw %', rate: true, value: (g) => pct(g.us.ftm, g.us.fta) },
  { key: 'fta', name: 'Free throws taken', value: (g) => g.us.fta },
  { key: 'oreb', name: 'Offensive rebounds', value: (g) => g.us.oreb },
  { key: 'dreb', name: 'Defensive rebounds', value: (g) => g.us.dreb },
  { key: 'reb', name: 'Rebounds', value: (g) => g.us.reb },
  { key: 'ast', name: 'Assists', value: (g) => g.us.ast },
  { key: 'stl', name: 'Steals', value: (g) => g.us.stl },
  { key: 'blk', name: 'Blocks', value: (g) => g.us.blk },
  { key: 'to', name: 'Turnovers', value: (g) => g.us.to },
  { key: 'fto', name: 'Turnovers forced', value: (g) => g.us.fto },
  { key: 'pf', name: 'Fouls', value: (g) => g.us.pf },
  { key: 'oto', name: 'Their turnovers', value: (g) => g.them.to },
  { key: 'opf', name: 'Their fouls', value: (g) => g.them.pf },
];

/** How closely two lists of numbers move together, from -1 to 1. Null when there are too few, or one of them never changes. */
export function correlation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3 || n !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** How far a number of games can be trusted, as a step from 1 to 4 with words for it. */
export interface Confidence {
  level: 1 | 2 | 3 | 4;
  label: string;
  about: string;
}
/** Games needed for each step up. */
export const CONFIDENCE_STEPS = { early: 5, fair: 10, solid: 20 };
export function confidence(games: number): Confidence {
  if (games >= CONFIDENCE_STEPS.solid) return { level: 4, label: 'Solid', about: 'Enough games that a strong link is unlikely to be chance.' };
  if (games >= CONFIDENCE_STEPS.fair) return { level: 3, label: 'Fair', about: 'The strongest links are worth acting on; the weaker ones may still be chance.' };
  if (games >= CONFIDENCE_STEPS.early) return { level: 2, label: 'Early read', about: 'A few games can line up by chance. Treat this as a hint, not a finding.' };
  return { level: 1, label: 'Very low', about: 'Too few games to tell a real link from chance. Keep scoring games and look again.' };
}
/** How strong a link is, in a word. */
export const strength = (r: number) => (Math.abs(r) >= 0.6 ? 'Strong' : Math.abs(r) >= 0.4 ? 'Moderate' : Math.abs(r) >= 0.2 ? 'Weak' : 'Little or none');

export interface WinRow {
  key: string;
  name: string;
  rate: boolean;
  /** How many games had a value for this stat. */
  games: number;
  /** The link with the margin, or null when it cannot be worked out. */
  r: number | null;
  inWins: number | null;
  inLosses: number | null;
}
const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
/**
 * Every stat that was tracked in these games, the strongest links first. A stat that is zero in
 * every game was not tracked and is left out. Tied games count towards the link and towards
 * neither average.
 */
export function winLinks<G extends GameMargin = GameNumbers>(games: G[], stats: WinStat<G>[] = WIN_STATS as unknown as WinStat<G>[]): { rows: WinRow[]; wins: number; losses: number; ties: number } {
  const rows: WinRow[] = [];
  for (const s of stats) {
    const have = games.map((g) => ({ v: s.value(g), margin: g.scoreUs - g.scoreThem })).filter((x): x is { v: number; margin: number } => x.v !== null);
    if (have.length === 0 || have.every((x) => x.v === 0)) continue;
    rows.push({
      key: s.key,
      name: s.name,
      rate: !!s.rate,
      games: have.length,
      r: correlation(have.map((x) => x.v), have.map((x) => x.margin)),
      inWins: mean(have.filter((x) => x.margin > 0).map((x) => x.v)),
      inLosses: mean(have.filter((x) => x.margin < 0).map((x) => x.v)),
    });
  }
  // A stat with no link to show goes to the bottom.
  const rank = (r: number | null) => (r === null ? -1 : Math.abs(r));
  rows.sort((a, b) => rank(b.r) - rank(a.r));
  return { rows, wins: games.filter((g) => g.scoreUs > g.scoreThem).length, losses: games.filter((g) => g.scoreUs < g.scoreThem).length, ties: games.filter((g) => g.scoreUs === g.scoreThem).length };
}
