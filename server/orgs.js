// Organizations: a community on the organization plan.
//
// A plain community is a group of coaches who talk and share. An organization is one that a club or
// league office runs on behalf of its coaches. It keeps everything a community has and adds:
//   - a quota of coach seats, used by the coaches and assistants it invites
//   - leagues, grouped into seasons, and the teams in them
//   - a schedule of games, which lands on each team's own calendar
//   - announcements to everyone or to some, and a record of who has seen them
//   - requirements each coach has to meet (a background check, say) and when they run out
//   - a log of what its admins did, and a public page with the schedule and standings
//
// The organization owns its teams: they live in a workspace of its own, which no single person
// owns, and coaches work in them the way helpers work in a team shared with them (server/staff.js).
// So a team and its roster stay when a coach moves on. What the coach wrote there is copied into
// their own account at that moment (keepWork below), so it is still theirs wherever they go next.
//
// The system administrator decides which communities are organizations, how many seats each has,
// and until when. Nothing here takes payment.
import crypto from 'node:crypto';
import { all, db, get, run, tx } from './db.js';
import { can, enter, membership, permsOf } from './communities.js';
import { isSystemAdmin } from './auth.js';
import { publicBase } from './invites.js';
import { mailerStatus, sendMail } from './mailer.js';
import { notify } from './notices.js';
import { createWorkspace, seedSport } from './seed.js';

function addColumn(table, column, ddl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
// 'group' is a plain community. 'organization' turns on everything in this file.
addColumn('communities', 'plan', "TEXT DEFAULT 'group'");
addColumn('communities', 'seats', 'INTEGER DEFAULT 0');
// The last day of the plan as YYYY-MM-DD, or empty for no end. After it, the organization's side is read-only.
addColumn('communities', 'plan_expires', "TEXT DEFAULT ''");
// The workspace its teams live in.
addColumn('communities', 'owner_id', 'INTEGER');
addColumn('communities', 'brand_color', "TEXT DEFAULT ''");
addColumn('communities', 'public_slug', "TEXT DEFAULT ''");
addColumn('communities', 'public_on', 'INTEGER DEFAULT 0');
// Who sees which sport's drills, plays and practices: 'all' is everything for everyone, 'sport' keeps a coach to the sports they coach.
addColumn('communities', 'library_scope', "TEXT DEFAULT 'all'");
// A member who coaches for the organization, and so uses one of its seats.
addColumn('community_members', 'coach', 'INTEGER DEFAULT 0');
addColumn('teams', 'community_id', 'INTEGER');
addColumn('teams', 'league_id', 'INTEGER');
// Who made a drill, play or plan. Only filled in inside an organization's workspace, where many people work.
addColumn('drills', 'created_by', 'INTEGER');
addColumn('plays', 'created_by', 'INTEGER');
addColumn('plans', 'created_by', 'INTEGER');

db.exec(`
CREATE TABLE IF NOT EXISTS org_seasons (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL, archived INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS org_leagues (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  season_id INTEGER NOT NULL REFERENCES org_seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sport TEXT NOT NULL DEFAULT 'Basketball', age_group TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS org_venues (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL, address TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS org_games (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  league_id INTEGER NOT NULL REFERENCES org_leagues(id) ON DELETE CASCADE,
  date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '', duration_min INTEGER NOT NULL DEFAULT 60,
  home_team_id INTEGER NOT NULL, away_team_id INTEGER NOT NULL, venue_id INTEGER,
  status TEXT NOT NULL DEFAULT 'scheduled',       -- 'scheduled' | 'final' | 'postponed' | 'cancelled'
  home_score INTEGER, away_score INTEGER, notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_org_games ON org_games(community_id, league_id, date);
-- Someone invited by email who has no account yet. An invited coach holds a seat until they join or the invitation is cancelled.
CREATE TABLE IF NOT EXISTS org_invites (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', coach INTEGER NOT NULL DEFAULT 1,
  team_id INTEGER, title TEXT NOT NULL DEFAULT '',
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  UNIQUE (community_id, email)
);
CREATE INDEX IF NOT EXISTS idx_org_invites_token ON org_invites(token_hash);
CREATE TABLE IF NOT EXISTS org_announcements (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, by_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '',
  pinned INTEGER DEFAULT 0, emailed INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS org_announcement_to (
  announcement_id INTEGER NOT NULL REFERENCES org_announcements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT,
  PRIMARY KEY (announcement_id, user_id)
);
-- Something every coach has to have: a background check, a safety course. And where each coach stands on it.
CREATE TABLE IF NOT EXISTS org_requirements (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS org_compliance (
  requirement_id INTEGER NOT NULL REFERENCES org_requirements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  done_on TEXT NOT NULL DEFAULT '', expires_on TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (requirement_id, user_id)
);
CREATE TABLE IF NOT EXISTS org_audit (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id INTEGER, user_name TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_audit ON org_audit(community_id, id);
-- What has already been copied into a coach's own account, so nothing is copied twice.
CREATE TABLE IF NOT EXISTS org_keepsakes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, source_id INTEGER NOT NULL, copy_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, source_id)
);
`);

const INVITE_DAYS = 14;
const str = (v, max = 200) => String(v ?? '').slice(0, max);
const parse = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowIso = () => new Date().toISOString();
const pad = (n) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
const isTime = (v) => /^\d{2}:\d{2}$/.test(String(v ?? ''));
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const lastId = (r) => Number(r.lastInsertRowid);

export const isOrg = (c) => !!c && c.plan === 'organization';
/** The plan has run out: everything stays, and can be read, but the organization's side cannot be changed. */
export const lapsed = (c) => isOrg(c) && !!c.plan_expires && c.plan_expires < today();
const lapsedMessage = (c) => `The organization plan for ${c.name} ended on ${c.plan_expires}. Everything is still here to read, but nothing can be changed until the plan is renewed.`;

export const seatsUsed = (communityId) =>
  get('SELECT (SELECT COUNT(*) FROM community_members WHERE community_id=? AND coach=1) + (SELECT COUNT(*) FROM org_invites WHERE community_id=? AND coach=1) AS n', communityId, communityId).n;
const seatFree = (c) => seatsUsed(c.id) < (c.seats || 0);
const noSeat = (c) => `All ${c.seats || 0} coach seats of ${c.name} are in use. Free one by removing a coach or cancelling an invitation, or ask for more seats.`;

/** What every member is told about the plan a community is on. */
export function orgSummary(c) {
  if (!isOrg(c)) return { plan: 'group', org: null };
  return {
    plan: 'organization',
    org: { seats: c.seats || 0, seats_used: seatsUsed(c.id), expires: c.plan_expires || '', lapsed: lapsed(c), brand_color: c.brand_color || '', public_on: !!c.public_on, public_slug: c.public_slug || '', library_scope: c.library_scope === 'sport' ? 'sport' : 'all' },
  };
}

// --- Keeping the library to a coach's own sports ----------------------------------
/**
 * The sports a person may see in an organization's libraries, as lower-case names, or null for all
 * of them. Only narrowed when the organization asked for it, and only for someone who coaches at
 * least one of its teams: admins, and members on no team, see everything.
 */
export function librarySports(c, userId) {
  if (!isOrg(c) || c.library_scope !== 'sport') return null;
  const m = membership(c.id, userId);
  if (!m || m.role !== 'member') return null;
  const names = all('SELECT DISTINCT lower(sp.name) AS name FROM team_staff s JOIN teams t ON t.id=s.team_id JOIN sports sp ON sp.id=t.sport_id WHERE t.community_id=? AND s.user_id=?', c.id, userId).map((r) => r.name);
  return names.length ? new Set(names) : null;
}
/** The same, inside the organization's own workspace: the ids of the sports a coach may see there, or null for all. */
export function workspaceSports(teamId, userId) {
  const c = get('SELECT c.* FROM teams t JOIN communities c ON c.id=t.community_id WHERE t.id=?', Number(teamId));
  const names = c && librarySports(c, userId);
  if (!names) return null;
  return new Set(all('SELECT id, lower(name) AS name FROM sports WHERE owner_id=?', c.owner_id).filter((s) => names.has(s.name)).map((s) => s.id));
}

// --- Teams the organization owns, and the people who coach them -----------------
const HEAD = 'Head coach';
const HEAD_PERMS = { plans: true, drills: true, plays: true, resources: true, roster: true, schedule: true, contacts: true, manage: false };
const ASSISTANT_PERMS = { plans: true, drills: true, plays: true, resources: true, roster: false, schedule: false, contacts: true, manage: false };

/** The organization a team belongs to, if it belongs to one. Used by the gate in server/staff.js. */
export function orgOfTeam(teamId) {
  const c = get('SELECT c.* FROM teams t JOIN communities c ON c.id=t.community_id WHERE t.id=?', Number(teamId));
  return c ? { id: c.id, name: c.name, lapsed: lapsed(c), lapsedMessage: lapsedMessage(c) } : null;
}
/**
 * An admin who looks after the organization's leagues can open any of its teams. They see players'
 * names, but parents' contact details only when they were given that power as well.
 */
export function orgAccess(user, teamId) {
  const team = get('SELECT community_id FROM teams WHERE id=?', Number(teamId));
  const m = team?.community_id ? membership(team.community_id, user.id) : null;
  if (!m || !can(m, 'leagues')) return null;
  const rosters = can(m, 'rosters');
  return { title: 'Organization admin', perms: { plans: true, drills: true, plays: true, resources: true, schedule: true, manage: true, roster: rosters, contacts: rosters } };
}
/**
 * Marks what a request makes as made by the person who sent it. Called for requests inside an
 * organization's workspace, just before the handler runs: whatever drills, plays and plans exist
 * by the time it answers and did not before are theirs.
 */
export function stampAuthor(req, res) {
  const tables = ['drills', 'plays', 'plans'];
  const before = Object.fromEntries(tables.map((t) => [t, get(`SELECT COALESCE(MAX(id), 0) AS n FROM ${t}`).n]));
  const json = res.json.bind(res);
  res.json = (body) => {
    for (const t of tables) run(`UPDATE ${t} SET created_by=? WHERE owner_id=? AND id>? AND created_by IS NULL`, req.user.id, req.ownerId, before[t]);
    return json(body);
  };
}

const coachesOf = (teamId) =>
  all(`SELECT s.user_id, s.title, u.name FROM team_staff s JOIN users u ON u.id=s.user_id WHERE s.team_id=? ORDER BY s.title='${HEAD}' DESC, u.name COLLATE NOCASE`, teamId).map((s) => ({ user_id: s.user_id, name: s.name, title: s.title, head: s.title === HEAD }));
const orgTeam = (c, teamId) => get('SELECT * FROM teams WHERE id=? AND community_id=?', Number(teamId), c.id);
const staffOfTeams = (teamIds) => (teamIds.length ? all(`SELECT DISTINCT user_id FROM team_staff WHERE team_id IN (${teamIds.map(Number).join(',')})`).map((r) => r.user_id) : []);

function ensureWorkspace(c) {
  if (c.owner_id) return c.owner_id;
  const ownerId = createWorkspace(`${c.name} (organization)`);
  run('UPDATE communities SET owner_id=? WHERE id=?', ownerId, c.id);
  c.owner_id = ownerId;
  return ownerId;
}
/** The organization's own copy of a sport, made the first time a league plays it. */
function sportFor(ownerId, name) {
  const hit = get('SELECT id FROM sports WHERE owner_id=? AND lower(name)=lower(?)', ownerId, name);
  return hit ? hit.id : seedSport(ownerId, str(name, 40).trim() || 'Basketball').sport;
}

// --- Keeping a coach's work when they move on ------------------------------------
const stripMembers = (json) => JSON.stringify((Array.isArray(parse(json, [])) ? parse(json, []) : []).map((g) => ({ name: str(g?.name), notes_html: str(g?.notes_html, 20000), members: [] })));
const linksOnly = (json) => {
  const e = parse(json, {});
  return Array.isArray(e?.links) ? e.links : [];
};
/**
 * Copies what a coach wrote for an organization's team into their own account: their drills and
 * plays in that sport, and their practices, which go into a team of their own named after the one
 * they coached. Rosters, players' notes and uploaded files stay with the organization.
 * Safe to call again: what was copied before is not copied twice. Returns what was copied, or null.
 */
export function keepWork(userId, team, communityName) {
  const home = get("SELECT owner_id FROM memberships WHERE user_id=? AND role='owner' ORDER BY owner_id LIMIT 1", userId)?.owner_id;
  if (!home || home === team.owner_id) return null;
  const kept = (kind, table, sourceId) => {
    const copy = get('SELECT copy_id FROM org_keepsakes WHERE user_id=? AND kind=? AND source_id=?', userId, kind, sourceId)?.copy_id;
    return copy && get(`SELECT id FROM ${table} WHERE id=? AND owner_id=?`, copy, home) ? copy : 0;
  };
  const once = (kind, sourceId) => !get('SELECT 1 AS ok FROM org_keepsakes WHERE user_id=? AND kind=? AND source_id=?', userId, kind, sourceId);
  const remember = (kind, sourceId, copyId) => run('INSERT OR REPLACE INTO org_keepsakes (user_id, kind, source_id, copy_id) VALUES (?,?,?,?)', userId, kind, sourceId, copyId);

  const drills = all('SELECT * FROM drills WHERE owner_id=? AND sport_id=? AND created_by=?', team.owner_id, team.sport_id, userId).filter((d) => once('drill', d.id));
  const plays = all('SELECT * FROM plays WHERE owner_id=? AND sport_id=? AND created_by=?', team.owner_id, team.sport_id, userId).filter((p) => once('play', p.id));
  const plans = all('SELECT * FROM plans WHERE team_id=? AND created_by=?', team.id, userId).filter((p) => once('plan', p.id));
  if (!drills.length && !plays.length && !plans.length) return null;

  const sportName = get('SELECT name FROM sports WHERE id=?', team.sport_id)?.name || 'Basketball';
  const sportId = sportFor(home, sportName);
  const tagFor = (t) => {
    const hit = get('SELECT id FROM tags WHERE owner_id=? AND sport_id=? AND lower(name)=lower(?)', home, sportId, t.name);
    return hit ? hit.id : lastId(run('INSERT INTO tags (owner_id, sport_id, name, color) VALUES (?,?,?,?)', home, sportId, t.name, t.color));
  };
  const tagsOf = (table, col, rowId) => all(`SELECT t.name, t.color FROM ${table} x JOIN tags t ON t.id=x.tag_id WHERE x.${col}=?`, rowId);
  const copyPlay = (p) => {
    const have = kept('play', 'plays', p.id);
    if (have) return have;
    const id = lastId(
      run(
        'INSERT INTO plays (owner_id, sport_id, name, category, labels_json, court, flipped, notes, frames_json, attachments_json) VALUES (?,?,?,?,?,?,?,?,?,?)',
        home, sportId, p.name, p.category, p.labels_json, p.court, p.flipped ? 1 : 0, p.notes, p.frames_json, JSON.stringify({ images: [], videos: [], links: linksOnly(p.attachments_json) }),
      ),
    );
    remember('play', p.id, id);
    return id;
  };
  // A play drawn by someone else but used in this coach's drill or practice comes along, so the copy is whole.
  const playsIn = (json) =>
    (Array.isArray(parse(json, [])) ? parse(json, []) : [])
      .map((pid) => get('SELECT * FROM plays WHERE id=? AND owner_id=?', Number(pid), team.owner_id))
      .filter(Boolean)
      .map(copyPlay);

  for (const p of plays) copyPlay(p);
  for (const d of drills) {
    const id = lastId(
      run(
        'INSERT INTO drills (owner_id, sport_id, name, duration_min, notes_html, coach_notes_html, callout, groups_json) VALUES (?,?,?,?,?,?,?,?)',
        home, sportId, d.name, d.duration_min, d.notes_html, d.coach_notes_html || '', '', stripMembers(d.groups_json),
      ),
    );
    run('UPDATE drills SET images_json=?, plays_json=?, extras_json=? WHERE id=?', '[]', JSON.stringify(playsIn(d.plays_json)), JSON.stringify({ links: linksOnly(d.extras_json), videos: [] }), id);
    for (const t of tagsOf('drill_tags', 'drill_id', d.id)) run('INSERT OR IGNORE INTO drill_tags (drill_id, tag_id) VALUES (?,?)', id, tagFor(t));
    remember('drill', d.id, id);
  }
  if (plans.length) {
    let mine = kept('team', 'teams', team.id);
    if (!mine) {
      mine = lastId(
        run(
          'INSERT INTO teams (owner_id, sport_id, name, season, notes) VALUES (?,?,?,?,?)',
          home, sportId, `${team.name} (${communityName})`, team.season || '', `The practices you wrote for ${team.name} at ${communityName}. The roster stayed with the organization.`,
        ),
      );
      remember('team', team.id, mine);
    }
    for (const p of plans) {
      const planId = lastId(
        run(
          `INSERT INTO plans (owner_id, team_id, kind, title, date, start_time, location, intro_html, is_template, assigned_json, is_game, notes, print_notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          home, mine, p.kind, p.title, p.date, p.start_time, p.location, p.intro_html, p.is_template ? 1 : 0, '[]', p.is_game ? 1 : 0, p.notes || '', p.print_notes === 0 ? 0 : 1,
        ),
      );
      all('SELECT * FROM plan_items WHERE plan_id=? ORDER BY position, id', p.id).forEach((it, i) => {
        const itemId = lastId(
          run(
            `INSERT INTO plan_items (plan_id, position, kind, title, duration_min, notes_html, coach_notes_html, callout, reps, groups_json, player_notes_json, drill_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            planId, i, it.kind, it.title, it.duration_min, it.notes_html, it.coach_notes_html || '', '', it.reps, stripMembers(it.groups_json), '[]', null,
          ),
        );
        run('UPDATE plan_items SET images_json=?, plays_json=?, extras_json=? WHERE id=?', '[]', JSON.stringify(playsIn(it.plays_json)), JSON.stringify({ links: linksOnly(it.extras_json), videos: [] }), itemId);
        for (const t of tagsOf('plan_item_tags', 'item_id', it.id)) run('INSERT OR IGNORE INTO plan_item_tags (item_id, tag_id) VALUES (?,?)', itemId, tagFor(t));
      });
      remember('plan', p.id, planId);
    }
  }
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [drills.length && count(drills.length, 'drill', 'drills'), plays.length && count(plays.length, 'play', 'plays'), plans.length && count(plans.length, 'practice', 'practices')].filter(Boolean);
  notify(userId, {
    kind: 'keepsake', ref: `team-${team.id}`, link: '/',
    title: `Your work from ${team.name} is in your own account`,
    body: `${parts.join(', ')} you wrote at ${communityName} ${parts.length === 1 && /^1 /.test(parts[0]) ? 'was' : 'were'} copied to your own teams and library, so you keep them. Use "Switch team" and choose your own teams to find them.`,
  });
  return { drills: drills.length, plays: plays.length, plans: plans.length };
}

/** Takes a coach off one of the organization's teams, keeping their work for them first. */
function unassign(c, team, userId) {
  if (!get('SELECT 1 AS ok FROM team_staff WHERE team_id=? AND user_id=?', team.id, userId)) return false;
  keepWork(userId, team, c.name);
  run('DELETE FROM team_staff WHERE team_id=? AND user_id=?', team.id, userId);
  return true;
}
/** Someone is leaving the community, or being removed: they come off its teams, with their work kept. */
export function orgMemberLeaving(c, userId) {
  if (!c.owner_id) return;
  for (const t of all('SELECT * FROM teams WHERE community_id=?', c.id)) unassign(c, t, userId);
}
/** A coach left a team on their own, from their Teams page. */
export function orgStaffLeaving(teamId, userId) {
  const team = get('SELECT * FROM teams WHERE id=? AND community_id IS NOT NULL', Number(teamId));
  const c = team && get('SELECT * FROM communities WHERE id=?', team.community_id);
  if (c) keepWork(userId, team, c.name);
}

// --- Invitations by email --------------------------------------------------------
const sent = new Map();
const INVITE_LIMIT = 200;
function tooManyOrgInvites(userId) {
  const recent = (sent.get(userId) || []).filter((t) => Date.now() - t < 3600_000);
  sent.set(userId, recent);
  return recent.length >= INVITE_LIMIT;
}
const INVITE_SELECT = `SELECT i.*, c.name AS community, (SELECT name FROM users WHERE id=i.invited_by) AS inviter, (SELECT name FROM teams WHERE id=i.team_id) AS team_name
  FROM org_invites i JOIN communities c ON c.id=i.community_id`;
async function mailOrgInvite(req, inviteId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('UPDATE org_invites SET token_hash=?, expires_at=? WHERE id=?', sha256(token), new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString(), inviteId);
  const inv = get(`${INVITE_SELECT} WHERE i.id=?`, inviteId);
  sent.set(req.user.id, [...(sent.get(req.user.id) || []), Date.now()]);
  const as = inv.coach ? (inv.team_name ? `${(inv.title || 'coach').toLowerCase()} of ${inv.team_name}` : 'a coach') : 'a member';
  return sendMail({
    to: inv.email,
    subject: `${req.user.name} invited you to ${inv.community} on Dime Coach`,
    text:
      `Hi${inv.name ? ` ${inv.name}` : ''},\n\n${req.user.name} (${req.user.email}) invited you to join ${inv.community} on Dime Coach as ${as}.\n\n` +
      `Dime Coach is where coaches plan practices, keep drills and draw plays together. ${inv.community} uses it for its teams, schedules and announcements.\n\n` +
      `Create your account to join:\n\n${publicBase(req)}/join?token=${token}\n\n` +
      `The link works for ${INVITE_DAYS} days. If you were not expecting this, ignore this message and nothing will happen.`,
    secret: token,
  });
}
/** The invitation a link belongs to, in the shape server/auth.js expects of a team invitation, or null. */
export function orgInviteByToken(token) {
  const inv = token ? get(`${INVITE_SELECT} WHERE i.token_hash=?`, sha256(String(token))) : null;
  if (!inv || inv.expires_at <= nowIso()) return null;
  return { email: inv.email, team: inv.team_name || '', community: inv.community, sport: '', season: '', inviter: inv.inviter || 'An admin', title: inv.coach ? (inv.team_name && inv.title) || 'Coach' : 'Member', name: inv.name };
}
/**
 * Puts a person in every organization their address was invited to, and on the team named in the
 * invitation. Only call this when the address is known to be theirs. Returns how many they joined.
 */
export function claimOrgInvites(userId, email) {
  const me = get('SELECT name FROM users WHERE id=?', userId);
  const address = String(email).toLowerCase();
  let joined = 0;
  for (const inv of all('SELECT * FROM org_invites WHERE email=? AND expires_at > ?', address, nowIso())) {
    const c = get('SELECT * FROM communities WHERE id=?', inv.community_id);
    const m = membership(c.id, userId);
    if (m) run("UPDATE community_members SET status='active', coach=MAX(coach, ?) WHERE community_id=? AND user_id=?", inv.coach ? 1 : 0, c.id, userId);
    else run("INSERT INTO community_members (community_id, user_id, role, status, invited_by, coach) VALUES (?,?,'member','active',?,?)", c.id, userId, inv.invited_by, inv.coach ? 1 : 0);
    const team = inv.team_id ? orgTeam(c, inv.team_id) : null;
    if (team && inv.coach) assign(c, team, userId, inv.title || 'Assistant coach', inv.invited_by);
    notify(inv.invited_by, { kind: 'community', title: `${me?.name || inv.email} joined ${c.name}`, body: 'They accepted your invitation.', link: `/communities/${c.id}?tab=people` });
    run('INSERT INTO org_audit (community_id, user_id, user_name, text, at) VALUES (?,?,?,?,?)', c.id, userId, me?.name || inv.email, 'Accepted an invitation and joined', nowIso());
    joined++;
  }
  // An invitation that ran out still frees its seat once the person has an account by other means.
  run('DELETE FROM org_invites WHERE email=?', address);
  return joined;
}
function assign(c, team, userId, title, byUserId) {
  const head = title === HEAD;
  run(
    'INSERT INTO team_staff (team_id, user_id, title, perms_json, added_by) VALUES (?,?,?,?,?) ON CONFLICT(team_id, user_id) DO UPDATE SET title=excluded.title, perms_json=excluded.perms_json',
    team.id, userId, title, JSON.stringify(head ? HEAD_PERMS : ASSISTANT_PERMS), byUserId ?? null,
  );
}

// --- The schedule ------------------------------------------------------------------
const addMinutes = (time, mins) => {
  if (!isTime(time)) return '';
  const t = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + mins;
  return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
};
const addDays = (date, days) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const GAME_SELECT = `SELECT g.*, h.name AS home, a.name AS away, v.name AS venue, v.address AS venue_address
  FROM org_games g LEFT JOIN teams h ON h.id=g.home_team_id LEFT JOIN teams a ON a.id=g.away_team_id LEFT JOIN org_venues v ON v.id=g.venue_id`;
const minutesOf = (t) => (isTime(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
const overlap = (a, b) => {
  const s1 = minutesOf(a.start_time);
  const s2 = minutesOf(b.start_time);
  // Two games on a day with no time given could be at the same time, so they count as clashing.
  if (s1 === null || s2 === null) return true;
  return s1 < s2 + b.duration_min && s2 < s1 + a.duration_min;
};
/** A game's place on each of its two teams' calendars. Called whenever a game is made, changed or removed. */
function pushGame(c, gameId) {
  run('DELETE FROM events WHERE uid=?', `league-${gameId}`);
  const g = get(`${GAME_SELECT} WHERE g.id=?`, gameId);
  if (!g || g.status === 'cancelled') return;
  const prefix = g.status === 'postponed' ? 'Postponed: ' : '';
  const where = [g.venue, g.venue_address].filter(Boolean).join(', ');
  const note = `League game set by ${c.name}.${g.notes ? ` ${g.notes}` : ''}`;
  for (const [teamId, title] of [[g.home_team_id, `${prefix}vs ${g.away ?? 'TBD'}`], [g.away_team_id, `${prefix}at ${g.home ?? 'TBD'}`]]) {
    const team = get('SELECT id, owner_id FROM teams WHERE id=?', teamId);
    if (team)
      run(
        'INSERT INTO events (owner_id, team_id, uid, kind, title, date, start_time, end_time, location, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
        team.owner_id, team.id, `league-${gameId}`, 'game', title, g.date, g.start_time, addMinutes(g.start_time, g.duration_min), where, note,
      );
  }
}
function gamesOut(c, where = '', ...params) {
  const games = all(`${GAME_SELECT} WHERE g.community_id=? ${where} ORDER BY g.date, g.start_time, g.id`, c.id, ...params);
  // Double bookings are pointed out, not refused: the person setting the schedule may know better.
  const live = all("SELECT id, date, start_time, duration_min, home_team_id, away_team_id, venue_id FROM org_games WHERE community_id=? AND status IN ('scheduled', 'final')", c.id);
  const byDate = new Map();
  for (const g of live) byDate.set(g.date, [...(byDate.get(g.date) ?? []), g]);
  return games.map((g) => {
    const warnings = [];
    if (g.status === 'scheduled' || g.status === 'final')
      for (const o of byDate.get(g.date) ?? []) {
        if (o.id === g.id || !overlap(g, o)) continue;
        if (g.venue_id && o.venue_id === g.venue_id) warnings.push(`${g.venue} is also booked for another game at this time.`);
        for (const [teamId, name] of [[g.home_team_id, g.home], [g.away_team_id, g.away]])
          if (o.home_team_id === teamId || o.away_team_id === teamId) warnings.push(`${name} has another game at this time.`);
      }
    return {
      id: g.id, league_id: g.league_id, date: g.date, start_time: g.start_time, duration_min: g.duration_min,
      home_team_id: g.home_team_id, away_team_id: g.away_team_id, home: g.home ?? 'Removed team', away: g.away ?? 'Removed team',
      venue_id: g.venue_id ?? null, venue: g.venue ?? '', status: g.status, home_score: g.home_score, away_score: g.away_score, notes: g.notes,
      warnings: [...new Set(warnings)],
    };
  });
}
function standingsOf(c, leagueId) {
  const rows = new Map(all('SELECT id, name FROM teams WHERE community_id=? AND league_id=? ORDER BY name COLLATE NOCASE', c.id, leagueId).map((t) => [t.id, { team_id: t.id, team: t.name, played: 0, won: 0, lost: 0, tied: 0, points_for: 0, points_against: 0 }]));
  for (const g of all("SELECT * FROM org_games WHERE community_id=? AND league_id=? AND status='final' AND home_score IS NOT NULL AND away_score IS NOT NULL", c.id, leagueId)) {
    for (const [mine, theirs, us, them] of [[g.home_team_id, g.away_team_id, g.home_score, g.away_score], [g.away_team_id, g.home_team_id, g.away_score, g.home_score]]) {
      const r = rows.get(mine);
      if (!r || !rows.has(theirs)) continue;
      r.played++;
      r.points_for += us;
      r.points_against += them;
      if (us > them) r.won++;
      else if (us < them) r.lost++;
      else r.tied++;
    }
  }
  const pct = (r) => (r.played ? (r.won + r.tied / 2) / r.played : -1);
  return [...rows.values()].sort((a, b) => pct(b) - pct(a) || b.points_for - b.points_against - (a.points_for - a.points_against) || a.team.localeCompare(b.team));
}
/** Every team plays every other once: the "circle" way of pairing them, round by round. */
function roundRobin(ids) {
  const list = [...ids];
  if (list.length % 2) list.push(null);
  const rounds = [];
  for (let r = 0; r < list.length - 1; r++) {
    const pairs = [];
    for (let i = 0; i < list.length / 2; i++) {
      const a = list[i];
      const b = list[list.length - 1 - i];
      // Alternating who is at home keeps any one team from always hosting.
      if (a && b) pairs.push((r + i) % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

// --- Announcements -----------------------------------------------------------------
/** Who an announcement goes to, as user ids, and how to say it in words. */
function audienceOf(c, a) {
  const members = all("SELECT user_id, role, coach FROM community_members WHERE community_id=? AND status='active'", c.id);
  const inOrg = new Set(members.map((m) => m.user_id));
  const only = (ids) => [...new Set(ids)].filter((id) => inOrg.has(id));
  const names = (table, ids) => (ids.length ? all(`SELECT name FROM ${table} WHERE community_id=? AND id IN (${ids.join(',')}) ORDER BY name COLLATE NOCASE`, c.id).map((r) => r.name) : []);
  const ids = (Array.isArray(a?.ids) ? a.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
  const teamIds = (where, ...p) => all(`SELECT t.id FROM teams t LEFT JOIN org_leagues l ON l.id=t.league_id WHERE t.community_id=? AND ${where}`, c.id, ...p).map((t) => t.id);
  switch (a?.kind) {
    case 'coaches':
      return { users: members.filter((m) => m.coach).map((m) => m.user_id), text: 'All coaches' };
    case 'head':
      return { users: only(all(`SELECT s.user_id FROM team_staff s JOIN teams t ON t.id=s.team_id WHERE t.community_id=? AND s.title='${HEAD}'`, c.id).map((r) => r.user_id)), text: 'Head coaches' };
    case 'admins':
      return { users: members.filter((m) => m.role !== 'member').map((m) => m.user_id), text: 'Admins' };
    case 'leagues':
      return { users: only(staffOfTeams(ids.length ? teamIds(`t.league_id IN (${ids.join(',')})`) : [])), text: `Coaches in ${names('org_leagues', ids).join(', ') || 'no league'}` };
    case 'teams':
      return { users: only(staffOfTeams(ids.length ? teamIds(`t.id IN (${ids.join(',')})`) : [])), text: `Coaches of ${names('teams', ids).join(', ') || 'no team'}` };
    case 'sport':
      return { users: only(staffOfTeams(teamIds('lower(l.sport)=lower(?)', str(a.value, 40)))), text: `${str(a.value, 40)} coaches` };
    case 'age':
      return { users: only(staffOfTeams(teamIds('lower(l.age_group)=lower(?)', str(a.value, 40)))), text: `${str(a.value, 40)} coaches` };
    case 'people':
      return { users: only(ids), text: `${only(ids).length} chosen ${only(ids).length === 1 ? 'person' : 'people'}` };
    default:
      return { users: members.map((m) => m.user_id), text: 'Everyone' };
  }
}

// --- Requirements ------------------------------------------------------------------
const SOON_DAYS = 30;
function complianceState(row) {
  if (!row || !row.done_on) return 'missing';
  if (row.expires_on && row.expires_on < today()) return 'expired';
  if (row.expires_on && row.expires_on <= addDays(today(), SOON_DAYS)) return 'due';
  return 'ok';
}

export function mountOrgs(app) {
  /** Loads an organization and the caller's place in it. Answers the request itself when it cannot go ahead. */
  function orgEnter(req, res, { perm = '', admin = false, write = false } = {}) {
    const at = enter(req, res, perm ? { perm } : {});
    if (!at) return null;
    if (!isOrg(at.c)) {
      res.status(400).json({ error: 'This is only for communities on the organization plan.' });
      return null;
    }
    if (admin && at.m.role === 'member') {
      res.status(403).json({ error: 'Only admins of this organization can see that.' });
      return null;
    }
    if (write && lapsed(at.c)) {
      res.status(403).json({ error: lapsedMessage(at.c) });
      return null;
    }
    return at;
  }
  const audit = (c, req, text) => run('INSERT INTO org_audit (community_id, user_id, user_name, text, at) VALUES (?,?,?,?,?)', c.id, req.user.id, req.user.name, text, nowIso());
  const fresh = (c) => get('SELECT * FROM communities WHERE id=?', c.id);

  /** Everything about the organization the caller may see, in one answer. */
  function orgOut(c0, m) {
    const c = fresh(c0);
    const p = permsOf(m);
    const teams = all(
      `SELECT t.id, t.name, t.league_id, (SELECT name FROM sports WHERE id=t.sport_id) AS sport, (SELECT COUNT(*) FROM players WHERE team_id=t.id AND active=1) AS players
         FROM teams t WHERE t.community_id=? ORDER BY t.name COLLATE NOCASE`,
      c.id,
    ).map((t) => {
      const coaches = coachesOf(t.id);
      return { ...t, coaches, mine: coaches.some((s) => s.user_id === m.user_id), can_open: p.leagues || coaches.some((s) => s.user_id === m.user_id) };
    });
    const out = {
      ...orgSummary(c),
      can: p,
      seasons: all('SELECT id, name, archived FROM org_seasons WHERE community_id=? ORDER BY archived, id DESC', c.id).map((s) => ({ ...s, archived: !!s.archived })),
      leagues: all('SELECT id, season_id, name, sport, age_group FROM org_leagues WHERE community_id=? ORDER BY name COLLATE NOCASE', c.id),
      teams,
      venues: all('SELECT id, name, address FROM org_venues WHERE community_id=? ORDER BY name COLLATE NOCASE', c.id),
      requirements: [],
      people: [],
      invites: [],
    };
    // The list of people, their seats and their paperwork is for those who manage people or leagues.
    if (!p.people && !p.leagues) return out;
    out.requirements = all('SELECT id, name FROM org_requirements WHERE community_id=? ORDER BY id', c.id);
    const done = all('SELECT x.* FROM org_compliance x JOIN org_requirements r ON r.id=x.requirement_id WHERE r.community_id=?', c.id);
    out.people = all(
      `SELECT u.id, u.name, u.email, u.last_action_at, u.last_login_at, cm.role, cm.coach FROM community_members cm JOIN users u ON u.id=cm.user_id
        WHERE cm.community_id=? AND cm.status='active' ORDER BY u.name COLLATE NOCASE`,
      c.id,
    ).map((u) => ({
      id: u.id, name: u.name, email: p.people ? u.email : undefined, role: u.role, coach: !!u.coach,
      last_active_at: p.people ? u.last_action_at || u.last_login_at || null : undefined,
      teams: teams.filter((t) => t.coaches.some((s) => s.user_id === u.id)).map((t) => ({ id: t.id, name: t.name, title: t.coaches.find((s) => s.user_id === u.id).title })),
      compliance: p.people
        ? out.requirements.map((r) => {
            const row = done.find((x) => x.requirement_id === r.id && x.user_id === u.id);
            return { requirement_id: r.id, done_on: row?.done_on || '', expires_on: row?.expires_on || '', note: row?.note || '', state: complianceState(row) };
          })
        : [],
    }));
    if (p.people)
      out.invites = all(`${INVITE_SELECT} WHERE i.community_id=? ORDER BY i.id`, c.id).map((i) => ({
        id: i.id, email: i.email, name: i.name, coach: !!i.coach, team: i.team_name || '', title: i.title, invited_by: i.inviter || '', invited_at: i.created_at, expired: i.expires_at < nowIso(),
      }));
    return out;
  }
  const send = (res, at) => res.json(orgOut(at.c, at.m));

  app.get('/api/communities/:id/org', (req, res) => {
    const at = orgEnter(req, res);
    if (at) send(res, at);
  });

  // --- People and seats ------------------------------------------------------------
  /** Adds one person: straight in when they have an account, by emailed invitation when they do not. */
  async function addPerson(req, c, { email, name, coach, team, title }) {
    if (!validEmail(email)) return { ok: false, error: 'That is not an email address.' };
    const user = get('SELECT * FROM users WHERE lower(email)=?', email);
    if (user?.status === 'disabled') return { ok: false, error: 'The account with that email has been turned off.' };
    if (user?.status === 'active') {
      const m = membership(c.id, user.id);
      if (m?.status === 'active' && (!coach || m.coach) && !team) return { ok: false, error: `${user.name} is already in ${c.name}.` };
      if (coach && !m?.coach && !seatFree(c)) return { ok: false, error: noSeat(c) };
      if (m) run("UPDATE community_members SET status='active', coach=MAX(coach, ?) WHERE community_id=? AND user_id=?", coach ? 1 : 0, c.id, user.id);
      else run("INSERT INTO community_members (community_id, user_id, role, status, invited_by, coach) VALUES (?,?,'member','active',?,?)", c.id, user.id, req.user.id, coach ? 1 : 0);
      if (team && coach) assign(c, team, user.id, title, req.user.id);
      const as = coach ? (team ? `${title.toLowerCase()} of ${team.name}` : 'a coach') : 'a member';
      notify(user.id, {
        kind: 'community', link: `/communities/${c.id}`,
        title: `${req.user.name} added you to ${c.name}`,
        body: `You are in as ${as}.${team ? ` To open the team, use "Switch team" and choose ${team.name}.` : ''}`,
      });
      if (mailerStatus().configured)
        sendMail({
          to: user.email,
          subject: `${req.user.name} added you to ${c.name} on Dime Coach`,
          text: `Hi ${user.name},\n\n${req.user.name} added you to ${c.name} on Dime Coach as ${as}.\n\nSign in to see it:\n\n${publicBase(req)}/communities/${c.id}`,
        });
      audit(c, req, `Added ${user.name} as ${as}`);
      return { ok: true, added: true, name: user.name };
    }
    // Nobody can sign in with this address yet: they are invited by email, and join once they have made an account.
    if (!mailerStatus().configured) return { ok: false, error: 'Nobody has an account with that email yet, and invitations by email are not set up.' };
    if (tooManyOrgInvites(req.user.id)) return { ok: false, error: 'That is a lot of invitations. Wait an hour before sending more.' };
    const old = get('SELECT * FROM org_invites WHERE community_id=? AND email=?', c.id, email);
    if (coach && !old?.coach && !seatFree(c)) return { ok: false, error: noSeat(c) };
    if (old) run('UPDATE org_invites SET name=?, coach=?, team_id=?, title=?, invited_by=? WHERE id=?', name || old.name, coach ? 1 : 0, team?.id ?? null, title, req.user.id, old.id);
    const inviteId = old
      ? old.id
      : lastId(run('INSERT INTO org_invites (community_id, email, name, coach, team_id, title, invited_by, token_hash, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)', c.id, email, name, coach ? 1 : 0, team?.id ?? null, title, req.user.id, '', nowIso(), nowIso()));
    const r = await mailOrgInvite(req, inviteId);
    if (!r.ok) {
      // An invitation nobody received is not left holding a seat.
      if (!old) run('DELETE FROM org_invites WHERE id=?', inviteId);
      return { ok: false, error: `The invitation was not sent. ${r.error}` };
    }
    audit(c, req, `Invited ${email} as ${coach ? 'a coach' : 'a member'}${old ? ' again' : ''}`);
    return { ok: true, invited: true, name: name || email };
  }
  const titleOf = (v) => (str(v, 60).trim() === HEAD ? HEAD : str(v, 60).trim() || 'Assistant coach');

  app.post('/api/communities/:id/org/people', async (req, res) => {
    const at = orgEnter(req, res, { perm: 'people', write: true });
    if (!at) return;
    const team = req.body.team_id ? orgTeam(at.c, req.body.team_id) : null;
    if (req.body.team_id && !team) return res.status(404).json({ error: 'That team is not in this organization any more.' });
    const r = await addPerson(req, at.c, { email: str(req.body.email, 254).trim().toLowerCase(), name: str(req.body.name, 80).trim(), coach: req.body.coach !== false, team, title: titleOf(req.body.title) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ...orgOut(at.c, at.m), result: r });
  });
  // Many at once: one person to a line, as "Name, email", "Name <email>" or just the email.
  app.post('/api/communities/:id/org/people/bulk', async (req, res) => {
    const at = orgEnter(req, res, { perm: 'people', write: true });
    if (!at) return;
    const lines = str(req.body.lines, 40000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 300);
    if (!lines.length) return res.status(400).json({ error: 'Paste one person to a line: a name and an email address.' });
    const results = [];
    for (const line of lines) {
      const email = (line.match(/[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+/) || [''])[0].toLowerCase();
      const name = line.replace(email, '').replace(/[<>,;"\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      const r = email ? await addPerson(req, fresh(at.c), { email, name, coach: req.body.coach !== false, team: null, title: 'Assistant coach' }) : { ok: false, error: 'No email address on this line.' };
      results.push({ line, ok: r.ok, error: r.error || '', invited: !!r.invited });
    }
    res.json({ ...orgOut(at.c, at.m), results });
  });
  // Gives someone a coach seat, or takes it back. Without a seat they are an ordinary member and coach no teams.
  app.put('/api/communities/:id/org/people/:userId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'people', write: true });
    if (!at) return;
    const target = membership(at.c.id, Number(req.params.userId));
    if (!target || target.status !== 'active') return res.status(404).json({ error: 'Not found' });
    const who = get('SELECT name FROM users WHERE id=?', target.user_id)?.name ?? 'Someone';
    if (req.body.coach === true && !target.coach) {
      if (!seatFree(at.c)) return res.status(400).json({ error: noSeat(at.c) });
      run('UPDATE community_members SET coach=1 WHERE community_id=? AND user_id=?', at.c.id, target.user_id);
      audit(at.c, req, `Gave ${who} a coach seat`);
    } else if (req.body.coach === false && target.coach) {
      orgMemberLeaving(at.c, target.user_id);
      run('UPDATE community_members SET coach=0 WHERE community_id=? AND user_id=?', at.c.id, target.user_id);
      notify(target.user_id, { kind: 'community', link: `/communities/${at.c.id}`, title: `You no longer have a coach seat in ${at.c.name}`, body: 'You are still a member. What you wrote for its teams has been copied to your own account.' });
      audit(at.c, req, `Took back the coach seat of ${who}`);
    }
    send(res, at);
  });
  app.post('/api/communities/:id/org/invites/:inviteId/resend', async (req, res) => {
    const at = orgEnter(req, res, { perm: 'people', write: true });
    if (!at) return;
    const inv = get('SELECT * FROM org_invites WHERE id=? AND community_id=?', Number(req.params.inviteId), at.c.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!mailerStatus().configured) return res.status(400).json({ error: 'No email service is connected, so the invitation cannot be sent.' });
    if (tooManyOrgInvites(req.user.id)) return res.status(429).json({ error: 'That is a lot of invitations. Wait an hour before sending more.' });
    const r = await mailOrgInvite(req, inv.id);
    if (!r.ok) return res.status(502).json({ error: `The invitation was not sent. ${r.error}` });
    audit(at.c, req, `Sent the invitation to ${inv.email} again`);
    send(res, at);
  });
  app.delete('/api/communities/:id/org/invites/:inviteId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'people' });
    if (!at) return;
    const inv = get('SELECT * FROM org_invites WHERE id=? AND community_id=?', Number(req.params.inviteId), at.c.id);
    if (inv) {
      run('DELETE FROM org_invites WHERE id=?', inv.id);
      audit(at.c, req, `Cancelled the invitation to ${inv.email}`);
    }
    send(res, at);
  });

  // --- Requirements ----------------------------------------------------------------
  app.post('/api/communities/:id/org/requirements', (req, res) => {
    const at = orgEnter(req, res, { perm: 'people', write: true });
    if (!at) return;
    const name = str(req.body.name, 60).trim();
    if (!name) return res.status(400).json({ error: 'Name the requirement, such as "Background check".' });
    if (all('SELECT id FROM org_requirements WHERE community_id=?', at.c.id).length >= 12) return res.status(400).json({ error: 'Twelve requirements is the most an organization can track.' });
    run('INSERT INTO org_requirements (community_id, name) VALUES (?,?)', at.c.id, name);
    audit(at.c, req, `Added the requirement "${name}"`);
    send(res, at);
  });
  app.delete('/api/communities/:id/org/requirements/:reqId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'people', write: true });
    if (!at) return;
    const r = get('SELECT * FROM org_requirements WHERE id=? AND community_id=?', Number(req.params.reqId), at.c.id);
    if (r) {
      run('DELETE FROM org_requirements WHERE id=?', r.id);
      audit(at.c, req, `Removed the requirement "${r.name}"`);
    }
    send(res, at);
  });
  app.put('/api/communities/:id/org/compliance/:userId/:reqId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'people', write: true });
    if (!at) return;
    const r = get('SELECT * FROM org_requirements WHERE id=? AND community_id=?', Number(req.params.reqId), at.c.id);
    const target = membership(at.c.id, Number(req.params.userId));
    if (!r || !target) return res.status(404).json({ error: 'Not found' });
    const done = isDate(req.body.done_on) ? req.body.done_on : '';
    const expires = isDate(req.body.expires_on) ? req.body.expires_on : '';
    if (!done && !expires && !str(req.body.note).trim()) run('DELETE FROM org_compliance WHERE requirement_id=? AND user_id=?', r.id, target.user_id);
    else
      run(
        'INSERT INTO org_compliance (requirement_id, user_id, done_on, expires_on, note) VALUES (?,?,?,?,?) ON CONFLICT(requirement_id, user_id) DO UPDATE SET done_on=excluded.done_on, expires_on=excluded.expires_on, note=excluded.note',
        r.id, target.user_id, done, expires, str(req.body.note, 200).trim(),
      );
    audit(at.c, req, `Updated "${r.name}" for ${get('SELECT name FROM users WHERE id=?', target.user_id)?.name ?? 'someone'}`);
    send(res, at);
  });

  // --- Seasons, leagues, venues ----------------------------------------------------
  app.post('/api/communities/:id/org/seasons', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const name = str(req.body.name, 60).trim();
    if (!name) return res.status(400).json({ error: 'Name the season, such as "Winter 2026-27".' });
    run('INSERT INTO org_seasons (community_id, name) VALUES (?,?)', at.c.id, name);
    audit(at.c, req, `Started the season "${name}"`);
    send(res, at);
  });
  app.put('/api/communities/:id/org/seasons/:seasonId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const s = get('SELECT * FROM org_seasons WHERE id=? AND community_id=?', Number(req.params.seasonId), at.c.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const name = req.body.name === undefined ? s.name : str(req.body.name, 60).trim() || s.name;
    const archived = typeof req.body.archived === 'boolean' ? (req.body.archived ? 1 : 0) : s.archived;
    run('UPDATE org_seasons SET name=?, archived=? WHERE id=?', name, archived, s.id);
    if (archived !== s.archived) audit(at.c, req, `${archived ? 'Archived' : 'Reopened'} the season "${name}"`);
    send(res, at);
  });
  app.delete('/api/communities/:id/org/seasons/:seasonId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const s = get('SELECT * FROM org_seasons WHERE id=? AND community_id=?', Number(req.params.seasonId), at.c.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (get('SELECT 1 AS ok FROM org_leagues WHERE season_id=?', s.id)) return res.status(400).json({ error: 'This season still has leagues in it. Remove them first, or archive the season to keep it.' });
    run('DELETE FROM org_seasons WHERE id=?', s.id);
    audit(at.c, req, `Deleted the empty season "${s.name}"`);
    send(res, at);
  });
  /**
   * Starts the next season from this one: the same leagues and the same teams, new and empty.
   * Rosters and practices are not carried over, since players move up. Coaches are, if asked.
   */
  app.post('/api/communities/:id/org/seasons/:seasonId/rollover', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const s = get('SELECT * FROM org_seasons WHERE id=? AND community_id=?', Number(req.params.seasonId), at.c.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const name = str(req.body.name, 60).trim();
    if (!name) return res.status(400).json({ error: 'Name the new season.' });
    const made = tx(() => {
      const seasonId = lastId(run('INSERT INTO org_seasons (community_id, name) VALUES (?,?)', at.c.id, name));
      let teams = 0;
      for (const l of all('SELECT * FROM org_leagues WHERE season_id=?', s.id)) {
        const leagueId = lastId(run('INSERT INTO org_leagues (community_id, season_id, name, sport, age_group) VALUES (?,?,?,?,?)', at.c.id, seasonId, l.name, l.sport, l.age_group));
        for (const t of all('SELECT * FROM teams WHERE community_id=? AND league_id=?', at.c.id, l.id)) {
          const teamId = lastId(run('INSERT INTO teams (owner_id, sport_id, name, season, notes, community_id, league_id) VALUES (?,?,?,?,?,?,?)', t.owner_id, t.sport_id, t.name, name, '', at.c.id, leagueId));
          if (req.body.keep_coaches)
            run('INSERT INTO team_staff (team_id, user_id, title, perms_json, added_by) SELECT ?, user_id, title, perms_json, ? FROM team_staff WHERE team_id=?', teamId, req.user.id, t.id);
          teams++;
        }
      }
      if (req.body.archive) run('UPDATE org_seasons SET archived=1 WHERE id=?', s.id);
      return teams;
    });
    audit(at.c, req, `Started "${name}" from "${s.name}" with ${made} ${made === 1 ? 'team' : 'teams'}${req.body.keep_coaches ? ' and their coaches' : ''}`);
    send(res, at);
  });

  app.post('/api/communities/:id/org/leagues', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const s = get('SELECT * FROM org_seasons WHERE id=? AND community_id=?', Number(req.body.season_id), at.c.id);
    if (!s) return res.status(400).json({ error: 'Choose the season this league plays in.' });
    const name = str(req.body.name, 60).trim();
    const sport = str(req.body.sport, 40).trim();
    if (!name) return res.status(400).json({ error: 'Name the league, such as "Boys 12 and under".' });
    if (!sport) return res.status(400).json({ error: 'Choose the sport.' });
    run('INSERT INTO org_leagues (community_id, season_id, name, sport, age_group) VALUES (?,?,?,?,?)', at.c.id, s.id, name, sport, str(req.body.age_group, 40).trim());
    audit(at.c, req, `Added the league "${name}" to ${s.name}`);
    send(res, at);
  });
  app.put('/api/communities/:id/org/leagues/:leagueId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const l = get('SELECT * FROM org_leagues WHERE id=? AND community_id=?', Number(req.params.leagueId), at.c.id);
    if (!l) return res.status(404).json({ error: 'Not found' });
    // The sport stays as it was: the teams' drills and categories are that sport's.
    run('UPDATE org_leagues SET name=?, age_group=? WHERE id=?', str(req.body.name, 60).trim() || l.name, req.body.age_group === undefined ? l.age_group : str(req.body.age_group, 40).trim(), l.id);
    send(res, at);
  });
  app.delete('/api/communities/:id/org/leagues/:leagueId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const l = get('SELECT * FROM org_leagues WHERE id=? AND community_id=?', Number(req.params.leagueId), at.c.id);
    if (!l) return res.status(404).json({ error: 'Not found' });
    if (get('SELECT 1 AS ok FROM teams WHERE community_id=? AND league_id=?', at.c.id, l.id)) return res.status(400).json({ error: 'This league still has teams in it. Remove or move them first.' });
    for (const g of all('SELECT id FROM org_games WHERE league_id=?', l.id)) run('DELETE FROM events WHERE uid=?', `league-${g.id}`);
    run('DELETE FROM org_leagues WHERE id=?', l.id);
    audit(at.c, req, `Deleted the league "${l.name}"`);
    send(res, at);
  });

  app.post('/api/communities/:id/org/venues', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const name = str(req.body.name, 80).trim();
    if (!name) return res.status(400).json({ error: 'Name the field or gym, such as "Lincoln Park, Field 2".' });
    run('INSERT INTO org_venues (community_id, name, address) VALUES (?,?,?)', at.c.id, name, str(req.body.address, 200).trim());
    send(res, at);
  });
  app.delete('/api/communities/:id/org/venues/:venueId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const v = get('SELECT id FROM org_venues WHERE id=? AND community_id=?', Number(req.params.venueId), at.c.id);
    if (v) {
      const games = all('SELECT id FROM org_games WHERE venue_id=?', v.id);
      run('UPDATE org_games SET venue_id=NULL WHERE venue_id=?', v.id);
      run('DELETE FROM org_venues WHERE id=?', v.id);
      for (const g of games) pushGame(at.c, g.id);
    }
    send(res, at);
  });

  // --- Teams and their coaches -----------------------------------------------------
  app.post('/api/communities/:id/org/teams', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const l = get('SELECT l.*, s.name AS season FROM org_leagues l JOIN org_seasons s ON s.id=l.season_id WHERE l.id=? AND l.community_id=?', Number(req.body.league_id), at.c.id);
    if (!l) return res.status(400).json({ error: 'Choose the league this team plays in.' });
    // Several at once: one name to a line.
    const names = str(req.body.name, 4000).split(/\r?\n/).map((n) => n.trim().slice(0, 80)).filter(Boolean).slice(0, 40);
    if (!names.length) return res.status(400).json({ error: 'Name the team.' });
    tx(() => {
      const ownerId = ensureWorkspace(at.c);
      const sportId = sportFor(ownerId, l.sport);
      for (const name of names) run('INSERT INTO teams (owner_id, sport_id, name, season, notes, community_id, league_id) VALUES (?,?,?,?,?,?,?)', ownerId, sportId, name, l.season, '', at.c.id, l.id);
    });
    audit(at.c, req, `Added ${names.length === 1 ? `the team "${names[0]}"` : `${names.length} teams`} to ${l.name}`);
    send(res, at);
  });
  app.put('/api/communities/:id/org/teams/:teamId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const t = orgTeam(at.c, req.params.teamId);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const name = str(req.body.name, 80).trim() || t.name;
    run('UPDATE teams SET name=? WHERE id=?', name, t.id);
    if (name !== t.name) {
      audit(at.c, req, `Renamed the team "${t.name}" to "${name}"`);
      for (const g of all('SELECT id FROM org_games WHERE home_team_id=? OR away_team_id=?', t.id, t.id)) pushGame(at.c, g.id);
    }
    send(res, at);
  });
  // The request must repeat the team's name: its roster and practices go with it. Coaches keep what they wrote.
  app.delete('/api/communities/:id/org/teams/:teamId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const t = orgTeam(at.c, req.params.teamId);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (str(req.body?.confirm).trim().toLowerCase() !== t.name.trim().toLowerCase()) return res.status(400).json({ error: 'Type the name of the team exactly to delete it.' });
    for (const s of all('SELECT user_id FROM team_staff WHERE team_id=?', t.id)) {
      keepWork(s.user_id, t, at.c.name);
      notify(s.user_id, { kind: 'team', title: `${at.c.name} removed the team ${t.name}`, body: 'What you wrote for it has been copied to your own account.' });
    }
    tx(() => {
      for (const g of all('SELECT id FROM org_games WHERE home_team_id=? OR away_team_id=?', t.id, t.id)) {
        run('DELETE FROM events WHERE uid=?', `league-${g.id}`);
        run('DELETE FROM org_games WHERE id=?', g.id);
      }
      run('DELETE FROM teams WHERE id=?', t.id);
    });
    audit(at.c, req, `Deleted the team "${t.name}"`);
    send(res, at);
  });
  app.post('/api/communities/:id/org/teams/:teamId/coaches', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const t = orgTeam(at.c, req.params.teamId);
    const target = membership(at.c.id, Number(req.body.user_id));
    if (!t || !target || target.status !== 'active') return res.status(404).json({ error: 'Not found' });
    // Coaching a team takes a seat, if the person does not have one yet.
    if (!target.coach) {
      if (!seatFree(at.c)) return res.status(400).json({ error: noSeat(at.c) });
      run('UPDATE community_members SET coach=1 WHERE community_id=? AND user_id=?', at.c.id, target.user_id);
    }
    const title = titleOf(req.body.title);
    const already = get('SELECT title FROM team_staff WHERE team_id=? AND user_id=?', t.id, target.user_id);
    assign(at.c, t, target.user_id, title, req.user.id);
    const who = get('SELECT name FROM users WHERE id=?', target.user_id)?.name ?? 'Someone';
    if (already?.title !== title) {
      notify(target.user_id, {
        kind: 'team', ref: `org-team-${t.id}`,
        title: already ? `You are now ${title.toLowerCase()} of ${t.name}` : `${at.c.name} made you ${title.toLowerCase()} of ${t.name}`,
        body: `To open the team, use "Switch team" and choose ${t.name}.`,
      });
      audit(at.c, req, `Made ${who} ${title.toLowerCase()} of ${t.name}`);
    }
    send(res, at);
  });
  app.delete('/api/communities/:id/org/teams/:teamId/coaches/:userId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues' });
    if (!at) return;
    const t = orgTeam(at.c, req.params.teamId);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const userId = Number(req.params.userId);
    if (unassign(at.c, t, userId)) {
      notify(userId, { kind: 'team', title: `${at.c.name} took you off ${t.name}`, body: 'What you wrote for the team has been copied to your own account, so you keep it.' });
      audit(at.c, req, `Took ${get('SELECT name FROM users WHERE id=?', userId)?.name ?? 'someone'} off ${t.name}`);
    }
    send(res, at);
  });

  // --- Games -----------------------------------------------------------------------
  const gamesAnswer = (c) => ({
    games: gamesOut(c),
    standings: Object.fromEntries(all('SELECT id FROM org_leagues WHERE community_id=?', c.id).map((l) => [l.id, standingsOf(c, l.id)])),
  });
  /** Tells the coaches of a game's two teams about it. One message per game: a later change replaces an unread earlier one. */
  function tellCoaches(c, game, title, body) {
    for (const userId of staffOfTeams([game.home_team_id, game.away_team_id])) notify(userId, { kind: 'league-game', ref: `game-${game.id}`, link: '/practices', title, body });
  }
  const when = (g) => `${g.date}${g.start_time ? ` at ${g.start_time}` : ''}`;
  /** Reads a game from a request. Returns { error } or the values to save. */
  function gameFrom(c, b, old) {
    const league = get('SELECT * FROM org_leagues WHERE id=? AND community_id=?', Number(b.league_id ?? old?.league_id), c.id);
    if (!league) return { error: 'Choose the league.' };
    const home = Number(b.home_team_id ?? old?.home_team_id);
    const away = Number(b.away_team_id ?? old?.away_team_id);
    const inLeague = (teamId) => get('SELECT 1 AS ok FROM teams WHERE id=? AND community_id=? AND league_id=?', teamId, c.id, league.id);
    if (!inLeague(home) || !inLeague(away)) return { error: 'Choose two teams from this league.' };
    if (home === away) return { error: 'A team cannot play itself.' };
    const date = b.date ?? old?.date;
    if (!isDate(date)) return { error: 'Choose the date.' };
    const start = b.start_time ?? old?.start_time ?? '';
    if (start && !isTime(start)) return { error: 'Enter the time as hours and minutes.' };
    const venue = b.venue_id === undefined ? old?.venue_id ?? null : b.venue_id ? get('SELECT id FROM org_venues WHERE id=? AND community_id=?', Number(b.venue_id), c.id)?.id ?? null : null;
    const status = ['scheduled', 'final', 'postponed', 'cancelled'].includes(b.status) ? b.status : old?.status ?? 'scheduled';
    const score = (v, was) => (v === undefined ? was ?? null : v === null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(999, Math.round(Number(v)))));
    return {
      league_id: league.id, home, away, date, start, venue, status,
      duration: Math.max(10, Math.min(600, Math.round(Number(b.duration_min ?? old?.duration_min ?? 60)) || 60)),
      home_score: score(b.home_score, old?.home_score), away_score: score(b.away_score, old?.away_score),
      notes: b.notes === undefined ? old?.notes ?? '' : str(b.notes, 300).trim(),
    };
  }
  app.get('/api/communities/:id/org/games', (req, res) => {
    const at = orgEnter(req, res);
    if (at) res.json(gamesAnswer(at.c));
  });
  app.post('/api/communities/:id/org/games', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const g = gameFrom(at.c, req.body);
    if (g.error) return res.status(400).json({ error: g.error });
    const gameId = lastId(
      run('INSERT INTO org_games (community_id, league_id, date, start_time, duration_min, home_team_id, away_team_id, venue_id, status, home_score, away_score, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', at.c.id, g.league_id, g.date, g.start, g.duration, g.home, g.away, g.venue, g.status, g.home_score, g.away_score, g.notes),
    );
    pushGame(at.c, gameId);
    const row = get(`${GAME_SELECT} WHERE g.id=?`, gameId);
    tellCoaches(at.c, row, `New game: ${row.away} at ${row.home}`, `${when(row)}${row.venue ? `, ${row.venue}` : ''}. It is on your team's calendar.`);
    audit(at.c, req, `Scheduled ${row.away} at ${row.home} on ${when(row)}`);
    res.json(gamesAnswer(at.c));
  });
  app.put('/api/communities/:id/org/games/:gameId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const old = get('SELECT * FROM org_games WHERE id=? AND community_id=?', Number(req.params.gameId), at.c.id);
    if (!old) return res.status(404).json({ error: 'Not found' });
    const g = gameFrom(at.c, req.body, old);
    if (g.error) return res.status(400).json({ error: g.error });
    run('UPDATE org_games SET league_id=?, date=?, start_time=?, duration_min=?, home_team_id=?, away_team_id=?, venue_id=?, status=?, home_score=?, away_score=?, notes=? WHERE id=?', g.league_id, g.date, g.start, g.duration, g.home, g.away, g.venue, g.status, g.home_score, g.away_score, g.notes, old.id);
    pushGame(at.c, old.id);
    const row = get(`${GAME_SELECT} WHERE g.id=?`, old.id);
    const moved = old.date !== row.date || old.start_time !== row.start_time || (old.venue_id ?? null) !== (row.venue_id ?? null);
    if (row.status !== old.status && row.status !== 'final') {
      tellCoaches(at.c, row, `${row.status === 'cancelled' ? 'Cancelled' : row.status === 'postponed' ? 'Postponed' : 'Back on'}: ${row.away} at ${row.home}`, `The game on ${when(old)}${row.status === 'scheduled' ? ` is now on ${when(row)}` : ''}.`);
      audit(at.c, req, `Marked ${row.away} at ${row.home} (${when(old)}) as ${row.status}`);
    } else if (moved) {
      tellCoaches(at.c, row, `Game moved: ${row.away} at ${row.home}`, `Now ${when(row)}${row.venue ? `, ${row.venue}` : ''}. It was ${when(old)}.`);
      audit(at.c, req, `Moved ${row.away} at ${row.home} from ${when(old)} to ${when(row)}`);
    } else if (row.status === 'final' && (old.status !== 'final' || old.home_score !== row.home_score || old.away_score !== row.away_score)) {
      audit(at.c, req, `Recorded ${row.home} ${row.home_score ?? '-'}, ${row.away} ${row.away_score ?? '-'}`);
    }
    res.json(gamesAnswer(at.c));
  });
  app.delete('/api/communities/:id/org/games/:gameId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const row = get(`${GAME_SELECT} WHERE g.id=? AND g.community_id=?`, Number(req.params.gameId), at.c.id);
    if (row) {
      run('DELETE FROM events WHERE uid=?', `league-${row.id}`);
      run('DELETE FROM org_games WHERE id=?', row.id);
      if (row.date >= today()) tellCoaches(at.c, row, `Game removed: ${row.away} at ${row.home}`, `The game on ${when(row)} was taken off the schedule.`);
      audit(at.c, req, `Removed ${row.away} at ${row.home} on ${when(row)}`);
    }
    res.json(gamesAnswer(at.c));
  });
  /**
   * Builds a league's schedule: every team plays every other once (or twice, home and away). One
   * round to a game day, the days a fixed number apart. Games on a day are spread over the venues
   * and the start times given, and then run on later into the day.
   */
  app.post('/api/communities/:id/org/leagues/:leagueId/generate', (req, res) => {
    const at = orgEnter(req, res, { perm: 'leagues', write: true });
    if (!at) return;
    const l = get('SELECT * FROM org_leagues WHERE id=? AND community_id=?', Number(req.params.leagueId), at.c.id);
    if (!l) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const teams = all('SELECT id FROM teams WHERE community_id=? AND league_id=? ORDER BY id', at.c.id, l.id).map((t) => t.id);
    if (teams.length < 2) return res.status(400).json({ error: 'A league needs at least two teams before it can have a schedule.' });
    if (!isDate(b.start_date)) return res.status(400).json({ error: 'Choose the date of the first games.' });
    const times = (Array.isArray(b.times) ? b.times : []).filter(isTime).slice(0, 12);
    if (!times.length) return res.status(400).json({ error: 'Give at least one start time.' });
    const venues = (Array.isArray(b.venue_ids) ? b.venue_ids : []).map((v) => get('SELECT id FROM org_venues WHERE id=? AND community_id=?', Number(v), at.c.id)?.id).filter(Boolean);
    const every = Math.max(1, Math.min(60, Math.round(Number(b.every_days)) || 7));
    const duration = Math.max(10, Math.min(600, Math.round(Number(b.duration_min)) || 60));
    let rounds = roundRobin(teams);
    if (Number(b.rounds) === 2) rounds = [...rounds, ...rounds.map((r) => r.map(([h, a]) => [a, h]))];
    const made = tx(() => {
      if (b.replace) {
        // Only games still to be played are replaced. Results already recorded are kept.
        for (const g of all("SELECT id FROM org_games WHERE league_id=? AND status<>'final'", l.id)) {
          run('DELETE FROM events WHERE uid=?', `league-${g.id}`);
          run('DELETE FROM org_games WHERE id=?', g.id);
        }
      }
      let n = 0;
      rounds.forEach((pairs, r) => {
        const date = addDays(b.start_date, r * every);
        pairs.forEach(([home, away], k) => {
          const slot = Math.floor(k / Math.max(1, venues.length));
          const start = slot < times.length ? times[slot] : addMinutes(times[times.length - 1], duration * (slot - times.length + 1));
          const gameId = lastId(run('INSERT INTO org_games (community_id, league_id, date, start_time, duration_min, home_team_id, away_team_id, venue_id) VALUES (?,?,?,?,?,?,?,?)', at.c.id, l.id, date, start, duration, home, away, venues.length ? venues[k % venues.length] : null));
          pushGame(at.c, gameId);
          n++;
        });
      });
      return n;
    });
    for (const userId of staffOfTeams(teams))
      notify(userId, { kind: 'league-schedule', ref: `league-${l.id}`, link: '/practices', title: `The ${l.name} schedule is out`, body: `${at.c.name} set the games for ${l.name}. They are on your team's calendar.` });
    audit(at.c, req, `Built the ${l.name} schedule: ${made} games over ${rounds.length} game days${b.replace ? ', replacing the unplayed ones' : ''}`);
    res.json(gamesAnswer(at.c));
  });

  // --- Announcements ---------------------------------------------------------------
  function announcementsOut(c, m) {
    const sees = can(m, 'announce');
    return all(
      `SELECT a.*, (SELECT read_at FROM org_announcement_to WHERE announcement_id=a.id AND user_id=?) AS my_read,
              EXISTS (SELECT 1 FROM org_announcement_to WHERE announcement_id=a.id AND user_id=?) AS to_me
         FROM org_announcements a WHERE a.community_id=? ORDER BY a.pinned DESC, a.id DESC LIMIT 200`,
      m.user_id, m.user_id, c.id,
    )
      .filter((a) => a.to_me || sees || a.user_id === m.user_id)
      .map((a) => {
        const counts = sees || a.user_id === m.user_id ? get('SELECT COUNT(*) AS total, COUNT(read_at) AS seen FROM org_announcement_to WHERE announcement_id=?', a.id) : null;
        return {
          id: a.id, title: a.title, body: a.body, by: a.by_name, at: a.created_at, audience: a.audience, pinned: !!a.pinned, emailed: !!a.emailed,
          to_me: !!a.to_me, unread: !!a.to_me && !a.my_read, can_manage: sees || a.user_id === m.user_id,
          sent_to: counts ? counts.total : undefined, seen_by: counts ? counts.seen : undefined,
        };
      });
  }
  app.get('/api/communities/:id/org/announcements', (req, res) => {
    const at = orgEnter(req, res);
    if (at) res.json(announcementsOut(at.c, at.m));
  });
  // The caller has looked at their announcements.
  app.post('/api/communities/:id/org/announcements/read', (req, res) => {
    const at = orgEnter(req, res);
    if (!at) return;
    run('UPDATE org_announcement_to SET read_at=? WHERE user_id=? AND read_at IS NULL AND announcement_id IN (SELECT id FROM org_announcements WHERE community_id=?)', nowIso(), req.user.id, at.c.id);
    run("UPDATE notices SET read_at=datetime('now') WHERE user_id=? AND kind='announcement' AND ref LIKE ? AND read_at IS NULL", req.user.id, `org-${at.c.id}-%`);
    res.json(announcementsOut(at.c, at.m));
  });
  // Who a message would go to, before it is sent.
  app.post('/api/communities/:id/org/announcements/audience', (req, res) => {
    const at = orgEnter(req, res, { perm: 'announce' });
    if (!at) return;
    const to = audienceOf(at.c, req.body.audience);
    res.json({ count: to.users.length, text: to.text });
  });
  app.post('/api/communities/:id/org/announcements', (req, res) => {
    const at = orgEnter(req, res, { perm: 'announce', write: true });
    if (!at) return;
    const title = str(req.body.title, 120).trim();
    const body = str(req.body.body, 6000).trim();
    if (!title) return res.status(400).json({ error: 'Give the announcement a title.' });
    if (!body) return res.status(400).json({ error: 'Write the announcement.' });
    const to = audienceOf(at.c, req.body.audience);
    if (!to.users.length) return res.status(400).json({ error: 'Nobody matches that choice yet, so there is no one to send it to.' });
    const email = !!req.body.email && mailerStatus().configured;
    const announcementId = tx(() => {
      const aid = lastId(run('INSERT INTO org_announcements (community_id, user_id, by_name, title, body, audience, pinned, emailed, created_at) VALUES (?,?,?,?,?,?,?,?,?)', at.c.id, req.user.id, req.user.name, title, body, to.text, req.body.pinned ? 1 : 0, email ? 1 : 0, nowIso()));
      // The sender has seen their own announcement.
      for (const userId of to.users) run('INSERT INTO org_announcement_to (announcement_id, user_id, read_at) VALUES (?,?,?)', aid, userId, userId === req.user.id ? nowIso() : null);
      return aid;
    });
    const others = to.users.filter((userId) => userId !== req.user.id);
    for (const userId of others)
      notify(userId, { kind: 'announcement', ref: `org-${at.c.id}-${announcementId}`, link: `/communities/${at.c.id}?tab=announcements`, title: `${at.c.name}: ${title}`, body: body.length > 200 ? `${body.slice(0, 200)}…` : body });
    if (email) {
      const base = publicBase(req);
      // One at a time and without holding up the answer: a long list takes a while to send.
      (async () => {
        for (const u of all(`SELECT email, name FROM users WHERE status='active' AND id IN (${others.join(',') || 0})`))
          await sendMail({ to: u.email, subject: `${at.c.name}: ${title}`, text: `Hi ${u.name},\n\n${req.user.name} sent this to ${to.text.toLowerCase()} in ${at.c.name}:\n\n${title}\n\n${body}\n\nSee it on Dime Coach:\n\n${base}/communities/${at.c.id}?tab=announcements` });
      })().catch((e) => console.error('Announcement emails stopped:', e.message));
    }
    audit(at.c, req, `Announced "${title}" to ${to.text.toLowerCase()} (${to.users.length})${email ? ', with email' : ''}`);
    res.json(announcementsOut(at.c, at.m));
  });
  app.put('/api/communities/:id/org/announcements/:announcementId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'announce', write: true });
    if (!at) return;
    run('UPDATE org_announcements SET pinned=? WHERE id=? AND community_id=?', req.body.pinned ? 1 : 0, Number(req.params.announcementId), at.c.id);
    res.json(announcementsOut(at.c, at.m));
  });
  app.delete('/api/communities/:id/org/announcements/:announcementId', (req, res) => {
    const at = orgEnter(req, res, { perm: 'announce' });
    if (!at) return;
    const a = get('SELECT * FROM org_announcements WHERE id=? AND community_id=?', Number(req.params.announcementId), at.c.id);
    if (a) {
      run('DELETE FROM org_announcements WHERE id=?', a.id);
      run("DELETE FROM notices WHERE kind='announcement' AND ref=? AND read_at IS NULL", `org-${at.c.id}-${a.id}`);
      audit(at.c, req, `Deleted the announcement "${a.title}"`);
    }
    res.json(announcementsOut(at.c, at.m));
  });

  // --- The record of what admins did -------------------------------------------------
  app.get('/api/communities/:id/org/audit', (req, res) => {
    const at = orgEnter(req, res, { admin: true });
    if (at) res.json(all('SELECT id, user_name AS by, text, at FROM org_audit WHERE community_id=? ORDER BY id DESC LIMIT 300', at.c.id));
  });

  // --- The public page and the organization's look -----------------------------------
  app.put('/api/communities/:id/org/public', (req, res) => {
    const at = orgEnter(req, res, { perm: 'settings', write: true });
    if (!at) return;
    const b = req.body;
    let slug = at.c.public_slug || '';
    if (b.public_slug !== undefined) {
      slug = str(b.public_slug, 60).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (slug && slug.length < 3) return res.status(400).json({ error: 'Make the web address at least three letters or numbers.' });
      if (slug.length > 40) return res.status(400).json({ error: 'Keep the web address under 40 characters.' });
      if (slug && get('SELECT 1 AS ok FROM communities WHERE public_slug=? AND id<>?', slug, at.c.id)) return res.status(409).json({ error: 'Another organization already uses that web address.' });
    }
    const on = typeof b.public_on === 'boolean' ? b.public_on : !!at.c.public_on;
    if (on && !slug) return res.status(400).json({ error: 'Choose a web address for the public page first.' });
    let color = at.c.brand_color || '';
    if (b.brand_color !== undefined) color = /^#[0-9a-fA-F]{6}$/.test(str(b.brand_color)) ? str(b.brand_color).toLowerCase() : '';
    run('UPDATE communities SET public_slug=?, public_on=?, brand_color=? WHERE id=?', slug, on ? 1 : 0, color, at.c.id);
    if (on !== !!at.c.public_on) audit(at.c, req, `Turned the public schedule page ${on ? 'on' : 'off'}`);
    send(res, at);
  });

  // Whether a coach sees every sport's shared material, or only the sports they coach.
  app.put('/api/communities/:id/org/library', (req, res) => {
    const at = orgEnter(req, res, { perm: 'settings', write: true });
    if (!at) return;
    const scope = req.body.scope === 'sport' ? 'sport' : 'all';
    run('UPDATE communities SET library_scope=? WHERE id=?', scope, at.c.id);
    if (scope !== (at.c.library_scope === 'sport' ? 'sport' : 'all')) audit(at.c, req, scope === 'sport' ? 'Set the libraries to show each coach only the sports they coach' : 'Set the libraries to show every sport to everyone');
    send(res, at);
  });

  // --- For the system administrator: which communities are organizations ---------------
  const systemOnly = (req, res, next) => (isSystemAdmin(req.user) ? next() : res.status(403).json({ error: 'Only the system administrator can do this.' }));
  const plansOut = () =>
    all('SELECT c.*, (SELECT name FROM users WHERE id=c.created_by) AS creator, (SELECT email FROM users WHERE id=c.created_by) AS creator_email FROM communities c ORDER BY c.plan DESC, c.name COLLATE NOCASE').map((c) => ({
      id: c.id, name: c.name, creator: c.creator || '', creator_email: c.creator_email || '',
      members: get("SELECT COUNT(*) AS n FROM community_members WHERE community_id=? AND status='active'", c.id).n,
      teams: get('SELECT COUNT(*) AS n FROM teams WHERE community_id=?', c.id).n,
      plan: isOrg(c) ? 'organization' : 'group', seats: c.seats || 0, seats_used: seatsUsed(c.id), expires: c.plan_expires || '', lapsed: lapsed(c),
    }));
  app.get('/api/system/communities', systemOnly, (_req, res) => res.json(plansOut()));
  app.put('/api/system/communities/:id', systemOnly, (req, res) => {
    const c = get('SELECT * FROM communities WHERE id=?', Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const plan = b.plan === 'organization' || b.plan === 'group' ? b.plan : c.plan || 'group';
    // Going back to a plain community is only for one with no teams: the teams belong to the organization.
    if (plan === 'group' && isOrg(c) && get('SELECT 1 AS ok FROM teams WHERE community_id=?', c.id))
      return res.status(400).json({ error: 'This organization has teams. Set an end date to make it read-only, or have its teams removed first.' });
    const seats = b.seats === undefined ? c.seats || 0 : Math.max(0, Math.min(100000, Math.round(Number(b.seats)) || 0));
    const expires = b.expires === undefined ? c.plan_expires || '' : isDate(b.expires) ? b.expires : '';
    tx(() => {
      run('UPDATE communities SET plan=?, seats=?, plan_expires=? WHERE id=?', plan, seats, expires, c.id);
      if (plan === 'organization') ensureWorkspace(c);
      else run('UPDATE community_members SET coach=0 WHERE community_id=?', c.id);
    });
    if (plan === 'organization' && !isOrg(c)) {
      run('INSERT INTO org_audit (community_id, user_id, user_name, text, at) VALUES (?,?,?,?,?)', c.id, req.user.id, req.user.name, `Put ${c.name} on the organization plan with ${seats} coach seats`, nowIso());
      notify(c.created_by, { kind: 'community', link: `/communities/${c.id}?tab=teams`, title: `${c.name} is now an organization`, body: `It has ${seats} coach seats. You can invite coaches, set up leagues and teams, build schedules and send announcements.` });
    } else if (isOrg(c) && (seats !== (c.seats || 0) || expires !== (c.plan_expires || '')))
      run('INSERT INTO org_audit (community_id, user_id, user_name, text, at) VALUES (?,?,?,?,?)', c.id, req.user.id, req.user.name, `Changed the plan: ${seats} coach seats${expires ? `, ending ${expires}` : ', no end date'}`, nowIso());
    res.json(plansOut());
  });
}

// --- Open to anyone: the public schedule page and its calendar feed --------------------
/** Mounted before sign-in is required. Shows only what the organization chose to publish: teams, games and results. */
export function mountOrgPublic(app) {
  const publicOrg = (slug) => {
    const c = get('SELECT * FROM communities WHERE public_slug=? AND public_on=1', str(slug, 60).toLowerCase());
    return c && isOrg(c) ? c : null;
  };
  app.get('/api/public/orgs/:slug', (req, res) => {
    const c = publicOrg(req.params.slug);
    if (!c) return res.status(404).json({ error: 'There is no public schedule at this address.' });
    const games = gamesOut(c).map(({ warnings: _w, notes: _n, ...g }) => g);
    res.json({
      name: c.name, description: c.description, image: c.image || '', color: c.brand_color || '',
      seasons: all('SELECT id, name FROM org_seasons WHERE community_id=? AND archived=0 ORDER BY id DESC', c.id).map((s) => ({
        ...s,
        leagues: all('SELECT id, name, sport, age_group FROM org_leagues WHERE season_id=? ORDER BY name COLLATE NOCASE', s.id).map((l) => ({
          ...l,
          teams: all('SELECT id, name FROM teams WHERE community_id=? AND league_id=? ORDER BY name COLLATE NOCASE', c.id, l.id),
          games: games.filter((g) => g.league_id === l.id),
          standings: standingsOf(c, l.id),
        })),
      })),
    });
  });
  // An iCalendar feed of a team's games, a league's, or all of them, for any calendar app to subscribe to.
  app.get('/api/public/orgs/:slug/calendar.ics', (req, res) => {
    const c = publicOrg(req.params.slug);
    if (!c) return res.status(404).type('text/plain').send('Not found');
    const teamId = Number(req.query.team) || 0;
    const leagueId = Number(req.query.league) || 0;
    const games = gamesOut(c).filter((g) => g.status !== 'cancelled' && (!teamId || g.home_team_id === teamId || g.away_team_id === teamId) && (!leagueId || g.league_id === leagueId));
    const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const stamp = (date, time) => `${date.replace(/-/g, '')}${time ? `T${time.replace(':', '')}00` : ''}`;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dime Coach//Schedule//EN', `X-WR-CALNAME:${esc(c.name)}`];
    for (const g of games) {
      lines.push('BEGIN:VEVENT', `UID:league-${g.id}@dimecoach`, `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}`);
      if (g.start_time) lines.push(`DTSTART:${stamp(g.date, g.start_time)}`, `DTEND:${stamp(g.date, addMinutes(g.start_time, g.duration_min))}`);
      else lines.push(`DTSTART;VALUE=DATE:${stamp(g.date, '')}`);
      lines.push(`SUMMARY:${esc(`${g.status === 'postponed' ? 'Postponed: ' : ''}${g.away} at ${g.home}`)}`);
      if (g.venue) lines.push(`LOCATION:${esc(g.venue)}`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    res.type('text/calendar; charset=utf-8').send(lines.join('\r\n'));
  });
}
