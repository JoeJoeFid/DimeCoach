// A team's page for the people around it: parents, family and friends who have an account.
//
// A coach decides, for each of the three kinds of follower, which parts of the team they see:
// the schedule, news from the coaches, the message board, homework, the plays and resources the
// coach picked out for them, and the roster. A follower sees a team only while they are on its
// list of parents, family and friends. Nothing here lets them change the team.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, db, dbPath, get, run } from './db.js';
import { sharedOpening, withoutOpening } from './calendar.js';
import { drillView, planView, playView } from './communities.js';
import { resourceList } from './resources.js';
import { coachesOfTeam, deliver, followersOfTeam } from './inbox.js';
import { mention, mentionedIn } from './notices.js';
import { publicBase } from './invites.js';
import { scoreOfPlan } from './games.js';
import { liveNow } from './streams.js';
import { livePlays } from './liveFeed.js';

const uploadsDir = path.join(path.dirname(dbPath), 'uploads');
const addColumn = (table, column, ddl) => {
  if (!all(`PRAGMA table_info(${table})`).some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
};
addColumn('teams', 'family_json', "TEXT NOT NULL DEFAULT ''");
// A few random letters that stand for the team in the address of its page, so the address gives away nothing about how many teams there are.
addColumn('teams', 'family_code', "TEXT NOT NULL DEFAULT ''");
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
// Who an announcement went out to: 'coach', 'parent', 'family', 'friend', with commas between. Empty for one from before this was asked.
addColumn('team_posts', 'audience', "TEXT NOT NULL DEFAULT ''");

export const FAMILY_KINDS = ['parent', 'family', 'friend'];
// 'games' and 'practices' say how much of the schedule is told: when and where games are, and what a practice covers.
// 'film' is the Filmroom: the game videos, clips and cuts a coach has put on the team's page.
// 'live' is watching a game's live video, and 'broadcast' sending it; 'pbp' is following a game play by play while it is scored.
export const FAMILY_SECTIONS = ['schedule', 'games', 'practices', 'live', 'broadcast', 'pbp', 'news', 'board', 'homework', 'playbook', 'drills', 'resources', 'film', 'roster'];
// A parent sees most things, family a little, and a friend the schedule, until a coach says otherwise.
const DEFAULTS = {
  parent: { schedule: true, games: true, practices: false, live: true, broadcast: false, pbp: true, news: true, board: true, homework: true, playbook: true, drills: true, resources: true, film: true, roster: true },
  family: { schedule: true, games: true, practices: false, live: true, broadcast: false, pbp: true, news: true, board: false, homework: false, playbook: false, drills: false, resources: true, film: false, roster: false },
  friend: { schedule: true, games: true, practices: false, live: true, broadcast: false, pbp: true, news: false, board: false, homework: false, playbook: false, drills: false, resources: false, film: false, roster: false },
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

/** What a team shows its followers: who sees which part, and the plays, drills and resources picked out for them. */
export function settingsOf(team) {
  const saved = parse(team.family_json, {}) || {};
  const access = {};
  for (const k of FAMILY_KINDS) access[k] = Object.fromEntries(FAMILY_SECTIONS.map((s) => [s, typeof saved.access?.[k]?.[s] === 'boolean' ? saved.access[k][s] : DEFAULTS[k][s]]));
  return {
    access,
    plays: (Array.isArray(saved.plays) ? saved.plays : []).map(Number).filter(Number.isInteger),
    drills: (Array.isArray(saved.drills) ? saved.drills : []).map(Number).filter(Number.isInteger),
    resources: (Array.isArray(saved.resources) ? saved.resources : []).map((k) => str(k, 2100)),
  };
}
/** Replaces one of a team's lists of what is shared with its followers: 'plays', 'drills' or 'resources'. */
export function saveFamilyList(team, key, list) {
  const s = settingsOf(get('SELECT * FROM teams WHERE id=?', team.id));
  s[key] = [...new Set(list)].slice(0, 500);
  run('UPDATE teams SET family_json=? WHERE id=?', JSON.stringify(s), team.id);
}
const sportOf = (team) => get('SELECT name FROM sports WHERE id=?', team.sport_id)?.name || '';
const audienceOf = (p) => String(p.audience || '').split(',').filter(Boolean);
const postOut = (p, userId) => ({ id: p.id, kind: p.kind, title: p.title, body: p.body, author: p.author, role: p.role, at: p.created_at, mine: p.user_id === userId, audience: audienceOf(p) });
/** A team's posts of one kind, newest first. With `as`, only the announcements that went out to that kind of follower; one from before audiences is for everyone. */
const postsOf = (teamId, kind, userId, as = '') =>
  all('SELECT * FROM team_posts WHERE team_id=? AND kind=? ORDER BY id DESC LIMIT 200', teamId, kind)
    .filter((p) => !as || !p.audience || audienceOf(p).includes(as))
    .map((p) => postOut(p, userId));
/** The groups an announcement can go out to. */
const AUDIENCES = ['coach', 'parent', 'family', 'friend'];

// Each person may post only so often, so the board cannot be flooded.
const posted = new Map();
const POST_LIMIT = 30;
function tooManyPosts(userId) {
  const recent = (posted.get(userId) || []).filter((t) => Date.now() - t < 60 * 60_000);
  posted.set(userId, [...recent, Date.now()]);
  return recent.length >= POST_LIMIT;
}
/** Who reads a team's board, and so can be named on it: its coaches, and the followers it is open to. */
function boardPeople(team) {
  const access = settingsOf(team).access;
  const coaches = coachesOfTeam(team).map((p) => ({ id: p.id, name: p.name, coach: true }));
  const seen = new Set(coaches.map((p) => p.id));
  return [...coaches, ...followersOfTeam(team).filter((p) => !seen.has(p.id) && access?.[p.kind]?.board).map((p) => ({ id: p.id, name: p.name, coach: false }))];
}
const boardNames = (team) => [...new Set(boardPeople(team).map((p) => p.name))];
function addPost(team, user, role, kind, b, base = '') {
  const body = str(b.body, 4000).trim();
  if (!body) return 'Write something first.';
  if (tooManyPosts(user.id)) return 'You have posted a lot in the last hour. Try again a little later.';
  // An announcement is a message to the team: it goes out to the groups picked for it, the coaches and the parents unless told otherwise.
  const audience = kind === 'news' ? (Array.isArray(b.to) ? AUDIENCES.filter((a) => b.to.includes(a)) : ['coach', 'parent']) : [];
  if (kind === 'news' && audience.length === 0) return 'Choose who the announcement goes out to.';
  const title = kind === 'news' ? str(b.title, 120).trim() : '';
  const postId = run('INSERT INTO team_posts (team_id, user_id, author, role, kind, title, body, created_at, audience) VALUES (?,?,?,?,?,?,?,?,?)', team.id, user.id, user.name, role, kind, title, body, nowIso(), audience.join(',')).lastInsertRowid;
  if (kind === 'news') {
    const to = new Set([...(audience.includes('coach') ? coachesOfTeam(team) : []), ...followersOfTeam(team).filter((p) => audience.includes(p.kind))].map((p) => p.id));
    to.delete(user.id);
    if (to.size) deliver(user, [...to], { subject: title || `${team.name} announcement`, body, title: (name) => `${team.name}: announcement from ${name}`, tag: 'news' });
  }
  // Someone named with "@" on the board is told, with a link to the message that names them.
  if (kind === 'board')
    for (const p of mentionedIn(body, boardPeople(team).filter((x) => x.id !== user.id)))
      mention(p.id, {
        by: user.name, where: `on the ${team.name} message board`, body, ref: `team-post-${postId}`, base,
        link: p.coach ? `/go/board/${team.id}?post=${postId}` : `/family/${slugOf(team)}?tab=messages&show=board&post=${postId}`,
      });
  return '';
}

/** How many teams a person follows, for the menu. */
export const followingCount = (userId) => get('SELECT COUNT(DISTINCT team_id) AS n FROM team_contacts WHERE user_id=?', userId).n;

// --- For the followers ------------------------------------------------------------
/** The team's code for the address of its page, made the first time it is needed. It always starts with a letter. */
function codeOf(team) {
  if (team.family_code) return team.family_code;
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const rest = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code;
  do {
    const bytes = crypto.randomBytes(6);
    code = letters[bytes[0] % letters.length] + [...bytes.subarray(1)].map((b) => rest[b % rest.length]).join('');
  } while (get('SELECT 1 AS ok FROM teams WHERE family_code=?', code));
  run('UPDATE teams SET family_code=? WHERE id=?', code, team.id);
  team.family_code = code;
  return code;
}
/** How a team is named in the address of its page: its name, then its code. Only the code is looked up, so a renamed team keeps its old links. */
export const slugOf = (team) => {
  const name = String(team.name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${name || 'team'}-${codeOf(team)}`;
};
/** The team an address names. A bare number is how the address used to be written, and still works. */
function teamIdOf(ref) {
  const text = String(ref ?? '');
  if (/^\d+$/.test(text)) return Number(text);
  const code = text.split('-').pop();
  return (code && get('SELECT id FROM teams WHERE family_code=?', code)?.id) || 0;
}
/** The team and how this person is on its list, or null when they are not. */
function follow(userId, ref) {
  const teamId = typeof ref === 'number' ? ref : teamIdOf(ref);
  const c = get('SELECT * FROM team_contacts WHERE user_id=? AND team_id=? ORDER BY id LIMIT 1', userId, Number(teamId));
  const team = c && get('SELECT * FROM teams WHERE id=?', c.team_id);
  if (!team) return null;
  const mine = new Set(parse(c.player_ids_json, []).map(Number));
  const players = all('SELECT id, name FROM players WHERE team_id=? AND active=1 ORDER BY name COLLATE NOCASE', team.id).filter((p) => mine.has(p.id));
  // A guest is on the list only to be shown video (film.js): no part of the team's page is open to them.
  if (c.kind === 'guest') return { team, kind: 'guest', players: [], settings: settingsOf(team), can: Object.fromEntries(FAMILY_SECTIONS.map((s) => [s, false])) };
  const kind = FAMILY_KINDS.includes(c.kind) ? c.kind : 'friend';
  return { team, kind, players, settings: settingsOf(team), can: settingsOf(team).access[kind] };
}
const coachesOf = (team) => {
  const staff = all('SELECT u.name, s.title FROM team_staff s JOIN users u ON u.id=s.user_id WHERE s.team_id=? ORDER BY u.name COLLATE NOCASE', team.id);
  // A team in a coach's own workspace is coached by whoever the workspace belongs to.
  const owners = team.community_id ? [] : all("SELECT u.name, 'Coach' AS title FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=? AND m.role='owner' AND u.status='active'", team.owner_id);
  return [...owners, ...staff].map((s) => ({ name: s.name, title: s.title || 'Coach' }));
};
/** What a practice covers, for a parent: its parts and how long each runs. None of the coach's notes. */
function practiceSummary(planId) {
  const items = all('SELECT kind, title, duration_min FROM plan_items WHERE plan_id=? ORDER BY position, id', planId).map((it) => ({
    title: it.title || (it.kind === 'break' ? 'Break' : 'Practice item'), minutes: Number(it.duration_min) || 0, rest: it.kind === 'break',
  }));
  return items.length ? { minutes: items.reduce((n, it) => n + it.minutes, 0), items } : null;
}
/**
 * The team's days: what is on its calendar, and the practices and games planned for days the calendar does not have.
 * `can.games` says whether a game's time and place are told, and `can.practices` whether a practice comes with what it covers.
 */
function scheduleOf(team, can) {
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const from = isoDay(since);
  const opening = sharedOpening(all("SELECT title FROM events WHERE team_id=? AND uid NOT LIKE 'league-%'", team.id).map((r) => r.title));
  const today = isoDay(new Date());
  // Put together the way a coach's own calendar is (buildSchedule in client/src/schedule.ts), so a
  // parent is told the same day, time and place the coach sees. A calendar event that has a practice
  // written for it shows once, as that practice, with the practice's time.
  const list = all(
    "SELECT p.id, p.title, p.date, p.start_time, p.location, p.is_game, p.game_json, (SELECT COUNT(*) FROM plan_items WHERE plan_id=p.id) AS items FROM plans p WHERE p.team_id=? AND p.kind='practice' AND p.is_template=0 AND p.date>=? AND p.date<>''",
    team.id, from,
  ).map((p) => ({
    key: `p${p.id}`, kind: p.is_game ? 'game' : 'practice', title: p.title || 'Practice', date: p.date, start_time: p.start_time || '', end_time: '', location: p.location || '',
    plan: p.id, filled: p.items > 0 || (!!p.is_game && String(p.game_json || '').length > 2), event: false,
  }));
  const filledFirst = [...list].sort((x, y) => Number(y.filled) - Number(x.filled));
  for (const ev of all('SELECT * FROM events WHERE team_id=? AND gone=0 AND date>=? ORDER BY date, start_time, id', team.id, from)) {
    const short = withoutOpening(ev.title, opening);
    // A game only pairs with a plan made for it (same title), so a practice on game day stays separate.
    const planned =
      filledFirst.find((e) => e.date === ev.date && !e.event && (e.title === short || e.title === ev.title)) ||
      (ev.kind !== 'game' ? filledFirst.find((e) => e.date === ev.date && !e.event) : undefined);
    if (planned) {
      planned.event = true;
      // What the practice leaves unsaid, the calendar fills in.
      planned.end_time = ev.end_time || '';
      planned.location ||= ev.location || '';
    } else
      list.push({
        key: `e${ev.id}`, kind: ev.kind, title: short || (ev.kind === 'game' ? 'Game' : ev.kind === 'practice' ? 'Practice' : 'Event'),
        date: ev.date, start_time: ev.start_time || '', end_time: ev.end_time || '', location: ev.location || '', plan: 0, filled: true, event: true,
      });
  }
  return list
    // A blank practice for today or earlier that is not on the calendar was started and left. It is not a real practice.
    .filter((e) => e.filled || e.event || e.date > today)
    .sort((x, y) => x.date.localeCompare(y.date) || x.start_time.localeCompare(y.start_time))
    .map(({ plan, filled: _filled, event: _event, ...d }) => ({ ...d, plan }))
    .map((d) => {
      // Without the details, a game is only a game on its day.
      if (d.kind === 'game' && !can.games) return { key: d.key, kind: d.kind, title: 'Game', date: d.date, start_time: '', end_time: '', location: '', summary: null };
      const { plan, ...day } = d;
      // A game someone is scoring, or has scored, comes with its score.
      return { ...day, summary: plan && day.kind === 'practice' && can.practices ? practiceSummary(plan) : null, score: plan && day.kind === 'game' ? scoreOfPlan(plan) : null };
    });
}
/** Homework for the whole team, and for this person's own players. */
function homeworkOf(team, players) {
  const mine = new Map(players.map((p) => [p.id, p.name]));
  return all("SELECT * FROM plans WHERE team_id=? AND kind='homework' AND is_template=0 ORDER BY date DESC, id DESC LIMIT 60", team.id)
    .map((p) => {
      const to = parse(p.assigned_json, []).map(Number);
      const names = to.filter((id) => mine.has(id)).map((id) => mine.get(id));
      if (to.length && !names.length) return null;
      return { id: p.id, title: p.title || 'Homework', date: p.date || '', due: p.due_date || '', for: to.length ? names : [], content: planView(p) };
    })
    .filter(Boolean);
}
const sharedDrills = (team, settings) => settings.drills.map((id) => get('SELECT * FROM drills WHERE id=? AND owner_id=?', id, team.owner_id)).filter(Boolean).map((d) => ({ id: d.id, ...drillView(d) }));
const sharedPlays = (team, settings) => settings.plays.map((id) => get('SELECT * FROM plays WHERE id=? AND owner_id=?', id, team.owner_id)).filter(Boolean).map(playView);
function sharedResources(team, settings) {
  if (!settings.resources.length) return [];
  const want = new Set(settings.resources);
  // Whether a small preview picture is kept for a link, so the page knows to ask for it.
  const kept = new Set(all("SELECT url FROM link_thumbs WHERE owner_id=? AND state='ok'", team.owner_id).map((t) => t.url));
  // The categories of the team's sport, by name, so the page can be narrowed by them as a coach's can.
  const names = new Map(all('SELECT id, name, color FROM tags WHERE owner_id=? AND sport_id=?', team.owner_id, team.sport_id).map((t) => [t.id, { name: t.name, color: t.color }]));
  return resourceList(team.owner_id)
    .filter((r) => want.has(r.key))
    .map((r) => ({ key: r.key, kind: r.kind, title: r.title, url: r.url, file_id: r.file_id, thumb: r.kind === 'link' && kept.has(r.url), tags: r.tag_ids.map((id) => names.get(id)).filter(Boolean) }));
}

export function mountFamily(app) {
  // Someone who only follows teams becomes a coach as well, and can then make a team of their own.
  // It is for accounts the system administrator has marked as paid.
  app.post('/api/family/start-coaching', (req, res) => {
    if (!req.user.paid) return res.status(402).json({ error: 'Coaching is not turned on for your account yet.' });
    run('UPDATE users SET follower=0 WHERE id=?', req.user.id);
    res.json({ ok: true });
  });
  app.get('/api/family/teams', (req, res) => {
    const rows = all('SELECT DISTINCT team_id FROM team_contacts WHERE user_id=?', req.user.id);
    res.json(
      rows
        .map((r) => follow(req.user.id, r.team_id))
        .filter(Boolean)
        .map((f) => ({ id: f.team.id, slug: slugOf(f.team), name: f.team.name, sport: sportOf(f.team), season: f.team.season || '', kind: f.kind, players: f.players.map((p) => p.name) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  });
  const enter = (req, res) => {
    const f = follow(req.user.id, req.params.id);
    if (!f) res.status(404).json({ error: 'You are not on this team’s list of parents, family and friends. Ask its coach to add you.' });
    return f;
  };
  /**
   * The game being scored for a team right now, if there is one: a scoresheet with plays on it,
   * not finished, and touched in the last three hours, so a game left open overnight is not "live".
   */
  const liveGame = (team) =>
    get(
      "SELECT s.*, p.title AS plan_title, p.game_json FROM scoresheets s JOIN plans p ON p.id=s.plan_id WHERE s.team_id=? AND s.scope='team' AND s.status='live' AND s.events_json<>'[]' AND s.updated_at >= datetime('now','-3 hours') ORDER BY s.updated_at DESC, s.id DESC LIMIT 1",
      team.id,
    ) || null;
  /** What a follower is told about the game itself: who it is against, the score, and where it has got to. */
  const liveBrief = (s) => {
    if (!s) return null;
    const game = parse(s.game_json, {});
    const state = parse(s.state_json, {});
    return { plan_id: s.plan_id, opponent: String(game.opponent || '').trim() || 'Opponent', home: game.side !== 'away', us: s.us, them: s.them, period: Math.max(1, Number(state.period) || 1), halves: !!state.halves };
  };
  app.get('/api/family/teams/:id', (req, res) => {
    const f = enter(req, res);
    if (!f) return;
    const { team, can, settings } = f;
    res.json({
      team: { id: team.id, slug: slugOf(team), name: team.name, sport: sportOf(team), season: team.season || '', organization: team.community_id ? get('SELECT name FROM communities WHERE id=?', team.community_id)?.name || '' : '', coaches: coachesOf(team) },
      me: { kind: f.kind, players: f.players.map((p) => p.name) },
      // How many videos from the Filmroom have been shared with this person.
      film: get('SELECT COUNT(*) AS n FROM film_shares f JOIN team_contacts c ON c.id=f.contact_id WHERE c.user_id=? AND f.team_id=?', req.user.id, team.id).n + (can.film ? get('SELECT COUNT(*) AS n FROM film_team_shares WHERE team_id=?', team.id).n : 0),
      // Live video: whether this person may watch or broadcast, and whether something is going out now.
      video: (() => {
        const mine = all('SELECT can_watch, can_broadcast FROM team_contacts WHERE team_id=? AND user_id=?', team.id, req.user.id);
        // Live video is open to their kind of follower, and has not been turned off for them alone.
        const watch = !!can.live && mine.some((c) => c.can_watch);
        // Broadcasting is open to their kind of follower, or was given to them alone.
        return { watch, broadcast: !!can.broadcast || mine.some((c) => c.can_broadcast), live: watch && liveNow(team.id) };
      })(),
      // A game being scored right now, for those who are told about games: the score and how far along it is.
      live_game: can.schedule && can.games && can.pbp ? liveBrief(liveGame(team)) : null,
      can,
      schedule: can.schedule ? scheduleOf(team, can) : [],
      news: can.news ? postsOf(team.id, 'news', req.user.id, f.kind) : [],
      board: can.board ? postsOf(team.id, 'board', req.user.id) : [],
      // The names that can be written with "@" on the board.
      board_people: can.board ? boardNames(team) : [],
      homework: can.homework ? homeworkOf(team, f.players) : [],
      plays: can.playbook ? sharedPlays(team, settings) : [],
      drills: can.drills ? sharedDrills(team, settings) : [],
      resources: can.resources ? sharedResources(team, settings) : [],
      // Names and numbers only: nothing about a player's family, none of the coach's notes, and not where each one plays.
      roster: can.roster ? all('SELECT name, number FROM players WHERE team_id=? AND active=1 ORDER BY name COLLATE NOCASE', team.id) : [],
    });
  });
  // The game being scored right now, play by play, for followers who are told about games. A player is
  // named only to those who may see the roster; to the rest each one is their number.
  app.get('/api/family/teams/:id/live', (req, res) => {
    const f = enter(req, res);
    if (!f) return;
    if (!f.can.schedule || !f.can.games || !f.can.pbp) return res.status(403).json({ error: 'Games are not open to you on this team.' });
    const sheet = liveGame(f.team);
    if (!sheet) return res.json({ game: null, plays: [] });
    const players = new Map(all('SELECT id, name, number FROM players WHERE team_id=?', f.team.id).map((p) => [p.id, p]));
    const nameOf = (id) => {
      const p = players.get(id);
      if (!p) return 'A player';
      return f.can.roster ? p.name : p.number ? `#${p.number}` : 'A player';
    };
    const brief = liveBrief(sheet);
    const state = parse(sheet.state_json, {});
    res.json({ game: brief, plays: livePlays(parse(sheet.events_json, []), { nameOf, oppName: brief.opponent, oppPlayers: Array.isArray(state.opp_players) ? state.opp_players : [] }) });
  });
  app.post('/api/family/teams/:id/board', (req, res) => {
    const f = enter(req, res);
    if (!f) return;
    if (!f.can.board) return res.status(403).json({ error: 'The message board is not open to you on this team.' });
    const problem = addPost(f.team, req.user, f.kind, 'board', req.body, publicBase(req));
    if (problem) return res.status(400).json({ error: problem });
    res.json(postsOf(f.team.id, 'board', req.user.id));
  });
  app.delete('/api/family/teams/:id/board/:postId', (req, res) => {
    const f = enter(req, res);
    if (!f) return;
    run("DELETE FROM team_posts WHERE id=? AND team_id=? AND user_id=? AND kind='board'", Number(req.params.postId), f.team.id, req.user.id);
    res.json(postsOf(f.team.id, 'board', req.user.id));
  });
  // The small preview picture kept for a link the coach shared.
  app.get('/api/family/teams/:id/thumb', (req, res) => {
    const f = enter(req, res);
    if (!f) return;
    const url = String(req.query.url ?? '');
    const shared = f.can.resources && sharedResources(f.team, f.settings).some((r) => r.kind === 'link' && r.url === url);
    const t = shared && get("SELECT data, mime FROM link_thumbs WHERE owner_id=? AND url=? AND state='ok'", f.team.owner_id, url);
    if (!t?.data) return res.status(404).end();
    res.set({ 'Content-Type': t.mime || 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' }).send(Buffer.from(t.data));
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
    const drills = all('SELECT id, name FROM drills WHERE owner_id=? AND sport_id=? ORDER BY name COLLATE NOCASE, id', team.owner_id, team.sport_id);
    return {
      access: s.access,
      // Only what still exists counts as shared.
      plays: s.plays.filter((id) => plays.some((p) => p.id === id)),
      drills: s.drills.filter((id) => drills.some((d) => d.id === id)),
      all_drills: drills,
      resources: s.resources.filter((k) => resources.some((r) => r.key === k)),
      all_plays: plays,
      all_resources: resources,
      // How many people of each kind have made an account, and so can open the team's page.
      joined: Object.fromEntries(FAMILY_KINDS.map((k) => [k, get('SELECT COUNT(*) AS n FROM team_contacts WHERE team_id=? AND kind=? AND user_id IS NOT NULL', team.id, k).n])),
      news: postsOf(team.id, 'news', req.user.id),
      board: postsOf(team.id, 'board', req.user.id),
      board_people: boardNames(team),
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
    if (Array.isArray(b.drills)) s.drills = [...new Set(b.drills.map(Number))].filter((id) => get('SELECT 1 AS ok FROM drills WHERE id=? AND owner_id=?', id, team.owner_id)).slice(0, 500);
    if (Array.isArray(b.resources)) s.resources = [...new Set(b.resources.map((k) => str(k, 2100)))].slice(0, 500);
    run('UPDATE teams SET family_json=? WHERE id=?', JSON.stringify(s), team.id);
    res.json(out(req, team));
  });
  app.post('/api/teams/:id/family/posts', (req, res) => {
    const team = enter(req, res);
    if (!team) return;
    const problem = addPost(team, req.user, 'coach', req.body.kind === 'news' ? 'news' : 'board', req.body, publicBase(req));
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
