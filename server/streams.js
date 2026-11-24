// Live video of a game, from one person's camera to the people around the team.
//
// How it travels is kept apart from everything else, so it can be swapped. Either way the
// broadcaster's browser records a few seconds at a time, each piece a small video file of its
// own, and a viewer plays them one after another, some seconds behind. There are two ways:
//
//   'segments'  the pieces are sent here and kept on this server's disk. It needs no outside service.
//   'r2'        the pieces go straight from the broadcaster's browser to Cloudflare R2, and straight
//               from R2 to each viewer, by short-lived signed links this server hands out (r2.js).
//               No video passes through this server and none is kept on its disk.
//
// The pieces themselves come in one of two layouts, whichever way they travel:
//
//   'separate'  each piece is a whole video file, recorded on its own. The recorder is stopped and
//               started between pieces, so a moment is lost at every join. Any browser can do it.
//   'joined'    one recording that never stops, cut where it can be cut cleanly. There is a short
//               opening part (`init`) that says what the video is, and each piece carries on from
//               the one before, so they play as one unbroken video. Needs a browser that records MP4.
//
// A new broadcast uses 'r2' when R2 is set up and 'segments' when it is not; one already saved
// keeps the way it was made. The app is told how to send (`send`) and how to watch (`watch`)
// and assumes neither, so a stream that goes through a video service later would be another
// `transport`, and nothing else here would change.
//
// A stream is thrown away when it ends, unless its team is allowed to keep video (set by the
// system administrator, team by team) and the broadcaster asked to save it. A saved one is for
// the team's coaches.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { all, db, dbPath, get, run } from './db.js';
import { poke } from './live.js';
import { isSystemAdmin } from './auth.js';
import { coachesOfTeam, followersOfTeam } from './inbox.js';
// The list of a team's parents, family and friends is made there, and has to exist before columns are added to it.
import './contacts.js';
// The setting for importing stats is kept beside the one for video, and its column is made there.
import './games.js';
import { notify } from './notices.js';
import { slugOf } from './family.js';
import { linkTo, r2Config, remove, sizeOf } from './r2.js';

db.exec(`
CREATE TABLE IF NOT EXISTS streams (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  plan_id INTEGER,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  transport TEXT NOT NULL DEFAULT 'segments',
  mime TEXT NOT NULL DEFAULT 'video/webm',
  status TEXT NOT NULL DEFAULT 'live',            -- 'live' | 'ended'
  saved INTEGER NOT NULL DEFAULT 0,
  segments INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL, last_at TEXT NOT NULL, ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_streams_team ON streams(team_id, status);
`);
const addColumn = (table, column, ddl) => {
  if (!all(`PRAGMA table_info(${table})`).some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
};
// Whether a team may keep video: the system administrator's call, since video is what fills the disk.
addColumn('teams', 'save_streams', 'INTEGER DEFAULT 0');
// What each person around a team may do with its live video. Coaches may always do both.
addColumn('team_contacts', 'can_watch', 'INTEGER DEFAULT 1');
addColumn('team_contacts', 'can_broadcast', 'INTEGER DEFAULT 0');
// Video kept in R2: the folder its pieces are under. Empty for video kept on this disk.
addColumn('streams', 'store_key', 'TEXT');
// How long people have spent watching a stream, a piece at a time.
addColumn('streams', 'watch_seconds', 'INTEGER DEFAULT 0');
// How the pieces are laid out, and how big the opening part of a joined one is: nothing until it has arrived.
addColumn('streams', 'layout', "TEXT DEFAULT 'separate'");
addColumn('streams', 'init_bytes', 'INTEGER DEFAULT 0');
// A joined video gets a new opening part whenever the broadcaster changes its quality: the piece each one starts at, in order.
addColumn('streams', 'inits', "TEXT DEFAULT ''");
// A small picture taken from the camera as the broadcast began, to show a saved video by.
addColumn('streams', 'poster', 'BLOB');
// Who is told when a broadcast begins: the groups the broadcaster chose, or nobody.
addColumn('streams', 'tell', "TEXT DEFAULT 'coaches,parents,family,friends'");
db.exec(`
-- What has been put in R2 for each stream, kept apart from the stream itself so the pieces can
-- still be found and removed after the stream's own row is gone, however it went.
CREATE TABLE IF NOT EXISTS stream_objects (
  id INTEGER PRIMARY KEY,
  prefix TEXT NOT NULL UNIQUE,
  ext TEXT NOT NULL,
  issued INTEGER NOT NULL DEFAULT 0,              -- links to send pieces 0..issued-1 have been given out
  issued_at TEXT NOT NULL,
  swept INTEGER NOT NULL DEFAULT 0
);
-- What each team has used, month by month, whatever became of the video: time broadcast, time
-- watched (every viewer's added together) and bytes sent.
CREATE TABLE IF NOT EXISTS stream_usage (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0, watch_seconds INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, month)
);
`);

const ROOT = path.join(path.dirname(dbPath), 'streams');
/** How long each piece runs. Shorter is nearer to live and more requests; longer is the reverse. */
export const SEGMENT_SECONDS = 4;
const MAX_SEGMENT_BYTES = 12 * 1024 * 1024;
/** The opening part of a joined video is a description of it, not video: a kilobyte or two. */
const MAX_INIT_BYTES = 256 * 1024;
const MAX_STREAM_SECONDS = 3 * 60 * 60;
/** Nothing new is taken once the disk has less than this left. */
const KEEP_FREE_BYTES = 80 * 1024 * 1024;
/** A live stream that has sent nothing for this long has stopped, whatever it meant to do. */
const STALE_MS = 90_000;
/** How long a link to send a piece to R2 is good for, and how many are handed out at a time. Long enough to catch up after a bad patch of signal. */
const SEND_LINK_SECONDS = 10 * 60;
const SEND_LINKS = 10;
/** The same for watching. Someone who may no longer watch is out within this long. */
const WATCH_LINK_SECONDS = 5 * 60;
const WATCH_LINKS = 6;
/** The groups of people around a team who can be told a broadcast has begun, and the kind of follower each one is. */
const TELL = ['coaches', 'parents', 'family', 'friends'];
const GROUP_OF = { parent: 'parents', family: 'family', friend: 'friends' };
const str = (v, max) => String(v ?? '').slice(0, max);
const nowIso = () => new Date().toISOString();
const dirOf = (id) => path.join(ROOT, String(id));
const extOf = (mime) => (String(mime).startsWith('video/mp4') ? 'mp4' : 'webm');
const fileOf = (s, n) => path.join(dirOf(s.id), `${n}.${extOf(s.mime)}`);
const removeFiles = (id) => fs.rmSync(dirOf(id), { recursive: true, force: true });
/** Where a stream kept in R2 has its pieces, and what one of them is called there. */
addColumn('stream_objects', 'inits', 'INTEGER DEFAULT 1');
const objectsOf = (s) => (s.store_key ? get('SELECT * FROM stream_objects WHERE prefix=?', s.store_key) : null);
const keyOf = (o, n) => `${o.prefix}${n}.${o.ext}`;
/**
 * The opening parts of a joined video: for each, the piece it applies from. There is one at the
 * start and another each time the broadcaster changed the quality, since a video of another size
 * has to say so before its pieces will play.
 */
const initsOf = (s) => (s.layout !== 'joined' || !s.init_bytes ? [] : s.inits ? s.inits.split(',').map(Number) : [0]);
const initName = (k) => (k === 0 ? 'init' : `init${k}`);
/** Which opening part comes next: a new one, or the last one again when no piece has come since (it was sent twice, or the quality changed again at once). */
const nextInit = (s) => {
  const list = initsOf(s);
  return list.length && list.at(-1) === s.segments ? list.length - 1 : list.length;
};
/** Notes that opening part `k` has arrived, of `bytes` bytes, and applies from the next piece. */
const gotInit = (s, k, bytes) => {
  const list = initsOf(s);
  list[k] = s.segments;
  run("UPDATE streams SET init_bytes=?, inits=?, last_at=? WHERE id=? AND status='live'", bytes, list.join(','), nowIso(), s.id);
};
/** Adds to what a team has used this month. */
function tally(teamId, { seconds = 0, watch = 0, bytes = 0 }) {
  run(
    `INSERT INTO stream_usage (team_id, month, seconds, watch_seconds, bytes) VALUES (?,?,?,?,?)
     ON CONFLICT(team_id, month) DO UPDATE SET seconds=seconds+excluded.seconds, watch_seconds=watch_seconds+excluded.watch_seconds, bytes=bytes+excluded.bytes`,
    teamId, nowIso().slice(0, 7), seconds, watch, bytes,
  );
}
/** Someone was given `pieces` pieces of a stream to watch. */
function watched(s, pieces) {
  if (pieces <= 0) return;
  run('UPDATE streams SET watch_seconds=watch_seconds+? WHERE id=?', pieces * SEGMENT_SECONDS, s.id);
  tally(s.team_id, { watch: pieces * SEGMENT_SECONDS });
}

/**
 * Removes from R2 the pieces of every stream that is no longer here: one ended without being
 * saved, a saved one deleted, one whose team was deleted. It goes over each twice: at once, and
 * again when the last link to send a piece has run out, in case one was used after the first pass.
 */
let sweeping = false;
let sweepAgain = false;
async function sweepObjects() {
  const cfg = r2Config();
  if (!cfg) return;
  if (sweeping) return void (sweepAgain = true);
  sweeping = true;
  try {
    do {
      sweepAgain = false;
      for (const o of all('SELECT * FROM stream_objects WHERE prefix NOT IN (SELECT store_key FROM streams WHERE store_key IS NOT NULL)')) {
        const linksOver = Date.now() - new Date(o.issued_at).getTime() > (SEND_LINK_SECONDS + 60) * 1000;
        if (o.swept && !linksOver) continue;
        // The opening part of a joined video, when it has one, goes with its pieces.
        let gone = (await Promise.all(Array.from({ length: o.inits || 1 }, (_, k) => remove(cfg, keyOf(o, initName(k)))))).every(Boolean);
        for (let n = 0; n < o.issued; n += 8) {
          const some = await Promise.all(Array.from({ length: Math.min(8, o.issued - n) }, (_, i) => remove(cfg, keyOf(o, n + i))));
          gone = gone && some.every(Boolean);
        }
        // Anything that could not be removed is tried again on the next pass.
        if (!gone) continue;
        if (linksOver) run('DELETE FROM stream_objects WHERE id=?', o.id);
        else run('UPDATE stream_objects SET swept=1 WHERE id=?', o.id);
      }
    } while (sweepAgain);
  } finally {
    sweeping = false;
  }
}
const sweepSoon = () => void sweepObjects().catch(() => {});
setInterval(sweepSoon, 60_000).unref();
function freeBytes() {
  try {
    const st = fs.statfsSync(path.dirname(dbPath));
    return st.bavail * st.bsize;
  } catch {
    return Infinity;
  }
}

/** What someone may do with a team's video: null when they have nothing to do with the team. */
export function videoRole(user, teamId) {
  const team = get('SELECT * FROM teams WHERE id=?', Number(teamId));
  if (!team) return null;
  const coach = coachesOfTeam(team).some((p) => p.id === user.id) || isSystemAdmin(user);
  const mine = all('SELECT can_watch, can_broadcast FROM team_contacts WHERE team_id=? AND user_id=?', team.id, user.id);
  if (!coach && mine.length === 0) return null;
  return { team, coach, watch: coach || mine.some((c) => c.can_watch), broadcast: coach || mine.some((c) => c.can_broadcast), save: !!team.save_streams };
}
/** Ends a stream. Its pieces are kept only when asked, and only for a team that may keep video. */
function end(s, keep) {
  const team = get('SELECT save_streams FROM teams WHERE id=?', s.team_id);
  const saved = keep && !!team?.save_streams && s.segments > 0;
  run("UPDATE streams SET status='ended', saved=?, ended_at=? WHERE id=?", saved ? 1 : 0, nowIso(), s.id);
  if (!saved) {
    removeFiles(s.id);
    run('DELETE FROM streams WHERE id=?', s.id);
    sweepSoon();
  }
}
/** Streams whose camera went away without saying so are ended, keeping nothing. */
function sweep(teamId) {
  for (const s of all("SELECT * FROM streams WHERE team_id=? AND status='live'", teamId)) if (Date.now() - new Date(s.last_at).getTime() > STALE_MS) end(s, false);
}
export const streamOut = (s) => ({
  id: s.id, team_id: s.team_id, plan_id: s.plan_id, title: s.title, transport: s.transport, mime: s.mime, status: s.status, saved: !!s.saved,
  segments: s.segments, segment_seconds: SEGMENT_SECONDS, seconds: s.seconds, bytes: s.bytes, started_at: s.started_at, ended_at: s.ended_at,
  // How the app gets the pieces to play: from this server, or by asking it for links to where they are kept.
  watch: s.transport === 'r2' ? 'links' : 'server',
  layout: s.layout === 'joined' ? 'joined' : 'separate',
  inits: initsOf(s),
  has_poster: !!s.poster,
  by: get('SELECT name FROM users WHERE id=?', s.user_id)?.name || '',
  // The game it is video of, when it belongs to one.
  game: s.plan_id ? get('SELECT id, title, date FROM plans WHERE id=?', s.plan_id) || null : null,
});
/** What a game is called on its video: its title, or who it is against. */
const gameName = (plan) => {
  let opponent = '';
  try {
    opponent = JSON.parse(plan.game_json || '{}').opponent || '';
  } catch {
    /* no opponent written down */
  }
  return plan.title || (opponent ? `vs. ${opponent}` : 'Game');
};
const tellTeam = (team, except) => poke([...coachesOfTeam(team), ...followersOfTeam(team)].map((p) => p.id).filter((id) => id !== except));

/** Whether a team has video going out right now that this kind of follower may watch. */
export function liveNow(teamId) {
  sweep(teamId);
  return !!get("SELECT 1 AS ok FROM streams WHERE team_id=? AND status='live' AND segments>0", teamId);
}

export function mountStreams(app) {
  // Anything left in R2 by a stream that went away while the server was down is found now.
  sweepSoon();
  // What a person sees of a team's video: what is live, what was saved, and what they may do.
  app.get('/api/streams', (req, res) => {
    const role = videoRole(req.user, req.query.team_id);
    if (!role) return res.status(404).json({ error: 'Not found' });
    sweep(role.team.id);
    res.json({
      can: { watch: role.watch, broadcast: role.broadcast, save: role.save && role.broadcast, coach: role.coach },
      live: role.watch ? all("SELECT * FROM streams WHERE team_id=? AND status='live' ORDER BY id DESC", role.team.id).map(streamOut) : [],
      // Saved video is for the coaches.
      saved: role.coach ? all("SELECT * FROM streams WHERE team_id=? AND status='ended' AND saved=1 ORDER BY id DESC", role.team.id).map(streamOut) : [],
      // Room on this disk only matters while video is kept on it.
      free_bytes: role.coach && !r2Config() ? freeBytes() : undefined,
    });
  });
  app.post('/api/streams', (req, res) => {
    const role = videoRole(req.user, req.body.team_id);
    if (!role) return res.status(404).json({ error: 'Not found' });
    if (!role.broadcast) return res.status(403).json({ error: 'You have not been given permission to broadcast for this team. Ask one of its coaches.' });
    const cfg = r2Config();
    if (!cfg && freeBytes() < KEEP_FREE_BYTES) return res.status(507).json({ error: 'The site is out of room for video right now. Tell the administrator.' });
    // One camera per person: starting again ends what they had going.
    for (const s of all("SELECT * FROM streams WHERE user_id=? AND status='live'", req.user.id)) end(s, false);
    const mime = /^video\/(mp4|webm)/.test(String(req.body.mime)) ? str(req.body.mime, 80) : 'video/webm';
    // Video belongs to a game: the one it was started from, or failing that the team's game on the day (the broadcaster's own date, since the server's clock may be a day off theirs).
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date)) ? req.body.date : nowIso().slice(0, 10);
    const plan =
      (req.body.plan_id && get('SELECT * FROM plans WHERE id=? AND team_id=? AND is_game=1', Number(req.body.plan_id), role.team.id)) ||
      get("SELECT * FROM plans WHERE team_id=? AND is_game=1 AND is_template=0 AND date=? ORDER BY start_time, id LIMIT 1", role.team.id, day) ||
      null;
    // Kept in R2 when it is set up, under a folder nobody could guess, and on this disk when it is not.
    const prefix = cfg ? `video/${crypto.randomBytes(12).toString('hex')}/` : null;
    // One unbroken recording, when the broadcaster's browser found it can make one. Only MP4 can be cut that way.
    const layout = req.body.layout === 'joined' && mime.startsWith('video/mp4') ? 'joined' : 'separate';
    // Who to tell: everyone unless the broadcaster said which groups, which may be none.
    const tell = Array.isArray(req.body.tell) ? TELL.filter((g) => req.body.tell.includes(g)) : TELL;
    const made = run(
      'INSERT INTO streams (team_id, plan_id, user_id, title, transport, store_key, mime, layout, tell, started_at, last_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      role.team.id, plan?.id ?? null, req.user.id, str(req.body.title, 120).trim() || (plan ? gameName(plan) : ''), cfg ? 'r2' : 'segments', prefix, mime, layout, tell.join(','), nowIso(), nowIso(),
    );
    if (cfg) run('INSERT INTO stream_objects (prefix, ext, issued_at) VALUES (?,?,?)', prefix, extOf(mime), nowIso());
    else fs.mkdirSync(dirOf(made.lastInsertRowid), { recursive: true });
    // `send` is how the app gets its pieces out: to this server, or by links it asks for.
    res.json({ stream: streamOut(get('SELECT * FROM streams WHERE id=?', made.lastInsertRowid)), can_save: role.save, send: cfg ? 'links' : 'server' });
  });
  // Every saved video of the teams being worked on, for Resources. A coach's page, so it goes by the workspace.
  app.get('/api/streams/saved', (req, res) => {
    if (req.user.follower) return res.json([]);
    const teams = req.staff ? [req.staff.teamId] : all('SELECT id FROM teams WHERE owner_id=?', req.ownerId).map((t) => t.id);
    res.json(teams.flatMap((id) => all("SELECT * FROM streams WHERE team_id=? AND status='ended' AND saved=1 ORDER BY id DESC", id)).map(streamOut));
  });
  const own = (req, res) => {
    const s = get("SELECT * FROM streams WHERE id=? AND user_id=? AND status='live'", Number(req.params.id), req.user.id);
    if (!s) res.status(404).json({ error: 'This broadcast has ended.' });
    return s;
  };
  /** A piece of `bytes` bytes has arrived for a stream, wherever it is kept. */
  const arrived = (s, bytes, req) => {
    run('UPDATE streams SET segments=segments+1, bytes=bytes+?, seconds=seconds+?, last_at=? WHERE id=?', bytes, SEGMENT_SECONDS, nowIso(), s.id);
    tally(s.team_id, { seconds: SEGMENT_SECONDS, bytes });
    // The first piece is the moment there is something to watch: everyone who may watch is told, on their devices too.
    if (s.segments === 0) {
      const team = get('SELECT * FROM teams WHERE id=?', s.team_id);
      tellTeam(team, req.user.id);
      // The groups the broadcaster chose get a message, and a notification on their devices. Only people who may watch are told.
      const groups = new Set(String(s.tell ?? TELL.join(',')).split(',').filter(Boolean));
      const coaches = coachesOfTeam(team).map((p) => p.id);
      const watchers = all('SELECT user_id, kind FROM team_contacts WHERE team_id=? AND user_id IS NOT NULL AND can_watch=1', team.id).filter((c) => groups.has(GROUP_OF[c.kind] || 'friends') && !coaches.includes(c.user_id));
      const what = { kind: 'live', ref: String(s.id), title: `${team.name} is live`, body: `${s.title || 'A game'} is being broadcast now. Tap to watch.` };
      if (groups.has('coaches')) for (const id of coaches) if (id !== req.user.id) notify(id, { ...what, link: s.plan_id ? `/go/plan/${team.id}/${s.plan_id}?view=video` : '/' });
      for (const id of new Set(watchers.map((c) => c.user_id))) if (id !== req.user.id) notify(id, { ...what, link: `/family/${slugOf(team)}?tab=video` });
    }
  };
  // One piece of video, as the bytes of a small file, for a stream kept on this disk.
  app.post('/api/streams/:id/segments', express.raw({ type: () => true, limit: MAX_SEGMENT_BYTES }), (req, res) => {
    const s = own(req, res);
    if (!s) return;
    if (s.transport !== 'segments') return res.status(400).json({ error: 'This broadcast does not send its video here.' });
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    if (!body || body.length === 0) return res.status(400).json({ error: 'Nothing was sent.' });
    if (s.seconds >= MAX_STREAM_SECONDS) return res.status(400).json({ error: 'This broadcast has reached the longest it can run.' });
    if (freeBytes() < KEEP_FREE_BYTES) return res.status(507).json({ error: 'The site is out of room for video.' });
    fs.mkdirSync(dirOf(s.id), { recursive: true });
    // The opening part of a joined video comes first, once.
    if (req.query.init) {
      if (s.layout !== 'joined' || body.length > MAX_INIT_BYTES) return res.status(400).json({ error: 'This broadcast has no opening part to send.' });
      const k = nextInit(s);
      fs.writeFileSync(fileOf(s, initName(k)), body);
      gotInit(s, k, body.length);
      return res.json({ segments: s.segments });
    }
    if (s.layout === 'joined' && !s.init_bytes) return res.status(400).json({ error: 'The opening part of the video has not arrived.' });
    fs.writeFileSync(fileOf(s, s.segments), body);
    arrived(s, body.length, req);
    res.json({ segments: s.segments + 1 });
  });

  // --- A stream kept in R2: the browser sends each piece straight there, by a link from here ---
  /** The broadcaster's own live stream when it is kept in R2, with where its pieces go. */
  const ownInStore = (req, res) => {
    const s = own(req, res);
    if (!s) return null;
    const cfg = r2Config();
    const objects = objectsOf(s);
    if (s.transport !== 'r2' || !objects) return void res.status(400).json({ error: 'This broadcast sends its video to the site itself.' });
    if (!cfg) return void res.status(503).json({ error: 'The video store is not set up right now. Tell the administrator.' });
    return { s, cfg, objects };
  };
  // Links to send the next few pieces, each good for one piece and for a few minutes.
  app.post('/api/streams/:id/links', (req, res) => {
    const at = ownInStore(req, res);
    if (!at) return;
    const { s, cfg, objects } = at;
    const most = Math.floor(MAX_STREAM_SECONDS / SEGMENT_SECONDS);
    if (s.segments >= most) return res.status(400).json({ error: 'This broadcast has reached the longest it can run.' });
    const upto = Math.min(most, s.segments + SEND_LINKS);
    const links = [];
    for (let n = s.segments; n < upto; n++) links.push({ n, url: linkTo(cfg, 'PUT', keyOf(objects, n), SEND_LINK_SECONDS) });
    run('UPDATE stream_objects SET issued=MAX(issued, ?), issued_at=? WHERE id=?', upto, nowIso(), objects.id);
    // A joined video's opening part is wanted first, until it has arrived, and again whenever the broadcaster says there is a new one.
    const k = nextInit(s);
    const init = s.layout === 'joined' && (!s.init_bytes || req.body?.init) ? linkTo(cfg, 'PUT', keyOf(objects, initName(k)), SEND_LINK_SECONDS) : undefined;
    if (init) run('UPDATE stream_objects SET inits=MAX(COALESCE(inits, 1), ?) WHERE id=?', k + 1, objects.id);
    res.json({ links, init, type: s.mime.split(';')[0], max_bytes: MAX_SEGMENT_BYTES });
  });
  // The browser says a piece is in R2. It is looked for there, and measured, before it counts.
  app.post('/api/streams/:id/pieces', async (req, res) => {
    const at = ownInStore(req, res);
    if (!at) return;
    const { s, cfg, objects } = at;
    // The opening part of a joined video: looked for and measured like a piece, and kept small.
    if (req.body?.n === 'init') {
      if (s.layout !== 'joined') return res.status(400).json({ error: 'This broadcast has no opening part to send.' });
      const k = nextInit(s);
      let size;
      try {
        size = await sizeOf(cfg, keyOf(objects, initName(k)));
      } catch {
        return res.status(502).json({ error: 'The video store could not be reached.' });
      }
      if (!size) return res.status(400).json({ error: 'That piece has not arrived.' });
      if (size > MAX_INIT_BYTES) {
        await remove(cfg, keyOf(objects, initName(k)));
        return res.status(413).json({ error: 'That piece of video is too large.' });
      }
      gotInit(s, k, size);
      return res.json({ segments: s.segments });
    }
    if (s.layout === 'joined' && !s.init_bytes) return res.status(400).json({ error: 'The opening part of the video has not arrived.' });
    const n = Number(req.body?.n);
    // Said twice, because the first answer was lost on the way back: it is already counted.
    if (n === s.segments - 1) return res.json({ segments: s.segments });
    if (n !== s.segments) return res.status(409).json({ error: 'That piece is out of turn.', segments: s.segments });
    if (s.seconds >= MAX_STREAM_SECONDS) return res.status(400).json({ error: 'This broadcast has reached the longest it can run.' });
    let bytes;
    try {
      bytes = await sizeOf(cfg, keyOf(objects, n));
    } catch {
      return res.status(502).json({ error: 'The video store could not be reached.' });
    }
    if (!bytes) return res.status(400).json({ error: 'That piece has not arrived.' });
    if (bytes > MAX_SEGMENT_BYTES) {
      await remove(cfg, keyOf(objects, n));
      return res.status(413).json({ error: 'That piece of video is too large.' });
    }
    // The stream may have ended, or moved on, while R2 was being asked.
    const now = get("SELECT * FROM streams WHERE id=? AND status='live'", s.id);
    if (!now) return res.status(404).json({ error: 'This broadcast has ended.' });
    if (now.segments !== n) return res.json({ segments: now.segments });
    arrived(now, bytes, req);
    res.json({ segments: n + 1 });
  });
  // A picture from the broadcaster's camera, small, to show the video by afterwards.
  app.post('/api/streams/:id/poster', express.raw({ type: () => true, limit: 200 * 1024 }), (req, res) => {
    const s = own(req, res);
    if (!s) return;
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    // Only a JPEG is taken, told by how its bytes begin and not by what the sender calls it.
    if (!body || body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) return res.status(400).json({ error: 'That is not a picture.' });
    run('UPDATE streams SET poster=? WHERE id=?', body, s.id);
    res.json({ ok: true });
  });
  app.post('/api/streams/:id/end', (req, res) => {
    const s = own(req, res);
    if (!s) return;
    end(s, req.body?.keep === true);
    tellTeam(get('SELECT * FROM teams WHERE id=?', s.team_id), req.user.id);
    res.json({ ok: true, saved: !!get('SELECT saved FROM streams WHERE id=?', s.id)?.saved });
  });
  /** A stream this person may watch: live for anyone allowed to watch, saved for the coaches. */
  const watchable = (req, res) => {
    const s = get('SELECT * FROM streams WHERE id=?', Number(req.params.id));
    const role = s && videoRole(req.user, s.team_id);
    if (!s || !role || !(s.status === 'live' ? role.watch : role.coach)) {
      res.status(404).json({ error: 'This video is not available.' });
      return null;
    }
    return s;
  };
  app.get('/api/streams/:id', (req, res) => {
    const s = watchable(req, res);
    if (s) res.json(streamOut(s));
  });
  app.get('/api/streams/:id/poster', (req, res) => {
    const s = watchable(req, res);
    if (!s) return;
    if (!s.poster) return res.status(404).end();
    res.set({ 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' }).type('image/jpeg').send(Buffer.from(s.poster));
  });
  // Links to watch the next few pieces of a stream kept in R2. Asked for again and again as the
  // video plays, and each time the person has to be allowed to watch.
  app.get('/api/streams/:id/links', (req, res) => {
    const s = watchable(req, res);
    if (!s) return;
    const cfg = r2Config();
    const objects = objectsOf(s);
    if (s.transport !== 'r2' || !objects) return res.status(400).json({ error: 'This video is played from the site itself.' });
    if (!cfg) return res.status(503).json({ error: 'The video store is not set up right now. Tell the administrator.' });
    const from = Math.max(0, Math.floor(Number(req.query.from)) || 0);
    const links = [];
    for (let n = from; n < Math.min(s.segments, from + WATCH_LINKS); n++) links.push({ n, url: linkTo(cfg, 'GET', keyOf(objects, n), WATCH_LINK_SECONDS) });
    watched(s, links.length);
    const inits = initsOf(s).map((from, k) => ({ k, from, url: linkTo(cfg, 'GET', keyOf(objects, initName(k)), WATCH_LINK_SECONDS) }));
    res.set('Cache-Control', 'no-store').json({ links, inits, type: s.mime.split(';')[0], good_for: WATCH_LINK_SECONDS });
  });
  app.get('/api/streams/:id/segments/:n', (req, res) => {
    const s = watchable(req, res);
    if (!s) return;
    // A joined video's opening parts are asked for by name: init, init1, init2.
    const part = /^init(\d*)$/.exec(req.params.n);
    const n = part && Number(part[1] || 0) < initsOf(s).length ? initName(Number(part[1] || 0)) : Number(req.params.n);
    if (s.transport !== 'segments' || (typeof n === 'number' && (!Number.isInteger(n) || n < 0 || n >= s.segments))) return res.status(404).end();
    if (typeof n === 'number') watched(s, 1);
    // Kept by the browser, but asked about every time, so someone who may no longer watch is refused even on a shared device.
    res.set({ 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' }).type(s.mime.split(';')[0]).sendFile(fileOf(s, n), (err) => err && !res.headersSent && res.status(404).end());
  });
  // A coach removes a saved video, which gives its room back.
  app.delete('/api/streams/:id', (req, res) => {
    const s = get('SELECT * FROM streams WHERE id=?', Number(req.params.id));
    const role = s && videoRole(req.user, s.team_id);
    if (!s || !role?.coach) return res.status(404).json({ error: 'Not found' });
    removeFiles(s.id);
    run('DELETE FROM streams WHERE id=?', s.id);
    sweepSoon();
    res.json({ ok: true });
  });

  // --- Who around a team may watch and broadcast: its coaches decide, person by person ---
  const peopleOf = (team) =>
    all('SELECT id, name, email, kind, user_id, can_watch, can_broadcast FROM team_contacts WHERE team_id=? ORDER BY name COLLATE NOCASE, id', team.id).map((c) => ({
      id: c.id, name: c.name || 'No name yet', kind: c.kind, joined: !!c.user_id, watch: !!c.can_watch, broadcast: !!c.can_broadcast,
    }));
  const coachTeam = (req, res) => {
    const role = videoRole(req.user, req.params.id);
    if (!role?.coach) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    return role.team;
  };
  app.get('/api/streams/teams/:id/people', (req, res) => {
    const team = coachTeam(req, res);
    if (team) res.json({ save: !!team.save_streams, people: peopleOf(team) });
  });
  app.put('/api/streams/teams/:id/people/:contactId', (req, res) => {
    const team = coachTeam(req, res);
    if (!team) return;
    const c = get('SELECT * FROM team_contacts WHERE id=? AND team_id=?', Number(req.params.contactId), team.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    run('UPDATE team_contacts SET can_watch=?, can_broadcast=? WHERE id=?', (typeof req.body.watch === 'boolean' ? req.body.watch : !!c.can_watch) ? 1 : 0, (typeof req.body.broadcast === 'boolean' ? req.body.broadcast : !!c.can_broadcast) ? 1 : 0, c.id);
    res.json({ save: !!team.save_streams, people: peopleOf(team) });
  });

  // --- The system administrator: which teams may keep video ---
  const systemOnly = (req, res, next) => (isSystemAdmin(req.user) ? next() : res.status(403).json({ error: 'Only the system administrator can do this.' }));
  const teamsOut = () =>
    all(
      `SELECT t.id, t.name, t.save_streams, t.stat_import, t.shot_efficiency_chart,
              COALESCE((SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=t.owner_id AND m.role='owner' ORDER BY u.id LIMIT 1), '') AS owner,
              (SELECT COUNT(*) FROM streams s WHERE s.team_id=t.id AND s.saved=1) AS videos,
              (SELECT COALESCE(SUM(bytes),0) FROM streams s WHERE s.team_id=t.id AND s.saved=1) AS bytes
         FROM teams t ORDER BY t.name COLLATE NOCASE`,
    ).map((t) => ({ id: t.id, name: t.name, owner: t.owner, save: !!t.save_streams, stats: !!t.stat_import, shots: !!t.shot_efficiency_chart, videos: t.videos, bytes: t.bytes }));
  app.get('/api/streams/admin/teams', systemOnly, (req, res) => res.json(teamsOut()));
  app.put('/api/streams/admin/teams/:id', systemOnly, (req, res) => {
    if (typeof req.body.save === 'boolean') run('UPDATE teams SET save_streams=? WHERE id=?', req.body.save ? 1 : 0, Number(req.params.id));
    if (typeof req.body.stats === 'boolean') run('UPDATE teams SET stat_import=? WHERE id=?', req.body.stats ? 1 : 0, Number(req.params.id));
    if (typeof req.body.shots === 'boolean') run('UPDATE teams SET shot_efficiency_chart=? WHERE id=?', req.body.shots ? 1 : 0, Number(req.params.id));
    res.json(teamsOut());
  });
}
