// What a game plan holds, and the sums behind it: how a game is cut into stretches of play for
// substituting, how much each player plays, and what can be read out of a calendar entry's title.
import type { GamePlan, GameSubs, Player, Team } from './types';
import type { SportKind } from './sports';

/** How each sport usually thinks about substituting. The coach changes any of it for a given game. */
export const DEFAULT_SUBS: Record<SportKind | 'other', GameSubs> = {
  basketball: { mode: 'periods', unit: 'Quarter', count: 4, minutes: 8, game_minutes: 32, every: 4, on: 5 },
  baseball: { mode: 'periods', unit: 'Inning', count: 6, minutes: 0, game_minutes: 0, every: 0, on: 9 },
  football: { mode: 'periods', unit: 'Quarter', count: 4, minutes: 10, game_minutes: 40, every: 5, on: 11 },
  volleyball: { mode: 'periods', unit: 'Set', count: 3, minutes: 0, game_minutes: 0, every: 0, on: 6 },
  other: { mode: 'periods', unit: 'Period', count: 4, minutes: 0, game_minutes: 0, every: 0, on: 5 },
};
export const UNIT_CHOICES = ['Quarter', 'Half', 'Period', 'Inning', 'Set'];
/** Situations a play sheet is grouped under. */
export const SITUATIONS = ['Base offense', 'Defense', 'Special situations', 'End of game'];

export const subsOf = (game: GamePlan, sport: SportKind | null): GameSubs => ({ ...DEFAULT_SUBS[sport ?? 'other'], ...(game.subs || {}) });

/** One stretch of play between substitutions: a quarter, an inning, or four minutes on the clock. */
export interface Segment {
  label: string;
  /** Longer name, for a tooltip. */
  name: string;
  /** Minutes it lasts. 0 when the game is not timed that way. */
  minutes: number;
}
const clock = (m: number) => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;
export function segmentsOf(subs: GameSubs): Segment[] {
  if (subs.mode === 'time') {
    const every = Math.max(1, subs.every || 1);
    const total = Math.max(every, subs.game_minutes || every);
    const out: Segment[] = [];
    for (let at = 0; at < total - 0.001 && out.length < 40; at += every) {
      const end = Math.min(total, at + every);
      out.push({ label: clock(at), name: `${clock(at)} to ${clock(end)}`, minutes: end - at });
    }
    return out;
  }
  const n = Math.max(1, Math.min(20, subs.count || 1));
  const short = subs.unit === 'Quarter' ? 'Q' : subs.unit === 'Half' ? 'H' : subs.unit === 'Inning' ? '' : subs.unit === 'Set' ? 'S' : 'P';
  return Array.from({ length: n }, (_, i) => ({ label: `${short}${i + 1}`, name: `${subs.unit} ${i + 1}`, minutes: Math.max(0, subs.minutes || 0) }));
}

/** How much one player plays: "16 min", or "4 innings" when the game is not timed. */
export function playingTime(playerId: number, lineup: number[][], segments: Segment[], subs: GameSubs): { count: number; text: string } {
  let count = 0;
  let minutes = 0;
  segments.forEach((seg, i) => {
    if ((lineup[i] || []).includes(playerId)) {
      count++;
      minutes += seg.minutes;
    }
  });
  const timed = segments.some((s) => s.minutes > 0);
  const unit = subs.mode === 'time' ? 'stretch' : subs.unit.toLowerCase();
  const plural = unit === 'half' ? 'halves' : unit === 'stretch' ? 'stretches' : `${unit}s`;
  return { count, text: timed ? `${Math.round(minutes * 10) / 10} min` : `${count} ${count === 1 ? unit : plural}` };
}

/**
 * Shares the playing time out evenly: each stretch takes the players who have played least so
 * far, and among those, whoever has sat out longest. Starters come first in the order given.
 */
export function fillEvenly(playerIds: number[], segments: number, on: number): number[][] {
  const played = new Map(playerIds.map((id) => [id, 0]));
  const lastOn = new Map(playerIds.map((id, i) => [id, -1 - (playerIds.length - i) / 1000]));
  const lineup: number[][] = [];
  for (let s = 0; s < segments; s++) {
    const pick = [...playerIds].sort((a, b) => played.get(a)! - played.get(b)! || lastOn.get(a)! - lastOn.get(b)!).slice(0, Math.min(on, playerIds.length));
    for (const id of pick) {
      played.set(id, played.get(id)! + 1);
      lastOn.set(id, s);
    }
    // Kept in roster order so the grid reads the same down every column.
    lineup.push(playerIds.filter((id) => pick.includes(id)));
  }
  return lineup;
}

/**
 * The opponent, and whether it is home or away, read from a calendar title such as
 * "Hawks vs. Tigers", "Game @ Tigers" or "at Lincoln Middle". Null when the title says neither.
 */
export function readOpponent(title: string, teamName: string): { opponent: string; side: 'home' | 'away' } | null {
  const t = title.replace(/\s+/g, ' ').trim();
  const m = /^(.*?)(?:\s+|^)(vs\.?|v\.?|versus|@|at)\s+(.+)$/i.exec(t);
  if (!m) return null;
  const away = /^(@|at)$/i.test(m[2]);
  const strip = (s: string) =>
    s
      .replace(/^(game|scrimmage|match)\b[:\s-]*/i, '')
      .replace(/\s*[-–(]\s*(home|away)\)?\s*$/i, '')
      .trim();
  const before = strip(m[1]);
  const after = strip(m[3]);
  const mine = teamName.trim().toLowerCase();
  // "Tigers vs. Hawks" on the Hawks' own calendar: the other name is the opponent.
  const opponent = mine && after.toLowerCase() === mine && before ? before : after;
  return opponent ? { opponent, side: away ? 'away' : 'home' } : null;
}

/** True when a game plan has anything in it worth keeping in view. */
export function gameHasContent(g: GamePlan | undefined): boolean {
  if (!g) return false;
  return !!(
    (g.lineup || []).some((s) => s.length > 0) ||
    (g.keys && [...(g.keys.offense || []), ...(g.keys.defense || []), g.keys.focus].some((k) => (k || '').trim())) ||
    (g.plays || []).some((p) => p.play_ids.length > 0) ||
    (g.matchups || []).length > 0 ||
    (g.warmup || []).length > 0 ||
    (g.batting || []).length > 0 ||
    (g.scouting || '').trim() ||
    (g.uniform || '').trim() ||
    (g.bring || '').trim() ||
    (g.arrive || '').trim() ||
    (g.result && Object.values(g.result).some((v) => (v || '').trim())) ||
    Object.keys(g.availability || {}).length > 0
  );
}

/** Players who can be put in the lineup: on the roster, and not marked out. */
export const availablePlayers = (players: Player[], g: GamePlan) => players.filter((p) => p.active && (g.availability || {})[String(p.id)] !== 'out');

/** The usual names for positions in each sport. A team can replace them with its own. */
export const DEFAULT_POSITIONS: Record<SportKind | 'other', string[]> = {
  basketball: ['PG', 'SG', 'SF', 'PF', 'C'],
  baseball: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'],
  football: ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'],
  volleyball: ['S', 'OH', 'MB', 'OPP', 'L', 'DS'],
  other: [],
};
/** "1, 2, 3, 4, 5" to the names in it. */
export const parsePositions = (text: string) =>
  [...new Set(text.split(/[,;\n]/).map((n) => n.trim().slice(0, 12)).filter(Boolean))].slice(0, 30);
/** The position names for a game: its own, else the team's, else the sport's. */
export function positionsOf(game: GamePlan, team: Pick<Team, 'positions'> | null | undefined, sport: SportKind | null): string[] {
  if (game.position_names && game.position_names.length > 0) return game.position_names;
  const own = parsePositions(team?.positions || '');
  return own.length > 0 ? own : DEFAULT_POSITIONS[sport ?? 'other'];
}

/** The position one player has in one stretch, or '' when none was chosen. */
export const spotOf = (game: GamePlan, seg: number, playerId: number) => game.spots?.[seg]?.[String(playerId)] ?? '';

/**
 * Hands out positions for a whole lineup. Someone who stays on keeps the position they had; the
 * others take what is left, in the order the positions are named.
 */
export function assignSpots(lineup: number[][], names: string[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  lineup.forEach((on, s) => {
    const spots: Record<string, string> = {};
    const taken = new Set<string>();
    const before = out[s - 1] || {};
    for (const id of on) {
      const had = before[String(id)];
      if (had && !taken.has(had)) {
        spots[String(id)] = had;
        taken.add(had);
      }
    }
    const free = names.filter((n) => !taken.has(n));
    for (const id of on) if (!(String(id) in spots)) spots[String(id)] = free.shift() ?? '';
    out.push(spots);
  });
  return out;
}

/** What changes going into one stretch of play: who comes on, who goes off, and who changes position. */
export interface SubChange {
  label: string;
  name: string;
  on: { id: number; spot: string }[];
  off: { id: number; spot: string }[];
  moves: { id: number; from: string; to: string }[];
}
/** The starters, then the changes at the start of every later stretch. Stretches where nothing changes are left out. */
export function substitutions(game: GamePlan, segments: Segment[]): { starters: { id: number; spot: string }[]; changes: SubChange[] } {
  const on = (s: number) => game.lineup?.[s] ?? [];
  const starters = on(0).map((id) => ({ id, spot: spotOf(game, 0, id) }));
  const changes: SubChange[] = [];
  for (let s = 1; s < segments.length; s++) {
    const was = on(s - 1);
    const now = on(s);
    const change: SubChange = {
      label: segments[s].label,
      name: segments[s].name,
      on: now.filter((id) => !was.includes(id)).map((id) => ({ id, spot: spotOf(game, s, id) })),
      off: was.filter((id) => !now.includes(id)).map((id) => ({ id, spot: spotOf(game, s - 1, id) })),
      moves: now
        .filter((id) => was.includes(id) && spotOf(game, s, id) !== spotOf(game, s - 1, id) && (spotOf(game, s, id) || spotOf(game, s - 1, id)))
        .map((id) => ({ id, from: spotOf(game, s - 1, id), to: spotOf(game, s, id) })),
    };
    if (change.on.length || change.off.length || change.moves.length) changes.push(change);
  }
  return { starters, changes };
}
