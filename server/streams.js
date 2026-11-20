// Live video of a game, from one person's camera to the people around the team.
//
// How it travels is kept apart from everything else, so it can be swapped. Today there is one way,
// 'segments': the broadcaster's browser records a few seconds at a time, each piece a small video
// file of its own, and sends them here; a viewer plays them one after another, some seconds behind.
// It needs no outside service. A stream that goes through a video service later would be another
// `transport` with its own address to play from, and nothing else here would change.
//
// A stream is thrown away when it ends, unless its team is allowed to keep video (set by the
// system administrator, team by team) and the broadcaster asked to save it. A saved one is for
// the team's coaches.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { all, db, dbPath, get, run } from './db.js';
import { poke } from './live.js';
import { isSystemAdmin } from './auth.js';
import { coachesOfTeam, followersOfTeam } from './inbox.js';
// The list of a team's parents, family and friends is made there, and has to exist before columns are added to it.
import './contacts.js';

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

const ROOT = path.join(path.dirname(dbPath), 'streams');
/** How long each piece runs. Shorter is nearer to live and more requests; longer is the reverse. */
export const SEGMENT_SECONDS = 4;
const MAX_SEGMENT_BYTES = 12 * 1024 * 1024;
const MAX_STREAM_SECONDS = 3 * 60 * 60;
/** Nothing new is taken once the disk has less than this left. */
const KEEP_FREE_BYTES = 80 * 1024 * 1024;
/** A live stream that has sent nothing for this long has stopped, whatever it meant to do. */
const STALE_MS = 90_000;
const str = (v, max) => String(v ?? '').slice(0, max);
const nowIso = () => new Date().toISOString();
const dirOf = (id) => path.join(ROOT, String(id));
const extOf = (mime) => (String(mime).startsWith('video/mp4') ? 'mp4' : 'webm');
const fileOf = (s, n) => path.join(dirOf(s.id), `${n}.${extOf(s.mime)}`);
const removeFiles = (id) => fs.rmSync(dirOf(id), { recursive: true, force: true });
function freeBytes() {
  try {
    const st = fs.statfsSync(path.dirname(dbPath));
    return st.bavail * st.bsize;
  } catch {
    return Infinity;
  }
}

/** What someone may do with a team's video: null when they have nothing to do with the team. */
function roleOn(user, teamId) {
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
  }
}
/** Streams whose camera went away without saying so are ended, keeping nothing. */
function sweep(teamId) {
  for (const s of all("SELECT * FROM streams WHERE team_id=? AND status='live'", teamId)) if (Date.now() - new Date(s.last_at).getTime() > STALE_MS) end(s, false);
}
const out = (s) => ({
  id: s.id, team_id: s.team_id, plan_id: s.plan_id, title: s.title, transport: s.transport, mime: s.mime, status: s.status, saved: !!s.saved,
  segments: s.segments, segment_seconds: SEGMENT_SECONDS, seconds: s.seconds, bytes: s.bytes, started_at: s.started_at, ended_at: s.ended_at,
  by: get('SELECT name FROM users WHERE id=?', s.user_id)?.name || '',
});
const tellTeam = (team, except) => poke([...coachesOfTeam(team), ...followersOfTeam(team)].map((p) => p.id).filter((id) => id !== except));

/** Whether a team has video going out right now that this kind of follower may watch. */
export function liveNow(teamId) {
  sweep(teamId);
  return !!get("SELECT 1 AS ok FROM streams WHERE team_id=? AND status='live' AND segments>0", teamId);
}

export function mountStreams(app) {
  // What a person sees of a team's video: what is live, what was saved, and what they may do.
  app.get('/api/streams', (req, res) => {
    const role = roleOn(req.user, req.query.team_id);
    if (!role) return res.status(404).json({ error: 'Not found' });
    sweep(role.team.id);
    res.json({
      can: { watch: role.watch, broadcast: role.broadcast, save: role.save && role.broadcast, coach: role.coach },
      live: role.watch ? all("SELECT * FROM streams WHERE team_id=? AND status='live' ORDER BY id DESC", role.team.id).map(out) : [],
      // Saved video is for the coaches.
      saved: role.coach ? all("SELECT * FROM streams WHERE team_id=? AND status='ended' AND saved=1 ORDER BY id DESC", role.team.id).map(out) : [],
      free_bytes: role.coach ? freeBytes() : undefined,
    });
  });
  app.post('/api/streams', (req, res) => {
    const role = roleOn(req.user, req.body.team_id);
    if (!role) return res.status(404).json({ error: 'Not found' });
    if (!role.broadcast) return res.status(403).json({ error: 'You have not been given permission to broadcast for this team. Ask one of its coaches.' });
    if (freeBytes() < KEEP_FREE_BYTES) return res.status(507).json({ error: 'The site is out of room for video right now. Tell the administrator.' });
    // One camera per person: starting again ends what they had going.
    for (const s of all("SELECT * FROM streams WHERE user_id=? AND status='live'", req.user.id)) end(s, false);
    const mime = /^video\/(mp4|webm)/.test(String(req.body.mime)) ? str(req.body.mime, 80) : 'video/webm';
    const plan = req.body.plan_id ? get('SELECT id FROM plans WHERE id=? AND team_id=?', Number(req.body.plan_id), role.team.id) : null;
    const made = run('INSERT INTO streams (team_id, plan_id, user_id, title, mime, started_at, last_at) VALUES (?,?,?,?,?,?,?)', role.team.id, plan?.id ?? null, req.user.id, str(req.body.title, 120).trim(), mime, nowIso(), nowIso());
    fs.mkdirSync(dirOf(made.lastInsertRowid), { recursive: true });
    res.json({ stream: out(get('SELECT * FROM streams WHERE id=?', made.lastInsertRowid)), can_save: role.save });
  });
  const own = (req, res) => {
    const s = get("SELECT * FROM streams WHERE id=? AND user_id=? AND status='live'", Number(req.params.id), req.user.id);
    if (!s) res.status(404).json({ error: 'This broadcast has ended.' });
    return s;
  };
  // One piece of video, as the bytes of a small file.
  app.post('/api/streams/:id/segments', express.raw({ type: () => true, limit: MAX_SEGMENT_BYTES }), (req, res) => {
    const s = own(req, res);
    if (!s) return;
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    if (!body || body.length === 0) return res.status(400).json({ error: 'Nothing was sent.' });
    if (s.seconds >= MAX_STREAM_SECONDS) return res.status(400).json({ error: 'This broadcast has reached the longest it can run.' });
    if (freeBytes() < KEEP_FREE_BYTES) return res.status(507).json({ error: 'The site is out of room for video.' });
    fs.mkdirSync(dirOf(s.id), { recursive: true });
    fs.writeFileSync(fileOf(s, s.segments), body);
    run('UPDATE streams SET segments=segments+1, bytes=bytes+?, seconds=seconds+?, last_at=? WHERE id=?', body.length, SEGMENT_SECONDS, nowIso(), s.id);
    // The first piece is the moment there is something to watch.
    if (s.segments === 0) tellTeam(get('SELECT * FROM teams WHERE id=?', s.team_id), req.user.id);
    res.json({ segments: s.segments + 1 });
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
    const role = s && roleOn(req.user, s.team_id);
    if (!s || !role || !(s.status === 'live' ? role.watch : role.coach)) {
      res.status(404).json({ error: 'This video is not available.' });
      return null;
    }
    return s;
  };
  app.get('/api/streams/:id', (req, res) => {
    const s = watchable(req, res);
    if (s) res.json(out(s));
  });
  app.get('/api/streams/:id/segments/:n', (req, res) => {
    const s = watchable(req, res);
    if (!s) return;
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 0 || n >= s.segments) return res.status(404).end();
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).type(s.mime.split(';')[0]).sendFile(fileOf(s, n), (err) => err && !res.headersSent && res.status(404).end());
  });
  // A coach removes a saved video, which gives its room back.
  app.delete('/api/streams/:id', (req, res) => {
    const s = get('SELECT * FROM streams WHERE id=?', Number(req.params.id));
    const role = s && roleOn(req.user, s.team_id);
    if (!s || !role?.coach) return res.status(404).json({ error: 'Not found' });
    removeFiles(s.id);
    run('DELETE FROM streams WHERE id=?', s.id);
    res.json({ ok: true });
  });

  // --- Who around a team may watch and broadcast: its coaches decide, person by person ---
  const peopleOf = (team) =>
    all('SELECT id, name, email, kind, user_id, can_watch, can_broadcast FROM team_contacts WHERE team_id=? ORDER BY name COLLATE NOCASE, id', team.id).map((c) => ({
      id: c.id, name: c.name || 'No name yet', kind: c.kind, joined: !!c.user_id, watch: !!c.can_watch, broadcast: !!c.can_broadcast,
    }));
  const coachTeam = (req, res) => {
    const role = roleOn(req.user, req.params.id);
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
      `SELECT t.id, t.name, t.save_streams,
              COALESCE((SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=t.owner_id AND m.role='owner' ORDER BY u.id LIMIT 1), '') AS owner,
              (SELECT COUNT(*) FROM streams s WHERE s.team_id=t.id AND s.saved=1) AS videos,
              (SELECT COALESCE(SUM(bytes),0) FROM streams s WHERE s.team_id=t.id AND s.saved=1) AS bytes
         FROM teams t ORDER BY t.name COLLATE NOCASE`,
    ).map((t) => ({ id: t.id, name: t.name, owner: t.owner, save: !!t.save_streams, videos: t.videos, bytes: t.bytes }));
  app.get('/api/streams/admin/teams', systemOnly, (req, res) => res.json(teamsOut()));
  app.put('/api/streams/admin/teams/:id', systemOnly, (req, res) => {
    run('UPDATE teams SET save_streams=? WHERE id=?', req.body.save === true ? 1 : 0, Number(req.params.id));
    res.json(teamsOut());
  });
}
