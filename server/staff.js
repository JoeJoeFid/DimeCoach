// Sharing a team with other coaches.
//
// A team's owner adds people by email and says what each may change. Someone with no account
// yet is sent an invitation (server/invites.js) and joins once they have made one. Someone
// added this way can "open" the shared team: a cookie names it, and from then on their requests
// run inside the owner's workspace, limited to that one team and to the permissions they were
// given. Everything else in this file is the gate that enforces those limits in one place, so
// the ordinary routes stay unaware of sharing.
import { all, get, run } from './db.js';
import { isSystemAdmin } from './auth.js';
import { notify } from './notices.js';
import { mailerStatus } from './mailer.js';
import { cancelInvite, inviteToTeam, mailAdded, pendingInvites, resendInvite, tooManyInvites } from './invites.js';
import { orgAccess, orgOfTeam, orgStaffLeaving, stampAuthor, workspaceSports } from './orgs.js';

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

// A team that belongs to an organization has no one person as its owner: the organization's name stands in.
const OWNER_NAME = `COALESCE((SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=t.owner_id AND m.role='owner' ORDER BY u.id LIMIT 1), (SELECT c.name FROM communities c WHERE c.id=t.community_id))`;

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
  // A team that belongs to an organization (server/orgs.js). Its admins, and the system administrator, are not held to the rules for coaches.
  const org = req.staff.org;
  const coach = org && !req.staff.orgAdmin && !req.staff.system;
  if (org && write && org.lapsed && !['workspace', 'shared-teams', 'messages', 'communities'].includes(seg[0])) return { status: 403, error: org.lapsedMessage };
  // Every team in the organization uses the same drills and plays, so a coach changes only the ones they added.
  const ownOnly = (table, what) => {
    if (!coach || !write || !seg[1]) return null;
    const row = get(`SELECT created_by FROM ${table} WHERE id=?`, Number(seg[1]));
    return !row || row.created_by === req.user.id
      ? null
      : { status: 403, error: `This ${what} is shared by every team in ${org.name}. You can use it, but only the person who added it or an admin of ${org.name} can change it.` };
  };

  switch (seg[0]) {
    case 'bootstrap':
    case 'storage':
    case 'workspace':
    case 'shared-teams':
    case 'community-shares':
    case 'messages':
    // Taking a copy of a practice someone sent goes to the caller's own teams, wherever they are working.
    case 'plan-links':
      return null;
    case 'teams':
      if (!seg[1]) return write ? ownerOnly('add teams') : null;
      if (!sameTeam(seg[1])) return NOT_FOUND;
      if (org && write && (seg[2] === 'staff' || seg[2] === 'invites')) return { status: 403, error: `The coaches of this team are assigned by ${org.name}, under "Seasons & teams" in the organization.` };
      if (org && req.method === 'DELETE' && !seg[2]) return { status: 403, error: `This team belongs to ${org.name}. It is deleted under "Seasons & teams" in the organization.` };
      // Who the team is shared with, and renaming or deleting it, need the "manage this team" permission.
      if (seg[2] === 'staff' || seg[2] === 'invites') return perms.manage ? null : { status: 403, error: `${ownerName} has not given you permission to manage who this team is shared with.` };
      if (!write) return null;
      if (seg[2] === 'calendar' || seg[2] === 'events') return need('schedule');
      // Position names are part of planning games.
      if (seg[2] === 'positions') return need('plans');
      if (seg[2] === 'players') return need('roster');
      // The parents, family and friends of the team go with its roster.
      if (seg[2] === 'contacts') return need('roster');
      return perms.manage ? null : { status: 403, error: `${ownerName} has not given you permission to rename or delete this team.` };
    case 'players': {
      if (!write) return null;
      const p = get('SELECT team_id FROM players WHERE id=?', Number(seg[1]));
      return p && sameTeam(p.team_id) ? need('roster') : NOT_FOUND;
    }
    case 'tags':
      if (coach && write) return { status: 403, error: `Categories are shared by every team in ${org.name}, so they are set by its admins.` };
      return write ? need('drills') : null;
    case 'drills':
      return write ? need('drills') || ownOnly('drills', 'drill') : null;
    case 'plays':
      return write ? need('plays') || ownOnly('plays', 'play') : null;
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
        // Talking about a plan is open to everyone on the team, whether or not they may change it.
        if (seg[2] === 'posts') return null;
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
    case 'coach-library': {
      if (!write) return null;
      // Taking a copy puts it in this team's workspace, so it needs the same permission as making one by hand.
      if (seg[1] === 'packs' && seg[3] === 'copy') return need('drills') || need('plays');
      if (seg[1] === 'items' && seg[3] === 'copy') {
        const item = get('SELECT kind FROM library_items WHERE id=?', Number(seg[2]));
        if (!item) return NOT_FOUND;
        if (item.kind === 'plan' && !sameTeam(req.body.team_id)) return NOT_FOUND;
        return need({ drill: 'drills', play: 'plays', plan: 'plans' }[item.kind]);
      }
      // Publishing and packs: the route itself lets only the system administrator through.
      return null;
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
    access: req.staff ? { team_id: req.staff.teamId, owner_name: req.staff.ownerName, title: req.staff.title, perms: req.staff.perms, system: !!req.staff.system, org: req.staff.org ? { id: req.staff.org.id, name: req.staff.org.name, admin: !!req.staff.orgAdmin, lapsed: req.staff.org.lapsed } : null } : null,
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
      } else {
        const team = get(`SELECT t.id, t.owner_id, ${OWNER_NAME} AS owner_name FROM teams t WHERE t.id=?`, teamId);
        // An admin who runs an organization's leagues can open any of its teams.
        const admin = team && orgAccess(req.user, teamId);
        if (admin) {
          req.homeOwnerId = req.ownerId;
          req.ownerId = team.owner_id;
          req.staff = { teamId, perms: cleanPerms(admin.perms, {}), title: admin.title, ownerName: team.owner_name || 'the organization', orgAdmin: true };
        } else if (team && isSystemAdmin(req.user) && team.owner_id !== req.ownerId) {
          // The system administrator can open any team to help with it, with nothing held back.
          req.homeOwnerId = req.ownerId;
          req.ownerId = team.owner_id;
          req.staff = { teamId, perms: cleanPerms(Object.fromEntries(PERMS.map((p) => [p, true]))), title: 'System administrator', ownerName: team.owner_name || 'the owner', system: true };
        }
      }
    }
    if (!req.staff) return next();
    const org = orgOfTeam(req.staff.teamId);
    if (org) req.staff.org = org;
    // Where the organization keeps coaches to their own sports, the other sports' drills, plays and categories are left out.
    if (org && !req.staff.orgAdmin && !req.staff.system) req.sportIds = workspaceSports(req.staff.teamId, req.user.id);
    const refused = gate(req);
    if (refused) return res.status(refused.status).json({ error: refused.error });
    // In an organization's workspace many people add things, so each new drill, play and plan is marked with who made it.
    if (org && req.method === 'POST') stampAuthor(req, res);
    next();
  });

  // --- For the person a team was shared with ---
  app.post('/api/workspace', (req, res) => {
    const teamId = Number(req.body.team_id) || 0;
    const allowed = get('SELECT 1 AS ok FROM team_staff WHERE team_id=? AND user_id=?', teamId, req.user.id) || orgAccess(req.user, teamId) || (isSystemAdmin(req.user) && get('SELECT 1 AS ok FROM teams WHERE id=?', teamId));
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
    // Leaving an organization's team: what they wrote there is copied to their own account first.
    if (left) orgStaffLeaving(Number(req.params.teamId), req.user.id);
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
  app.post('/api/teams/:id/staff', async (req, res) => {
    const team = ownTeam(req);
    if (!team) return res.status(404).json({ error: 'Not found' });
    const email = str(req.body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter their email address.' });
    if (email === str(req.user.email).toLowerCase()) return res.status(400).json({ error: req.staff ? 'This team is already shared with you.' : 'This is your own team already.' });
    const person = get("SELECT id, name, email FROM users WHERE lower(email)=? AND status='active'", email);
    const title = str(req.body.title).trim().slice(0, 60) || 'Assistant coach';
    if (person && get("SELECT 1 AS ok FROM memberships WHERE user_id=? AND owner_id=? AND role='owner'", person.id, team.owner_id))
      return res.status(400).json({ error: 'That is the owner of this team.' });
    if (!person) {
      // Nobody has this address yet: they are invited by email, and join once they have made an account.
      if (get("SELECT 1 AS ok FROM users WHERE lower(email)=? AND status='disabled'", email)) return res.status(400).json({ error: 'The account with that email has been turned off.' });
      if (!mailerStatus().configured)
        return res.status(400).json({
          error: isSystemAdmin(req.user)
            ? 'Nobody has an account with that email yet, and no email service is connected to invite them. Add them under System admin first, then share the team.'
            : 'Nobody has an account with that email yet, and invitations by email are not set up. Ask the administrator to add them, then share the team.',
        });
      if (tooManyInvites(req.user.id)) return res.status(429).json({ error: 'That is a lot of invitations. Wait an hour before sending more.' });
      const r = await inviteToTeam(req, team, email, title, JSON.stringify(cleanPerms(req.body.perms)));
      if (!r.ok) return res.status(502).json({ error: `The invitation was not sent. ${r.error}` });
      return res.json(staffOf(team.id));
    }
    if (get('SELECT 1 AS ok FROM team_staff WHERE team_id=? AND user_id=?', team.id, person.id))
      return res.status(409).json({ error: 'This team is already shared with them.' });
    run('INSERT INTO team_staff (team_id, user_id, title, perms_json, added_by) VALUES (?,?,?,?,?)', team.id, person.id, title, JSON.stringify(cleanPerms(req.body.perms)), req.user.id);
    notify(person.id, {
      kind: 'team',
      title: `${req.user.name} added you to ${team.name}`,
      body: `You are on the team as ${title}. To open it, use "Switch team" and choose ${team.name}.`,
    });
    mailAdded(req, person, team, title);
    res.json(staffOf(team.id));
  });

  // Invitations sent to people who have not made an account yet.
  app.get('/api/teams/:id/invites', (req, res) => {
    const team = ownTeam(req);
    if (!team) return res.status(404).json({ error: 'Not found' });
    res.json(pendingInvites(team.id));
  });
  app.post('/api/teams/:id/invites/:inviteId/resend', async (req, res) => {
    const team = ownTeam(req);
    if (!team) return res.status(404).json({ error: 'Not found' });
    if (!mailerStatus().configured) return res.status(400).json({ error: 'No email service is connected, so the invitation cannot be sent.' });
    if (tooManyInvites(req.user.id)) return res.status(429).json({ error: 'That is a lot of invitations. Wait an hour before sending more.' });
    const r = await resendInvite(req, team.id, Number(req.params.inviteId));
    if (!r) return res.status(404).json({ error: 'Not found' });
    if (!r.ok) return res.status(502).json({ error: `The invitation was not sent. ${r.error}` });
    res.json(pendingInvites(team.id));
  });
  app.delete('/api/teams/:id/invites/:inviteId', (req, res) => {
    const team = ownTeam(req);
    if (!team) return res.status(404).json({ error: 'Not found' });
    cancelInvite(team.id, Number(req.params.inviteId));
    res.json(pendingInvites(team.id));
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
