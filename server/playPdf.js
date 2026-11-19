// Reading a play out of a PDF printed by another play designer.
//
// The PDF is a sheet of small court diagrams, one for each phase of the play, drawn as shapes and
// not as pictures. Each diagram becomes one step: the numbers become players, the crosses become
// defenders, and the arrows become cuts, passes, dribbles and screens. Everything is measured
// against the court's own lines, so the result lands in the same places on our court.
//
// It is written for the sheets The Hoops Geek's designer prints. Nothing here trusts the file:
// whatever cannot be understood is left out, and the play is still checked like any other when saved.

const round = (n) => Math.round(n * 100) / 100;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mean = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

/** Our court, in feet: see COURT in client/src/components/PlayDiagram.tsx. */
const OURS = { width: 50, half: 42, basket: 5.25 };
export const MAX_IMPORT_STEPS = 80;
const MAX_PAGES = 40;

export class PlayPdfError extends Error {}

// --- The page as plain shapes ---------------------------------------------------
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** Every painted path on a page, in points measured from the top-left corner, with how it was painted. */
async function readPage(page, OPS) {
  const height = page.view[3];
  const list = await page.getOperatorList();
  const strokes = new Set([OPS.stroke, OPS.closeStroke]);
  const fills = new Set([OPS.fill, OPS.eoFill]);
  const both = new Set([OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  let st = { ctm: [1, 0, 0, 1, 0, 0], stroke: '#000000', fill: '#000000', alpha: 1, dash: false };
  const stack = [];
  const paths = [];
  list.fnArray.forEach((fn, i) => {
    const a = list.argsArray[i];
    if (fn === OPS.save) stack.push({ ...st });
    else if (fn === OPS.restore) st = stack.pop() ?? st;
    else if (fn === OPS.transform) st = { ...st, ctm: mul(st.ctm, a) };
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ...st });
      if (Array.isArray(a?.[0]) || ArrayBuffer.isView(a?.[0])) st = { ...st, ctm: mul(st.ctm, a[0]) };
    } else if (fn === OPS.paintFormXObjectEnd) st = stack.pop() ?? st;
    else if (fn === OPS.setStrokeRGBColor) st = { ...st, stroke: String(a[0]).toLowerCase() };
    else if (fn === OPS.setFillRGBColor) st = { ...st, fill: String(a[0]).toLowerCase() };
    else if (fn === OPS.setDash) st = { ...st, dash: Array.isArray(a[0]) && a[0].length > 0 };
    else if (fn === OPS.setGState) {
      for (const [key, value] of a[0] ?? []) {
        if (key === 'ca') st = { ...st, alpha: Number(value) };
        if (key === 'D') st = { ...st, dash: Array.isArray(value?.[0]) && value[0].length > 0 };
      }
    } else if (fn === OPS.constructPath) {
      const paint = a[0];
      const d = a[1]?.[0];
      if (!d) return;
      const m = st.ctm;
      const at = (x, y) => [m[0] * x + m[2] * y + m[4], height - (m[1] * x + m[3] * y + m[5])];
      const subs = [];
      let sub = null;
      let curves = 0;
      let straights = 0;
      for (let k = 0; k < d.length; ) {
        const c = d[k++];
        if (c === 0) {
          sub = { pts: [at(d[k++], d[k++])], line: [], closed: false };
          sub.line.push(sub.pts[0]);
          subs.push(sub);
        } else if (!sub) break;
        else if (c === 1) {
          const p = at(d[k++], d[k++]);
          sub.pts.push(p);
          sub.line.push(p);
          straights++;
        } else if (c === 2 || c === 3) {
          const from = sub.pts[sub.pts.length - 1];
          const c1 = at(d[k++], d[k++]);
          const c2 = c === 2 ? at(d[k++], d[k++]) : c1;
          const p = at(d[k++], d[k++]);
          // The curve, as a run of short straight pieces.
          for (let s = 1; s <= 8; s++) {
            const t = s / 8;
            const u = 1 - t;
            sub.line.push(
              c === 2
                ? [u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p[0], u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p[1]]
                : [u * u * from[0] + 2 * u * t * c1[0] + t * t * p[0], u * u * from[1] + 2 * u * t * c1[1] + t * t * p[1]],
            );
          }
          sub.pts.push(p);
          curves++;
        } else if (c === 4) sub.closed = true;
        else break;
      }
      const all = subs.flatMap((s) => s.line);
      if (!all.length) return;
      const xs = all.map((p) => p[0]);
      const ys = all.map((p) => p[1]);
      paths.push({
        i,
        stroke: strokes.has(paint) || both.has(paint),
        fill: fills.has(paint) || both.has(paint),
        clip: paint === OPS.endPath,
        strokeColor: st.stroke,
        fillColor: st.fill,
        alpha: st.alpha,
        dash: st.dash,
        subs,
        curves,
        straights,
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      });
    }
  });
  return { paths, height };
}

const boxW = (b) => b[2] - b[0];
const boxH = (b) => b[3] - b[1];
const boxMid = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const inside = (p, b, pad = 0) => p[0] >= b[0] - pad && p[0] <= b[2] + pad && p[1] >= b[1] - pad && p[1] <= b[3] + pad;
const lengthOf = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);
/** The corners of a closed outline, without the last one repeating the first. */
const corners = (sub) => (sub.pts.length > 1 && dist(sub.pts[0], sub.pts[sub.pts.length - 1]) < 0.05 ? sub.pts.slice(0, -1) : sub.pts);

/**
 * Where the diagrams are on a page. Each diagram is drawn inside a box it is clipped to, and that
 * box is named again for nearly everything in it, so the boxes named most often are the diagrams.
 */
function diagramBoxes(paths) {
  const seen = [];
  for (const p of paths) {
    if (!p.clip || p.curves || p.subs.length !== 1 || corners(p.subs[0]).length !== 4) continue;
    if (boxW(p.box) < 100 || boxH(p.box) < 60) continue;
    // The same box is not written to the last decimal each time.
    const had = seen.find((b) => b.box.every((n, k) => Math.abs(n - p.box[k]) < 1));
    if (had) had.n++;
    else seen.push({ box: p.box, n: 1 });
  }
  const found = seen.filter((b) => b.n >= 2);
  // A box around other boxes is the page, not a diagram.
  return found
    .filter((b) => !found.some((o) => o !== b && inside([o.box[0], o.box[1]], b.box, 1) && inside([o.box[2], o.box[3]], b.box, 1) && boxW(o.box) * boxH(o.box) < boxW(b.box) * boxH(b.box) * 0.9))
    .map((b) => b.box)
    .sort((a, b) => (Math.abs(a[1] - b[1]) > 20 ? a[1] - b[1] : a[0] - b[0]));
}

// --- The court in a diagram, and how to get from it to ours ----------------------
/**
 * Finds the court among a diagram's lines and returns how to turn a point on the page into feet
 * on our court. The rims say which way the court runs: two of them for a full court, one for a half.
 */
function courtOf(lines) {
  const xs = lines.flatMap((p) => [p.box[0], p.box[2]]);
  const ys = lines.flatMap((p) => [p.box[1], p.box[3]]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const short = Math.min(boxW(box), boxH(box));
  const rims = lines
    .filter((p) => p.subs.length === 1 && p.subs[0].closed && p.curves >= 4 && !p.straights)
    .filter((p) => Math.abs(boxW(p.box) - boxH(p.box)) < boxW(p.box) * 0.2 && boxW(p.box) / short > 0.018 && boxW(p.box) / short < 0.05)
    .map((p) => boxMid(p.box));
  if (!rims.length) return null;
  let full = false;
  let sideways;
  let flipped = false;
  if (rims.length >= 2) {
    // The two rims furthest apart are the two baskets.
    let a = rims[0];
    let b = rims[1];
    for (const p of rims) for (const q of rims) if (dist(p, q) > dist(a, b)) [a, b] = [p, q];
    if (dist(a, b) > Math.max(boxW(box), boxH(box)) * 0.5) {
      full = true;
      sideways = Math.abs(a[0] - b[0]) > Math.abs(a[1] - b[1]);
    }
  }
  if (!full) {
    // The baseline is the edge the rim is nearest to.
    const [x, y] = rims[0];
    const gaps = [x - box[0], box[2] - x, y - box[1], box[3] - y];
    const edge = gaps.indexOf(Math.min(...gaps));
    sideways = edge < 2;
    flipped = edge === 1 || edge === 3;
  }
  // The court is 50 feet across wherever it is drawn.
  const across = sideways ? boxH(box) : boxW(box);
  const along = sideways ? boxW(box) : boxH(box);
  const perFoot = across / 50;
  const feet = along / perFoot;
  if (!(perFoot > 0.4) || feet < 30 || feet > 110) return null;
  const ours = full ? OURS.half * 2 : OURS.half;
  // Their court may be longer than ours (94 feet against 84). The length is squeezed to fit, so the
  // baskets, the middle and everything between stay where they were.
  const squeeze = full ? ours / feet : Math.abs(feet - OURS.half) < 2.5 ? 1 : OURS.half / 47;
  const to = ([X, Y]) => {
    const d = (sideways ? (flipped ? box[2] - X : X - box[0]) : flipped ? box[3] - Y : Y - box[1]) / perFoot;
    const y = flipped ? ours - d * squeeze : d * squeeze;
    // Seen sideways, our court has its left sideline along the bottom.
    const x = sideways ? OURS.width - (Y - box[1]) / perFoot : (X - box[0]) / perFoot;
    return [round(x), round(y)];
  };
  return { court: full ? 'full' : 'half', upright: !sideways, flipped, perFoot, to, height: ours };
}

// --- What each drawn thing is -----------------------------------------------------
const hex = (c) => (/^#[0-9a-f]{6}$/.test(c) ? c : '');
/** A color worth keeping: anything that is not plain black or dark gray. */
function ownColor(c) {
  if (!hex(c)) return undefined;
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 40 && Math.max(r, g, b) < 130 ? undefined : c;
}

/** The point halfway along a path. A wavy line is averaged over its middle, which lands on the line it waves around. */
function middleOf(line) {
  const total = lengthOf(line);
  if (!total) return line[0];
  const kept = [];
  let run = 0;
  for (let k = 1; k < line.length; k++) {
    run += dist(line[k - 1], line[k]);
    if (run >= total * 0.42 && run <= total * 0.58) kept.push(line[k]);
  }
  if (kept.length) return mean(kept);
  let left = total / 2;
  for (let k = 1; k < line.length; k++) {
    const step = dist(line[k - 1], line[k]);
    if (step >= left) return [line[k - 1][0] + ((line[k][0] - line[k - 1][0]) * left) / step, line[k - 1][1] + ((line[k][1] - line[k - 1][1]) * left) / step];
    left -= step;
  }
  return line[line.length - 1];
}

/** The pointed end of an arrowhead: the corner across from its notch. */
function tipOf(pts) {
  if (pts.length === 3) {
    // A plain triangle: the tip is the corner across from its shortest side.
    const sides = [0, 1, 2].map((k) => dist(pts[(k + 1) % 3], pts[(k + 2) % 3]));
    return pts[sides.indexOf(Math.min(...sides))];
  }
  const turn = pts.map((p, k) => {
    const a = pts[(k + pts.length - 1) % pts.length];
    const b = pts[(k + 1) % pts.length];
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
  });
  const ups = turn.filter((t) => t > 0).length;
  const notch = turn.findIndex((t) => (ups === 1 ? t > 0 : ups === pts.length - 1 ? t <= 0 : false));
  if (notch >= 0 && pts.length === 4) return pts[(notch + 2) % 4];
  const c = mean(pts);
  return pts.reduce((best, p) => (dist(p, c) > dist(best, c) ? p : best), pts[0]);
}

/**
 * Sorts a diagram's drawn things into rings, crosses, shapes and lines. Lengths are judged in feet,
 * so the same rules hold at whatever size the diagram was printed.
 */
function sortOut(elements, perFoot) {
  const ft = (n) => n / perFoot;
  const rings = [];
  const shapes = [];
  const bodies = [];
  const ends = [];
  const strokes = [];
  let unknown = 0;
  for (const p of elements) {
    const size = Math.max(boxW(p.box), boxH(p.box));
    const sub = p.subs[0];
    if (p.fill && !p.stroke && p.alpha < 0.95) {
      // A tinted area: an oval, or a box, a diamond or a triangle.
      if (ft(size) < 1 || p.subs.length !== 1) continue;
      if (p.curves >= 3) shapes.push({ shape: 'ellipse', pts: [[p.box[0], p.box[1]], [p.box[2], p.box[3]]], color: hex(p.fillColor), opacity: p.alpha });
      else {
        const pts = corners(sub);
        if (pts.length === 3) shapes.push({ shape: 'triangle', pts, color: hex(p.fillColor), opacity: p.alpha });
        else if (pts.length === 4) shapes.push({ shape: 'rect', pts, color: hex(p.fillColor), opacity: p.alpha });
        else shapes.push({ shape: 'rect', pts: [[p.box[0], p.box[1]], [p.box[2], p.box[1]], [p.box[2], p.box[3]], [p.box[0], p.box[3]]], color: hex(p.fillColor), opacity: p.alpha });
      }
      continue;
    }
    if (p.stroke) {
      if (p.subs.length !== 1) continue;
      if (sub.closed && p.curves >= 4 && !p.straights) {
        // A circle the size of a player: whoever is inside it has the ball.
        if (Math.abs(boxW(p.box) - boxH(p.box)) < size * 0.2 && ft(size) > 2.2 && ft(size) < 5) rings.push(boxMid(p.box));
        continue;
      }
      if (sub.closed) continue;
      const length = lengthOf(sub.line);
      if (!p.curves && sub.pts.length === 2 && ft(length) < 4.5) {
        strokes.push({ a: sub.pts[0], b: sub.pts[1], color: p.strokeColor });
        continue;
      }
      if (ft(length) < 1.2) continue;
      // A long run of little curves is the wave of a dribble.
      bodies.push({ i: p.i, kind: p.dash ? 'pass' : p.curves >= 6 ? 'dribble' : 'cut', start: sub.line[0], end: sub.line[sub.line.length - 1], mid: middleOf(sub.line) });
      continue;
    }
    if (!p.fill || p.curves) {
      if (p.fill && ft(size) > 1) unknown++;
      continue;
    }
    const quads = p.subs.map(corners).filter((pts) => pts.length >= 3);
    if (!quads.length) continue;
    if (quads.length >= 2) {
      // A dashed line is printed as a row of little slabs: a pass.
      const spots = quads.map(mean);
      if (ft(lengthOf(spots)) >= 1.5) bodies.push({ i: p.i, kind: 'pass', start: spots[0], end: spots[spots.length - 1], mid: spots[Math.floor(spots.length / 2)] });
      continue;
    }
    const pts = quads[0];
    if (ft(size) > 6) continue;
    if (pts.length === 4) {
      const sides = pts.map((q, k) => dist(q, pts[(k + 1) % 4]));
      const long = Math.max(...sides);
      if (Math.abs(sides[0] - sides[2]) < long * 0.15 && Math.abs(sides[1] - sides[3]) < long * 0.15 && long / Math.max(0.01, Math.min(...sides)) > 3.5) {
        // A thin slab on its own: the bar across the end of a screen. A short one is a stray dash.
        if (ft(long) >= 2) ends.push({ i: p.i, bar: true, at: mean(pts) });
        continue;
      }
    }
    if (pts.length <= 5) ends.push({ i: p.i, bar: false, at: tipOf(pts) });
  }
  // Two short strokes crossing at their middles are a defender.
  const crosses = [];
  const used = new Set();
  strokes.forEach((s, k) => {
    if (used.has(k)) return;
    const mid = mean([s.a, s.b]);
    const other = strokes.findIndex((o, j) => j > k && !used.has(j) && dist(mean([o.a, o.b]), mid) < perFoot * 0.4);
    if (other < 0) return;
    used.add(k);
    used.add(other);
    crosses.push({ at: mid, color: ownColor(s.color) });
  });
  // Each arrowhead or bar finishes the line that ends nearest to it.
  for (const e of ends) {
    const open = bodies.filter((b) => !b.done && dist(b.end, e.at) < perFoot * 4).sort((a, b) => dist(a.end, e.at) - dist(b.end, e.at))[0];
    if (!open) continue;
    open.done = true;
    open.end = e.at;
    if (e.bar && open.kind === 'cut') open.kind = 'screen';
  }
  return { rings, shapes, crosses, lines: bodies.sort((a, b) => a.i - b.i), unknown };
}

// --- One diagram to one step ------------------------------------------------------
function stepOf(diagram, court) {
  const { perFoot, to } = court;
  const ft = (n) => n / perFoot;
  const { rings, shapes, crosses, lines, unknown } = sortOut(diagram.elements, perFoot);
  const objects = [];
  const ids = new Set();
  const idFor = (want) => {
    let id = want.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) || 'm';
    for (let n = 2; ids.has(id); n++) id = `${want.slice(0, 12)}_${n}`;
    ids.add(id);
    return id;
  };

  // Words and numbers. A short one standing alone is a player. A small one beside a cross names that defender.
  const defenders = crosses.map((c) => ({ ...c, label: '' }));
  const players = [];
  const words = [];
  for (const t of diagram.texts) {
    const short = /^[A-Za-z0-9]{1,3}$/.test(t.str);
    if (short) {
      const beside = defenders.filter((d) => !d.label && dist(d.at, t.at) < perFoot * 3.4).sort((a, b) => dist(a.at, t.at) - dist(b.at, t.at))[0];
      if (beside && ft(t.size) < 2.1) {
        beside.label = t.str;
        continue;
      }
      // A short word in big letters is a heading, not a player.
      if (ft(t.size) < 3) {
        players.push({ at: t.at, label: t.str });
        continue;
      }
    }
    words.push(t);
  }
  const marks = [
    ...players.map((p) => ({ id: idFor(`o${p.label}`), type: 'o', at: p.at, label: p.label })),
    ...defenders.map((d) => ({ id: idFor(`x${d.label}`), type: 'x', at: d.at, label: `X${d.label}`, color: d.color })),
  ];
  for (const r of rings) {
    const holder = marks.filter((m) => dist(m.at, r) < perFoot * 1.6).sort((a, b) => dist(a.at, r) - dist(b.at, r))[0];
    if (holder) holder.hasBall = true;
  }
  // Only one player holds the ball in a step.
  marks.filter((m) => m.hasBall).slice(1).forEach((m) => delete m.hasBall);

  for (const s of shapes) {
    let points = s.pts.map(to);
    if (s.shape === 'ellipse') points = [[Math.min(points[0][0], points[1][0]), Math.min(points[0][1], points[1][1])], [Math.max(points[0][0], points[1][0]), Math.max(points[0][1], points[1][1])]];
    objects.push({ id: idFor('s1'), type: 'shape', shape: s.shape, points, color: s.color || '#2a78d6', opacity: round(Math.min(1, Math.max(0.05, s.opacity * 0.6))) });
  }

  /** The nearest player to a spot, an attacker before a defender. */
  const nearest = (at, reach, except) => {
    const within = marks.filter((m) => m.id !== except && dist(m.at, at) < perFoot * reach).sort((a, b) => dist(a.at, at) - dist(b.at, at));
    return within.find((m) => m.type === 'o') ?? within[0];
  };
  const made = lines.map((l) => ({ ...l, id: idFor('l1') }));
  for (const l of made) {
    const from = nearest(l.start, 4);
    if (from) {
      l.from = from.id;
      l.start = from.at;
    }
  }
  // A line that starts where another ends is the same player carrying on.
  for (const l of made) {
    if (l.from) continue;
    const before = made.find((o) => o !== l && o.kind !== 'pass' && dist(o.end, l.start) < perFoot * 2.5);
    if (before) {
      l.from = `end:${before.id}`;
      l.start = before.end;
      l.order = 2;
    }
  }
  const basketsAt = court.court === 'full' ? [['basket', [OURS.width / 2, OURS.basket]], ['basket2', [OURS.width / 2, court.height - OURS.basket]]] : [['basket', [OURS.width / 2, court.flipped ? court.height - OURS.basket : OURS.basket]]];
  for (const l of made) {
    if (l.kind !== 'pass') continue;
    const catcher = nearest(l.end, 4.5, l.from);
    // Thrown to where a cutter is going: it meets them there.
    const cutter = made.filter((o) => o.kind !== 'pass' && o.from !== l.from && dist(o.end, l.end) < perFoot * 4).sort((a, b) => dist(a.end, l.end) - dist(b.end, l.end))[0];
    if (catcher && (!cutter || dist(catcher.at, l.end) <= dist(cutter.end, l.end))) {
      l.to = catcher.id;
      l.catcher = catcher.id;
      l.end = catcher.at;
    } else if (cutter) {
      l.to = `end:${cutter.id}`;
      l.catcher = cutter.from;
      l.end = cutter.end;
    } else {
      const hoop = basketsAt.find(([, at]) => dist(to(l.end), at) < 3.5);
      if (hoop) l.to = hoop[0];
    }
  }
  // A pass thrown by whoever has just caught one waits for the first to arrive.
  made.forEach((l, k) => {
    if (l.kind !== 'pass' || !l.from) return;
    // Only a pass drawn earlier can be the one waited for, so a give-and-go does not wait on itself.
    const feed = made.slice(0, k).filter((o) => o.kind === 'pass' && o.catcher === l.from).pop();
    if (feed) l.order = (feed.order ?? 1) + 1;
  });

  for (const l of made) {
    const line = { id: l.id, type: 'line', kind: l.kind, points: [to(l.start), to(l.mid), to(l.end)] };
    if (l.from) line.from = l.from;
    if (l.to) line.to = l.to;
    if (l.order > 1) line.order = l.order;
    objects.push(line);
  }
  for (const m of marks) {
    const [x, y] = to(m.at);
    const mark = { id: m.id, type: m.type, x, y, label: m.label };
    if (m.color) mark.color = m.color;
    if (m.hasBall) mark.hasBall = true;
    objects.push(mark);
  }
  for (const t of words) {
    const [x, y] = to(t.at);
    const size = round(Math.min(8, Math.max(0.8, ft(t.size) * 0.92)));
    const mark = { id: idFor('t1'), type: 'text', x, y, label: t.str.slice(0, 120), size };
    // Headings are heavy and the lines under them are not. The file does not say which is which, so size decides.
    if (size < 2.3) mark.bold = false;
    objects.push(mark);
  }
  return { frame: { note: '', objects }, unknown };
}

/**
 * Lines up each step with the next. A player's line ends where the same player stands in the next
 * step, when that is close by, so nobody jumps as one step gives way to the next.
 */
function joinSteps(frames) {
  const key = (m) => `${m.type}:${m.label}`;
  frames.forEach((frame, n) => {
    const next = frames[n + 1];
    if (!next) return;
    const then = new Map(next.objects.filter((o) => o.type === 'o' || o.type === 'x').map((m) => [key(m), m]));
    const now = new Map(frame.objects.filter((o) => o.type === 'o' || o.type === 'x').map((m) => [m.id, m]));
    const lines = frame.objects.filter((o) => o.type === 'line');
    for (const l of lines) {
      if (l.kind === 'pass' || !l.from || l.from.startsWith('end:')) continue;
      // Someone with two lines in a step ends up at the end of the last one only.
      if (lines.some((o) => o.from === `end:${l.id}`)) continue;
      const mover = now.get(l.from);
      const after = mover && then.get(key(mover));
      if (after && dist(l.points[2], [after.x, after.y]) < 5) {
        l.points[2] = [after.x, after.y];
        for (const o of lines) if (o.to === `end:${l.id}`) o.points[2] = [after.x, after.y];
      }
    }
  });
}

/** Reads a printed play. Returns it ready to be saved as a new play, with what could not be read counted. */
export async function playFromPdf(bytes, fileName = '') {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    throw new PlayPdfError('That file could not be opened as a PDF.');
  }
  try {
    if (doc.numPages > MAX_PAGES) throw new PlayPdfError(`That PDF has ${doc.numPages} pages. A play sheet of up to ${MAX_PAGES} pages can be read.`);
    const diagrams = [];
    let title = '';
    let titleSize = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const { paths, height } = await readPage(page, pdfjs.OPS);
      const boxes = diagramBoxes(paths);
      const texts = (await page.getTextContent()).items
        .filter((it) => typeof it.str === 'string' && it.str.trim())
        .map((it) => {
          const size = Math.hypot(it.transform[0], it.transform[1]);
          return { str: it.str.trim(), size, left: it.transform[4], at: [it.transform[4] + it.width / 2, height - it.transform[5] - size * 0.36] };
        });
      for (const t of texts) {
        if (boxes.some((b) => inside(t.at, b))) continue;
        // The biggest words outside the diagrams are the name of the play.
        if (!/^phase\s+\d+$/i.test(t.str) && t.size > titleSize + 0.5) [title, titleSize] = [t.str, t.size];
      }
      boxes.forEach((box, k) => {
        // "Phase 12" printed just above a diagram says where it comes in the play.
        const tag = texts.find((t) => /^phase\s+\d+$/i.test(t.str) && t.at[1] < box[1] && box[1] - t.at[1] < 40 && t.left >= box[0] - 4 && t.left < box[2]);
        diagrams.push({
          order: n * 1000 + k,
          phase: tag ? Number(tag.str.match(/\d+/)[0]) : null,
          box,
          paths: paths.filter((p) => !p.clip && inside(boxMid(p.box), box, 1)),
          texts: texts.filter((t) => inside(t.at, box)),
        });
      });
      page.cleanup();
    }
    if (!diagrams.length) throw new PlayPdfError('No play diagrams were found in that PDF. It needs to be the PDF the play designer prints, not a scan or a photo.');
    diagrams.sort((a, b) => (a.phase !== null && b.phase !== null && a.phase !== b.phase ? a.phase - b.phase : a.order - b.order));

    // The court's lines are all one color, and there are more of them than of anything else.
    const tally = new Map();
    for (const d of diagrams) for (const p of d.paths) if (p.stroke && !p.fill) tally.set(p.strokeColor, (tally.get(p.strokeColor) ?? 0) + 1);
    const courtColor = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    let court = null;
    for (const d of diagrams) {
      const lines = d.paths.filter((p) => p.stroke && p.strokeColor === courtColor);
      if (lines.length < 8) continue;
      d.court = courtOf(lines);
      court ??= d.court;
      const first = Math.min(...lines.map((p) => p.i));
      // Everything drawn after the court, in any color but the court's, is part of the play.
      d.elements = d.paths.filter((p) => p.i > first && !(p.stroke && p.strokeColor === courtColor) && !(p.fill && !p.stroke && p.fillColor === courtColor));
    }
    if (!court) throw new PlayPdfError('The diagrams in that PDF could not be read: no basketball court was found in them.');
    const usable = diagrams.filter((d) => d.court && d.court.court === court.court && d.court.upright === court.upright && d.court.flipped === court.flipped);
    const kept = usable.slice(0, MAX_IMPORT_STEPS);
    let unknown = 0;
    const frames = kept.map((d) => {
      const step = stepOf(d, d.court);
      unknown += step.unknown;
      return step.frame;
    });
    joinSteps(frames);
    const name = (title || fileName.replace(/\.pdf$/i, '') || 'Imported play').slice(0, 120);
    return {
      name,
      court: court.court,
      upright: court.upright,
      flipped: court.flipped,
      frames,
      found: diagrams.length,
      left_out: diagrams.length - kept.length,
      unknown,
    };
  } finally {
    task.destroy().catch(() => {});
  }
}
