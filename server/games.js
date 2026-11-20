// Keeping score. A scoresheet is a list of plays ("number 12 made a three") and a little state
// around it (the period, who is on the floor). Everything else, the score and every stat, is
// worked out from the plays, so undoing or fixing one puts everything right.
//
// There are two kinds. A team's scoresheet belongs to one of its games and is kept by one scorer
// at a time. A personal one ("My stats") is one person following one player: it is theirs alone,
// never part of the team's numbers, unless they choose to show it to the team's coaches.
import { all, db, get, run } from './db.js';
import { poke } from './live.js';
import { coachesOfTeam, followersOfTeam } from './inbox.js';
import { isSystemAdmin } from './auth.js';
import { statsFromCsv } from './statsCsv.js';

db.exec(`
CREATE TABLE IF NOT EXISTS scoresheets (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'team',              -- 'team' | 'personal'
  plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER, player_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '', date TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}', events_json TEXT NOT NULL DEFAULT '[]',
  us INTEGER NOT NULL DEFAULT 0, them INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'live', rev INTEGER NOT NULL DEFAULT 0,
  scorer_id INTEGER, shared_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scoresheets_plan ON scoresheets(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scoresheets_user ON scoresheets(user_id, scope);
CREATE INDEX IF NOT EXISTS idx_scoresheets_team ON scoresheets(team_id, scope);
`);

const str = (v, max) => String(v ?? '').slice(0, max);
const parse = (json, fallback) => {
  try {
    return JSON.parse(json) ?? fallback;
  } catch {
    return fallback;
  }
};
// 'p1' is a point with nothing known about how it was scored: the other team's score when stats are brought in from a file.
const POINTS = { m1: 1, m2: 2, m3: 3, p1: 1 };
const TYPES = new Set(['p1', 'm1', 'm2', 'm3', 'x1', 'x2', 'x3', 'reb', 'ast', 'stl', 'blk', 'to', 'pf']);
const MAX_EVENTS = 3000;
// Whether a team may bring a game's stats in from a file: the system administrator's call, team by team.
if (!all('PRAGMA table_info(teams)').some((c) => c.name === 'stat_import')) db.exec('ALTER TABLE teams ADD COLUMN stat_import INTEGER DEFAULT 0');
const mayImport = (user, teamId) => isSystemAdmin(user) || !!get('SELECT stat_import FROM teams WHERE id=?', teamId)?.stat_import;

/** The plays as sent, with anything unexpected dropped. */
function cleanEvents(list) {
  const out = [];
  for (const e of Array.isArray(list) ? list.slice(0, MAX_EVENTS) : []) {
    if (!e || !TYPES.has(e.type)) continue;
    out.push({
      id: str(e.id, 40), side: e.side === 'them' ? 'them' : 'us', player: Number.isInteger(e.player) ? e.player : null, type: e.type,
      period: Math.min(20, Math.max(1, Number(e.period) || 1)), clock: Number.isFinite(e.clock) ? Math.max(0, Math.round(e.clock)) : null, at: Number(e.at) || 0,
    });
  }
  return out;
}
/** The state as sent: only what a scoresheet keeps, each part within reason. */
function cleanState(s) {
  const st = s && typeof s === 'object' ? s : {};
  const ids = (v) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger).slice(0, 30) : []);
  return {
    mode: st.mode === 'full' ? 'full' : 'score',
    period: Math.min(20, Math.max(1, Number(st.period) || 1)),
    status: st.status === 'final' ? 'final' : 'live',
    on: ids(st.on),
    timed: !!st.timed,
    period_secs: Math.min(3600, Math.max(60, Number(st.period_secs) || 480)),
    clock_left: Number.isFinite(st.clock_left) ? Math.max(0, Math.round(st.clock_left)) : null,
    opp_advanced: !!st.opp_advanced,
    opp_players: (Array.isArray(st.opp_players) ? st.opp_players : []).slice(0, 30).map((p) => ({ id: Number(p?.id) || 0, label: str(p?.label, 20) })).filter((p) => p.id),
    // Set when the plays were made from a file of totals, not tapped in as they happened.
    imported: st.imported ? str(st.imported, 120) : '',
  };
}
const pointsOf = (events, side) => events.reduce((n, e) => n + (e.side === side ? POINTS[e.type] || 0 : 0), 0);
const sheetOut = (s) => ({
  id: s.id, scope: s.scope, plan_id: s.plan_id, team_id: s.team_id, player_id: s.player_id, player_name: s.player_name, title: s.title, date: s.date,
  state: cleanState(parse(s.state_json, {})), events: parse(s.events_json, []), us: s.us, them: s.them, status: s.status, rev: s.rev,
  scorer_id: s.scorer_id, scorer: s.scorer_id ? get('SELECT name FROM users WHERE id=?', s.scorer_id)?.name || '' : '', shared: !!s.shared_at, updated_at: s.updated_at,
});

/** A game's score for the people who follow the team: the numbers, and how far along it is. Null when nobody has scored it. */
export function scoreOfPlan(planId) {
  const s = planId && get("SELECT us, them, status, state_json, events_json FROM scoresheets WHERE plan_id=? AND scope='team'", planId);
  if (!s) return null;
  const events = parse(s.events_json, []);
  if (events.length === 0 && s.status !== 'final') return null;
  const periods = [];
  for (const e of events) {
    const p = POINTS[e.type];
    if (!p) continue;
    periods[e.period - 1] ||= { us: 0, them: 0 };
    periods[e.period - 1][e.side] += p;
  }
  return { us: s.us, them: s.them, status: s.status, period: cleanState(parse(s.state_json, {})).period, periods: [...periods].map((p) => p || { us: 0, them: 0 }) };
}

/** The teams a person coaches, and the ones they follow with the players that are theirs. */
function teamsFor(user) {
  const coached = all(
    `SELECT DISTINCT t.id, t.name FROM teams t
      WHERE t.id IN (SELECT team_id FROM team_staff WHERE user_id=?) OR t.owner_id IN (SELECT owner_id FROM memberships WHERE user_id=? AND role='owner')
      ORDER BY t.name COLLATE NOCASE`,
    user.id, user.id,
  ).map((t) => ({ ...t, coach: true, players: all('SELECT id, name, number FROM players WHERE team_id=? AND active=1 ORDER BY name COLLATE NOCASE', t.id) }));
  const seen = new Set(coached.map((t) => t.id));
  const followed = [];
  for (const c of all('SELECT c.player_ids_json, t.id, t.name FROM team_contacts c JOIN teams t ON t.id=c.team_id WHERE c.user_id=? ORDER BY t.name COLLATE NOCASE', user.id)) {
    if (seen.has(c.id)) continue;
    const ids = parse(c.player_ids_json, []).map(Number);
    const mine = ids.length ? all(`SELECT id, name, number FROM players WHERE team_id=? AND active=1 AND id IN (${ids.map(() => '?').join(',')}) ORDER BY name COLLATE NOCASE`, c.id, ...ids) : [];
    const had = followed.find((t) => t.id === c.id);
    if (had) had.players.push(...mine.filter((p) => !had.players.some((x) => x.id === p.id)));
    else followed.push({ id: c.id, name: c.name, coach: false, players: mine });
  }
  return [...coached, ...followed];
}

export function mountGames(app) {
  // --- A team's game ---
  const planOf = (req, res) => {
    const plan = get('SELECT * FROM plans WHERE id=? AND owner_id=?', Number(req.params.id), req.ownerId);
    if (!plan || !plan.is_game) res.status(404).json({ error: 'Not found' });
    return plan && plan.is_game ? plan : null;
  };
  app.get('/api/plans/:id/score', (req, res) => {
    const plan = planOf(req, res);
    if (!plan) return;
    const s = get("SELECT * FROM scoresheets WHERE plan_id=? AND scope='team'", plan.id);
    res.json({ sheet: s ? sheetOut(s) : null, can_import: mayImport(req.user, plan.team_id) });
  });
  // --- Bringing a game's stats in from a file ---
  // The file is read and handed back first, so the coach can say which of their players each line is.
  const importable = (req, res) => {
    const plan = planOf(req, res);
    if (!plan) return null;
    if (!mayImport(req.user, plan.team_id)) {
      res.status(403).json({ error: 'Importing stats is not turned on for this team. The administrator decides which teams may.' });
      return null;
    }
    return plan;
  };
  const readStats = (req, res) => {
    try {
      return statsFromCsv(String(req.body.csv ?? '').slice(0, 400_000));
    } catch (e) {
      res.status(400).json({ error: e.message });
      return null;
    }
  };
  app.post('/api/plans/:id/score/import/read', (req, res) => {
    const plan = importable(req, res);
    const read = plan && readStats(req, res);
    if (!read) return;
    const roster = all('SELECT id, name, number FROM players WHERE team_id=? AND active=1 ORDER BY name COLLATE NOCASE', plan.team_id);
    const flat = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const taken = new Set();
    // A line is matched by name first, then by number, and each player only once. The coach has the last word.
    const guess = (row) => {
      const names = [`${row.first} ${row.last}`, `${row.last} ${row.first}`, row.last].map(flat).filter(Boolean);
      const found = roster.find((p) => !taken.has(p.id) && names.includes(flat(p.name))) || roster.find((p) => !taken.has(p.id) && row.number && String(p.number).trim() === row.number && (!row.last || flat(p.name).includes(flat(row.last))));
      if (found) taken.add(found.id);
      return found?.id ?? 0;
    };
    const rows = read.rows.map((row) => ({ ...row, player_id: guess(row) }));
    // Whoever is left is offered by number alone.
    for (const row of rows) {
      if (row.player_id || !row.number) continue;
      const p = roster.find((x) => !taken.has(x.id) && String(x.number).trim() === row.number);
      if (p) {
        taken.add(p.id);
        row.player_id = p.id;
      }
    }
    const old = get("SELECT events_json FROM scoresheets WHERE plan_id=? AND scope='team'", plan.id);
    res.json({ rows, team: read.team, games: read.games, roster, existing: old ? parse(old.events_json, []).length : 0 });
  });
  app.post('/api/plans/:id/score/import', (req, res) => {
    const plan = importable(req, res);
    const read = plan && readStats(req, res);
    if (!read) return;
    const roster = new Set(all('SELECT id FROM players WHERE team_id=?', plan.team_id).map((p) => p.id));
    const map = req.body.map && typeof req.body.map === 'object' ? req.body.map : {};
    const used = new Set();
    const events = [];
    let n = 0;
    const add = (side, player, type, count) => {
      for (let i = 0; i < count; i++) events.push({ id: `imp${(n++).toString(36)}`, side, player, type, period: 1, clock: null, at: 0 });
    };
    for (const [i, row] of read.rows.entries()) {
      // What the coach chose for this line: one of their players, the team as a whole ('team'), or to leave it out.
      const to = map[i];
      if (to === 'skip' || to === undefined || to === null || to === 0) continue;
      const player = to === 'team' ? null : Number(to);
      if (player !== null && (!roster.has(player) || used.has(player))) return res.status(400).json({ error: 'Each line of the file has to go to a different player on this team.' });
      if (player !== null) used.add(player);
      const s = row.stats;
      add('us', player, 'm3', s.tpm);
      add('us', player, 'x3', s.tpa - s.tpm);
      add('us', player, 'm2', s.fgm - s.tpm);
      add('us', player, 'x2', s.fga - s.fgm - (s.tpa - s.tpm));
      add('us', player, 'm1', s.ftm);
      add('us', player, 'x1', s.fta - s.ftm);
      for (const k of ['reb', 'ast', 'stl', 'blk', 'to', 'pf']) add('us', player, k, s[k]);
    }
    if (events.length === 0) return res.status(400).json({ error: 'Nothing was chosen to bring in.' });
    if (events.length > MAX_EVENTS - 400) return res.status(400).json({ error: 'That file has more in it than one game can hold.' });
    add('them', null, 'p1', Math.min(300, Math.max(0, Math.round(Number(req.body.them) || 0))));
    const old = get("SELECT * FROM scoresheets WHERE plan_id=? AND scope='team'", plan.id);
    const state = cleanState({ ...(old ? parse(old.state_json, {}) : {}), mode: 'full', period: 1, status: 'final', imported: str(req.body.file, 100) || 'a file' });
    const us = pointsOf(events, 'us');
    const them = pointsOf(events, 'them');
    if (old) run("UPDATE scoresheets SET state_json=?, events_json=?, us=?, them=?, status='final', rev=rev+1, scorer_id=?, updated_at=datetime('now') WHERE id=?", JSON.stringify(state), JSON.stringify(events), us, them, req.user.id, old.id);
    else run("INSERT INTO scoresheets (scope, plan_id, team_id, user_id, state_json, events_json, us, them, status, rev, scorer_id) VALUES ('team',?,?,?,?,?,?,?,'final',1,?)", plan.id, plan.team_id, req.user.id, JSON.stringify(state), JSON.stringify(events), us, them, req.user.id);
    const game = parse(plan.game_json, {});
    game.result = { went_well: '', work_on: '', ...(game.result || {}), us: String(us), them: String(them) };
    run('UPDATE plans SET game_json=? WHERE id=?', JSON.stringify(game), plan.id);
    res.json({ sheet: sheetOut(get("SELECT * FROM scoresheets WHERE plan_id=? AND scope='team'", plan.id)) });
  });
  // One person keeps score at a time. Saving sends the whole sheet with the number of the version
  // it was built on; a save built on an older version means someone else has taken over.
  app.put('/api/plans/:id/score', (req, res) => {
    const plan = planOf(req, res);
    if (!plan) return;
    const old = get("SELECT * FROM scoresheets WHERE plan_id=? AND scope='team'", plan.id);
    if (old && !req.body.take && Number(req.body.rev) !== old.rev)
      return res.status(409).json({ error: `${get('SELECT name FROM users WHERE id=?', old.scorer_id)?.name || 'Someone else'} is keeping score for this game on another device.`, sheet: sheetOut(old) });
    // Taking over starts from what is saved, never from what the new device happens to hold.
    const events = req.body.take && old ? parse(old.events_json, []) : cleanEvents(req.body.events);
    const state = req.body.take && old ? cleanState(parse(old.state_json, {})) : cleanState(req.body.state);
    const us = pointsOf(events, 'us');
    const them = pointsOf(events, 'them');
    if (old)
      run("UPDATE scoresheets SET state_json=?, events_json=?, us=?, them=?, status=?, rev=rev+1, scorer_id=?, updated_at=datetime('now') WHERE id=?", JSON.stringify(state), JSON.stringify(events), us, them, state.status, req.user.id, old.id);
    else
      run("INSERT INTO scoresheets (scope, plan_id, team_id, user_id, state_json, events_json, us, them, status, rev, scorer_id) VALUES ('team',?,?,?,?,?,?,?,?,1,?)", plan.id, plan.team_id, req.user.id, JSON.stringify(state), JSON.stringify(events), us, them, state.status, req.user.id);
    // A finished game's score goes onto its plan, where "After the game" shows it.
    if (state.status === 'final') {
      const game = parse(plan.game_json, {});
      game.result = { went_well: '', work_on: '', ...(game.result || {}), us: String(us), them: String(them) };
      run('UPDATE plans SET game_json=? WHERE id=?', JSON.stringify(game), plan.id);
    }
    // Everyone around the team hears that the score moved: other coaches, and the people following along.
    const team = get('SELECT * FROM teams WHERE id=?', plan.team_id);
    if (team && (!old || old.us !== us || old.them !== them || old.status !== state.status))
      poke([...coachesOfTeam(team), ...followersOfTeam(team)].map((p) => p.id).filter((id) => id !== req.user.id));
    res.json({ sheet: sheetOut(get("SELECT * FROM scoresheets WHERE plan_id=? AND scope='team'", plan.id)) });
  });
  // Every scored game of a team, for its season totals, and what parents chose to show its coaches.
  app.get('/api/teams/:id/scores', (req, res) => {
    const team = get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(req.params.id), req.ownerId);
    if (!team) return res.status(404).json({ error: 'Not found' });
    const games = all(
      "SELECT s.*, p.title AS plan_title, p.date AS plan_date, p.game_json FROM scoresheets s JOIN plans p ON p.id=s.plan_id WHERE s.team_id=? AND s.scope='team' ORDER BY p.date DESC, s.id DESC",
      team.id,
    ).map((s) => ({ ...sheetOut(s), title: s.plan_title, date: s.plan_date, opponent: parse(s.game_json, {}).opponent || '' }));
    const shared = all(
      "SELECT s.*, u.name AS by_name FROM scoresheets s JOIN users u ON u.id=s.user_id WHERE s.team_id=? AND s.scope='personal' AND s.shared_at IS NOT NULL ORDER BY s.date DESC, s.id DESC",
      team.id,
    ).map((s) => ({ ...sheetOut(s), by: s.by_name }));
    res.json({ games, shared });
  });

  // --- One person following one player ---
  const mine = (req, res) => {
    const s = get("SELECT * FROM scoresheets WHERE id=? AND user_id=? AND scope='personal'", Number(req.params.id), req.user.id);
    if (!s) res.status(404).json({ error: 'Not found' });
    return s;
  };
  const listMine = (user) => {
    const names = new Map(all('SELECT id, name FROM teams').map((t) => [t.id, t.name]));
    return {
      teams: teamsFor(user),
      sheets: all("SELECT * FROM scoresheets WHERE user_id=? AND scope='personal' ORDER BY date DESC, id DESC LIMIT 300", user.id).map((s) => ({ ...sheetOut(s), team: names.get(s.team_id) || '' })),
    };
  };
  app.get('/api/tracks', (req, res) => res.json(listMine(req.user)));
  app.post('/api/tracks', (req, res) => {
    const teams = teamsFor(req.user);
    const team = teams.find((t) => t.id === Number(req.body.team_id));
    // A player off a roster has to be one this person may follow: any player for a coach, their own for a parent.
    const player = team?.players.find((p) => p.id === Number(req.body.player_id));
    const name = player ? player.name : str(req.body.player_name, 80).trim();
    if (!name) return res.status(400).json({ error: 'Choose a player, or type a name.' });
    if (get("SELECT COUNT(*) AS n FROM scoresheets WHERE user_id=? AND scope='personal'", req.user.id).n >= 500) return res.status(400).json({ error: 'You have a lot of stat sheets. Delete some old ones first.' });
    const made = run(
      "INSERT INTO scoresheets (scope, team_id, user_id, player_id, player_name, title, date, state_json) VALUES ('personal',?,?,?,?,?,?,?)",
      team?.id ?? null, req.user.id, player?.id ?? null, name, str(req.body.title, 120).trim(), /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date)) ? req.body.date : new Date().toISOString().slice(0, 10), JSON.stringify(cleanState({ mode: 'full' })),
    );
    res.json({ id: Number(made.lastInsertRowid), ...listMine(req.user) });
  });
  app.put('/api/tracks/:id', (req, res) => {
    const s = mine(req, res);
    if (!s) return;
    const events = 'events' in req.body ? cleanEvents(req.body.events) : parse(s.events_json, []);
    const state = 'state' in req.body ? { ...cleanState(req.body.state), mode: 'full' } : cleanState(parse(s.state_json, {}));
    run(
      "UPDATE scoresheets SET state_json=?, events_json=?, us=?, status=?, title=?, date=?, rev=rev+1, updated_at=datetime('now') WHERE id=?",
      JSON.stringify(state), JSON.stringify(events), pointsOf(events, 'us'), state.status, 'title' in req.body ? str(req.body.title, 120).trim() : s.title, /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date)) ? req.body.date : s.date, s.id,
    );
    res.json({ sheet: sheetOut(get('SELECT * FROM scoresheets WHERE id=?', s.id)) });
  });
  // Showing a sheet to the team's coaches, or taking it back. It stays the person's own either way.
  app.post('/api/tracks/:id/share', (req, res) => {
    const s = mine(req, res);
    if (!s) return;
    if (!s.team_id || !teamsFor(req.user).some((t) => t.id === s.team_id)) return res.status(400).json({ error: 'This sheet is not for a player on one of your teams, so there are no coaches to share it with.' });
    run('UPDATE scoresheets SET shared_at=? WHERE id=?', req.body.on === false ? null : new Date().toISOString(), s.id);
    if (req.body.on !== false) {
      const team = get('SELECT * FROM teams WHERE id=?', s.team_id);
      poke(coachesOfTeam(team).map((p) => p.id));
    }
    res.json(listMine(req.user));
  });
  app.delete('/api/tracks/:id', (req, res) => {
    const s = mine(req, res);
    if (!s) return;
    run('DELETE FROM scoresheets WHERE id=?', s.id);
    res.json(listMine(req.user));
  });
}
