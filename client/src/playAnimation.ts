// How a play moves. Within a step every line has a place in the order of movement: lines that
// share a place move together, and each place waits for the one before it to finish. The same
// rules drive the order list in the editor and the animated playback.
import { LINE_WORDS, type SportKind } from './sports';
import { MARK_R, isLine, isMark, isPlayer, sampleLine, type Pt } from './components/PlayDiagram';
import { travelPath } from './playLogic';
import type { Play, PlayFrame, PlayLine, PlayMark, PlayObject } from './types';

/** A line's place in its step's order of movement. Lines with no place set all move first, together. */
export const orderOf = (l: PlayLine) => (l.order && l.order > 0 ? l.order : 1);

/** The step's lines grouped by place, in order. Each group moves at the same time. */
export function beatsOf(frame: PlayFrame): PlayLine[][] {
  const lines = frame.objects.filter(isLine);
  const places = [...new Set(lines.map(orderOf))].sort((a, b) => a - b);
  return places.map((p) => lines.filter((l) => orderOf(l) === p));
}

/** Rewrites places as 1, 2, 3 with no gaps, given new values for some lines. Halves slot a line in between. */
export function withOrder(objects: PlayObject[], changes: Map<string, number>): PlayObject[] {
  const value = (l: PlayLine) => changes.get(l.id) ?? orderOf(l);
  const ranks = [...new Set(objects.filter(isLine).map(value))].sort((a, b) => a - b);
  return objects.map((o) => {
    if (!isLine(o)) return o;
    const { order: _old, ...rest } = o;
    const place = ranks.indexOf(value(o)) + 1;
    // The first place is the default, so it is not stored.
    return place > 1 ? { ...rest, order: place } : rest;
  });
}

/** One line in a step's running order, and whether it starts at the same moment as the line before it. */
export interface SequenceItem {
  line: PlayLine;
  withPrevious: boolean;
}
/**
 * The step's lines as one list, first to last. A line either waits for the one before it to
 * finish, or starts with it. Any number of lines in a row can start together, and a step can
 * hold any number of such groups.
 */
export const sequenceOf = (frame: PlayFrame): SequenceItem[] => beatsOf(frame).flatMap((beat) => beat.map((line, i) => ({ line, withPrevious: i > 0 })));

/**
 * Writes a running order back onto the step. Places count up each time a line waits for the one
 * before it. The lines are also stored in that order, so the list reads the same way next time.
 */
export function withSequence(objects: PlayObject[], sequence: { id: string; withPrevious: boolean }[]): PlayObject[] {
  const byId = new Map(objects.filter(isLine).map((l) => [l.id, l]));
  let place = 0;
  const ordered: PlayLine[] = [];
  sequence.forEach((item, i) => {
    const line = byId.get(item.id);
    if (!line) return;
    if (i === 0 || !item.withPrevious) place++;
    const { order: _old, ...rest } = line;
    // The first place is the default, so it is not stored.
    ordered.push(place > 1 ? { ...rest, order: place } : rest);
    byId.delete(item.id);
  });
  // A line the list did not mention keeps moving, after everything else.
  for (const line of byId.values()) ordered.push({ ...line, order: ++place });
  let next = 0;
  return objects.map((o) => (isLine(o) ? ordered[next++] : o));
}

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/** A line in plain words: "1 passes to 2", "3 screens for 2", "1 cuts to the basket". */
export function describeLine(line: PlayLine, frame: PlayFrame, sport: SportKind = 'basketball'): string {
  const words = LINE_WORDS[sport][line.kind];
  const name = (id: string | undefined) => {
    if (!id) return '';
    if (id.startsWith('basket')) return 'the basket';
    const m = frame.objects.find((o) => o.id === id);
    return m && isMark(m) ? (m.type === 'ball' ? 'The ball' : m.label || 'A player') : '';
  };
  const who = name(line.from);
  const where = name(line.to);
  if (!who) return `${words.label}${where ? ` to ${where}` : ''} (not attached to a player)`;
  // "3 screens for 2", but "T blocks E" and "CF backs up LF".
  const link = line.kind !== 'screen' || where === 'the basket' ? 'to ' : sport === 'basketball' ? 'for ' : '';
  return `${who} ${words.verb}${where ? ` ${link}${where}` : ''}`;
}

// --- Playback ---------------------------------------------------------------

const lengthOf = (pts: Pt[]) => pts.slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
/** The point a share of the way along a path, measured by distance so speed is even through a curve. */
function pointAlong(pts: Pt[], share: number): Pt {
  if (share <= 0) return pts[0];
  if (share >= 1) return pts[pts.length - 1];
  let left = lengthOf(pts) * share;
  for (let i = 1; i < pts.length; i++) {
    const step = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (step >= left) {
      const t = step ? left / step : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    left -= step;
  }
  return pts[pts.length - 1];
}
/** Starts and stops gently, the way a player does. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** A pass is in the air for this share of its beat, so it arrives before the cutters do. */
const FLIGHT = 0.65;
const REACH = MARK_R + 1.4;

export interface Snapshot {
  /** Players, cones, labels and loose balls where they are right now. */
  marks: PlayMark[];
  /** Balls in the air on a pass. */
  flying: Pt[];
  /** Lines already finished, and lines moving now. The rest are still to come. */
  done: Set<string>;
  active: Set<string>;
}

/**
 * Where everything is partway through a step: every beat before `beat` is finished, and beat
 * number `beat` is a share `t` (0 to 1) of the way through. Pass `beat` past the last one for the
 * end of the step.
 */
export function snapshot(frame: PlayFrame, beat: number, t: number): Snapshot {
  const beats = beatsOf(frame);
  const marks = frame.objects.filter(isMark);
  const players = marks.filter(isPlayer);
  const pos = new Map<string, Pt>(marks.map((m) => [m.id, [m.x, m.y] as Pt]));
  const holding = new Set(players.filter((p) => p.hasBall).map((p) => p.id));
  const caught = new Set<string>(); // drawn balls that a player now holds
  const flying: Pt[] = [];
  const nearest = (list: PlayMark[], p: Pt) =>
    list
      .map((m) => ({ m, d: Math.hypot(pos.get(m.id)![0] - p[0], pos.get(m.id)![1] - p[1]) }))
      .filter((x) => x.d <= REACH)
      .sort((a, b) => a.d - b.d)[0]?.m;

  const pass = (line: PlayLine, u: number) => {
    const path = sampleLine(line.points, 32);
    const source = line.from ? marks.find((m) => m.id === line.from) : nearest(players, path[0]);
    const receiver = line.to ? players.find((p) => p.id === line.to) : nearest(players, path[path.length - 1]);
    const air = Math.min(1, u / FLIGHT);
    if (u <= 0) return;
    if (source?.type === 'ball') {
      // A loose ball thrown in: it travels itself, and is caught at the end.
      pos.set(source.id, pointAlong(path, ease(air)));
      if (air >= 1 && receiver) {
        caught.add(source.id);
        holding.add(receiver.id);
      }
      return;
    }
    if (source) holding.delete(source.id);
    if (air >= 1 && receiver) holding.add(receiver.id);
    else flying.push(pointAlong(path, ease(air)));
  };
  const move = (line: PlayLine, u: number) => {
    const path = travelPath(line);
    const mover = line.from ? marks.find((m) => m.id === line.from) : (nearest(players, path[0]) ?? nearest(marks.filter((m) => m.type === 'ball'), path[0]));
    if (mover) pos.set(mover.id, pointAlong(path, ease(u)));
  };
  const run = (lines: PlayLine[], u: number) => {
    // Passes first, so who is passing and who is receiving are read before anyone in this beat moves.
    lines.filter((l) => l.kind === 'pass').forEach((l) => pass(l, u));
    lines.filter((l) => l.kind !== 'pass').forEach((l) => move(l, u));
  };

  const done = new Set<string>();
  const active = new Set<string>();
  beats.forEach((lines, i) => {
    if (i < beat) {
      run(lines, 1);
      lines.forEach((l) => done.add(l.id));
    } else if (i === beat) {
      run(lines, t);
      lines.forEach((l) => (t >= 1 ? done : active).add(l.id));
    }
  });

  return {
    marks: marks
      .filter((m) => !caught.has(m.id))
      .map((m) => {
        const [x, y] = pos.get(m.id)!;
        if (!isPlayer(m)) return { ...m, x, y };
        const { hasBall: _had, ...rest } = m;
        return holding.has(m.id) ? { ...rest, x, y, hasBall: true } : { ...rest, x, y };
      }),
    flying,
    done,
    active,
  };
}

/** One stretch of the playback: a beat moving, or a pause to take it in. */
export interface Segment {
  frame: number;
  beat: number;
  /** True while things move. Otherwise the picture holds still at the end of `beat`. */
  moving: boolean;
  /** Milliseconds at normal speed. */
  ms: number;
  start: number;
}
const MOVE_MS = 1300;
const BEAT_PAUSE_MS = 350;
const STEP_PAUSE_MS = 900;
const OPEN_MS = 700;

/** The whole play laid out in time: each step opens with a look, runs its beats in order, then rests. */
export function timeline(play: Pick<Play, 'frames'>, fromFrame = 0): { segments: Segment[]; total: number } {
  const segments: Segment[] = [];
  let at = 0;
  const add = (s: Omit<Segment, 'start'>) => {
    segments.push({ ...s, start: at });
    at += s.ms;
  };
  play.frames.forEach((frame, f) => {
    if (f < fromFrame) return;
    const beats = beatsOf(frame).length;
    add({ frame: f, beat: 0, moving: false, ms: f === fromFrame ? OPEN_MS : STEP_PAUSE_MS / 2 });
    for (let b = 0; b < beats; b++) {
      add({ frame: f, beat: b, moving: true, ms: MOVE_MS });
      add({ frame: f, beat: b + 1, moving: false, ms: b === beats - 1 ? STEP_PAUSE_MS : BEAT_PAUSE_MS });
    }
    if (beats === 0) add({ frame: f, beat: 0, moving: false, ms: STEP_PAUSE_MS });
  });
  return { segments, total: at };
}

/** Which stretch a moment falls in, and how far through it. */
export function locate(segments: Segment[], ms: number): { segment: Segment; t: number } {
  let segment = segments[0];
  for (const s of segments) if (s.start <= ms) segment = s;
  return { segment, t: segment.ms ? Math.min(1, Math.max(0, (ms - segment.start) / segment.ms)) : 1 };
}
