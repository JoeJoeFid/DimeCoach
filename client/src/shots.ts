// Shooting, worked out from a game's plays: every attempt in the order it was taken, the periods
// it falls into, hot and cold stretches, and each player's volume and efficiency over many games.
// Nothing here draws anything or reads the page, so it is tested on its own (shots.test.mjs).
import type { GameEvent } from './scoring';

/** This many field goals made in a row is a run. */
export const RUN_MAKES = 4;
/** This many field goals missed in a row is a cold stretch. */
export const COLD_MISSES = 5;

/** What a shot is worth when it goes in: a free throw is 1. */
export type ShotKind = 1 | 2 | 3;
export interface Attempt {
  id: string;
  player: number | null;
  kind: ShotKind;
  made: boolean;
  period: number;
  /** The points this attempt put on the board: nothing for a miss. */
  points: number;
  /** The team's score once this attempt was over. */
  score: number;
  /** Where on the half court it was taken, as shares of its width and depth, when that was marked. */
  x?: number;
  y?: number;
}
const SHOTS: Record<string, [ShotKind, boolean]> = { m1: [1, true], x1: [1, false], m2: [2, true], x2: [2, false], m3: [3, true], x3: [3, false] };

/** Plays brought in from a file are totals: they were never in an order. */
export const hasOrder = (events: GameEvent[]) => !events.some((e) => e.id.startsWith('imp'));

/**
 * The team's attempts in the order they happened: by period, and within a period as they were put
 * in. A point recorded with no shot behind it counts towards the score and is not an attempt.
 */
export function attemptsOf(events: GameEvent[]): Attempt[] {
  const ours = events.filter((e) => e.side === 'us');
  // Stable, so plays put in during one period keep their order.
  const ordered = ours.map((e, i) => ({ e, i })).sort((a, b) => a.e.period - b.e.period || a.i - b.i);
  const out: Attempt[] = [];
  let score = 0;
  for (const { e } of ordered) {
    if (e.type === 'p1') {
      score += 1;
      continue;
    }
    const shot = SHOTS[e.type];
    if (!shot) continue;
    const points = shot[1] ? shot[0] : 0;
    score += points;
    out.push({ id: e.id, player: e.player, kind: shot[0], made: shot[1], period: e.period, points, score, ...(e.x !== undefined && e.y !== undefined ? { x: e.x, y: e.y } : {}) });
  }
  return out;
}

/** Makes and attempts: field goals (twos and threes together), threes, and free throws. */
export interface Tally {
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  pts: number;
}
export function tally(list: Attempt[]): Tally {
  const t: Tally = { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, pts: 0 };
  for (const a of list) {
    t.pts += a.points;
    if (a.kind === 1) {
      t.fta++;
      if (a.made) t.ftm++;
      continue;
    }
    t.fga++;
    if (a.made) t.fgm++;
    if (a.kind === 3) {
      t.tpa++;
      if (a.made) t.tpm++;
    }
  }
  return t;
}

/** A period's stretch of the attempts: from `start` up to, not including, `end`. */
export interface Section {
  period: number;
  start: number;
  end: number;
  totals: Tally;
}
/** The attempts cut into their periods, in order. A game all in one period comes back as one section. */
export function sections(list: Attempt[]): Section[] {
  const out: Section[] = [];
  list.forEach((a, i) => {
    const last = out[out.length - 1];
    if (last && last.period === a.period) last.end = i + 1;
    else out.push({ period: a.period, start: i, end: i + 1, totals: tally([]) });
  });
  for (const s of out) s.totals = tally(list.slice(s.start, s.end));
  return out;
}

/** A stretch of field goals all made or all missed, from the attempt at `from` to the one at `to`. */
export interface Streak {
  kind: 'run' | 'cold';
  from: number;
  to: number;
  /** How many field goals are in it. Free throws in between are not counted and do not end it. */
  count: number;
}
export function streaks(list: Attempt[], runMakes = RUN_MAKES, coldMisses = COLD_MISSES): Streak[] {
  const out: Streak[] = [];
  let made: boolean | null = null;
  let from = 0;
  let to = 0;
  let count = 0;
  const close = () => {
    if (made === true && count >= runMakes) out.push({ kind: 'run', from, to, count });
    if (made === false && count >= coldMisses) out.push({ kind: 'cold', from, to, count });
  };
  list.forEach((a, i) => {
    if (a.kind === 1) return;
    if (a.made !== made) {
      close();
      made = a.made;
      from = i;
      count = 0;
    }
    to = i;
    count++;
  });
  close();
  return out;
}

/** One game's field goal attempts for each player, as the server hands them over. */
export interface GameShots {
  /** Everyone with any stat in the game. */
  played: number[];
  players: { id: number; m2: number; x2: number; m3: number; x3: number }[];
}
export interface Efficiency {
  id: number;
  games: number;
  attempts: number;
  made: number;
  points: number;
  /** Attempts for each game the player has a stat in. */
  perGame: number;
  /** Points for each attempt. */
  pps: number;
}
/**
 * Each player's shot volume and efficiency over the games given, counting only the kinds of shot
 * that are switched on, and the team's points per shot over the same attempts. With both kinds
 * off there is nothing to count: no rows, and no average.
 */
export function efficiency(games: GameShots[], on: { two: boolean; three: boolean }): { rows: Efficiency[]; average: number | null } {
  const by = new Map<number, { games: number; attempts: number; made: number; points: number }>();
  const of = (id: number) => {
    if (!by.has(id)) by.set(id, { games: 0, attempts: 0, made: 0, points: 0 });
    return by.get(id)!;
  };
  for (const g of games) {
    for (const id of g.played) of(id).games++;
    for (const p of g.players) {
      const row = of(p.id);
      if (on.two) {
        row.attempts += p.m2 + p.x2;
        row.made += p.m2;
        row.points += p.m2 * 2;
      }
      if (on.three) {
        row.attempts += p.m3 + p.x3;
        row.made += p.m3;
        row.points += p.m3 * 3;
      }
    }
  }
  const rows = [...by.entries()]
    .filter(([, r]) => r.attempts > 0)
    .map(([id, r]) => ({ id, ...r, perGame: r.attempts / Math.max(1, r.games), pps: r.points / r.attempts }));
  const attempts = rows.reduce((n, r) => n + r.attempts, 0);
  return { rows, average: attempts ? rows.reduce((n, r) => n + r.points, 0) / attempts : null };
}
