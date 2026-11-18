// Sign-ups: the players an organization has for a season, before and after they are on a team.
//
// A player gets on the list in one of two ways: a parent fills in the season's sign-up form, which
// anyone with its link can open, or a manager types them in. Each belongs to a season and usually
// to a division. From there a manager puts them on teams, by hand or by having the division's
// waiting players dealt out evenly.
//
// Being on a team means being on that team's roster: placing a player adds them to the roster the
// coach sees, moving them moves that roster line, and taking them off removes it. A player a
// manager placed by hand is never moved by the automatic placing. One it placed can be dealt again.
//
// Parents' contact details and notes are shown only to admins who may see rosters.
import crypto from 'node:crypto';
import { all, db, get, run, tx } from './db.js';
import { can } from './communities.js';

const str = (v, max = 200) => String(v ?? '').slice(0, max).trim();
const nowIso = () => new Date().toISOString();
const lastId = (r) => Number(r.lastInsertRowid);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The most players one season can hold, so a form left open cannot fill the disk. */
const SEASON_MAX = 3000;
/** Sign-ups one address may send in an hour through the public form. */
const FORM_LIMIT = 12;

let ready = false;
function ensureSchema() {
  if (ready) return;
  db.exec(`
CREATE TABLE IF NOT EXISTS org_signups (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  season_id INTEGER NOT NULL REFERENCES org_seasons(id) ON DELETE CASCADE,
  league_id INTEGER REFERENCES org_leagues(id) ON DELETE SET NULL,
  name TEXT NOT NULL, grade TEXT NOT NULL DEFAULT '',
  parent_name TEXT NOT NULL DEFAULT '', parent_email TEXT NOT NULL DEFAULT '', parent_phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'admin',
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  placed TEXT NOT NULL DEFAULT '',
  player_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_signups_season ON org_signups(season_id);
`);
  const cols = db.prepare('PRAGMA table_info(org_seasons)').all().map((c) => c.name);
  if (!cols.includes('signup_open')) db.exec('ALTER TABLE org_seasons ADD COLUMN signup_open INTEGER DEFAULT 0');
  if (!cols.includes('signup_code')) db.exec("ALTER TABLE org_seasons ADD COLUMN signup_code TEXT DEFAULT ''");
  ready = true;
}

/**
 * Brings the list back in line with the rosters. A player whose roster line is gone, because a
 * coach removed them or the team was deleted, is waiting for a team again.
 */
function reconcile(communityId) {
  run(
    `UPDATE org_signups SET team_id=NULL, placed='', player_id=NULL
      WHERE community_id=? AND (placed<>'' OR player_id IS NOT NULL)
        AND (team_id IS NULL OR player_id IS NULL OR player_id NOT IN (SELECT id FROM players WHERE team_id=org_signups.team_id))`,
    communityId,
  );
}

/** How many players are waiting for a team in the seasons still running. */
export function waitingCount(communityId) {
  ensureSchema();
  reconcile(communityId);
  return get('SELECT COUNT(*) AS n FROM org_signups g JOIN org_seasons s ON s.id=g.season_id WHERE g.community_id=? AND s.archived=0 AND g.team_id IS NULL', communityId).n;
}
/** Whether a season has anyone signed up, which keeps it from being deleted. */
export function seasonHasSignups(seasonId) {
  ensureSchema();
  return !!get('SELECT 1 AS ok FROM org_signups WHERE season_id=?', seasonId);
}

/** Puts a player on a team's roster, or moves their roster line there. */
function putOn(g, team, how) {
  const line = g.player_id ? get('SELECT id FROM players WHERE id=?', g.player_id) : null;
  let playerId = line?.id;
  if (playerId) run('UPDATE players SET team_id=?, owner_id=?, active=1 WHERE id=?', team.id, team.owner_id, playerId);
  else
    playerId = lastId(
      run('INSERT INTO players (owner_id, team_id, name, grade, parent_name, parent_email, parent_phone) VALUES (?,?,?,?,?,?,?)', team.owner_id, team.id, g.name, g.grade, g.parent_name, g.parent_email, g.parent_phone),
    );
  run('UPDATE org_signups SET team_id=?, league_id=?, placed=?, player_id=? WHERE id=?', team.id, team.league_id, how, playerId, g.id);
}
function takeOff(g) {
  if (g.player_id) run('DELETE FROM players WHERE id=?', g.player_id);
  run("UPDATE org_signups SET team_id=NULL, placed='', player_id=NULL WHERE id=?", g.id);
}

const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Works out where a division's waiting players would go. Each goes to whichever team has the
 * fewest players and is still under the ideal size. Players already on a team count toward its
 * size and stay where they are, except, when asked, the ones placed automatically before: those
 * go back in the pool and are dealt again.
 */
function seedPlan(league, { ideal, extras, redo }) {
  const teams = all('SELECT t.id, t.name, t.owner_id, t.league_id, (SELECT COUNT(*) FROM players WHERE team_id=t.id AND active=1) AS size FROM teams t WHERE t.league_id=? ORDER BY t.name COLLATE NOCASE', league.id);
  const before = new Map(teams.map((t) => [t.id, t.size]));
  let pool = all('SELECT * FROM org_signups WHERE league_id=? AND team_id IS NULL', league.id);
  if (redo) {
    const again = all("SELECT * FROM org_signups WHERE league_id=? AND team_id IS NOT NULL AND placed='auto'", league.id);
    for (const g of again) {
      const t = teams.find((x) => x.id === g.team_id);
      if (t) t.size--;
    }
    pool = [...pool, ...again];
  }
  const kept = new Map(teams.map((t) => [t.id, t.size]));
  const total = pool.length + teams.reduce((n, t) => n + t.size, 0);
  const moves = [];
  let waiting = 0;
  for (const g of shuffled(pool)) {
    const open = teams.filter((t) => t.size < ideal);
    const choices = open.length ? open : extras === 'spread' ? teams : [];
    if (!choices.length) {
      waiting++;
      if (g.team_id) moves.push({ g, team: null });
      continue;
    }
    const least = Math.min(...choices.map((t) => t.size));
    const few = choices.filter((t) => t.size === least);
    const team = few[crypto.randomInt(few.length)];
    team.size++;
    if (team.id !== g.team_id) moves.push({ g, team });
  }
  return {
    moves,
    out: {
      teams: teams.map((t) => ({ id: t.id, name: t.name, before: before.get(t.id), kept: kept.get(t.id), after: t.size })),
      pool: pool.length,
      placed: pool.length - waiting,
      waiting,
      // How many more teams it would take for everyone to fit at the ideal size.
      teams_short: Math.max(0, Math.ceil(total / ideal) - teams.length),
    },
  };
}

/** The routes for managers. Called from inside mountOrgs, which lends its helpers. */
export function mountSignups(app, { orgEnter, audit, orgOut }) {
  ensureSchema();
  const seasonOf = (c, id) => get('SELECT * FROM org_seasons WHERE id=? AND community_id=?', Number(id), c.id);
  const leagueOf = (c, id) => get('SELECT * FROM org_leagues WHERE id=? AND community_id=?', Number(id), c.id);
  const signupOf = (c, id) => get('SELECT * FROM org_signups WHERE id=? AND community_id=?', Number(id), c.id);

  /** A season's players, and its sign-up form. */
  function signupsOut(at, season) {
    reconcile(at.c.id);
    const contacts = can(at.m, 'rosters');
    const rows = all('SELECT * FROM org_signups WHERE season_id=? ORDER BY name COLLATE NOCASE, id', season.id);
    // Players a coach added to a roster themselves are on the team without being on this list.
    const others = all(
      `SELECT t.id, COUNT(p.id) AS n FROM teams t JOIN org_leagues l ON l.id=t.league_id JOIN players p ON p.team_id=t.id AND p.active=1
        WHERE l.season_id=? AND p.id NOT IN (SELECT player_id FROM org_signups WHERE season_id=? AND player_id IS NOT NULL) GROUP BY t.id`,
      season.id,
      season.id,
    );
    return {
      season: { id: season.id, name: season.name, open: !!season.signup_open, code: season.signup_code || '' },
      contacts,
      others: Object.fromEntries(others.map((o) => [o.id, o.n])),
      signups: rows.map((g) => ({
        id: g.id, league_id: g.league_id, name: g.name, grade: g.grade, team_id: g.team_id, placed: g.placed, source: g.source, created_at: g.created_at,
        parent_name: contacts ? g.parent_name : '', parent_email: contacts ? g.parent_email : '', parent_phone: contacts ? g.parent_phone : '', notes: contacts ? g.notes : '',
      })),
    };
  }
  const send = (res, at, season, more = {}) => res.json({ ...signupsOut(at, season), org: orgOut(at.c, at.m), ...more });

  app.get('/api/communities/:id/org/signups', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues' });
    if (!at) return;
    const season = seasonOf(at.c, req.query.season_id);
    if (!season) return res.status(404).json({ error: 'That season was not found.' });
    send(res, at, season);
  });

  // Opens or closes the season's sign-up form. Its link is made the first time it opens, and stays the same.
  app.put('/api/communities/:id/org/seasons/:seasonId/signups', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const season = seasonOf(at.c, req.params.seasonId);
    if (!season) return res.status(404).json({ error: 'That season was not found.' });
    const open = !!req.body.open;
    const code = season.signup_code || crypto.randomBytes(9).toString('base64url');
    run('UPDATE org_seasons SET signup_open=?, signup_code=? WHERE id=?', open ? 1 : 0, code, season.id);
    if (open !== !!season.signup_open) audit(at.c, req, `${open ? 'Opened' : 'Closed'} sign-ups for ${season.name}`);
    send(res, at, seasonOf(at.c, season.id));
  });

  // Adds players by hand: one with their details, or several names at once, one to a line.
  app.post('/api/communities/:id/org/signups', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const season = seasonOf(at.c, req.body.season_id);
    if (!season) return res.status(400).json({ error: 'Choose the season.' });
    const league = req.body.league_id ? leagueOf(at.c, req.body.league_id) : null;
    if (req.body.league_id && (!league || league.season_id !== season.id)) return res.status(400).json({ error: 'Choose a division in this season.' });
    const names = str(req.body.names ?? req.body.name, 20000).split(/\r?\n/).map((n) => n.trim().slice(0, 80)).filter(Boolean).slice(0, 300);
    if (!names.length) return res.status(400).json({ error: 'Type the player’s name.' });
    if (get('SELECT COUNT(*) AS n FROM org_signups WHERE season_id=?', season.id).n + names.length > SEASON_MAX) return res.status(400).json({ error: `A season holds ${SEASON_MAX} players at most.` });
    const email = str(req.body.parent_email, 200).toLowerCase();
    if (email && !EMAIL.test(email)) return res.status(400).json({ error: 'That email address does not look right.' });
    const one = names.length === 1;
    tx(() => {
      for (const name of names)
        run(
          'INSERT INTO org_signups (community_id, season_id, league_id, name, grade, parent_name, parent_email, parent_phone, notes, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          at.c.id, season.id, league?.id ?? null, name, one ? str(req.body.grade, 40) : '', one ? str(req.body.parent_name, 80) : '', one ? email : '', one ? str(req.body.parent_phone, 40) : '', one ? str(req.body.notes, 1000) : '', 'admin', nowIso(),
        );
    });
    audit(at.c, req, `Added ${one ? `the player "${names[0]}"` : `${names.length} players`} to ${season.name}${league ? `, ${league.name}` : ''}`);
    send(res, at, season);
  });

  // Changes a player's details or their division. A new division takes them off a team in the old one.
  app.put('/api/communities/:id/org/signups/:signupId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const g = signupOf(at.c, req.params.signupId);
    if (!g) return res.status(404).json({ error: 'That player was not found.' });
    const b = req.body;
    const contacts = can(at.m, 'rosters');
    const name = b.name === undefined ? g.name : str(b.name, 80);
    if (!name) return res.status(400).json({ error: 'Type the player’s name.' });
    const email = contacts && b.parent_email !== undefined ? str(b.parent_email, 200).toLowerCase() : g.parent_email;
    if (email && !EMAIL.test(email)) return res.status(400).json({ error: 'That email address does not look right.' });
    let leagueId = g.league_id;
    if (b.league_id !== undefined) {
      const league = b.league_id ? leagueOf(at.c, b.league_id) : null;
      if (b.league_id && (!league || league.season_id !== g.season_id)) return res.status(400).json({ error: 'Choose a division in this season.' });
      leagueId = league?.id ?? null;
    }
    const next = {
      name, grade: b.grade === undefined ? g.grade : str(b.grade, 40), parent_email: email,
      parent_name: contacts && b.parent_name !== undefined ? str(b.parent_name, 80) : g.parent_name,
      parent_phone: contacts && b.parent_phone !== undefined ? str(b.parent_phone, 40) : g.parent_phone,
      notes: contacts && b.notes !== undefined ? str(b.notes, 1000) : g.notes,
    };
    tx(() => {
      if (leagueId !== g.league_id && g.team_id) takeOff(g);
      run('UPDATE org_signups SET league_id=?, name=?, grade=?, parent_name=?, parent_email=?, parent_phone=?, notes=? WHERE id=?', leagueId, next.name, next.grade, next.parent_name, next.parent_email, next.parent_phone, next.notes, g.id);
      // The roster line follows, so the coach sees the same name and contact details.
      const now = signupOf(at.c, g.id);
      if (now.player_id) run('UPDATE players SET name=?, grade=?, parent_name=?, parent_email=?, parent_phone=? WHERE id=?', next.name, next.grade, next.parent_name, next.parent_email, next.parent_phone, now.player_id);
    });
    send(res, at, seasonOf(at.c, g.season_id));
  });

  app.delete('/api/communities/:id/org/signups/:signupId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const g = signupOf(at.c, req.params.signupId);
    if (!g) return res.status(404).json({ error: 'That player was not found.' });
    tx(() => {
      takeOff(g);
      run('DELETE FROM org_signups WHERE id=?', g.id);
    });
    audit(at.c, req, `Removed the player "${g.name}" from the sign-ups`);
    send(res, at, seasonOf(at.c, g.season_id));
  });

  // By hand: puts players on a team, moves them to another, or (with no team) takes them off.
  app.post('/api/communities/:id/org/signups/place', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(Number))].slice(0, 500);
    const list = ids.map((id) => signupOf(at.c, id)).filter(Boolean);
    if (!list.length) return res.status(400).json({ error: 'Choose at least one player.' });
    const season = seasonOf(at.c, list[0].season_id);
    if (list.some((g) => g.season_id !== season.id)) return res.status(400).json({ error: 'Choose players from one season.' });
    let team = null;
    if (req.body.team_id) {
      team = get('SELECT t.id, t.name, t.owner_id, t.league_id, l.season_id FROM teams t JOIN org_leagues l ON l.id=t.league_id WHERE t.id=? AND t.community_id=?', Number(req.body.team_id), at.c.id);
      if (!team || team.season_id !== season.id) return res.status(400).json({ error: 'Choose a team in this season.' });
    }
    tx(() => {
      for (const g of list) {
        if (team) putOn(g, team, 'manual');
        else takeOff(g);
      }
    });
    send(res, at, season);
  });

  // Deals the division's waiting players out to its teams. With apply off, it only says what would happen.
  app.post('/api/communities/:id/org/leagues/:leagueId/seed', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const league = leagueOf(at.c, req.params.leagueId);
    if (!league) return res.status(404).json({ error: 'That division was not found.' });
    const ideal = Math.floor(Number(req.body.ideal));
    if (!(ideal >= 1 && ideal <= 99)) return res.status(400).json({ error: 'Set how many players a team should have, from 1 to 99.' });
    if (!get('SELECT 1 AS ok FROM teams WHERE league_id=?', league.id)) return res.status(400).json({ error: `${league.name} has no teams yet. Add its teams first.` });
    const opts = { ideal, extras: req.body.extras === 'wait' ? 'wait' : 'spread', redo: !!req.body.redo };
    const season = seasonOf(at.c, league.season_id);
    if (!req.body.apply) return res.json({ plan: seedPlan(league, opts).out });
    let plan;
    tx(() => {
      plan = seedPlan(league, opts);
      for (const { g, team } of plan.moves) {
        if (team) putOn(g, team, 'auto');
        else takeOff(g);
      }
    });
    audit(at.c, req, `Placed ${plan.out.placed} ${plan.out.placed === 1 ? 'player' : 'players'} on teams in ${league.name} automatically`);
    send(res, at, season, { plan: plan.out });
  });

  // Takes back the automatic placing: those players wait again. Players placed by hand stay.
  app.post('/api/communities/:id/org/leagues/:leagueId/unseed', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const league = leagueOf(at.c, req.params.leagueId);
    if (!league) return res.status(404).json({ error: 'That division was not found.' });
    const list = all("SELECT * FROM org_signups WHERE league_id=? AND team_id IS NOT NULL AND placed='auto'", league.id);
    tx(() => list.forEach(takeOff));
    if (list.length) audit(at.c, req, `Took ${list.length} automatically placed ${list.length === 1 ? 'player' : 'players'} off teams in ${league.name}`);
    send(res, at, seasonOf(at.c, league.season_id));
  });
}

// --- Open to anyone with the link: a season's sign-up form ----------------------------
const formSends = new Map();
function tooManyForms(ip) {
  const now = Date.now();
  const recent = (formSends.get(ip) || []).filter((t) => now - t < 3600000);
  formSends.set(ip, recent);
  if (recent.length >= FORM_LIMIT) return true;
  recent.push(now);
  return false;
}

/** Mounted before sign-in is required. */
export function mountSignupsPublic(app) {
  ensureSchema();
  const seasonFor = (code) => {
    const c = str(code, 40);
    return c ? get("SELECT s.*, c.name AS org, c.image, c.brand_color, c.plan, c.plan_expires FROM org_seasons s JOIN communities c ON c.id=s.community_id WHERE s.signup_code=? AND c.plan='organization'", c) : null;
  };
  const closed = (s) => !s.signup_open || s.archived || (!!s.plan_expires && s.plan_expires < new Date().toISOString().slice(0, 10));

  app.get('/api/public/signup/:code', (req, res) => {
    const s = seasonFor(req.params.code);
    if (!s) return res.status(404).json({ error: 'There is no sign-up form at this address.' });
    res.json({
      org: s.org, image: s.image || '', color: s.brand_color || '', season: s.name, open: !closed(s),
      divisions: closed(s) ? [] : all('SELECT id, name, sport, age_group, gender FROM org_leagues WHERE season_id=? ORDER BY sport COLLATE NOCASE, name COLLATE NOCASE', s.id),
    });
  });

  app.post('/api/public/signup/:code', (req, res) => {
    const s = seasonFor(req.params.code);
    if (!s) return res.status(404).json({ error: 'There is no sign-up form at this address.' });
    if (closed(s)) return res.status(403).json({ error: `Sign-ups for ${s.name} are closed.` });
    const b = req.body || {};
    // A field people never see. Something that fills it in is not a person: say thanks, keep nothing.
    if (str(b.website, 200)) return res.json({ ok: true });
    const name = str(b.name, 80);
    const parent = str(b.parent_name, 80);
    const email = str(b.parent_email, 200).toLowerCase();
    if (!name) return res.status(400).json({ error: 'Type the player’s name.' });
    if (!parent) return res.status(400).json({ error: 'Type the name of a parent or guardian.' });
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Type an email address we can reach you at.' });
    const league = b.league_id ? get('SELECT id FROM org_leagues WHERE id=? AND season_id=?', Number(b.league_id), s.id) : null;
    if (b.league_id && !league) return res.status(400).json({ error: 'Choose a division from the list.' });
    // The same player sent twice by the same parent is kept once.
    if (get('SELECT 1 AS ok FROM org_signups WHERE season_id=? AND lower(name)=lower(?) AND parent_email=?', s.id, name, email)) return res.json({ ok: true });
    if (tooManyForms(req.ip)) return res.status(429).json({ error: 'That is a lot of sign-ups from one place. Try again in an hour.' });
    if (get('SELECT COUNT(*) AS n FROM org_signups WHERE season_id=?', s.id).n >= SEASON_MAX) return res.status(403).json({ error: 'This season is full. Get in touch with the organization.' });
    run(
      'INSERT INTO org_signups (community_id, season_id, league_id, name, grade, parent_name, parent_email, parent_phone, notes, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      s.community_id, s.id, league?.id ?? null, name, str(b.grade, 40), parent, email, str(b.parent_phone, 40), str(b.notes, 1000), 'form', nowIso(),
    );
    res.json({ ok: true });
  });
}
