// The playbook: diagrammed plays that stand on their own and can be attached to practice items.
//
// A play is a list of steps (frames). Each frame holds the objects drawn on the court for that
// step. Coordinates are in feet from the top-left corner of the court, so a drawing is independent
// of screen size. The drawing itself is opaque to the server: it only checks shape and size.
import { all, get, run, tx } from './db.js';
import { cleanImages, cleanLinks, cleanVideos } from './images.js';

const str = (v, max = 200) => String(v ?? '').slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);
const parse = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};

const MARKS = ['o', 'x', 'ball', 'cone', 'text'];
const LINES = ['cut', 'pass', 'dribble', 'screen'];
const MAX_FRAMES = 20;
const MAX_OBJECTS = 80;

const SHAPES = { rect: 4, ellipse: 2, triangle: 3 };
const HEX = /^#[0-9a-f]{6}$/i;
const point = (p) => [num(p?.[0]), num(p?.[1])];

/** Normalizes a drawing to the shapes the app knows, dropping anything else. */
function cleanFrames(input) {
  const frames = (Array.isArray(input) ? input : []).slice(0, MAX_FRAMES).map((f) => ({
    note: str(f?.note, 500),
    objects: (Array.isArray(f?.objects) ? f.objects : [])
      .slice(0, MAX_OBJECTS)
      .map((o) => {
        const id = str(o?.id, 24);
        if (MARKS.includes(o?.type)) {
          const mark = { id, type: o.type, x: num(o.x), y: num(o.y), label: str(o.label, 40) };
          if (HEX.test(String(o.color))) mark.color = String(o.color).toLowerCase();
          if (o.hasBall === true && (o.type === 'o' || o.type === 'x')) mark.hasBall = true;
          if (o.type === 'text') {
            // How a label is lettered: size in feet, typeface, weight and slant.
            const size = Number(o.size);
            if (Number.isFinite(size) && size > 0) mark.size = Math.round(Math.min(8, Math.max(0.8, size)) * 100) / 100;
            if (['serif', 'mono', 'hand'].includes(o.font)) mark.font = o.font;
            if (o.bold === false) mark.bold = false;
            if (o.italic === true) mark.italic = true;
          }
          return mark;
        }
        if (o?.type === 'line' && LINES.includes(o.kind) && Array.isArray(o.points) && o.points.length === 3) {
          const line = { id, type: 'line', kind: o.kind, points: o.points.map(point) };
          // What each end is attached to: another object's id, or a basket.
          if (o.from) line.from = str(o.from, 24);
          if (o.to) line.to = str(o.to, 24);
          // Its place in the order of movement. First is the default and is not stored.
          const order = Math.round(Number(o.order));
          if (Number.isFinite(order) && order > 1) line.order = Math.min(40, order);
          return line;
        }
        if (o?.type === 'shape' && SHAPES[o.shape] && Array.isArray(o.points) && o.points.length === SHAPES[o.shape]) {
          const opacity = Number(o.opacity);
          return {
            id, type: 'shape', shape: o.shape, points: o.points.map(point),
            color: HEX.test(String(o.color)) ? String(o.color).toLowerCase() : '#2a78d6',
            opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.05, opacity)) : 0.25,
          };
        }
        return null;
      })
      .filter(Boolean),
  }));
  return frames.length ? frames : [{ note: '', objects: [] }];
}
const cleanLabels = (input) =>
  [...new Set((Array.isArray(input) ? input : []).map((l) => str(l, 40).trim()).filter(Boolean))].slice(0, 12);

const attachmentsOut = (p) => {
  const a = parse(p.attachments_json, {});
  const list = (v) => (Array.isArray(v) ? v : []);
  return { images: list(a?.images), videos: list(a?.videos), links: list(a?.links) };
};
const attachmentsJson = (b, ownerId) =>
  JSON.stringify({ images: cleanImages(b.images, ownerId), videos: cleanVideos(b.videos, ownerId), links: cleanLinks(b.links) });

const playOut = (p) => ({
  ...attachmentsOut(p),
  id: p.id, sport_id: p.sport_id, name: p.name, category: p.category, labels: parse(p.labels_json, []),
  court: p.court, flipped: !!p.flipped, notes: p.notes, frames: parse(p.frames_json, [{ note: '', objects: [] }]),
  updated_at: p.updated_at,
});

/** Keeps only play ids this workspace owns. Used when saving items and drills. */
export function cleanPlayIds(list, ownerId) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const playId = Number(v);
    if (Number.isInteger(playId) && !out.includes(playId) && get('SELECT id FROM plays WHERE id=? AND owner_id=?', playId, ownerId)) out.push(playId);
  }
  return out.slice(0, 8);
}

export function mountPlays(app) {
  const own = (req) => get('SELECT * FROM plays WHERE id=? AND owner_id=?', Number(req.params.id), req.ownerId);

  app.get('/api/plays', (req, res) => {
    res.json(all('SELECT * FROM plays WHERE owner_id=? ORDER BY name COLLATE NOCASE, id', req.ownerId).map(playOut));
  });
  app.get('/api/plays/:id', (req, res) => {
    const p = own(req);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(playOut(p));
  });
  app.post('/api/plays', (req, res) => {
    const b = req.body;
    if (!get('SELECT id FROM sports WHERE id=? AND owner_id=?', Number(b.sport_id), req.ownerId))
      return res.status(400).json({ error: 'Unknown sport' });
    // A copy of an existing play starts from that play's drawing.
    const src = b.from_play_id ? get('SELECT * FROM plays WHERE id=? AND owner_id=?', Number(b.from_play_id), req.ownerId) : null;
    if (b.from_play_id && !src) return res.status(400).json({ error: 'Unknown play to copy' });
    const r = run(
      'INSERT INTO plays (owner_id, sport_id, name, category, labels_json, court, flipped, notes, frames_json, attachments_json) VALUES (?,?,?,?,?,?,?,?,?,?)',
      req.ownerId, Number(b.sport_id), str(b.name ?? (src ? `${src.name} (copy)` : 'New play'), 120).trim() || 'New play',
      str(b.category ?? src?.category, 60).trim(), src ? src.labels_json : JSON.stringify(cleanLabels(b.labels)),
      (b.court ?? src?.court) === 'full' ? 'full' : 'half', src?.flipped ? 1 : 0, str(src?.notes, 2000),
      src ? src.frames_json : JSON.stringify(cleanFrames(b.frames)),
      src ? src.attachments_json : '{}',
    );
    res.json(playOut(get('SELECT * FROM plays WHERE id=?', Number(r.lastInsertRowid))));
  });
  app.put('/api/plays/:id', (req, res) => {
    const p = own(req);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const frames = JSON.stringify(cleanFrames(b.frames));
    if (frames.length > 400_000) return res.status(413).json({ error: 'This play is too large to save. Remove some steps or objects.' });
    tx(() =>
      run(
        `UPDATE plays SET name=?, category=?, labels_json=?, court=?, flipped=?, notes=?, frames_json=?, attachments_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        str(b.name, 120).trim() || 'Untitled play', str(b.category, 60).trim(), JSON.stringify(cleanLabels(b.labels)),
        b.court === 'full' ? 'full' : 'half', b.flipped ? 1 : 0, str(b.notes, 2000), frames, attachmentsJson(b, req.ownerId), p.id,
      ),
    );
    res.json(playOut(get('SELECT * FROM plays WHERE id=?', p.id)));
  });
  app.delete('/api/plays/:id', (req, res) => {
    run('DELETE FROM plays WHERE id=? AND owner_id=?', Number(req.params.id), req.ownerId);
    res.json({ ok: true });
  });
}
