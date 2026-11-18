// A team's page for the people around it: parents, family and friends who have an account.
//
// A coach decides, for each of the three kinds of follower, which parts of the team they see:
// the schedule, news from the coaches, the message board, homework, the plays and resources the
// coach picked out for them, and the roster. A follower sees a team only while they are on its
// list of parents, family and friends. Nothing here lets them change the team.
import fs from 'node:fs';
import path from 'node:path';
import { all, db, dbPath, get, run } from './db.js';
import { sharedOpening, withoutOpening } from './calendar.js';
import { planView, playView } from './communities.js';
import { resourceList } from './resources.js';

const uploadsDir = path.join(path.dirname(dbPath), 'uploads');
const addColumn = (table, column, ddl) => {
  if (!all(`PRAGMA table_info(${table})`).some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
};
addColumn('teams', 'family_json', "TEXT NOT NULL DEFAULT ''");
db.exec(`
CREATE TABLE IF NOT EXISTS team_posts (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER, author TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'coach',             -- 'coach' | 'parent' | 'family' | 'friend'
  kind TEXT NOT NULL DEFAULT 'board',             -- 'news' (from the coaches) | 'board' (anyone on the team's page)
  title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_posts ON team_posts(team_id, kind, id);
`);

export const FAMILY_KINDS = ['parent', 'family', 'friend'];
export const FAMILY_SECTIONS = ['schedule', 'news', 'board', 'homework', 'playbook', 'resources', 'roster'];
// A parent sees most things, family a little, and a friend the schedule, until a coach says otherwise.
const DEFAULTS = {
  parent: { schedule: true, news: true, board: true, homework: true, playbook: true, resources: true, roster: true },
  family: { schedule: true, news: true, board: false, homework: false, playbook: false, resources: true, roster: false },
  friend: { schedule: true, news: false, board: false, homework: false, playbook: false, resources: false, roster: false },
};
const str = (v, max = 200) => String(v ?? '').slice(0, max);
const parse = (s, fallback) => {
  try {
    return JSON.parse(s) ?? fallback;
  } catch {
    return fallback;
  }
};
const nowIso = () => new Date().toISOString();
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** What a team shows its followers: who sees which part, and the plays and resources picked out for them. */
function settingsOf(team) {
  const saved = parse(team.family_json, {}) || {};
  const access = {};
  for (const k of FAMILY_KINDS) access[k] = Object.fromEntries(FAMILY_SECTIONS.map((s) => [s, typeof saved.access?.[k]?.[s] === 'boolean' ? saved.access[k][s] : DEFAULTS[k][s]]));
  return {
    access,
    plays: (Array.isArray(saved.plays) ? saved.plays : []).map(Number).filter(Number.isInteger),
    resources: (Array.isArray(saved.resources) ? saved.resources : []).map((k) => str(k, 2100)),
  };
}
const sportOf = (team) => get('SELECT name FROM sports WHERE id=?', team.sport_id)?.name || '';
const postOut = (p, userId) => ({ id: p.id, kind: p.kind, title: p.title, body: p.body, author: p.author, role: p.role, at: p.created_at, mine: p.user_id === userId });
const postsOf = (teamId, kind, userId) => all('SELECT * FROM team_posts WHERE team_id=? AND kind=? ORDER BY id DESC LIMIT 200', teamId, kind).map((p) => postOut(p, userId));

// Each person may post only so often, so the board cannot be flooded.
const posted = new Map();
const POST_LIMIT = 30;
function tooManyPosts(userId) {
  const recent = (posted.get(userId) || []).filter((t) => Date.now() - t < 60 * 60_000);
  posted.set(userId, [...recent, Date.now()]);
  return recent.length >= POST_LIMIT;
}
function addPost(team, user, role, kind, b) {
  const body = str(b.body, 4000).trim();
  if (!body) return 'Write something first.';
  if (tooManyPosts(user.id)) return 'You have posted a lot in the last hour. Try again a little later.';
  run('INSERT INTO team_posts (team_id, user_id, author, role, kind, title, body, created_at) VALUES (?,?,?,?,?,?,?,?)', team.id, user.id, user.name, role, kind, kind === 'news' ? str(b.title, 120).trim() : '', body, nowIso());
  return '';
}

/** How many teams a person follows, for the menu. */
export const followingCount = (userId) => get('SELECT COUNT(DISTINCT team_id) AS n FROM team_contacts WHERE user_id=?', userId).n;

// --- For the followers ------------------------------------------------------------
/** The team and how this person is on its list, or null when they are not. */
function follow(userId, teamId) {
  const c = get('SELECT * FROM team_contacts WHERE user_id=? AND team_id=? ORDER BY id LIMIT 1', userId, Number(teamId));
  const team = c && get('SELECT * FROM teams WHERE id=?', c.team_id);
  if (!team) return null;
  const mine = new Set(parse(c.player_ids_json, []).map(Number));
  const players = all('SELECT id, name FROM players WHERE team_id=? AND active=1 ORDER BY name COLLATE NOCASE', team.id).filter((p) => mine.has(p.id));
  const kind = FAMILY_KINDS.includes(c.kind) ? c.kind : 'friend';
  return { team, kind, players, settings: settingsOf(team), can: settingsOf(team).access[kind] };
}
const coachesOf = (team) => {
  const staff = all('SELECT u.name, s.title FROM team_staff s JOIN users u ON u.id=s.user_id WHERE s.team_id=? ORDER BY u.name COLLATE NOCASE', team.id);
  // A team in a coach's own workspace is coached by whoever the workspace belongs to.
  const owners = team.community_id ? [] : all("SELECT u.name, 'Coach' AS title FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=? AND m.role='owner' AND u.status='active'", team.owner_id);
  return [...owners, ...staff].map((s) => ({ name: s.name, title: s.title || 'Coach' }));
};
/** The team's days: what is on its calendar, and the practices and games planned for days the calendar does not have. */
function scheduleOf(team) {
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const from = isoDay(since);
  const opening = sharedOpening(all("SELECT title FROM events WHERE team_id=? AND uid NOT LIKE 'league-%'", team.id).map((r) => r.title));
  const events = all('SELECT * FROM events WHERE team_id=? AND gone=0 AND date>=? ORDER BY date, start_time, id', team.id, from).map((ev) => ({
    key: `e${ev.id}`, kind: ev.kind, title: withoutOpening(ev.title, opening) || (ev.kind === 'game' ? 'Game' : ev.kind === 'practice' ? 'Practice' : 'Event'),
    date: ev.date, start_time: ev.start_time || '', end_time: ev.end_time || '', location: ev.location || '',
  }));
  const taken = new Set(events.map((e) => `${e.date} ${e.kind}`));
  const plans = all("SELECT id, title, date, start_time, location, is_game FROM plans WHERE team_id=? AND kind='practice' AND is_template=0 AND date>=?", team.id, from)
    .map((p) => ({ key: `p${p.id}`, kind: p.is_game ? 'game' : 'practice', title: p.title || (p.is_game ? 'Game' : 'Practice'), date: p.date, start_time: p.start_time || '', end_time: '', location: p.location || '' }))
    .filter((p) => !taken.has(`${p.date} ${p.kind}`));
  return [...events, ...plans].sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
}
/** Homework for the whole team, and for this person's own players. */
function homeworkOf(team, players) {
  const mine = new Map(players.map((p) => [p.id, p.name]));
  return all("SELECT * FROM plans WHERE team_id=? AND kind='homework' AND is_template=0 ORDER BY date DESC, id DESC LIMIT 60", team.id)
    .map((p) => {
      const to = parse(p.assigned_json, []).map(Number);
      const names = to.filter((id) => mine.has(id)).map((id) => mine.get(id));
      if (to.length && !names.length) return null;
      return { id: p.id, title: p.title || 'Homework', date: p.date || '', for: to.length ? names : [], content: planView(p) };
    })
    .filter(Boolean);
}
const sharedPlays = (team, settings) => settings.plays.map((id) => get('SELECT * FROM plays WHERE id=? AND owner_id=?', id, team.owner_id)).filter(Boolean).map(playView);
function sharedResources(team, settings) {
  if (!settings.resources.length) return [];
  const want = new Set(settings.resources);
  return resourceList(team.owner_id).filter((r) => want.has(r.key)).map((r) => ({ key: r.key, kind: r.kind, title: r.title, url: r.url, file_id: r.file_id }));
}

export function mountFamily(app) {
  app.get('/api/family/teams', (req, res) => {
    const rows = all('SELECT DISTINCT team_id FROM team_contacts WHERE user_id=?', req.user.id);
    res.json(
      rows
        .map((r) => follow(req.user.id, r.team_id))
        .filter(Boolean)
        .map((f) => ({ id: f.team.id, name: f.team.name, sport: sportOf(f.team), season: f.team.season || '', kind: f.kind, players: f.players.map((p) => p.name) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  });
  const enter = (req, res) => {
    const f = follow(req.user.id, req.params.id);
    if (!f) res.status(404).json({ error: 'You are not on this team’s list of parents, family and friends. Ask its coach to add you.' });
    return f;
  };
  app.get('/api/family/teams/:id', (req, res) => {
    const f = enter(req, res);
    if (!f) return;
    const { team, can, settings } = f;
    res.json({
      team: { id: team.id, name: team.name, sport: sportOf(team), season: team.season || '', organization: team.community_id ? get('SELECT name FROM communities WHERE id=?', team.community_id)?.name || '' : '', coaches: coachesOf(team) },
      me: { kind: f.kind, players: f.players.map((p) => p.name) },
      can,
      schedule: can.schedule ? scheduleOf(team) : [],
      news: can.news ? postsOf(team.id, 'news', req.user.id) : [],
      board: can.board ? postsOf(team.id, 'board', req.user.id) : [],
      homework: can.homework ? homeworkOf(team, f.players) : [],
      plays: can.playbook ? sharedPlays(team, settings) : [],
      resources: can.resources ? sharedResources(team, settings) : [],
      // Names and numbers only: nothing about a player's family, and none of the coach's notes.
      roster: can.roster ? all('SELECT name, number, position FROM players WHERE team_id=? AND active=1 ORDER BY name COLLATE NOCASE', team.id) : [],
    });
  });
  app.post('/api/family/teams/:id/board', (req, res) => {
    const f = enter(req, res);
    if (!f) return;
    if (!f.can.board) return res.status(403).json({ error: 'The message board is not open to you on this team.' });
    const problem = addPost(f.team, req.user, f.kind, 'board', req.body);
    if (problem) return res.status(400).json({ error: problem });
    res.json(postsOf(f.team.id, 'board', req.user.id));
  });
  app.delete('/api/family/teams/:id/board/:postId', (req, res) => {
    const f = enter(req, res);
    if (!f) return;
    run("DELETE FROM team_posts WHERE id=? AND team_id=? AND user_id=? AND kind='board'", Number(req.params.postId), f.team.id, req.user.id);
    res.json(postsOf(f.team.id, 'board', req.user.id));
  });
  // A picture or video the coach shared with the team's followers. Files are private otherwise.
  app.get('/api/family/teams/:id/files/:fileId', (req, res) => {
    const f = enter(req, res);
    if (!f) return;
    const fileId = Number(req.params.fileId);
    const shared = f.can.resources && sharedResources(f.team, f.settings).some((r) => r.file_id === fileId);
    const file = shared && get('SELECT filename, mime FROM images WHERE id=? AND owner_id=?', fileId, f.team.owner_id);
    const name = file && path.basename(file.filename);
    if (!name || !fs.existsSync(path.join(uploadsDir, name))) return res.status(404).json({ error: 'Not found' });
    res.sendFile(name, { root: uploadsDir, headers: { 'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' } });
  });
}

// --- For the coaches --------------------------------------------------------------
export function mountFamilyCoach(app) {
  const enter = (req, res) => {
    const team = get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(req.params.id), req.ownerId);
    if (!team) res.status(404).json({ error: 'Not found' });
    return team;
  };
  const out = (req, team0) => {
    const team = get('SELECT * FROM teams WHERE id=?', team0.id);
    const s = settingsOf(team);
    const plays = all('SELECT id, name, category FROM plays WHERE owner_id=? AND sport_id=? ORDER BY name COLLATE NOCASE, id', team.owner_id, team.sport_id);
    const resources = resourceList(team.owner_id).map((r) => ({ key: r.key, kind: r.kind, title: r.title, url: r.url }));
    return {
      access: s.access,
      // Only what still exists counts as shared.
      plays: s.plays.filter((id) => plays.some((p) => p.id === id)),
      resources: s.resources.filter((k) => resources.some((r) => r.key === k)),
      all_plays: plays,
      all_resources: resources,
      // How many people of each kind have made an account, and so can open the team's page.
      joined: Object.fromEntries(FAMILY_KINDS.map((k) => [k, get('SELECT COUNT(*) AS n FROM team_contacts WHERE team_id=? AND kind=? AND user_id IS NOT NULL', team.id, k).n])),
      news: postsOf(team.id, 'news', req.user.id),
      board: postsOf(team.id, 'board', req.user.id),
    };
  };
  app.get('/api/teams/:id/family', (req, res) => {
    const team = enter(req, res);
    if (team) res.json(out(req, team));
  });
  app.put('/api/teams/:id/family', (req, res) => {
    const team = enter(req, res);
    if (!team) return;
    const s = settingsOf(team);
    const b = req.body || {};
    if (b.access && typeof b.access === 'object')
      for (const k of FAMILY_KINDS) for (const sec of FAMILY_SECTIONS) if (typeof b.access[k]?.[sec] === 'boolean') s.access[k][sec] = b.access[k][sec];
    if (Array.isArray(b.plays)) s.plays = [...new Set(b.plays.map(Number))].filter((id) => get('SELECT 1 AS ok FROM plays WHERE id=? AND owner_id=?', id, team.owner_id)).slice(0, 500);
    if (Array.isArray(b.resources)) s.resources = [...new Set(b.resources.map((k) => str(k, 2100)))].slice(0, 500);
    run('UPDATE teams SET family_json=? WHERE id=?', JSON.stringify(s), team.id);
    res.json(out(req, team));
  });
  app.post('/api/teams/:id/family/posts', (req, res) => {
    const team = enter(req, res);
    if (!team) return;
    const problem = addPost(team, req.user, 'coach', req.body.kind === 'news' ? 'news' : 'board', req.body);
    if (problem) return res.status(400).json({ error: problem });
    res.json(out(req, team));
  });
  // A coach can take down anything on the team's page.
  app.delete('/api/teams/:id/family/posts/:postId', (req, res) => {
    const team = enter(req, res);
    if (!team) return;
    run('DELETE FROM team_posts WHERE id=? AND team_id=?', Number(req.params.postId), team.id);
    res.json(out(req, team));
  });
}
