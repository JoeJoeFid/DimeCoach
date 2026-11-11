// The rules of the play builder that are not about drawing: what a line can attach to, and where
// everyone stands when the next step begins.
import { MARK_R, baskets, isLine, isMark, isPlayer, sampleLine, type Pt } from './components/PlayDiagram';
import type { Play, PlayFrame, PlayLine, PlayMark, PlayObject } from './types';

/** How close (in feet) the end of a line must be to a player, the ball or a basket to attach to it. */
export const SNAP = 2.4;
/** A ball drawn this close to a player is in that player's hands. */
export const HOLD = MARK_R + 2.4;

export interface Anchor {
  id: string;
  x: number;
  y: number;
}
type Court = Pick<Play, 'court' | 'flipped'>;

const near = (a: Pt, b: Pt, d: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= d;
const start = (l: PlayLine) => l.points[0] as Pt;
const end = (l: PlayLine) => l.points[2] as Pt;

/** Things a line can start from: players and the ball. */
export const sources = (frame: PlayFrame): Anchor[] => frame.objects.filter((o): o is PlayMark => isPlayer(o) || o.type === 'ball');
/** Things a line can end at: players, the ball and the baskets. */
export const targets = (frame: PlayFrame, play: Court): Anchor[] => [...sources(frame), ...baskets(play)];

export function nearestAnchor(p: Pt, list: Anchor[], exclude?: string): Anchor | null {
  let best: Anchor | null = null;
  let bestD = SNAP;
  for (const a of list) {
    if (a.id === exclude) continue;
    const d = Math.hypot(a.x - p[0], a.y - p[1]);
    if (d <= bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/** Moves one end of a line, keeping its bend the same relative to the line. */
export function withEnd(line: PlayLine, index: 0 | 2, p: Pt): PlayLine {
  const pts = line.points.map((q) => [...q]) as Pt[];
  const other = pts[index === 0 ? 2 : 0];
  const oldMid: Pt = [(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2];
  const bend: Pt = [pts[1][0] - oldMid[0], pts[1][1] - oldMid[1]];
  pts[index] = p;
  pts[1] = [(p[0] + other[0]) / 2 + bend[0], (p[1] + other[1]) / 2 + bend[1]];
  return { ...line, points: pts };
}

/** After something moved, drags along the ends of every line attached to it. */
export function followAnchor(objects: PlayObject[], id: string, p: Pt): PlayObject[] {
  return objects.map((o) => {
    if (!isLine(o)) return o;
    let line = o;
    if (line.from === id) line = withEnd(line, 0, p);
    if (line.to === id) line = withEnd(line, 2, p);
    return line;
  });
}

/** Plain words for what a line end is attached to, for the selection panel. */
export function describeAnchor(id: string | undefined, frame: PlayFrame): string {
  if (!id) return 'a free spot';
  if (id.startsWith('basket')) return 'the basket';
  const m = frame.objects.find((o) => o.id === id);
  if (!m || !isMark(m)) return 'a free spot';
  return m.type === 'ball' ? 'the ball' : `player ${m.label || '?'}`;
}

/**
 * The path a player actually runs along a line. A line that ends on another player or the basket
 * is run only up to just short of it, so the runner stops beside the player or under the rim.
 */
export function travelPath(l: PlayLine): Pt[] {
  const pts = sampleLine(l.points, 32);
  if (!l.to) return pts;
  const total = pts.slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  let left = total - Math.min(l.to.startsWith('basket') ? 2.2 : MARK_R * 2 + 0.3, total * 0.6);
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const step = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (step >= left) {
      const t = step ? left / step : 0;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      break;
    }
    out.push(pts[i]);
    left -= step;
  }
  return out;
}

/**
 * Starts the next step from where this one ends, so each step only has to show new movement.
 *
 * - A player with a cut, dribble or screen line attached stands where that line ends. If the line
 *   ends on another player or the basket, they stop just short of it.
 * - The player with the ball is the circled one. The ball goes to whoever it was passed to,
 *   following a chain of passes, and otherwise stays with its holder wherever they moved. A pass
 *   to the basket or to open floor leaves a loose ball there. A ball drawn beside a player (the
 *   older way of showing possession) becomes that player's circle.
 * - Cones and shapes stay put. Lines and text labels belong to the step they were drawn in.
 *
 * Lines drawn before attachment existed have no `from` or `to`. For those, a line counts as
 * belonging to whatever its end sits on.
 */
export function carryForward(frame: PlayFrame, play: Court): PlayFrame {
  const lines = frame.objects.filter(isLine);
  const marks = frame.objects.filter(isMark);
  const players = marks.filter(isPlayer);
  const REACH = MARK_R + 1.4;

  const startsAt = (l: PlayLine, m: PlayMark) => (l.from ? l.from === m.id : near(start(l), [m.x, m.y], REACH));

  /** Where the traveller on this line ends up. */
  const landing = (l: PlayLine): Pt => {
    const path = travelPath(l);
    return path[path.length - 1];
  };

  const movedTo = new Map<string, Pt>();
  for (const p of players) {
    let at: Pt = [p.x, p.y];
    const used = new Set<string>();
    const first = lines.find((l) => l.kind !== 'pass' && startsAt(l, p));
    if (first) {
      used.add(first.id);
      at = landing(first);
      // A second, unattached line drawn on from where the first one ended continues the movement.
      for (let hop = 0; hop < 5; hop++) {
        const next = lines.find((l) => !used.has(l.id) && l.kind !== 'pass' && !l.from && near(start(l), at, REACH));
        if (!next) break;
        used.add(next.id);
        at = landing(next);
      }
    }
    movedTo.set(p.id, at);
  }

  const hoops = baskets(play);
  /** Follows the passes drawn from whoever has the ball. Ends with a player holding it, or a spot on the floor. */
  const chase = (holder: PlayMark | undefined, at: Pt, ballId?: string): { carrier?: PlayMark; spot: Pt | null } => {
    let carrier = holder;
    const used = new Set<string>();
    for (let hop = 0; hop < 6; hop++) {
      const from: Pt = carrier ? [carrier.x, carrier.y] : at;
      const pass = lines.find(
        (l) =>
          l.kind === 'pass' &&
          !used.has(l.id) &&
          (l.from ? l.from === carrier?.id || (hop === 0 && l.from === ballId) : near(start(l), from, REACH) || (hop === 0 && near(start(l), at, REACH))),
      );
      if (!pass) break;
      used.add(pass.id);
      const hoop = pass.to ? hoops.find((h) => h.id === pass.to) : undefined;
      if (hoop) return { spot: [hoop.x, hoop.y] };
      const receiver = pass.to ? players.find((p) => p.id === pass.to) : players.find((p) => near([p.x, p.y], end(pass), REACH));
      if (!receiver) return { spot: end(pass) };
      carrier = receiver;
    }
    return { carrier, spot: null };
  };

  /** Players who have the ball when the next step starts. */
  const holders = new Set<string>();
  /** Balls nobody is holding: shot at the basket, or passed to open floor. */
  const loose: Pt[] = [];
  for (const p of players.filter((q) => q.hasBall)) {
    const r = chase(p, [p.x, p.y]);
    if (r.carrier) holders.add(r.carrier.id);
    else if (r.spot) loose.push(r.spot);
  }
  /** Where each drawn ball goes. Null means a player ends up holding it, so the circle replaces it. */
  const ballSpot = new Map<string, Pt | null>();
  for (const o of marks) {
    if (o.type !== 'ball') continue;
    const at: Pt = [o.x, o.y];
    const holder = players
      .filter((p) => near([p.x, p.y], at, HOLD))
      .sort((p, q) => Math.hypot(p.x - o.x, p.y - o.y) - Math.hypot(q.x - o.x, q.y - o.y))[0] as PlayMark | undefined;
    const r = chase(holder, at, o.id);
    if (r.carrier) {
      holders.add(r.carrier.id);
      ballSpot.set(o.id, null);
    } else if (r.spot) {
      ballSpot.set(o.id, r.spot);
    } else {
      // A loose ball with a dribble drawn from it rolls there. Otherwise it stays put.
      const roll = lines.find((l) => l.kind === 'dribble' && (l.from ? l.from === o.id : near(start(l), at, REACH)));
      ballSpot.set(o.id, roll ? landing(roll) : at);
    }
  }

  const objects: PlayObject[] = [];
  for (const o of frame.objects) {
    if (isLine(o)) continue;
    if (!isMark(o)) {
      objects.push({ ...o, points: o.points.map((q) => [...q]) });
      continue;
    }
    if (o.type === 'text') continue;
    if (o.type === 'ball') {
      const spot = ballSpot.get(o.id);
      if (spot) objects.push({ ...o, x: spot[0], y: spot[1] });
      continue;
    }
    if (isPlayer(o)) {
      // Marks keep their identity from step to step, so a player keeps their label and color.
      const { hasBall: _had, ...rest } = o;
      const to = movedTo.get(o.id)!;
      objects.push({ ...rest, x: to[0], y: to[1], ...(holders.has(o.id) ? { hasBall: true } : {}) });
      continue;
    }
    objects.push({ ...o });
  }
  loose.forEach((spot, i) => objects.push({ id: `ball-${Date.now().toString(36)}-${i}`, type: 'ball', x: spot[0], y: spot[1], label: '' }));
  return { note: '', objects };
}
