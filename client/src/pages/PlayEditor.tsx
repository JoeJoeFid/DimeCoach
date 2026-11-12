import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, newKey } from '../api';
import type { Play, PlayFrame, PlayLine, PlayMark, PlayObject, PlayShape } from '../types';
import {
  baskets,
  Court,
  COURT,
  courtHeight,
  isLine,
  isMark,
  isPlayer,
  isShape,
  LineShape,
  lineTrims,
  MarkShape,
  ovalCorners,
  PlayDiagram,
  sampleLine,
  ShapeView,
  TEXT_FONTS,
  TEXT_SIZE,
  textBox,
  type Pt,
  VIEW_PAD,
} from '../components/PlayDiagram';
import PlayAnimation from '../components/PlayAnimation';
import { ShareDialog } from '../components/community';
import { beatsOf, describeLine, ordinal, sequenceOf, withOrder, withSequence, type SequenceItem } from '../playAnimation';
import { HOLD, carryForward, describeAnchor, followAnchor, nearestAnchor, sources, targets, withEnd } from '../playLogic';
import Attachments from '../components/Attachments';
import { Field, Modal } from '../components/bits';
import { confirmDialog, promptDialog } from '../components/dialogs';
import { deleteLater } from '../components/toasts';
import { TAG_COLORS } from '../util';
import { useApp } from '../App';
import { LINE_WORDS, PLAY_CATEGORIES_BY_SPORT, SURFACES, VOLLEY_COURTS, lineups, moveBetween, sportKind, surfaceWord, type Lineup, type SportKind } from '../sports';

/** Stands for "these do not all share one value", so no swatch shows as chosen. */
const MIXED = '\u0000mixed';
const sameValue = <T,>(values: T[]): T | null => (values.every((v) => v === values[0]) ? values[0] : null);
/** Letter heights offered for a label, in feet on the court. */
const TEXT_SIZES = [
  { label: 'S', name: 'Small', size: 1.2 },
  { label: 'M', name: 'Medium', size: TEXT_SIZE },
  { label: 'L', name: 'Large', size: 2.5 },
  { label: 'XL', name: 'Extra large', size: 3.6 },
];
const TEXT_FONT_CHOICES: { id: '' | NonNullable<PlayMark['font']>; label: string }[] = [
  { id: '', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'hand', label: 'Marker' },
];
const NEW_CATEGORY = '\u0000new';
/** The most steps a play can hold. */
const MAX_STEPS = 20;
type ShapeKind = PlayShape['shape'];
type Tool = 'select' | 'o' | 'x' | 'cone' | 'text' | 'cut' | 'pass' | 'dribble' | 'screen' | ShapeKind;
const TOOLS: { id: Tool; label: string; hint: string; group: 'pointer' | 'mark' | 'line' | 'shape' }[] = [
  { id: 'select', label: 'Select', hint: 'Select, move and reshape. Drag across the court to select everything in an area, or shift-click to add to the selection.', group: 'pointer' },
  { id: 'o', label: 'Offense', hint: 'Drag onto the court to place the next offensive player, or click here and then click the court. Select a player to give them the ball.', group: 'mark' },
  { id: 'x', label: 'Defense', hint: 'Drag onto the court to place the next defender, or click here and then click the court.', group: 'mark' },
  { id: 'cone', label: 'Cone', hint: 'Drag onto the court to place a cone.', group: 'mark' },
  { id: 'text', label: 'Text', hint: 'Drag onto the court to place a label.', group: 'mark' },
  { id: 'cut', label: 'Cut', hint: 'Drag onto a player, then click where they cut to. Or click here and drag on the court.', group: 'line' },
  { id: 'pass', label: 'Pass', hint: 'Drag onto the passer, then click the receiver. Or click here and drag on the court.', group: 'line' },
  { id: 'dribble', label: 'Dribble', hint: 'Drag onto the ball handler, then click where they dribble to. Or click here and drag on the court.', group: 'line' },
  { id: 'screen', label: 'Screen', hint: 'Drag onto the screener, then click the player they screen. Or click here and drag on the court.', group: 'line' },
  { id: 'rect', label: 'Box', hint: 'Drag onto the court to place a box, then drag its corners to reshape it.', group: 'shape' },
  { id: 'ellipse', label: 'Oval', hint: 'Drag onto the court to place an oval, then drag its corners to resize it.', group: 'shape' },
  { id: 'triangle', label: 'Triangle', hint: 'Drag onto the court to place a triangle, then drag its corners to reshape it.', group: 'shape' },
];
const LINE_KINDS: PlayLine['kind'][] = ['cut', 'pass', 'dribble', 'screen'];
const SHAPE_KINDS: ShapeKind[] = ['rect', 'ellipse', 'triangle'];
const isLineTool = (t: Tool): t is PlayLine['kind'] => (LINE_KINDS as string[]).includes(t);
const isShapeTool = (t: Tool): t is ShapeKind => (SHAPE_KINDS as string[]).includes(t);
const NOTE_EXAMPLES: Record<SportKind, string> = {
  basketball: '1 passes to 2 and cuts through',
  baseball: '1B and 3B charge, 2B covers first',
  football: 'X runs a slant, Z clears out deep',
  volleyball: '6 passes to the setter, 4 hits the outside set',
};
type Snapshot = Pick<Play, 'frames' | 'court'>;
const snapshotOf = (p: Play): Snapshot => ({ frames: p.frames, court: p.court });
/** The palette in a sport's own words: a cut in basketball is a route in football and a run in baseball. */
function toolsFor(sport: SportKind) {
  return TOOLS.map((t) => {
    const words = isLineTool(t.id) ? LINE_WORDS[sport][t.id] : null;
    const hint = words?.hint ?? t.hint;
    return { ...t, label: words?.label ?? t.label, hint: surfaceWord(sport) === 'court' ? hint : hint.replaceAll('the court', 'the field') };
  });
}
/** Colors offered for shapes and players. The first entry of the player list means "the default ink". */
const SHAPE_COLORS = [...TAG_COLORS, '#52514e'];
const PLAYER_COLORS = ['', ...TAG_COLORS];

/** The next unused number for a new player: 1 to 5 first, then onward. */
function nextLabel(frame: PlayFrame, type: 'o' | 'x') {
  const used = new Set(frame.objects.filter((o) => o.type === type).map((o) => (o as PlayMark).label));
  for (let n = 1; n < 30; n++) {
    const label = type === 'o' ? String(n) : `X${n}`;
    if (!used.has(label)) return label;
  }
  return '';
}

function newShape(kind: ShapeKind, [x, y]: Pt): PlayShape {
  const points =
    kind === 'ellipse'
      ? [[x - 6, y - 4], [x + 6, y + 4]]
      : kind === 'triangle'
        ? [[x, y - 5], [x + 6, y + 4], [x - 6, y + 4]]
        : [[x - 6, y - 4], [x + 6, y - 4], [x + 6, y + 4], [x - 6, y + 4]];
  return { id: newKey(), type: 'shape', shape: kind, points, color: SHAPE_COLORS[0], opacity: 0.25 };
}
/** The corner handles of a shape. An oval shows the corners of the box it sits in. */
const shapeHandles = (s: PlayShape): Pt[] => (s.shape === 'ellipse' ? ovalCorners(s.points) : (s.points as Pt[]));
/** Moves one corner. On an oval that resizes its box; on a box or triangle it reshapes it. */
function withCorner(s: PlayShape, index: number, p: Pt): PlayShape {
  if (s.shape !== 'ellipse') return { ...s, points: s.points.map((q, i) => (i === index ? p : q)) };
  const [[x1, y1], [x2, y2]] = s.points;
  const left = index === 0 || index === 3;
  const top = index === 0 || index === 1;
  return { ...s, points: [[left ? p[0] : x1, top ? p[1] : y1], [left ? x2 : p[0], top ? y2 : p[1]]] };
}
function scaled(s: PlayShape, factor: number): PlayShape {
  const cx = s.points.reduce((a, q) => a + q[0], 0) / s.points.length;
  const cy = s.points.reduce((a, q) => a + q[1], 0) / s.points.length;
  return { ...s, points: s.points.map((q) => [cx + (q[0] - cx) * factor, cy + (q[1] - cy) * factor]) };
}

/**
 * What a dragged-out area selects. A player, ball, cone or label counts when its center is inside.
 * A line counts when any part of it passes through. A shape counts when all of it is inside, so a
 * big zone behind the players is not picked up by accident.
 */
function insideArea(objects: PlayObject[], a: Pt, b: Pt): string[] {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const has = (q: number[]) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
  return objects
    .filter((o) => (isLine(o) ? sampleLine(o.points, 24).some(has) : isShape(o) ? (o.shape === 'ellipse' ? ovalCorners(o.points) : o.points).every(has) : has([o.x, o.y])))
    .map((o) => o.id);
}

type Drag =
  | { kind: 'move'; id: string; last: Pt; moved: boolean }
  | { kind: 'handle'; id: string; index: number; moved: boolean }
  | { kind: 'corner'; id: string; index: number; moved: boolean }
  | { kind: 'textw'; id: string; moved: boolean }
  | { kind: 'draw'; id: string }
  | { kind: 'group'; last: Pt; moved: boolean }
  | { kind: 'area'; start: Pt };

export default function PlayEditor() {
  const { id } = useParams();
  const playId = Number(id);
  const navigate = useNavigate();
  const [play, setPlay] = useState<Play | null>(null);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [step, setStep] = useState(0);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelectedOne] = useState<string | null>(null);
  // Only the pointer drags a step, and only after a small move, so a click or Enter still opens it.
  const stepSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  /** Two or more things selected together, by dragging an area or shift-clicking. Empty otherwise. */
  const [multi, setMulti] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  /** Whether the animated playback is open. */
  const [watching, setWatching] = useState(false);
  /** A tool being dragged from the palette: which one, and where the pointer is on the page. */
  const [carry, setCarry] = useState<{ tool: Tool; x: number; y: number } | null>(null);
  const carrying = useRef<{ tool: Tool; x: number; y: number; active: boolean } | null>(null);
  /** A click that ends a palette drag must not also pick the tool. */
  const skipClick = useRef(false);
  /** A line dropped from the palette whose far end still follows the pointer, waiting for a destination. */
  const [aim, setAim] = useState<string | null>(null);
  /** The area being dragged out with the pointer tool, as two opposite corners. */
  const [area, setArea] = useState<{ a: Pt; b: Pt } | null>(null);
  // Selecting one thing, or nothing, always ends a group selection.
  const setSelected = useCallback((id: string | null) => {
    setSelectedOne(id);
    setMulti([]);
  }, []);
  /** Selects a set of things: none, one, or a group. */
  const selectMany = useCallback((ids: string[]) => {
    setSelectedOne(ids.length === 1 ? ids[0] : null);
    setMulti(ids.length > 1 ? ids : []);
  }, []);
  /** The player, ball or basket a line end is about to attach to, shown with a ring while dragging. */
  const [snap, setSnap] = useState<string | null>(null);
  const [labelsText, setLabelsText] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const app = useApp();
  const sportOf = (sportId: number | undefined) => sportKind(app.sports.find((x) => x.id === sportId)?.name) ?? 'basketball';

  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef<Play | null>(null);
  const version = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  // Undo history holds whole drawings. A drag is recorded once, when it starts.
  // Each step back holds the drawing and the surface it was drawn on, so undoing a change of surface puts both back.
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const [, bump] = useState(0);

  // --- Load and autosave ---------------------------------------------------
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = latest.current;
    if (!p) return;
    const v = version.current;
    setSaveState('saving');
    try {
      await api.updatePlay(p);
      if (version.current === v) setSaveState('saved');
    } catch (e) {
      setSaveState('error');
      setError(`Could not save: ${(e as Error).message}`);
    }
  }, []);
  const update = useCallback(
    (patch: Partial<Play>) => {
      if (!latest.current) return;
      latest.current = { ...latest.current, ...patch };
      version.current++;
      setPlay(latest.current);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 700);
    },
    [flush],
  );
  useEffect(() => {
    let alive = true;
    const startVersion = version.current;
    setPlay(null);
    Promise.all([api.play(playId), api.plays()])
      .then(([p, all]) => {
        if (!alive) return;
        latest.current = p;
        setPlay(p);
        setLabelsText(p.labels.join(', '));
        setCategories([...new Set([...PLAY_CATEGORIES_BY_SPORT[sportOf(p.sport_id)], ...all.filter((x) => x.sport_id === p.sport_id).map((x) => x.category).filter(Boolean)])]);
        past.current = [];
        future.current = [];
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
      if (latest.current && version.current !== startVersion) api.updatePlay(latest.current).catch(() => {});
      latest.current = null;
    };
  }, [playId]);

  // --- Drawing changes -------------------------------------------------------
  const frames = play?.frames ?? [];
  const index = Math.min(step, Math.max(0, frames.length - 1));
  const frame = frames[index];

  const remember = () => {
    if (!latest.current) return;
    past.current.push(snapshotOf(latest.current));
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    bump((n) => n + 1);
  };
  const setObjects = (fn: (objects: PlayObject[]) => PlayObject[], record = true) => {
    const p = latest.current;
    if (!p) return;
    if (record) remember();
    update({ frames: p.frames.map((f, i) => (i === index ? { ...f, objects: fn(f.objects) } : f)) });
  };
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !latest.current) return;
    future.current.push(snapshotOf(latest.current));
    setSelected(null);
    update(prev);
  }, [update]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !latest.current) return;
    past.current.push(snapshotOf(latest.current));
    setSelected(null);
    update(next);
  }, [update]);
  const removeSelected = useCallback(() => {
    const gone = new Set(selected ? [selected] : multi);
    if (gone.size === 0) return;
    // Lines that were attached to a deleted player keep their place, but are attached to nothing.
    setObjects((os) =>
      os
        .filter((o) => !gone.has(o.id))
        .map((o) => (isLine(o) && ((o.from && gone.has(o.from)) || (o.to && gone.has(o.to))) ? { ...o, from: o.from && gone.has(o.from) ? undefined : o.from, to: o.to && gone.has(o.to) ? undefined : o.to } : o)),
    );
    setSelected(null);
    // setObjects reads the newest drawing from a ref, so this callback only depends on the selection.
  }, [selected, multi, index]);

  /** Drops a line that was dragged on but never given a destination, along with its history entry. */
  const cancelAim = useCallback(() => {
    if (!aim) return;
    past.current.pop();
    setObjects((os) => os.filter((o) => o.id !== aim), false);
    setAim(null);
    setSelected(null);
  }, [aim, index]);
  // Moving to another step abandons it too.
  useEffect(() => {
    if (!aim || !latest.current) return;
    const id = aim;
    setAim(null);
    update({ frames: latest.current.frames.map((f) => ({ ...f, objects: f.objects.filter((o) => o.id !== id) })) });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      // While the animation is showing, the keyboard belongs to it, not to the drawing underneath.
      if (watching || sharing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selected || multi.length > 0)) {
        e.preventDefault();
        removeSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        setTool('select');
        if (aim) cancelAim();
        else setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, multi, removeSelected, undo, redo, aim, cancelAim, watching, sharing]);

  const selectedObject = useMemo(() => frame?.objects.find((o) => o.id === selected) ?? null, [frame, selected]);

  if (error && !play)
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link to="/playbook">Back to the playbook</Link>
      </div>
    );
  if (!play || !frame) return <div className="page muted">Loading…</div>;

  const h = courtHeight(play.court);
  const current = () => latest.current!.frames[index];

  // --- Pointer handling ------------------------------------------------------
  const point = (e: { clientX: number; clientY: number }): Pt => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const x = e.clientX * m.a + e.clientY * m.c + m.e;
    const y = e.clientX * m.b + e.clientY * m.d + m.f;
    return [Math.min(COURT.width + 1, Math.max(-1, x)), Math.min(h + 1, Math.max(-1, y))];
  };
  const capture = (e: RPointerEvent) => svg.current?.setPointerCapture(e.pointerId);

  /** Gives a player the ball, or takes it away. One player holds it at a time. */
  const giveBall = (playerId: string, on: boolean) =>
    setObjects((os) => {
      const player = os.find((o) => o.id === playerId);
      if (!player || !isPlayer(player)) return os;
      return os
        // A ball drawn right beside this player was this player's ball: the circle replaces it.
        .filter((o) => !(on && o.type === 'ball' && Math.hypot(o.x - player.x, o.y - player.y) <= HOLD))
        .map((o) => {
          if (!isPlayer(o)) return o;
          const { hasBall: _had, ...rest } = o;
          return o.id === playerId && on ? { ...rest, hasBall: true } : rest;
        });
    });

  /**
   * A tool dragged from the palette and let go over the court. Players, cones, labels and shapes
   * land where they are dropped. A line starts at the drop, attached to a player or the ball if it
   * was dropped on one, and its far end then follows the pointer until a destination is clicked.
   * Either way the pointer tool is back in hand afterwards.
   */
  const dropTool = async (t: Tool, p: Pt) => {
    if (t === 'select') return;
    if (aim) cancelAim();
    setTool('select');
    if (isLineTool(t)) {
      const from = nearestAnchor(p, sources(current()));
      const origin: Pt = from ? [from.x, from.y] : p;
      const lineId = newKey();
      setObjects((os) => [...os, { id: lineId, type: 'line', kind: t, points: [origin, origin, origin], from: from?.id }]);
      setSelected(lineId);
      setAim(lineId);
      return;
    }
    if (isShapeTool(t)) {
      const shape = newShape(t, p);
      setObjects((os) => [...os, shape]);
      setSelected(shape.id);
      return;
    }
    let label = '';
    if (t === 'o' || t === 'x') label = nextLabel(current(), t);
    if (t === 'text') {
      const text = await promptDialog({ title: 'Label text', confirmLabel: 'Add label' });
      if (!text) return;
      label = text;
    }
    const markId = newKey();
    setObjects((os) => [...os, { id: markId, type: t, x: p[0], y: p[1], label }]);
    setSelected(markId);
  };
  const overCourt = (e: { clientX: number; clientY: number }) => {
    const r = svg.current?.getBoundingClientRect();
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  /** Pressing a palette button. A plain click picks the tool; moving off the button carries it to the court. */
  const onToolDown = (e: RPointerEvent, t: Tool) => {
    if (e.button !== 0 || t === 'select') return;
    carrying.current = { tool: t, x: e.clientX, y: e.clientY, active: false };
    const move = (ev: PointerEvent) => {
      const c = carrying.current;
      if (!c) return;
      if (!c.active && Math.hypot(ev.clientX - c.x, ev.clientY - c.y) < 6) return;
      c.active = true;
      setCarry({ tool: c.tool, x: ev.clientX, y: ev.clientY });
      // Show which player a line would start from.
      setSnap(isLineTool(c.tool) && overCourt(ev) ? (nearestAnchor(point(ev), sources(current()))?.id ?? null) : null);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const c = carrying.current;
      carrying.current = null;
      setCarry(null);
      setSnap(null);
      if (!c?.active) return;
      skipClick.current = true;
      setTimeout(() => (skipClick.current = false), 0);
      if (ev.type === 'pointerup' && overCourt(ev)) dropTool(c.tool, point(ev));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  /** While a dropped line waits for its destination, any press on the court sets it. */
  const onAimDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (!aim || e.button !== 0) return;
    e.stopPropagation();
    const p = point(e);
    const id = aim;
    setAim(null);
    setObjects((os) => os.map((o) => (o.id === id && isLine(o) ? { ...o, points: [o.points[0], [(o.points[0][0] + p[0]) / 2, (o.points[0][1] + p[1]) / 2], p] } : o)), false);
    // From here it is an ordinary line being drawn: letting go ends it, attaching to whatever is under it.
    drag.current = { kind: 'draw', id };
    capture(e);
  };

  const onCourtDown = async (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = point(e);
    if (isLineTool(tool)) {
      // A line that starts on a player or the ball belongs to them from the first moment.
      const from = nearestAnchor(p, sources(frame));
      const origin: Pt = from ? [from.x, from.y] : p;
      const lineId = newKey();
      setObjects((os) => [...os, { id: lineId, type: 'line', kind: tool, points: [origin, origin, origin], from: from?.id }]);
      setSelected(lineId);
      drag.current = { kind: 'draw', id: lineId };
      capture(e);
      return;
    }
    if (tool === 'select') {
      // Dragging across open floor marks out an area. Everything inside it is selected on release.
      if (!e.shiftKey) setSelected(null);
      drag.current = { kind: 'area', start: p };
      capture(e);
      return;
    }
    if (isShapeTool(tool)) {
      const shape = newShape(tool, p);
      setObjects((os) => [...os, shape]);
      setSelected(shape.id);
      setTool('select');
      return;
    }
    let label = '';
    if (tool === 'o' || tool === 'x') label = nextLabel(frame, tool);
    if (tool === 'text') {
      const text = await promptDialog({ title: 'Label text', confirmLabel: 'Add label' });
      if (!text) return;
      label = text;
    }
    const markId = newKey();
    setObjects((os) => [...os, { id: markId, type: tool, x: p[0], y: p[1], label }]);
    setSelected(markId);
  };
  /**
   * Pressing on something already drawn. With the pointer tool it selects and starts a move.
   * A line tool draws from it instead, and any placing tool ignores shapes so you can put a player inside a zone.
   */
  const onObjectDown = (e: RPointerEvent, o: PlayObject) => {
    if (e.button !== 0 || isLineTool(tool)) return;
    if (isShape(o) && tool !== 'select') return;
    e.stopPropagation();
    setTool('select');
    const chosen = selected ? [selected] : multi;
    if (e.shiftKey) {
      // Shift-click adds to the selection, or takes away from it.
      selectMany(chosen.includes(o.id) ? chosen.filter((x) => x !== o.id) : [...chosen, o.id]);
      return;
    }
    if (multi.includes(o.id)) {
      // Pressing on one of a group moves the whole group.
      drag.current = { kind: 'group', last: point(e), moved: false };
      capture(e);
      return;
    }
    setSelected(o.id);
    drag.current = { kind: 'move', id: o.id, last: point(e), moved: false };
    capture(e);
  };
  const onHandleDown = (e: RPointerEvent, lineId: string, i: number) => {
    e.stopPropagation();
    drag.current = { kind: 'handle', id: lineId, index: i, moved: false };
    capture(e);
  };
  const onCornerDown = (e: RPointerEvent, shapeId: string, i: number) => {
    e.stopPropagation();
    drag.current = { kind: 'corner', id: shapeId, index: i, moved: false };
    capture(e);
  };

  /** Starts dragging one side of a label's box, to make it narrower or wider. */
  const onTextEdgeDown = (e: RPointerEvent, markId: string) => {
    e.stopPropagation();
    drag.current = { kind: 'textw', id: markId, moved: false };
    capture(e);
  };

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d && aim) {
      const p = point(e);
      const line = current().objects.find((o) => o.id === aim) as PlayLine | undefined;
      setSnap(nearestAnchor(p, targets(current(), play), line?.from)?.id ?? null);
      setObjects((os) => os.map((o) => (o.id === aim && isLine(o) ? { ...o, points: [o.points[0], [(o.points[0][0] + p[0]) / 2, (o.points[0][1] + p[1]) / 2], p] } : o)), false);
      return;
    }
    if (!d) return;
    const p = point(e);
    if (d.kind === 'area') {
      setArea({ a: d.start, b: p });
    } else if (d.kind === 'group') {
      const dx = p[0] - d.last[0];
      const dy = p[1] - d.last[1];
      if (!d.moved && Math.hypot(dx, dy) < 0.15) return;
      const first = !d.moved;
      d.moved = true;
      d.last = p;
      const ids = new Set(multi);
      setObjects((os) => {
        let next: PlayObject[] = os.map((o) => {
          if (!ids.has(o.id)) return o;
          // A line stays attached only to things that are moving with it.
          if (isLine(o)) return { ...o, points: o.points.map((q) => [q[0] + dx, q[1] + dy]), from: o.from && ids.has(o.from) ? o.from : undefined, to: o.to && ids.has(o.to) ? o.to : undefined };
          if (isShape(o)) return { ...o, points: o.points.map((q) => [q[0] + dx, q[1] + dy]) };
          return { ...o, x: o.x + dx, y: o.y + dy };
        });
        // Lines left behind stretch to follow the players and balls that moved.
        for (const m of next) if (ids.has(m.id) && isMark(m)) next = followAnchor(next, m.id, [m.x, m.y]);
        return next;
      }, first);
    } else if (d.kind === 'draw') {
      const line = current().objects.find((o) => o.id === d.id) as PlayLine | undefined;
      setSnap(nearestAnchor(p, targets(current(), play), line?.from)?.id ?? null);
      setObjects(
        (os) => os.map((o) => (o.id === d.id && isLine(o) ? { ...o, points: [o.points[0], [(o.points[0][0] + p[0]) / 2, (o.points[0][1] + p[1]) / 2], p] } : o)),
        false,
      );
    } else if (d.kind === 'handle') {
      const first = !d.moved;
      d.moved = true;
      if (d.index !== 1) {
        const line = current().objects.find((o) => o.id === d.id) as PlayLine | undefined;
        const pool = d.index === 0 ? sources(current()) : targets(current(), play);
        setSnap(nearestAnchor(p, pool, d.index === 0 ? line?.to : line?.from)?.id ?? null);
      }
      setObjects((os) => os.map((o) => {
        if (o.id !== d.id || !isLine(o)) return o;
        return d.index === 1 ? { ...o, points: [o.points[0], p, o.points[2]] } : withEnd(o, d.index as 0 | 2, p);
      }), first);
    } else if (d.kind === 'corner') {
      const first = !d.moved;
      d.moved = true;
      setObjects((os) => os.map((o) => (o.id === d.id && isShape(o) ? withCorner(o, d.index, p) : o)), first);
    } else if (d.kind === 'textw') {
      // The box stays centered on the label: its width is twice the distance from the middle to the pointer.
      const first = !d.moved;
      d.moved = true;
      setObjects((os) => os.map((o) => (o.id === d.id && isMark(o) ? { ...o, w: Math.round(Math.min(60, Math.max(2, Math.abs(p[0] - o.x) * 2)) * 10) / 10 } : o)), first);
    } else {
      const dx = p[0] - d.last[0];
      const dy = p[1] - d.last[1];
      if (!d.moved && Math.hypot(dx, dy) < 0.15) return;
      const first = !d.moved;
      d.moved = true;
      d.last = p;
      setObjects((os) => {
        const moved: { to: Pt | null } = { to: null };
        const next = os.map((o) => {
          if (o.id !== d.id) return o;
          if (isLine(o)) return { ...o, points: o.points.map((q) => [q[0] + dx, q[1] + dy]), from: undefined, to: undefined };
          if (isShape(o)) return { ...o, points: o.points.map((q) => [q[0] + dx, q[1] + dy]) };
          moved.to = [o.x + dx, o.y + dy];
          return { ...o, x: o.x + dx, y: o.y + dy };
        });
        // Lines attached to a player or the ball stretch to follow it.
        return moved.to ? followAnchor(next, d.id, moved.to) : next;
      }, first);
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setSnap(null);
    if (!d) return;
    if (d.kind === 'area') {
      const box = area;
      setArea(null);
      // A plain click on open floor has no area: the selection was already cleared.
      if (!box || (Math.abs(box.b[0] - box.a[0]) < 0.6 && Math.abs(box.b[1] - box.a[1]) < 0.6)) return;
      const inside = insideArea(current().objects, box.a, box.b);
      const kept = multi.length > 0 ? multi : selected ? [selected] : [];
      selectMany([...new Set([...kept, ...inside])]);
      return;
    }
    if (d.kind === 'group') return;
    const line = current().objects.find((o) => o.id === d.id);
    if (d.kind === 'draw' && line && isLine(line)) {
      // A click without a drag leaves a zero-length line: drop it, and the history entry made for it.
      if (Math.hypot(line.points[2][0] - line.points[0][0], line.points[2][1] - line.points[0][1]) < 1) {
        past.current.pop();
        setObjects((os) => os.filter((o) => o.id !== d.id), false);
        setSelected(null);
        return;
      }
      // Let go on a player, the ball or the basket and the line ends there.
      const to = nearestAnchor(line.points[2] as Pt, targets(current(), play), line.from);
      if (to) setObjects((os) => os.map((o) => (o.id === d.id && isLine(o) ? { ...withEnd(o, 2, [to.x, to.y]), to: to.id } : o)), false);
    }
    if (d.kind === 'handle' && d.index !== 1 && d.moved && line && isLine(line)) {
      const isStart = d.index === 0;
      const anchor = nearestAnchor(line.points[d.index] as Pt, isStart ? sources(current()) : targets(current(), play), isStart ? line.to : line.from);
      setObjects(
        (os) =>
          os.map((o) => {
            if (o.id !== d.id || !isLine(o)) return o;
            const moved = anchor ? withEnd(o, d.index as 0 | 2, [anchor.x, anchor.y]) : o;
            return isStart ? { ...moved, from: anchor?.id } : { ...moved, to: anchor?.id };
          }),
        false,
      );
    }
  };

  /**
   * Where the grab point for one end of the selected line is drawn. An attached end sits on the
   * edge of the player it belongs to, not on top of them, so the player can still be picked up.
   */
  const handleSpot = (line: PlayLine, i: number, q: number[]): number[] => {
    const attached = i === 0 ? line.from : i === 2 ? line.to : undefined;
    if (!attached) return q;
    const trims = lineTrims(line, current().objects);
    const pts = sampleLine(line.points);
    const path = i === 0 ? pts : [...pts].reverse();
    let left = (i === 0 ? trims.start : trims.end) + 0.9;
    for (let k = 1; k < path.length; k++) {
      const step = Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
      if (step >= left) {
        const t = left / (step || 1);
        return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * t, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * t];
      }
      left -= step;
    }
    return q;
  };

  // --- Steps and play-level actions -------------------------------------------
  const setFrames = (next: PlayFrame[], goTo: number) => {
    remember();
    update({ frames: next });
    setStep(goTo);
    setSelected(null);
  };
  const addStep = () => setFrames([...play.frames.slice(0, index + 1), carryForward(frame, play), ...play.frames.slice(index + 1)], index + 1);
  /** An exact copy of the open step, placed straight after it and opened. */
  const duplicateStep = () => setFrames([...play.frames.slice(0, index + 1), structuredClone(frame), ...play.frames.slice(index + 1)], index + 1);
  /** Drops a step in a new place in the running order. The step that was open stays open. */
  const moveStep = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = Number(e.active.id);
    const to = Number(e.over.id);
    const open = play.frames[index];
    const next = arrayMove(play.frames, from, to);
    setFrames(next, next.indexOf(open));
  };
  const removeStep = async () => {
    if (frame.objects.length > 0 && !(await confirmDialog({ title: `Delete step ${index + 1}?`, body: 'Its drawing is removed. You can undo this.', confirmLabel: 'Delete step', danger: true }))) return;
    setFrames(play.frames.filter((_, i) => i !== index), Math.max(0, index - 1));
  };
  const flip = () => {
    remember();
    const W = COURT.width;
    const mirror = (q: number[]) => [W - q[0], h - q[1]];
    update({
      flipped: !play.flipped,
      frames: play.frames.map((f) => ({
        ...f,
        objects: f.objects.map((o) => (isMark(o) ? { ...o, x: W - o.x, y: h - o.y } : { ...o, points: o.points.map(mirror) })),
      })),
    });
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete "${play.name}"?`, body: 'It is also removed from any practice items it is attached to.', confirmLabel: 'Delete play', danger: true }))) return;
    // Saved as it stands, so undoing the delete brings back exactly what was here.
    await flush();
    latest.current = null;
    deleteLater({ key: `play:${play.id}`, message: `Deleted the play "${play.name || 'Untitled play'}".`, run: () => api.deletePlay(play.id) });
    navigate('/playbook');
  };
  const duplicate = async () => {
    await flush();
    const copy = await api.createPlay({ sport_id: play.sport_id, from_play_id: play.id });
    navigate(`/plays/${copy.id}`);
  };
  const patchSelected = (patch: Partial<PlayMark> | Partial<PlayLine> | Partial<PlayShape>, record = true) =>
    setObjects((os) => os.map((o) => (o.id === selected ? ({ ...o, ...patch } as PlayObject) : o)), record);
  /** Gives every offensive player, or every defender, in every step the same color. */
  const colorAll = (type: 'o' | 'x', color: string) => {
    remember();
    update({ frames: play.frames.map((f) => ({ ...f, objects: f.objects.map((o) => (o.type === type ? { ...o, color: color || undefined } : o)) })) });
  };

  const sport = sportOf(play.sport_id);
  const tools = toolsFor(sport);
  /** Drops a ready-made starting lineup onto this step, selected so it can be nudged as a group. */
  const addLineup = (lineup: Lineup) => {
    const ballTaken = current().objects.some((o) => isMark(o) && (o.hasBall || o.type === 'ball'));
    const made: PlayMark[] = lineup.spots.map((spot) => ({ ...spot, id: newKey(), hasBall: spot.hasBall && !ballTaken ? true : undefined }));
    setObjects((os) => [...os, ...made]);
    selectMany(made.map((m) => m.id));
  };
  /** Switches the court or field. Between two views of the same field, everything drawn moves with it. */
  const changeSurface = (court: Play['court']) => {
    const move = moveBetween(play.court, court);
    if (!move) return update({ court });
    const top = courtHeight(court);
    const fit = (p: number[]) => {
      const [x, y] = move(p);
      return [Math.min(COURT.width - 1, Math.max(1, x)), Math.min(top - 1, Math.max(1, y))];
    };
    // "Our side" of a volleyball court has no room for the other team: anyone across the net is
    // left out, with the lines drawn from or to them. Undo brings them back.
    const across = (o: PlayObject) => court === 'vhalf' && isMark(o) && move([o.x, o.y])[1] < VOLLEY_COURTS.vhalf.net - 0.5;
    remember();
    update({
      court,
      frames: play.frames.map((f) => {
        const out = new Set(f.objects.filter(across).map((o) => o.id));
        return {
          ...f,
          objects: f.objects
            .filter((o) => !out.has(o.id) && !(isLine(o) && ((o.from && out.has(o.from)) || (o.to && out.has(o.to)))))
            .map((o) => {
              if (!isMark(o)) return { ...o, points: o.points.map(fit) };
              const [x, y] = fit([o.x, o.y]);
              return { ...o, x, y };
            }),
        };
      }),
    });
  };
  const selLine = selectedObject && isLine(selectedObject) ? selectedObject : null;
  const selShape = selectedObject && isShape(selectedObject) ? selectedObject : null;
  const selMark = selectedObject && isMark(selectedObject) ? selectedObject : null;
  const snapAt = snap ? targets(frame, play).find((a) => a.id === snap) : null;
  // --- A group selection: what is in it, and which settings its members share ---
  const group = frame.objects.filter((o) => multi.includes(o.id));
  const allOf = <T extends PlayObject>(test: (o: PlayObject) => o is T): T[] | null => (group.length > 0 && group.every(test) ? (group as T[]) : null);
  const groupPlayers = allOf((o): o is PlayMark => isMark(o) && isPlayer(o));
  const groupLines = allOf(isLine);
  const groupShapes = allOf(isShape);
  const groupSummary = (() => {
    const n = (count: number, one: string, many: string) => (count ? `${count} ${count === 1 ? one : many}` : '');
    const marks = group.filter(isMark);
    return [
      n(marks.filter(isPlayer).length, 'player', 'players'),
      n(marks.filter((m) => !isPlayer(m)).length, 'marker', 'markers'),
      n(group.filter(isLine).length, 'line', 'lines'),
      n(group.filter(isShape).length, 'shape', 'shapes'),
    ].filter(Boolean).join(', ');
  })();
  const patchGroup = (patch: Partial<PlayMark> | Partial<PlayLine> | Partial<PlayShape>, record = true) =>
    setObjects((os) => os.map((o) => (multi.includes(o.id) ? ({ ...o, ...patch } as PlayObject) : o)), record);
  const isSelected = (id: string) => id === selected || multi.includes(id);
  // --- Order of movement in this step ---
  const beats = beatsOf(frame);
  const lineCount = beats.reduce((n, b) => n + b.length, 0);
  /** The same lines as one running list: each either waits for the line before it, or starts with it. */
  const sequence = sequenceOf(frame);
  const resequence = (next: SequenceItem[]) => setObjects((os) => withSequence(os, next.map((s) => ({ id: s.line.id, withPrevious: s.withPrevious }))));
  /**
   * Moves a line one place up or down the running list. It keeps its own "with previous" setting,
   * except when it trades places with a line it already moves with: then the two simply swap and stay together.
   */
  const moveInOrder = (i: number, by: 1 | -1) => {
    const upper = Math.min(i, i + by);
    const next = [...sequence];
    if (sequence[upper + 1].withPrevious) {
      next[upper] = { line: sequence[upper + 1].line, withPrevious: sequence[upper].withPrevious };
      next[upper + 1] = { line: sequence[upper].line, withPrevious: true };
    } else [next[upper], next[upper + 1]] = [next[upper + 1], next[upper]];
    resequence(next);
  };
  const setWithPrevious = (i: number, on: boolean) => resequence(sequence.map((s, j) => (j === i ? { ...s, withPrevious: on } : s)));
  const allTogether = () => setObjects((os) => withOrder(os, new Map(os.filter(isLine).map((l) => [l.id, 1]))));
  const oneAtATime = () => setObjects((os) => withOrder(os, new Map(beats.flat().map((l, i) => [l.id, i + 1]))));
  const swatches = (colors: string[], value: string, onPick: (c: string) => void, what: string) => (
    <div className="color-row" role="group" aria-label={`${what} color`}>
      {colors.map((c) => (
        <button
          key={c || 'default'}
          type="button"
          className={`swatch ${c ? '' : 'default'} ${value === c ? 'on' : ''}`}
          style={c ? { background: c } : undefined}
          aria-label={c ? `Use color ${c}` : 'Use the default color'}
          aria-pressed={value === c}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );

  return (
    <div className="page play-editor">
      <div className="crumbs">
        <Link to="/playbook">← Playbook</Link>
        <span className={`save-state ${saveState}`} role="status">
          {saveState === 'saved' ? 'All changes saved' : saveState === 'error' ? 'Not saved' : 'Saving…'}
        </span>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <div className="play-head">
          <div className="play-head-main">
            <div className="fields">
              <Field label="Play name" grow>
                <input className="input" value={play.name} onChange={(e) => update({ name: e.target.value })} />
              </Field>
              <Field label="Category">
                {/* A plain list, so every category is always offered. A text box with suggestions only
                    offers the ones matching what is already typed, which hides the rest once one is chosen. */}
                <select
                  className="input"
                  aria-label="Category"
                  value={play.category}
                  onChange={async (e) => {
                    if (e.target.value !== NEW_CATEGORY) return update({ category: e.target.value });
                    const name = (await promptDialog({ title: 'New category', confirmLabel: 'Use category' }))?.trim().slice(0, 60);
                    if (!name) return;
                    setCategories((cs) => (cs.includes(name) ? cs : [...cs, name]));
                    update({ category: name });
                  }}
                >
                  <option value="">No category</option>
                  {[...new Set([...categories, ...(play.category ? [play.category] : [])])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={NEW_CATEGORY}>+ New category…</option>
                </select>
              </Field>
              <Field label={surfaceWord(sport) === 'court' ? 'Court' : 'Field'}>
                <select className="input" value={play.court} onChange={(e) => changeSurface(e.target.value as Play['court'])}>
                  {SURFACES[sport].map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Tags, separated by commas">
              <input
                className="input"
                placeholder="vs 2-3 zone, late clock"
                value={labelsText}
                onChange={(e) => {
                  setLabelsText(e.target.value);
                  update({ labels: [...new Set(e.target.value.split(',').map((l) => l.trim()).filter(Boolean))] });
                }}
              />
            </Field>
          </div>
          <Field label="About this play">
            <textarea className="input" placeholder="When to call it, what to look for" value={play.notes} onChange={(e) => update({ notes: e.target.value })} />
          </Field>
        </div>
        <div className="plan-summary">
          <div className="head-actions">
            <Link className="btn primary" to={`/plays/${play.id}/print`} onClick={() => flush()}>
              Print
            </Link>
            <button className="btn" onClick={duplicate}>
              Duplicate
            </button>
            <button className="btn" onClick={() => setSharing(true)}>
              Share
            </button>
            <button className="btn" onClick={() => setWatching(true)} title="Watch the play move, step by step">
              ▶ Play animation
            </button>
            {play.court === 'half' && (
              <button className="btn" onClick={flip} title="Turn the court so the basket is at the other end">
                Flip court
              </button>
            )}
            {lineups(play.court).map((l) => (
              <button key={l.id} className="btn" onClick={() => addLineup(l)} title="Places everyone in their usual starting spots on this step. Drag them where you want them.">
                {l.label}
              </button>
            ))}
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="card builder-bar">
        <div className="bar-tools">
          <div className="toolbar" role="toolbar" aria-label="Drawing tools">
            {(['pointer', 'mark', 'line', 'shape'] as const).map((g) => (
              <div className="tool-group" key={g}>
                {tools.filter((t) => t.group === g).map((t) => (
                  <button key={t.id} type="button" className={`tool ${tool === t.id ? 'on' : ''} ${t.id === 'select' ? '' : 'draggable'}`}
                    aria-pressed={tool === t.id}
                    title={t.hint}
                    onPointerDown={(e) => onToolDown(e, t.id)}
                    onClick={() => {
                      if (skipClick.current) return;
                      if (aim) cancelAim();
                      setTool(t.id);
                    }}
                  >
                    <ToolIcon tool={t.id} />
                    {t.label}
                  </button>
                ))}
              </div>
            ))}
            <div className="tool-group">
              <button type="button" className="tool" disabled={past.current.length === 0} onClick={undo} title="Undo (Ctrl+Z)">
                Undo
              </button>
              <button type="button" className="tool" disabled={future.current.length === 0} onClick={redo} title="Redo (Ctrl+Y)">
                Redo
              </button>
            </div>
          </div>
          {aim && (
            <p className="muted small tool-hint" role="status">
              Now click where it ends. Click a player or the basket to attach it there. Press Escape to cancel.
            </p>
          )}
        </div>
        {/* Options for whatever is selected in the drawing. The space is always there, so the court does not jump. */}
        <div className="bar-selection">
          <div className="selection">
            {group.length > 0 && (
              <>
                <p className="group-count">
                  <strong>{group.length} selected</strong>
                  <span className="muted small"> · {groupSummary}</span>
                </p>
                {groupPlayers && (
                  <>
                    <span className="field-label">Player color</span>
                    {swatches(PLAYER_COLORS, sameValue(groupPlayers.map((m) => m.color || '')) ?? MIXED, (c) => patchGroup({ color: c || undefined }), 'Player')}
                  </>
                )}
                {groupLines && (
                  <>
                    <span className="field-label">Line type</span>
                    <div className="seg">
                      {LINE_KINDS.map((k) => (
                        <button key={k} className={sameValue(groupLines.map((l) => l.kind)) === k ? 'on' : ''} aria-pressed={sameValue(groupLines.map((l) => l.kind)) === k} onClick={() => patchGroup({ kind: k })}>
                          {k[0].toUpperCase() + k.slice(1)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {groupShapes && (
                  <>
                    <span className="field-label">Shape color</span>
                    {swatches(SHAPE_COLORS, sameValue(groupShapes.map((x) => x.color)) ?? MIXED, (c) => patchGroup({ color: c }), 'Shape')}
                    <label className="opacity">
                      <span className="field-label">See-through</span>
                      <input
                        type="range"
                        min={5}
                        max={100}
                        step={5}
                        value={Math.round(groupShapes[0].opacity * 100)}
                        aria-label="Shape opacity"
                        onPointerDown={remember}
                        onChange={(e) => patchGroup({ opacity: Number(e.target.value) / 100 }, false)}
                      />
                      <span className="attach-pct">{sameValue(groupShapes.map((x) => x.opacity)) === null ? 'Mixed' : `${Math.round(groupShapes[0].opacity * 100)}%`}</span>
                    </label>
                    <div className="head-actions">
                      <button className="btn small" onClick={() => setObjects((os) => os.map((o) => (multi.includes(o.id) && isShape(o) ? scaled(o, 1 / 1.15) : o)))}>
                        Smaller
                      </button>
                      <button className="btn small" onClick={() => setObjects((os) => os.map((o) => (multi.includes(o.id) && isShape(o) ? scaled(o, 1.15) : o)))}>
                        Larger
                      </button>
                    </div>
                  </>
                )}
                <p className="muted small group-hint">
                  {groupPlayers || groupLines || groupShapes ? 'Changes apply to all of them. Drag any one to move them together.' : 'These are different kinds of things, so there is nothing to set for all of them. Drag any one to move them together.'}
                </p>
                <button className="btn small danger" onClick={removeSelected}>
                  Delete {group.length} selected
                </button>
              </>
            )}
            {selMark && (isPlayer(selMark) || selMark.type === 'text') && (
              <Field label={selMark.type === 'text' ? 'Label text' : 'Player label'}>
                <input className="input" value={selMark.label} maxLength={selMark.type === 'text' ? 120 : 40} onChange={(e) => patchSelected({ label: e.target.value })} />
              </Field>
            )}
            {selMark && selMark.type === 'text' && (
              <>
                <span className="field-label">Size</span>
                <div className="seg">
                  {TEXT_SIZES.map((z) => (
                    <button key={z.label} className={(selMark.size ?? TEXT_SIZE) === z.size ? 'on' : ''} aria-pressed={(selMark.size ?? TEXT_SIZE) === z.size} aria-label={`${z.name} text`} onClick={() => patchSelected({ size: z.size === TEXT_SIZE ? undefined : z.size })}>
                      {z.label}
                    </button>
                  ))}
                </div>
                <span className="field-label">Font</span>
                <div className="seg font-seg">
                  {TEXT_FONT_CHOICES.map((f) => (
                    <button key={f.label} className={(selMark.font ?? '') === f.id ? 'on' : ''} aria-pressed={(selMark.font ?? '') === f.id} style={f.id ? { fontFamily: TEXT_FONTS[f.id] } : undefined} onClick={() => patchSelected({ font: f.id || undefined })}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="seg style-seg">
                  <button className={selMark.bold !== false ? 'on' : ''} aria-pressed={selMark.bold !== false} aria-label="Bold" onClick={() => patchSelected({ bold: selMark.bold === false ? undefined : false })}>
                    <strong>B</strong>
                  </button>
                  <button className={selMark.italic ? 'on' : ''} aria-pressed={!!selMark.italic} aria-label="Italic" onClick={() => patchSelected({ italic: selMark.italic ? undefined : true })}>
                    <em>I</em>
                  </button>
                </div>
                <span className="field-label">Text color</span>
                {swatches(PLAYER_COLORS, selMark.color || '', (c) => patchSelected({ color: c || undefined }), 'Text')}
                {selMark.w && (
                  <button className="btn small" onClick={() => patchSelected({ w: undefined })} title="Back to one line, as wide as the words">
                    Fit box to text
                  </button>
                )}
              </>
            )}
            {selMark && isPlayer(selMark) && (
              <>
                <label className="has-ball-toggle">
                  <input type="checkbox" checked={!!selMark.hasBall} onChange={(e) => giveBall(selMark.id, e.target.checked)} />
                  <span>Has the ball</span>
                </label>
                <span className="field-label">Player color</span>
                {swatches(PLAYER_COLORS, selMark.color || '', (c) => patchSelected({ color: c || undefined }), 'Player')}
                <button className="btn small" onClick={() => colorAll(selMark.type as 'o' | 'x', selMark.color || '')}>
                  Use for all {selMark.type === 'o' ? 'offense' : 'defense'}
                </button>
              </>
            )}
            {selLine && (
              <>
                <span className="field-label">Line type</span>
                <div className="seg">
                  {LINE_KINDS.map((k) => (
                    <button key={k} className={selLine.kind === k ? 'on' : ''} aria-pressed={selLine.kind === k} onClick={() => patchSelected({ kind: k })}>
                      {k[0].toUpperCase() + k.slice(1)}
                    </button>
                  ))}
                </div>
                <p className="muted small attach-info">
                  From {describeAnchor(selLine.from, frame)} to {describeAnchor(selLine.to, frame)}.
                </p>
                <button
                  className="btn small"
                  onClick={() => patchSelected({ points: [selLine.points[0], [(selLine.points[0][0] + selLine.points[2][0]) / 2, (selLine.points[0][1] + selLine.points[2][1]) / 2], selLine.points[2]] })}
                >
                  Straighten
                </button>
              </>
            )}
            {selShape && (
              <>
                <span className="field-label">Shape color</span>
                {swatches(SHAPE_COLORS, selShape.color, (c) => patchSelected({ color: c }), 'Shape')}
                <label className="opacity">
                  <span className="field-label">See-through</span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={Math.round(selShape.opacity * 100)}
                    aria-label="Shape opacity"
                    onPointerDown={remember}
                    onChange={(e) => patchSelected({ opacity: Number(e.target.value) / 100 }, false)}
                  />
                  <span className="attach-pct">{Math.round(selShape.opacity * 100)}%</span>
                </label>
                <div className="head-actions">
                  <button className="btn small" onClick={() => setObjects((os) => os.map((o) => (o.id === selected && isShape(o) ? scaled(o, 1 / 1.15) : o)))}>
                    Smaller
                  </button>
                  <button className="btn small" onClick={() => setObjects((os) => os.map((o) => (o.id === selected && isShape(o) ? scaled(o, 1.15) : o)))}>
                    Larger
                  </button>
                </div>
              </>
            )}
            {selectedObject && (
              <button className="btn small danger" onClick={removeSelected}>
                Delete selected
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="builder">
        <div className="builder-left">
          <div className="card builder-steps">
            <h4>Steps</h4>
            <DndContext sensors={stepSensors} collisionDetection={closestCenter} onDragEnd={moveStep}>
              <SortableContext items={play.frames.map((_, i) => String(i))} strategy={rectSortingStrategy}>
                <div className="step-list">
                  {play.frames.map((f, i) => (
                    <StepThumb
                      key={i}
                      id={String(i)}
                      number={i + 1}
                      on={i === index}
                      onOpen={() => {
                        setStep(i);
                        setSelected(null);
                      }}
                    >
                      <PlayDiagram play={play} frame={f} />
                    </StepThumb>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {play.frames.length > 1 && <p className="muted small step-help">Drag a step to change the order.</p>}
            <button className="btn small" onClick={addStep} title="Players and the ball start where their lines end in this step">
              + Next step
            </button>
            <button className="btn small" onClick={duplicateStep} disabled={play.frames.length >= MAX_STEPS} title="An exact copy of this step, placed right after it">
              Duplicate step {index + 1}
            </button>
            {play.frames.length > 1 && (
              <button className="btn small danger" onClick={removeStep}>
                Delete step {index + 1}
              </button>
            )}
          </div>
        </div>

        {carry && (
          <div className="tool-ghost" style={{ left: carry.x, top: carry.y }} aria-hidden="true">
            <ToolIcon tool={carry.tool} />
            {tools.find((t) => t.id === carry.tool)!.label}
          </div>
        )}
        <div className="card builder-stage">
          <svg
            ref={svg}
            className={`play-svg editing tool-${tool} ${aim ? 'aiming' : ''} ${carry ? 'drop-ready' : ''}`}
            viewBox={`${-VIEW_PAD} ${-VIEW_PAD} ${COURT.width + VIEW_PAD * 2} ${h + VIEW_PAD * 2}`}
            onPointerDownCapture={onAimDown}
            onPointerDown={onCourtDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="application"
            aria-label={`Court for step ${index + 1}`}
          >
            <Court court={play.court} flipped={play.flipped} />
            {frame.objects.filter(isShape).map((o) => (
              <g key={o.id} onPointerDown={(e) => onObjectDown(e, o)}>
                <ShapeView shape={o} selected={isSelected(o.id)} />
              </g>
            ))}
            {frame.objects.filter(isLine).map((o) => (
              <g key={o.id} onPointerDown={(e) => onObjectDown(e, o)}>
                <LineShape
                  line={o}
                  objects={frame.objects}
                  selected={isSelected(o.id)}
                  hit={<path d={`M ${sampleLine(o.points, 16).map((q) => q.join(' ')).join(' L ')}`} className="line-hit" />}
                />
              </g>
            ))}
            {/* A ring on whatever the line end will attach to if released now. */}
            {snapAt && <circle className="snap-ring" cx={snapAt.x} cy={snapAt.y} r={snapAt.id.startsWith('basket') ? 1.7 : 2.2} />}
            {frame.objects.filter(isMark).map((o) => (
              <g key={o.id} onPointerDown={(e) => onObjectDown(e, o)}>
                <MarkShape mark={o} selected={isSelected(o.id)} />
              </g>
            ))}
            {/* With more than one group of movement, each line wears its place in the order. */}
            {beats.length > 1 &&
              beats.flatMap((lines, b) =>
                lines.map((l) => {
                  const mid = sampleLine(l.points, 8)[4];
                  return (
                    <g key={`order-${l.id}`} className="order-badge" aria-hidden="true">
                      <circle cx={mid[0]} cy={mid[1]} r={0.95} />
                      <text x={mid[0]} y={mid[1]} textAnchor="middle" dominantBaseline="central">
                        {b + 1}
                      </text>
                    </g>
                  );
                }),
              )}
            {area && (
              <rect className="area-box" x={Math.min(area.a[0], area.b[0])} y={Math.min(area.a[1], area.b[1])} width={Math.abs(area.b[0] - area.a[0])} height={Math.abs(area.b[1] - area.a[1])} />
            )}
            {/* While a line tool is active the baskets can be grabbed as a target, so show where they are. */}
            {isLineTool(tool) && baskets(play).map((b) => <circle key={b.id} className="basket-target" cx={b.x} cy={b.y} r={1.3} />)}
            {selLine &&
              tool === 'select' &&
              !aim &&
              selLine.points.map((q, i) => (
                <circle
                  key={i}
                  className={`handle-dot ${i === 1 ? 'mid' : ''} ${(i === 0 && selLine.from) || (i === 2 && selLine.to) ? 'attached' : ''}`}
                  cx={handleSpot(selLine, i, q)[0]}
                  cy={handleSpot(selLine, i, q)[1]}
                  r={0.75}
                  onPointerDown={(e) => onHandleDown(e, selLine.id, i)}
                />
              ))}
            {/* A selected label has a handle on each side: drag one to narrow or widen its box, and the words wrap to fit. */}
            {selMark?.type === 'text' &&
              tool === 'select' &&
              [-1, 1].map((side) => {
                const box = textBox(selMark);
                return (
                  <rect
                    key={side}
                    className="corner-dot text-edge"
                    x={selMark.x + side * (box.width / 2 + 0.5) - 0.55}
                    y={selMark.y - 0.9}
                    width={1.1}
                    height={1.8}
                    rx={0.3}
                    onPointerDown={(e) => onTextEdgeDown(e, selMark.id)}
                  />
                );
              })}
            {selShape &&
              tool === 'select' &&
              shapeHandles(selShape).map((q, i) => <rect key={i} className="corner-dot" x={q[0] - 0.7} y={q[1] - 0.7} width={1.4} height={1.4} onPointerDown={(e) => onCornerDown(e, selShape.id, i)} />)}
          </svg>
        </div>

        <div className="card builder-settings">
          <h4>
            Step {index + 1} <span className="hint">of {play.frames.length}</span>
          </h4>
          <button className="btn primary" onClick={() => setWatching(true)}>
            ▶ Play animation
          </button>
          <div className="order">
            <h4>
              Order of movement <span className="hint">Step {index + 1}</span>
            </h4>
            {lineCount === 0 ? (
              <p className="muted small">
                Draw a {LINE_KINDS.map((k) => LINE_WORDS[sport][k].label.toLowerCase()).join(', ')} line and it appears here. This is where you set what happens first.
              </p>
            ) : (
              <>
                {lineCount > 1 && (
                  <div className="order-quick">
                    <button className="btn small" disabled={beats.length === 1} onClick={allTogether}>
                      All together
                    </button>
                    <button className="btn small" disabled={beats.length === lineCount} onClick={oneAtATime}>
                      One at a time
                    </button>
                  </div>
                )}
                {lineCount > 1 && (
                  <p className="muted small order-help">Lines run from top to bottom. Set a line to "With previous" to start it at the same time as the one above.</p>
                )}
                <ol className="order-list">
                  {beats.map((lines, b) => (
                    <li key={b} className={`order-beat ${lines.length > 1 ? 'group' : ''}`}>
                      <span className="order-place">
                        {ordinal(b + 1)}
                        {lines.length > 1 && <span className="muted"> · {lines.length} together</span>}
                      </span>
                      {lines.map((l) => {
                        const i = sequence.findIndex((s) => s.line.id === l.id);
                        const name = describeLine(l, frame, sport);
                        return (
                          <div key={l.id} className={`order-row ${isSelected(l.id) ? 'on' : ''}`}>
                            <button type="button" className="order-name" onClick={() => setSelected(l.id)} title="Show this line in the drawing">
                              <span className={`order-dot ${l.kind}`} aria-hidden="true" />
                              {name}
                            </button>
                            <span className="order-controls">
                              {i === 0 ? (
                                <span className="order-first">Starts the step</span>
                              ) : (
                                <select className="order-when" aria-label={`When "${name}" starts`} value={sequence[i].withPrevious ? 'with' : 'after'} onChange={(e) => setWithPrevious(i, e.target.value === 'with')}>
                                  <option value="after">After previous</option>
                                  <option value="with">With previous</option>
                                </select>
                              )}
                              <span className="order-move">
                                <button type="button" className="btn small" aria-label={`Move "${name}" earlier`} title="Earlier" disabled={i === 0} onClick={() => moveInOrder(i, -1)}>
                                  ↑
                                </button>
                                <button type="button" className="btn small" aria-label={`Move "${name}" later`} title="Later" disabled={i === sequence.length - 1} onClick={() => moveInOrder(i, 1)}>
                                  ↓
                                </button>
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
          <Field label={`Note for step ${index + 1}`}>
            <textarea
              className="input"
              rows={3}
              placeholder={NOTE_EXAMPLES[sport]}
              value={frame.note}
              onChange={(e) => update({ frames: play.frames.map((f, i) => (i === index ? { ...f, note: e.target.value } : f)) })}
            />
          </Field>
        </div>
      </div>

      {sharing && <ShareDialog kind="play" itemId={play.id} title={play.name || 'Play'} onClose={() => setSharing(false)} />}
      {watching && (
        <Modal title={play.name || 'Play'} onClose={() => setWatching(false)} wide>
          <PlayAnimation play={play} />
        </Modal>
      )}
      <div className="card play-media">
        <h4>
          Resources <span className="hint">Film of the play, a whiteboard photo, or a link to a clip. Pictures print with the play.</span>
        </h4>
        <Attachments images={play.images || []} videos={play.videos || []} links={play.links || []} onChange={update} />
      </div>
    </div>
  );
}

/** Small pictures of what each tool draws, in the same style as the court. */
function ToolIcon({ tool }: { tool: Tool }) {
  const line = (kind: PlayLine['kind']) => (
    <svg viewBox="0 0 12 6" className="play-svg tool-icon" aria-hidden="true">
      <LineShape line={{ id: 'i', type: 'line', kind, points: [[0.6, 3], [5.5, 3], [11, 3]] }} />
    </svg>
  );
  const mark = (m: PlayMark) => (
    <svg viewBox="0.9 0.9 4.2 4.2" className="play-svg tool-icon mark" aria-hidden="true">
      <MarkShape mark={m} />
    </svg>
  );
  const shape = (kind: ShapeKind) => (
    <svg viewBox="-9 -7 18 14" className="play-svg tool-icon" aria-hidden="true">
      <ShapeView shape={{ ...newShape(kind, [0, 0]), color: 'currentColor', opacity: 0.3 }} />
    </svg>
  );
  switch (tool) {
    case 'select':
      return (
        <svg viewBox="0 0 24 24" className="tool-icon plain" aria-hidden="true">
          <path d="M6 3l12 9-5.500 1.200L15.500 20l-2.600 1.100-3-6.800L6 18z" fill="currentColor" />
        </svg>
      );
    case 'o':
      return mark({ id: 'i', type: 'o', x: 3, y: 3, label: '1' });
    case 'x':
      return mark({ id: 'i', type: 'x', x: 3, y: 3, label: 'X' });
    case 'cone':
      return mark({ id: 'i', type: 'cone', x: 3, y: 3, label: '' });
    case 'text':
      return mark({ id: 'i', type: 'text', x: 3, y: 3, label: 'Aa' });
    case 'rect':
    case 'ellipse':
    case 'triangle':
      return shape(tool);
    default:
      return line(tool);
  }
}

/** One step in the strip: click to open it, drag to move it earlier or later. */
function StepThumb({ id, number, on, onOpen, children }: { id: string; number: number; on: boolean; onOpen: () => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`step-thumb ${on ? 'on' : ''} ${isDragging ? 'moving' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-pressed={on}
      aria-label={`Step ${number}`}
      onClick={onOpen}
    >
      {children}
      <span>{number}</span>
    </button>
  );
}
