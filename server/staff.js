// Sharing a team with other coaches.
//
// A team's owner adds people who already have accounts and says what each may change. Someone
// added this way can "open" the shared team: a cookie names it, and from then on their requests
// run inside the owner's workspace, limited to that one team and to the permissions they were
// given. Everything else in this file is the gate that enforces those limits in one place, so
// the ordinary routes stay unaware of sharing.
import { all, get, run } from './db.js';
import { isSystemAdmin } from './auth.js';
import { notify } from './notices.js';

const COOKIE = 'pp_team';
const str = (v) => (v == null ? '' : String(v));

/**
 * What an owner can allow. All but `contacts` are about changing things; viewing is always on.
 * `manage` is the team itself: renaming or deleting it, and deciding who else it is shared with.
 */
export const PERMS = ['plans', 'drills', 'plays', 'resources', 'roster', 'schedule', 'contacts', 'manage'];
const DEFAULT_PERMS = { plans: true, drills: true, plays: true, resources: true, roster: false, schedule: false, contacts: true, manage: false };
const AREA = {
  plans: 'practices and homework',
  drills: 'drills and categories',
  plays: 'the playbook',
  resources: 'resources and uploads',
  roster: 'the roster',
  schedule: 'the schedule link',
};

function cleanPerms(input, base = DEFAULT_PERMS) {
  const out = {};
  for (const p of PERMS) out[p] = input && typeof input[p] === 'boolean' ? input[p] : !!base[p];
  // Editing the roster means seeing all of it.
  if (out.roster) out.contacts = true;
  return out;
}
const permsOf = (row) => {
  try {
    return cleanPerms(JSON.parse(row.perms_json), {});
  } catch {
    return cleanPerms(null, {});
  }
};

const OWNER_NAME = `(SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=t.owner_id AND m.role='owner' ORDER BY u.id LIMIT 1)`;

function readCookie(req, name) {
  for (const part of str(req.headers.cookie).split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function setTeamCookie(req, res, teamId) {
  const secure = req.secure || process.env.PP_COOKIE_SECURE === '1';
  res.setHeader('Set-Cookie', `${COOKIE}=${teamId || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${teamId ? 365 * 86400 : 0}${secure ? '; Secure' : ''}`);
}

const NOT_FOUND = { status: 404, error: 'Not found' };
const ownerOnly = (what) => ({ status: 403, error: `Only the team's owner can ${what}. Switch back to your own teams to do this for yourself.` });

/** Decides whether a request made inside a shared team may go ahead. Returns null, or what to refuse with. */
function gate(req) {
  const { teamId, perms, ownerName } = req.staff;
  const write = req.method !== 'GET' && req.method !== 'HEAD';
  const seg = req.path.split('/').filter(Boolean);
  const need = (perm) =>
    perms[perm] ? null : { status: 403, error: `You can look at ${AREA[perm]} for this team, but ${ownerName} has not given you permission to change ${['plans', 'drills', 'resources'].includes(perm) ? 'them' : 'it'}.` };
  const sameTeam = (v) => Number(v) === teamId;

  switch (seg[0]) {
    case 'bootstrap':
    case 'storage':
    case 'workspace':
    case 'shared-teams':
    case 'community-shares':
    case 'messages':
      return null;
    case 'teams':
      if (!seg[1]) return write ? ownerOnly('add teams') : null;
      if (!sameTeam(seg[1])) return NOT_FOUND;
      // Who the team is shared with, and renaming or deleting it, need the "manage this team" permission.
      if (seg[2] === 'staff') return perms.manage ? null : { status: 403, error: `${ownerName} has not given you permission to manage who this team is shared with.` };
      if (!write) return null;
      if (seg[2] === 'calendar' || seg[2] === 'events') return need('schedule');
      if (seg[2] === 'players') return need('roster');
      return perms.manage ? null : { status: 403, error: `${ownerName} has not given you permission to rename or delete this team.` };
    case 'players': {
      if (!write) return null;
      const p = get('SELECT team_id FROM players WHERE id=?', Number(seg[1]));
      return p && sameTeam(p.team_id) ? need('roster') : NOT_FOUND;
    }
    case 'tags':
    case 'drills':
      return write ? need('drills') : null;
    case 'plays':
      return write ? need('plays') : null;
    case 'resources':
      return write ? need('resources') : null;
    case 'images':
    case 'videos':
      if (!write || perms.plans || perms.drills || perms.plays || perms.resources) return null;
      return { status: 403, error: `${ownerName} has not given you permission to add uploads to this team.` };
    case 'plans': {
      if (seg[1]) {
        const plan = get('SELECT team_id FROM plans WHERE id=?', Number(seg[1]));
        if (!plan || !sameTeam(plan.team_id)) return NOT_FOUND;
        return write ? need('plans') : null;
      }
      if (!write) return sameTeam(req.query.team_id) ? null : NOT_FOUND;
      if (!sameTeam(req.body.team_id)) return NOT_FOUND;
      if (req.body.from_plan_id) {
        const src = get('SELECT team_id FROM plans WHERE id=?', Number(req.body.from_plan_id));
        if (!src || !sameTeam(src.team_id)) return NOT_FOUND;
      }
      return need('plans');
    }
    case 'ai': {
      const asked = req.body.team_id ?? req.query.team_id;
      if (asked != null && !sameTeam(asked)) return NOT_FOUND;
      return need('plans');
    }
    case 'communities':
      // Talking and membership are personal. Publishing the owner's material is the owner's call.
      return write && seg[2] === 'shares' ? ownerOnly("share this team's material with a community") : null;
    case 'community-library': {
      if (!write) return null;
      const share = get('SELECT kind FROM community_shares WHERE id=?', Number(seg[1]));
      if (!share) return NOT_FOUND;
      if (share.kind === 'plan' && !sameTeam(req.body.team_id)) return NOT_FOUND;
      return need({ drill: 'drills', play: 'plays', plan: 'plans' }[share.kind]);
    }
    default:
      return write ? ownerOnly('do this') : null;
  }
}

/** The sharing part of the bootstrap: the caller's own teams, teams shared with them, and where they are now. */
export function staffBootstrap(req) {
  return {
    own_teams: all(`SELECT t.id, t.name, t.season, (SELECT name FROM sports WHERE id=t.sport_id) AS sport FROM teams t WHERE t.owner_id=? ORDER BY t.id DESC`, req.homeOwnerId ?? req.ownerId),
    shared_teams: all(
      `SELECT t.id, t.name, t.season, (SELECT name FROM sports WHERE id=t.sport_id) AS sport, s.title, s.perms_json, ${OWNER_NAME} AS owner_name
         FROM team_staff s JOIN teams t ON t.id=s.team_id WHERE s.user_id=? ORDER BY t.name COLLATE NOCASE`,
      req.user.id,
    ).map((r) => ({ id: r.id, name: r.name, season: r.season, sport: r.sport, title: r.title, owner_name: r.owner_name || 'The owner', perms: permsOf(r) })),
    access: req.staff ? { team_id: req.staff.teamId, owner_name: req.staff.ownerName, title: req.staff.title, perms: req.staff.perms, system: !!req.staff.system } : null,
  };
}

export function mountStaff(app) {
  // Step into a shared team when the cookie names one this person is still on, then apply the gate.
  app.use('/api', (req, res, next) => {
    const teamId = Number(readCookie(req, COOKIE));
    if (teamId) {
      const row = get(
        `SELECT s.*, t.owner_id, ${OWNER_NAME} AS owner_name FROM team_staff s JOIN teams t ON t.id=s.team_id WHERE s.team_id=? AND s.user_id=?`,
        teamId, req.user.id,
      );
      if (row) {
        req.homeOwnerId = req.ownerId;
        req.ownerId = row.owner_id;
        req.staff = { teamId, perms: permsOf(row), title: row.title, ownerName: row.owner_name || 'the owner' };
      } else if (isSystemAdmin(req.user)) {
        // The system administrator can open any team to help with it, with nothing held back.
        const team = get(`SELECT t.id, t.owner_id, ${OWNER_NAME} AS owner_name FROM teams t WHERE t.id=?`, teamId);
        if (team && team.owner_id !== req.ownerId) {
          req.homeOwnerId = req.ownerId;
          req.ownerId = team.owner_id;
          req.staff = { teamId, perms: cleanPerms(Object.fromEntries(PERMS.map((p) => [p, true]))), title: 'System administrator', ownerName: team.owner_name || 'the owner', system: true };
        }
      }
    }
    if (!req.staff) return next();
    const refused = gate(req);
    if (refused) return res.status(refused.status).json({ error: refused.error });
    next();
  });

  // --- For the person a team was shared with ---
  app.post('/api/workspace', (req, res) => {
    const teamId = Number(req.body.team_id) || 0;
    const allowed = get('SELECT 1 AS ok FROM team_staff WHERE team_id=? AND user_id=?', teamId, req.user.id) || (isSystemAdmin(req.user) && get('SELECT 1 AS ok FROM teams WHERE id=?', teamId));
    if (teamId && !allowed) return res.status(404).json({ error: 'That team is not shared with you any more.' });
    setTeamCookie(req, res, teamId);
    res.json({ ok: true });
  });
  app.delete('/api/shared-teams/:teamId', (req, res) => {
    const left = get(
      `SELECT t.name, (SELECT m.user_id FROM memberships m WHERE m.owner_id=t.owner_id AND m.role='owner' LIMIT 1) AS owner_user
         FROM team_staff s JOIN teams t ON t.id=s.team_id WHERE s.team_id=? AND s.user_id=?`,
      Number(req.params.teamId), req.user.id,
    );
    if (left) notify(left.owner_user, { kind: 'team', title: `${req.user.name} left ${left.name}`, body: 'They no longer have access to the team.', link: '/teams?tab=people' });
    run('DELETE FROM team_staff WHERE team_id=? AND user_id=?', Number(req.params.teamId), req.user.id);
    if (req.staff?.teamId === Number(req.params.teamId)) setTeamCookie(req, res, 0);
    res.json({ ok: true });
  });

  // --- For the owner: who the team is shared with, and what each person may change ---
  const ownTeam = (req) => get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(req.params.id), req.ownerId);
  const staffOf = (teamId) =>
    all(
      `SELECT s.user_id, s.title, s.perms_json, s.created_at, u.name, u.email FROM team_staff s JOIN users u ON u.id=s.user_id
        WHERE s.team_id=? ORDER BY u.name COLLATE NOCASE`,
      teamId,
    ).map((r) => ({ user_id: r.user_id, name: r.name, email: r.email, title: r.title, added_at: r.created_at, perms: permsOf(r) }));

  app.get('/api/teams/:id/staff', (req, res) => {
    const team = ownTeam(req);
    if (!team) return res.status(404).json({ error: 'Not found' });
    res.json(staffOf(team.id));
  });
  app.post('/api/teams/:id/staff', (req, res) => {
    const team = ownTeam(req);
    if (!team) return res.status(404).json({ error: 'Not found' });
    const email = str(req.body.email).trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Enter the email they sign in to Dime Coach with.' });
    if (email === str(req.user.email).toLowerCase()) return res.status(400).json({ error: req.staff ? 'This team is already shared with you.' : 'This is your own team already.' });
    const person = get("SELECT id FROM users WHERE lower(email)=? AND status='active'", email);
    if (person && get("SELECT 1 AS ok FROM memberships WHERE user_id=? AND owner_id=? AND role='owner'", person.id, team.owner_id))
      return res.status(400).json({ error: 'That is the owner of this team.' });
    if (!person)
      return res.status(404).json({
        error: isSystemAdmin(req.user)
          ? 'Nobody has an account with that email yet. Add them under System admin first, then share the team.'
          : 'Nobody has an account with that email yet. Ask the administrator to add them, then share the team.',
      });
    if (get('SELECT 1 AS ok FROM team_staff WHERE team_id=? AND user_id=?', team.id, person.id))
      return res.status(409).json({ error: 'This team is already shared with them.' });
    const title = str(req.body.title).trim().slice(0, 60) || 'Assistant coach';
    run('INSERT INTO team_staff (team_id, user_id, title, perms_json, added_by) VALUES (?,?,?,?,?)', team.id, person.id, title, JSON.stringify(cleanPerms(req.body.perms)), req.user.id);
    notify(person.id, {
      kind: 'team',
      title: `${req.user.name} added you to ${team.name}`,
      body: `You are on the team as ${title}. To open it, use "Switch team" and choose ${team.name}.`,
    });
    res.json(staffOf(team.id));
  });
  app.put('/api/teams/:id/staff/:userId', (req, res) => {
    const team = ownTeam(req);
    const row = team && get('SELECT * FROM team_staff WHERE team_id=? AND user_id=?', team.id, Number(req.params.userId));
    if (!row) return res.status(404).json({ error: 'Not found' });
    // Someone managing a team that is not theirs changes other people, never their own access.
    if (req.staff && row.user_id === req.user.id) return res.status(403).json({ error: 'You cannot change your own access to this team.' });
    const title = req.body.title === undefined ? row.title : str(req.body.title).trim().slice(0, 60) || 'Assistant coach';
    const perms = JSON.stringify(cleanPerms(req.body.perms, permsOf(row)));
    run('UPDATE team_staff SET title=?, perms_json=? WHERE team_id=? AND user_id=?', title, perms, team.id, row.user_id);
    // One message however many switches are flipped: an unread one about this team is simply refreshed.
    if (perms !== row.perms_json || title !== row.title)
      notify(row.user_id, { kind: 'team-access', ref: `team-${team.id}`, title: `${req.user.name} changed what you can do on ${team.name}`, body: `You are on the team as ${title}. Open the team to see what you can change.` });
    res.json(staffOf(team.id));
  });
  app.delete('/api/teams/:id/staff/:userId', (req, res) => {
    const team = ownTeam(req);
    if (!team) return res.status(404).json({ error: 'Not found' });
    if (req.staff && Number(req.params.userId) === req.user.id) return res.status(403).json({ error: 'To leave this team, use "Leave" on your own Teams page.' });
    const gone = run('DELETE FROM team_staff WHERE team_id=? AND user_id=?', team.id, Number(req.params.userId));
    if (gone.changes) notify(Number(req.params.userId), { kind: 'team', title: `${req.user.name} removed you from ${team.name}`, body: 'The team is no longer shared with you.' });
    res.json(staffOf(team.id));
  });
}
