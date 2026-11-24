// The Filmroom: a team's saved game video, the clips its coaches cut from it, and the videos
// they put together out of clips.
//
// Nothing here makes video. A clip is two marks on a saved game video, with a title and notes.
// A video put together in the Filmroom (a "reel") is a list of clips and whole game videos, in
// an order, each with a choice of whether its notes show over the picture. Playing one plays
// the same pieces of game video that were always there, so a clip or a reel costs no room.
//
// A mark is a piece of the video and how far into that piece, in seconds: the pieces are a few
// seconds each but not all the same length, so "one minute in" would not find the same moment
// twice. Everything here is for the team's coaches, as saved video is.
import { all, db, get, run } from './db.js';
import { streamOut, videoRole } from './streams.js';

db.exec(`
CREATE TABLE IF NOT EXISTS film_clips (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  start_n INTEGER NOT NULL, start_off REAL NOT NULL DEFAULT 0,
  end_n INTEGER NOT NULL, end_off REAL NOT NULL DEFAULT 0,
  seconds REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_film_clips_team ON film_clips(team_id);
CREATE TABLE IF NOT EXISTS film_reels (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- What a reel is made of, in order: a clip, or a whole game video.
CREATE TABLE IF NOT EXISTS film_reel_items (
  id INTEGER PRIMARY KEY,
  reel_id INTEGER NOT NULL REFERENCES film_reels(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  clip_id INTEGER REFERENCES film_clips(id) ON DELETE CASCADE,
  stream_id INTEGER REFERENCES streams(id) ON DELETE CASCADE,
  show_notes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_film_reel_items ON film_reel_items(reel_id, position);
`);

const MAX_ITEMS = 200;
const str = (v, max) => String(v ?? '').slice(0, max);
const nowIso = () => new Date().toISOString();
const whole = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null);
const part = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 1000) / 1000 : 0);
/** A team's saved game videos, newest first. */
const videosOf = (teamId) => all("SELECT * FROM streams WHERE team_id=? AND status='ended' AND saved=1 ORDER BY id DESC", teamId);
const clipOut = (c) => ({
  id: c.id, stream_id: c.stream_id, title: c.title, notes: c.notes,
  start: { n: c.start_n, off: c.start_off }, end: { n: c.end_n, off: c.end_off }, seconds: c.seconds,
  created_at: c.created_at, by: get('SELECT name FROM users WHERE id=?', c.user_id)?.name || '',
});
const reelOut = (r) => ({
  id: r.id, title: r.title, notes: r.notes, created_at: r.created_at, updated_at: r.updated_at, by: get('SELECT name FROM users WHERE id=?', r.user_id)?.name || '',
  items: all('SELECT clip_id, stream_id, show_notes FROM film_reel_items WHERE reel_id=? ORDER BY position, id', r.id).map((i) => ({ clip_id: i.clip_id, stream_id: i.stream_id, show_notes: !!i.show_notes })),
});
/** Everything in a team's Filmroom. */
const filmOf = (teamId) => ({
  videos: videosOf(teamId).map(streamOut),
  clips: all('SELECT * FROM film_clips WHERE team_id=? ORDER BY id DESC', teamId).map(clipOut),
  reels: all('SELECT * FROM film_reels WHERE team_id=? ORDER BY updated_at DESC, id DESC', teamId).map(reelOut),
});

export function mountFilm(app) {
  /** The team, when the person asking coaches it. Answers "not found" otherwise, as for anything of a team they have nothing to do with. */
  const coached = (req, res, teamId) => {
    const role = videoRole(req.user, teamId);
    if (!role?.coach) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    return role.team;
  };
  app.get('/api/film', (req, res) => {
    const team = coached(req, res, req.query.team_id);
    if (team) res.json(filmOf(team.id));
  });

  // --- Clips ---
  app.post('/api/film/clips', (req, res) => {
    const s = get("SELECT * FROM streams WHERE id=? AND status='ended' AND saved=1", Number(req.body.stream_id));
    const team = coached(req, res, s?.team_id);
    if (!team) return;
    const [sn, en] = [whole(req.body.start?.n), whole(req.body.end?.n)];
    const [so, eo] = [part(req.body.start?.off), part(req.body.end?.off)];
    // The end has to come after the start, and both have to be in the video.
    if (sn === null || en === null || en >= s.segments || en < sn || (en === sn && eo <= so)) return res.status(400).json({ error: 'A clip ends after it starts, inside the video.' });
    const title = str(req.body.title, 120).trim();
    if (!title) return res.status(400).json({ error: 'Give the clip a title.' });
    run(
      'INSERT INTO film_clips (team_id, stream_id, user_id, title, notes, start_n, start_off, end_n, end_off, seconds, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      team.id, s.id, req.user.id, title, str(req.body.notes, 2000).trim(), sn, so, en, eo, Math.max(0, Math.min(part(req.body.seconds), s.seconds + 60)), nowIso(),
    );
    res.json(filmOf(team.id));
  });
  const clipOf = (req, res) => {
    const c = get('SELECT * FROM film_clips WHERE id=?', Number(req.params.id));
    return coached(req, res, c?.team_id) ? c : null;
  };
  app.put('/api/film/clips/:id', (req, res) => {
    const c = clipOf(req, res);
    if (!c) return;
    const title = str(req.body.title, 120).trim();
    if (!title) return res.status(400).json({ error: 'Give the clip a title.' });
    run('UPDATE film_clips SET title=?, notes=? WHERE id=?', title, str(req.body.notes, 2000).trim(), c.id);
    res.json(filmOf(c.team_id));
  });
  app.delete('/api/film/clips/:id', (req, res) => {
    const c = clipOf(req, res);
    if (!c) return;
    run('DELETE FROM film_clips WHERE id=?', c.id);
    res.json(filmOf(c.team_id));
  });

  // --- Videos put together from clips and game videos ---
  /** What a reel is to be made of, checked: each thing has to be this team's own. */
  const itemsFrom = (teamId, list) => {
    const out = [];
    for (const i of Array.isArray(list) ? list.slice(0, MAX_ITEMS) : []) {
      const clip = i?.clip_id ? get('SELECT id FROM film_clips WHERE id=? AND team_id=?', Number(i.clip_id), teamId) : null;
      const video = !clip && i?.stream_id ? get("SELECT id FROM streams WHERE id=? AND team_id=? AND status='ended' AND saved=1", Number(i.stream_id), teamId) : null;
      if (clip || video) out.push({ clip_id: clip?.id ?? null, stream_id: video?.id ?? null, show_notes: i.show_notes ? 1 : 0 });
    }
    return out;
  };
  const putItems = (reelId, items) => {
    run('DELETE FROM film_reel_items WHERE reel_id=?', reelId);
    items.forEach((i, at) => run('INSERT INTO film_reel_items (reel_id, position, clip_id, stream_id, show_notes) VALUES (?,?,?,?,?)', reelId, at, i.clip_id, i.stream_id, i.show_notes));
  };
  const reelFrom = (req, res, teamId) => {
    const title = str(req.body.title, 120).trim();
    const items = itemsFrom(teamId, req.body.items);
    if (!title) return void res.status(400).json({ error: 'Give the video a title.' });
    if (items.length === 0) return void res.status(400).json({ error: 'Add at least one clip or game video.' });
    return { title, notes: str(req.body.notes, 2000).trim(), items };
  };
  app.post('/api/film/reels', (req, res) => {
    const team = coached(req, res, req.body.team_id);
    if (!team) return;
    const r = reelFrom(req, res, team.id);
    if (!r) return;
    const id = Number(run('INSERT INTO film_reels (team_id, user_id, title, notes, created_at, updated_at) VALUES (?,?,?,?,?,?)', team.id, req.user.id, r.title, r.notes, nowIso(), nowIso()).lastInsertRowid);
    putItems(id, r.items);
    res.json({ id, ...filmOf(team.id) });
  });
  const reelOf = (req, res) => {
    const r = get('SELECT * FROM film_reels WHERE id=?', Number(req.params.id));
    return coached(req, res, r?.team_id) ? r : null;
  };
  app.put('/api/film/reels/:id', (req, res) => {
    const was = reelOf(req, res);
    if (!was) return;
    const r = reelFrom(req, res, was.team_id);
    if (!r) return;
    run('UPDATE film_reels SET title=?, notes=?, updated_at=? WHERE id=?', r.title, r.notes, nowIso(), was.id);
    putItems(was.id, r.items);
    res.json({ id: was.id, ...filmOf(was.team_id) });
  });
  app.delete('/api/film/reels/:id', (req, res) => {
    const r = reelOf(req, res);
    if (!r) return;
    run('DELETE FROM film_reels WHERE id=?', r.id);
    res.json(filmOf(r.team_id));
  });
}
