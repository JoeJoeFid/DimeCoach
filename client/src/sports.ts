// What changes from sport to sport: the surface a play is drawn on, the words for each kind of
// line, the kinds of play, and where a starting lineup stands.
import type { Play, PlayLine, PlayMark } from './types';

export type SportKind = 'basketball' | 'baseball' | 'football';
/** Sports offered when making a team. Each has its own starter categories, drills and playbook. */
export const SPORT_CHOICES = ['Basketball', 'Baseball', 'Football'];

/** Which playbook a sport gets, from its name. Softball shares baseball's. Null when none is drawn yet. */
export function sportKind(name: string | undefined): SportKind | null {
  const n = (name || '').toLowerCase();
  if (n.includes('basketball')) return 'basketball';
  if (n.includes('baseball') || n.includes('softball')) return 'baseball';
  if (n.includes('football')) return 'football';
  return null;
}
export const surfaceWord = (kind: SportKind) => (kind === 'basketball' ? 'court' : 'field');

export const SURFACES: Record<SportKind, { id: Play['court']; label: string }[]> = {
  basketball: [
    { id: 'half', label: 'Half court' },
    { id: 'full', label: 'Full court' },
  ],
  baseball: [
    { id: 'infield', label: 'Infield' },
    { id: 'diamond', label: 'Whole field' },
  ],
  football: [
    { id: 'gridiron', label: 'Open field' },
    { id: 'redzone', label: 'Goal line' },
  ],
};

/** Starter kinds of play per sport. Coaches can type any category; these are suggestions. */
export const PLAY_CATEGORIES_BY_SPORT: Record<SportKind, string[]> = {
  basketball: ['Man offense', 'Zone offense', 'Quick hitter', 'Baseline out of bounds', 'Sideline out of bounds', 'Press break', 'Transition', 'Man defense', 'Zone defense', 'Press', 'End of game'],
  baseball: ['Defensive alignment', 'Bunt defense', 'First and third', 'Cutoffs and relays', 'Pickoffs and rundowns', 'Backing up', 'Baserunning', 'Bunt offense', 'Hit and run', 'Situations'],
  football: ['Run', 'Pass', 'Play action', 'Screen', 'Option', 'Goal line', 'Defensive front', 'Coverage', 'Blitz', 'Kickoff', 'Punt', 'Field goal'],
};

type LineKind = PlayLine['kind'];
/**
 * The four kinds of line mean the same thing in every sport: someone moves, the ball is sent,
 * someone moves with the ball, and a line that ends in a bar. Each sport has its own words for them.
 */
export const LINE_WORDS: Record<SportKind, Record<LineKind, { label: string; verb: string; hint: string }>> = {
  basketball: {
    cut: { label: 'Cut', verb: 'cuts', hint: 'Drag onto a player, then click where they cut to. Or click here and drag on the court.' },
    pass: { label: 'Pass', verb: 'passes', hint: 'Drag onto the passer, then click the receiver. Or click here and drag on the court.' },
    dribble: { label: 'Dribble', verb: 'dribbles', hint: 'Drag onto the ball handler, then click where they dribble to. Or click here and drag on the court.' },
    screen: { label: 'Screen', verb: 'screens', hint: 'Drag onto the screener, then click the player they screen. Or click here and drag on the court.' },
  },
  baseball: {
    cut: { label: 'Run', verb: 'runs', hint: 'Drag onto a runner or fielder, then click where they run to. Or click here and drag on the field.' },
    pass: { label: 'Throw or hit', verb: 'throws', hint: 'Drag onto whoever has the ball, then click who it goes to, or the spot where a hit lands. Or click here and drag on the field.' },
    dribble: { label: 'Run with ball', verb: 'runs with the ball', hint: 'Drag onto the fielder with the ball, then click where they carry it. Or click here and drag on the field.' },
    screen: { label: 'Back up', verb: 'backs up', hint: 'Drag onto a fielder, then click the teammate or base they back up or cover. Or click here and drag on the field.' },
  },
  football: {
    cut: { label: 'Route', verb: 'runs', hint: 'Drag onto a player, then click where their route, motion or pursuit ends. Or click here and drag on the field.' },
    pass: { label: 'Pass', verb: 'passes', hint: 'Drag onto whoever has the ball, then click who gets it. Use it for snaps, handoffs, pitches and throws. Or click here and drag on the field.' },
    dribble: { label: 'Ball carrier', verb: 'carries the ball', hint: 'Drag onto the player with the ball, then click where they run it. Or click here and drag on the field.' },
    screen: { label: 'Block', verb: 'blocks', hint: 'Drag onto the blocker, then click the player they block. Or click here and drag on the field.' },
  },
};

// --- Field geometry, in the same units as the court (the drawing is always 50 wide) -------------

/** Home plate and the distance between bases, for each baseball view. */
export const DIAMONDS = {
  infield: { home: [25, 43] as [number, number], base: 18, height: 48, fence: false },
  diamond: { home: [25, 45] as [number, number], base: 9.3, height: 50, fence: true },
};
/** One yard on the football field: 53 1/3 yards across the 50-wide drawing. */
export const YARD = 50 / (160 / 3);
/** Where the line of scrimmage and the goal line sit, for each football view. */
export const GRIDIRONS = {
  gridiron: { los: 24, goal: null as number | null, height: 42 },
  redzone: { los: 10 * YARD * 2, goal: 10 * YARD, height: 42 },
};

export const isDiamond = (court: Play['court']): court is 'infield' | 'diamond' => court === 'infield' || court === 'diamond';
export const isGridiron = (court: Play['court']): court is 'gridiron' | 'redzone' => court === 'gridiron' || court === 'redzone';

/**
 * Where a point drawn on one view of a field belongs on the other view, so switching between the
 * infield and the whole field (or open field and goal line) keeps everyone standing in the same place.
 */
export function moveBetween(from: Play['court'], to: Play['court']): ((p: number[]) => number[]) | null {
  if (isDiamond(from) && isDiamond(to) && from !== to) {
    const a = DIAMONDS[from];
    const b = DIAMONDS[to];
    const k = b.base / a.base;
    return ([x, y]) => [b.home[0] + (x - a.home[0]) * k, b.home[1] + (y - a.home[1]) * k];
  }
  if (isGridiron(from) && isGridiron(to) && from !== to) {
    const dy = GRIDIRONS[to].los - GRIDIRONS[from].los;
    return ([x, y]) => [x, y + dy];
  }
  return null;
}

type Spot = Pick<PlayMark, 'type' | 'label' | 'x' | 'y'> & { hasBall?: boolean };
export interface Lineup {
  id: string;
  label: string;
  spots: Spot[];
}

/** Ready-made starting positions for the surface a play is drawn on. Basketball has none. */
export function lineups(court: Play['court']): Lineup[] {
  if (isDiamond(court)) {
    const { home, base: d, height } = DIAMONDS[court];
    const clamp = (v: number, hi: number) => Math.min(hi - 2, Math.max(2, v));
    // Across and up from home plate, in base lengths.
    const at = (label: string, across: number, up: number, hasBall = false): Spot => ({ type: 'x', label, x: clamp(home[0] + across * d, 50), y: clamp(home[1] - up * d, height), hasBall });
    return [
      {
        id: 'fielders',
        label: 'Add fielders',
        spots: [
          at('P', 0, 0.672, true),
          { type: 'x', label: 'C', x: home[0], y: Math.min(height - 1.5, home[1] + 2.6) },
          at('1B', 0.56, 0.98),
          at('2B', 0.36, 1.36),
          at('3B', -0.56, 0.98),
          at('SS', -0.36, 1.36),
          at('LF', -1.3, 2.35),
          at('CF', 0, 2.9),
          at('RF', 1.3, 2.35),
        ],
      },
      { id: 'batter', label: 'Add batter', spots: [{ type: 'o', label: 'B', x: home[0] - 2.4, y: home[1] - 0.4 }] },
    ];
  }
  if (isGridiron(court)) {
    const { los } = GRIDIRONS[court];
    const o = (label: string, dx: number, back: number, hasBall = false): Spot => ({ type: 'o', label, x: 25 + dx, y: los + back, hasBall });
    const x = (label: string, dx: number, off: number): Spot => ({ type: 'x', label, x: 25 + dx, y: los - off });
    return [
      {
        id: 'offense',
        label: 'Add offense',
        spots: [o('C', 0, 1.6, true), o('G', -3.3, 1.6), o('G', 3.3, 1.6), o('T', -6.6, 1.6), o('T', 6.6, 1.6), o('Y', 9.9, 1.6), o('X', -20, 1.6), o('Z', 19, 3.2), o('QB', 0, 5.2), o('F', 0, 8.8), o('H', 0, 12.2)],
      },
      {
        id: 'defense',
        label: 'Add defense',
        spots: [x('T', -1.9, 1.7), x('T', 1.9, 1.7), x('E', -6.6, 1.7), x('E', 7.6, 1.7), x('M', 0, 5.6), x('W', -7.6, 5.6), x('S', 8.6, 5.6), x('C', -20, 5), x('C', 19, 5), x('FS', -6, 9.5), x('SS', 7, 8.6)],
      },
    ];
  }
  return [];
}
