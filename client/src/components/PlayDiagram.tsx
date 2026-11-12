// Drawing a play: the court, and the shapes, lines and marks on it. Everything is in feet, so the
// same drawing scales to a thumbnail, the editor or a printed sheet.
import type { CSSProperties, ReactNode } from 'react';
import type { Play, PlayFrame, PlayLine, PlayMark, PlayObject, PlayShape } from '../types';
import { DIAMONDS, GRIDIRONS, YARD, isDiamond, isGridiron } from '../sports';

export type Pt = [number, number];

/** High school dimensions, in feet. */
export const COURT = { width: 50, half: 42, basketY: 5.25, threeR: 19.75, laneW: 12, ftY: 19, ftR: 6, centerR: 6 };
export const courtHeight = (court: Play['court']) =>
  isDiamond(court) ? DIAMONDS[court].height : isGridiron(court) ? GRIDIRONS[court].height : court === 'full' ? COURT.half * 2 : COURT.half;
const PAD = 1.2;
export const VIEW_PAD = PAD;
export const MARK_R = 1.5;

export const isLine = (o: PlayObject): o is PlayLine => o.type === 'line';
export const isShape = (o: PlayObject): o is PlayShape => o.type === 'shape';
export const isMark = (o: PlayObject): o is PlayMark => o.type !== 'line' && o.type !== 'shape';
export const isPlayer = (o: PlayObject): o is PlayMark & { type: 'o' | 'x' } => o.type === 'o' || o.type === 'x';

/** Where the baskets are. A line can attach to one, just as it can to a player. */
export function baskets(play: Pick<Play, 'court' | 'flipped'>): { id: string; x: number; y: number }[] {
  const { width: W, half: H, basketY } = COURT;
  if (play.court !== 'half' && play.court !== 'full') return [];
  if (play.court === 'full') return [{ id: 'basket', x: W / 2, y: basketY }, { id: 'basket2', x: W / 2, y: H * 2 - basketY }];
  return [{ id: 'basket', x: W / 2, y: play.flipped ? H - basketY : basketY }];
}

/** One end of the floor with the baseline along the top edge. */
function HalfCourt() {
  const { width: W, half: H, basketY: by, threeR: r, laneW, ftY, ftR, centerR } = COURT;
  const cx = W / 2;
  const lx = cx - laneW / 2;
  return (
    <g className="court-lines">
      <rect x={0} y={0} width={W} height={H} />
      {/* lane and free throw circle */}
      <rect x={lx} y={0} width={laneW} height={ftY} />
      <path d={`M ${cx - ftR} ${ftY} A ${ftR} ${ftR} 0 0 0 ${cx + ftR} ${ftY}`} />
      <path d={`M ${cx - ftR} ${ftY} A ${ftR} ${ftR} 0 0 1 ${cx + ftR} ${ftY}`} strokeDasharray="1 1" />
      {/* three point line: short straight runs, then the arc */}
      <path d={`M ${cx - r} 0 L ${cx - r} ${by} A ${r} ${r} 0 0 0 ${cx + r} ${by} L ${cx + r} 0`} />
      {/* backboard and rim */}
      <line x1={cx - 3} y1={4} x2={cx + 3} y2={4} className="court-board" />
      <circle cx={cx} cy={by} r={0.75} />
      {/* half of the center circle */}
      <path d={`M ${cx - centerR} ${H} A ${centerR} ${centerR} 0 0 1 ${cx + centerR} ${H}`} />
    </g>
  );
}

/** A baseball field seen from above, home plate at the bottom. */
function BaseballField({ court }: { court: 'infield' | 'diamond' }) {
  const W = COURT.width;
  const { home, base: d, height: h, fence } = DIAMONDS[court];
  const [hx, hy] = home;
  const k = d / Math.SQRT2;
  // The pitching rubber is 60 feet 6 inches out, and the infield dirt is an arc 95 feet from it.
  const m = 0.672 * d;
  const R = 1.055 * d;
  /** How far across (and up) the dirt arc meets each foul line. */
  const s = (Math.SQRT2 * m + Math.sqrt(4 * R * R - 2 * m * m)) / 2 / Math.SQRT2;
  /** How far across (and up) each foul line runs: to the fence, or off the edge of the view. */
  const pole = fence ? 2.546 * d : Math.min(hx, hy);
  const sag = 4.3 * d - pole;
  const fenceR = (pole * pole + sag * sag) / (2 * sag);
  const q = k - 0.2 * d;
  const bases: Pt[] = [[hx + k, hy - k], [hx, hy - 2 * k], [hx - k, hy - k], [hx, hy]];
  return (
    <g>
      <rect className="court-floor" x={0} y={0} width={W} height={h} />
      <path className="field-dirt" d={`M ${hx} ${hy} L ${hx - s} ${hy - s} A ${R} ${R} 0 0 1 ${hx + s} ${hy - s} Z`} />
      <circle className="field-dirt" cx={hx} cy={hy} r={0.16 * d} />
      <path className="court-floor" d={`M ${hx} ${hy - k - q} L ${hx + q} ${hy - k} L ${hx} ${hy - k + q} L ${hx - q} ${hy - k} Z`} />
      <circle className="field-dirt" cx={hx} cy={hy - m} r={0.1 * d} />
      <g className="court-lines">
        <rect x={0} y={0} width={W} height={h} />
        <path d={`M ${hx - pole} ${hy - pole} L ${hx} ${hy} L ${hx + pole} ${hy - pole}`} />
        <path d={`M ${hx + k} ${hy - k} L ${hx} ${hy - 2 * k} L ${hx - k} ${hy - k}`} />
        <path d={`M ${hx - s} ${hy - s} A ${R} ${R} 0 0 1 ${hx + s} ${hy - s}`} />
        {fence && <path d={`M ${hx - pole} ${hy - pole} A ${fenceR} ${fenceR} 0 0 1 ${hx + pole} ${hy - pole}`} />}
        <line x1={hx - 0.04 * d} y1={hy - m} x2={hx + 0.04 * d} y2={hy - m} className="court-board" />
      </g>
      {bases.map(([x, y], i) => (
        <rect key={i} className="field-base" x={x - 0.035 * d} y={y - 0.035 * d} width={0.07 * d} height={0.07 * d} transform={`rotate(45 ${x} ${y})`} />
      ))}
    </g>
  );
}

/** A stretch of football field, offense at the bottom driving up. */
function FootballField({ court }: { court: 'gridiron' | 'redzone' }) {
  const W = COURT.width;
  const { los, goal, height: h } = GRIDIRONS[court];
  const anchor = goal ?? los;
  const from = goal ?? 0;
  const every = (step: number) => {
    const out: number[] = [];
    for (let y = anchor - Math.floor((anchor - from) / step) * step; y < h - 0.01; y += step) out.push(y);
    return out;
  };
  // Hash marks at each yard: along both sidelines, and a third of the way in from each.
  const ticks = every(YARD)
    .map((y) => [0, W - 0.9, W / 3 - 0.45, (2 * W) / 3 - 0.45].map((x) => `M ${x.toFixed(2)} ${y.toFixed(2)} h 0.9`).join(' '))
    .join(' ');
  return (
    <g>
      <rect className="court-floor" x={0} y={0} width={W} height={h} />
      {goal !== null && <rect className="field-zone" x={0} y={0} width={W} height={goal} />}
      <g className="court-lines">
        <rect x={0} y={0} width={W} height={h} />
        <path d={ticks} />
        {every(5 * YARD).map((y) => (
          <line key={y} x1={0} y1={y} x2={W} y2={y} className={y === goal ? 'court-board' : undefined} />
        ))}
      </g>
      <line className="field-los" x1={0} y1={los} x2={W} y2={los} />
    </g>
  );
}

export function Court({ court, flipped }: { court: Play['court']; flipped: boolean }) {
  const { width: W, half: H } = COURT;
  const h = courtHeight(court);
  if (isDiamond(court)) return <BaseballField court={court} />;
  if (isGridiron(court)) return <FootballField court={court} />;
  return (
    <g>
      <rect className="court-floor" x={0} y={0} width={W} height={h} />
      {court === 'full' ? (
        <>
          <HalfCourt />
          <g transform={`rotate(180 ${W / 2} ${H})`}>
            <HalfCourt />
          </g>
        </>
      ) : (
        <g transform={flipped ? `rotate(180 ${W / 2} ${H / 2})` : undefined}>
          <HalfCourt />
        </g>
      )}
    </g>
  );
}

// --- Line geometry ----------------------------------------------------------
/** A line is start, a point it bends through, and end. This is the curve through all three. */
export function sampleLine(points: number[][], n = 36): Pt[] {
  const [s, m, e] = points;
  // Control point of the quadratic curve that passes through m at its midpoint.
  const c: Pt = [2 * m[0] - (s[0] + e[0]) / 2, 2 * m[1] - (s[1] + e[1]) / 2];
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    out.push([a * s[0] + b * c[0] + d * e[0], a * s[1] + b * c[1] + d * e[1]]);
  }
  return out;
}
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const toPath = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
const lengthOf = (pts: Pt[]) => pts.slice(1).reduce((acc, p, i) => acc + dist(pts[i], p), 0);

/** The stretch of a path between `from` and `to` feet along it. */
function slice(pts: Pt[], from: number, to: number): Pt[] {
  const out: Pt[] = [];
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    const at = (d: number): Pt => {
      const t = seg ? (d - run) / seg : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    };
    if (out.length === 0 && run + seg >= from) out.push(at(from));
    if (out.length > 0) {
      if (run + seg >= to) {
        out.push(at(to));
        return out;
      }
      out.push(pts[i]);
    }
    run += seg;
  }
  return out.length > 1 ? out : pts;
}

/** How far a line stops short of whatever it is attached to, so it meets the edge of a player and not the middle. */
export function lineTrims(line: PlayLine, objects: PlayObject[]) {
  const gap = (id: string | undefined, atEnd: boolean) => {
    if (!id) return 0;
    if (id.startsWith('basket')) return atEnd ? 1.1 : 0;
    const m = objects.find((o) => o.id === id);
    if (!m || !isMark(m)) return 0;
    if (m.type === 'ball') return 0.95;
    return MARK_R + (atEnd ? 0.3 : 0.1);
  };
  return { start: gap(line.from, false), end: gap(line.to, true) };
}

const HEAD = 1.5;
/** The drawn shape of a line: its body, and the arrowhead or screen bar at the end. */
function lineShape(line: PlayLine, trims = { start: 0, end: 0 }) {
  let pts = sampleLine(line.points);
  const full = lengthOf(pts);
  // Only trim when the line is long enough to still be a line afterwards.
  if (trims.start + trims.end > 0 && full > trims.start + trims.end + 1) pts = slice(pts, trims.start, full - trims.end);
  const end = pts[pts.length - 1];
  // Direction of travel at the very end.
  let k = pts.length - 2;
  while (k > 0 && dist(pts[k], end) < 0.4) k--;
  const len = dist(pts[k], end) || 1;
  const ux = (end[0] - pts[k][0]) / len;
  const uy = (end[1] - pts[k][1]) / len;
  const px = -uy;
  const py = ux;

  if (line.kind === 'screen') {
    const bar = `M ${end[0] + px * 1.3} ${end[1] + py * 1.3} L ${end[0] - px * 1.3} ${end[1] - py * 1.3}`;
    return { body: toPath(pts), bar, head: '' };
  }

  // Stop the body where the arrowhead begins so the stroke does not poke through its tip.
  const keep = Math.max(0, lengthOf(pts) - HEAD * 0.8);
  const body = slice(pts, 0, keep);

  let bodyPath = toPath(body);
  if (line.kind === 'dribble') {
    // A dribble is drawn as a wave along the path. It flattens out at both ends.
    const wave: Pt[] = [];
    let d = 0;
    for (let i = 0; i < body.length; i++) {
      if (i > 0) d += dist(body[i - 1], body[i]);
      const a = body[Math.max(0, i - 1)];
      const b = body[Math.min(body.length - 1, i + 1)];
      const l = dist(a, b) || 1;
      const nx = -(b[1] - a[1]) / l;
      const ny = (b[0] - a[0]) / l;
      const fade = Math.min(1, d / 1.2, (keep - d) / 1.2);
      const off = Math.sin((d / 2.2) * Math.PI * 2) * 0.55 * Math.max(0, fade);
      wave.push([body[i][0] + nx * off, body[i][1] + ny * off]);
    }
    bodyPath = toPath(wave);
  }
  const bx = end[0] - ux * HEAD;
  const byy = end[1] - uy * HEAD;
  const head = `M ${end[0]} ${end[1]} L ${bx + px * 0.65} ${byy + py * 0.65} L ${bx - px * 0.65} ${byy - py * 0.65} Z`;
  return { body: bodyPath, bar: '', head };
}

// --- Shapes, lines and marks ---------------------------------------------------
export function LineShape({ line, objects, selected, hit }: { line: PlayLine; objects?: PlayObject[]; selected?: boolean; hit?: ReactNode }) {
  const s = lineShape(line, objects ? lineTrims(line, objects) : undefined);
  return (
    <g className={`play-line ${line.kind} ${selected ? 'selected' : ''}`}>
      {hit}
      <path d={s.body} className="line-body" />
      {s.bar && <path d={s.bar} className="line-body bar" />}
      {s.head && <path d={s.head} className="line-head" />}
    </g>
  );
}

/** The four corners of the box an oval sits in, in order. An oval is stored as two opposite corners. */
export const ovalCorners = (points: number[][]): Pt[] => {
  const [[x1, y1], [x2, y2]] = points;
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
};

export function ShapeView({ shape, selected }: { shape: PlayShape; selected?: boolean }) {
  const style = { fill: shape.color, stroke: shape.color, fillOpacity: shape.opacity };
  const cls = `play-shape ${selected ? 'selected' : ''}`;
  if (shape.shape === 'ellipse') {
    const [[x1, y1], [x2, y2]] = shape.points;
    return <ellipse className={cls} cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} style={style} />;
  }
  return <polygon className={cls} points={shape.points.map((p) => p.join(',')).join(' ')} style={style} />;
}

/** The standard letter height of a label, in feet on the court. */
export const TEXT_SIZE = 1.7;
export const TEXT_FONTS: Record<NonNullable<PlayMark['font']>, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  mono: "var(--mono), ui-monospace, Consolas, monospace",
  hand: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Marker Felt', cursive",
};
/** Only what was changed from the standard look, so an untouched label follows the stylesheet. */
function textStyle(mark: PlayMark): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (mark.color) style.fill = mark.color;
  if (mark.size) style.fontSize = `${mark.size}px`;
  if (mark.font) style.fontFamily = TEXT_FONTS[mark.font];
  if (mark.bold === false) style.fontWeight = 400;
  if (mark.italic) style.fontStyle = 'italic';
  return Object.keys(style).length ? style : undefined;
}

export function MarkShape({ mark, selected }: { mark: PlayMark; selected?: boolean }) {
  const cls = `play-mark ${mark.type} ${mark.hasBall ? 'has-ball' : ''} ${selected ? 'selected' : ''}`;
  if (mark.type === 'ball') return <circle className={cls} cx={mark.x} cy={mark.y} r={0.8} />;
  if (mark.type === 'cone') return <path className={cls} d={`M ${mark.x} ${mark.y - 1} L ${mark.x + 0.9} ${mark.y + 0.8} L ${mark.x - 0.9} ${mark.y + 0.8} Z`} />;
  if (mark.type === 'text')
    return (
      <text className={cls} x={mark.x} y={mark.y} textAnchor="middle" dominantBaseline="central" style={textStyle(mark)}>
        {mark.label || 'Text'}
      </text>
    );
  // A player's own color, if one was chosen, replaces the default ink.
  const style = mark.color ? ({ '--mark-color': mark.color } as CSSProperties) : undefined;
  return (
    <g className={cls} style={style}>
      {/* Only the player with the ball is circled. Everyone else is a bare label, with an invisible disc so it is easy to grab. */}
      <circle cx={mark.x} cy={mark.y} r={MARK_R} className={mark.hasBall ? 'ring' : 'grab'} />
      <text x={mark.x} y={mark.y} textAnchor="middle" dominantBaseline="central">
        {mark.label}
      </text>
    </g>
  );
}

/** A finished, non-interactive drawing of one step. Shapes sit under the lines, and marks on top. */
export function PlayDiagram({ play, frame, className = '' }: { play: Pick<Play, 'court' | 'flipped'>; frame: PlayFrame; className?: string }) {
  const h = courtHeight(play.court);
  return (
    <svg className={`play-svg ${className}`} viewBox={`${-PAD} ${-PAD} ${COURT.width + PAD * 2} ${h + PAD * 2}`} role="img" aria-label={frame.note || 'Play diagram'}>
      <Court court={play.court} flipped={play.flipped} />
      {frame.objects.filter(isShape).map((o) => (
        <ShapeView key={o.id} shape={o} />
      ))}
      {frame.objects.filter(isLine).map((o) => (
        <LineShape key={o.id} line={o} objects={frame.objects} />
      ))}
      {frame.objects.filter(isMark).map((o) => (
        <MarkShape key={o.id} mark={o} />
      ))}
    </svg>
  );
}

/** Every step of a play side by side, each with its number and note. Used on printed sheets and previews. */
export function PlaySteps({ play, columns }: { play: Play; columns?: number }) {
  const cols = columns ?? Math.min(play.frames.length, play.court === 'full' ? 4 : 3);
  return (
    <div className="play-steps" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))`, gap: '10px' }}>
      {play.frames.map((f, i) => (
        <figure key={i} className="play-step" style={{ margin: 0 }}>
          <PlayDiagram play={play} frame={f} />
          {(play.frames.length > 1 || f.note) && (
            <figcaption style={{ fontSize: '0.82em', marginTop: 3 }}>
              {play.frames.length > 1 && <strong>{i + 1}. </strong>}
              {f.note}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}
