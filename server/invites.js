// Invitations by email, and links for choosing a new password.
//
// A team can be shared with someone who has no account yet: they are sent a link, and the team is
// theirs to open once they have made an account through it. Only the hash of a link's code is kept.
import crypto from 'node:crypto';
import { all, db, get, run } from './db.js';
import { mailerStatus, sendMail } from './mailer.js';
import { notify } from './notices.js';

db.exec(`
CREATE TABLE IF NOT EXISTS team_invites (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', perms_json TEXT NOT NULL DEFAULT '{}',
  invited_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  UNIQUE (team_id, email)
);
CREATE INDEX IF NOT EXISTS idx_team_invites_token ON team_invites(token_hash);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
`);

export const INVITE_DAYS = 14;
export const RESET_MINUTES = 60;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const nowIso = () => new Date().toISOString();
const later = (ms) => new Date(Date.now() + ms).toISOString();

/** Where links in an email point: the site's public address, or failing that the one this request came to. */
export const publicBase = (req) => String(process.env.PP_PUBLIC_URL || `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '');

// Each person may send only so many invitations an hour, so the site cannot be used to send junk.
const sent = new Map();
const INVITE_LIMIT = 20;
const HOUR_MS = 60 * 60_000;
export function tooManyInvites(userId) {
  const recent = (sent.get(userId) || []).filter((t) => Date.now() - t < HOUR_MS);
  sent.set(userId, recent);
  return recent.length >= INVITE_LIMIT;
}
const noteInvite = (userId) => sent.set(userId, [...(sent.get(userId) || []), Date.now()]);

const INVITE_COLS = `i.*, t.name AS team, t.season, t.owner_id, (SELECT name FROM sports WHERE id=t.sport_id) AS sport,
  (SELECT name FROM users WHERE id=i.invited_by) AS inviter`;

/** Emails the invitation, with a fresh link each time. Resolves to { ok, error }. */
async function mailInvite(req, inviteId) {
  const token = newToken();
  run('UPDATE team_invites SET token_hash=?, expires_at=? WHERE id=?', sha256(token), later(INVITE_DAYS * 86400_000), inviteId);
  const inv = get(`SELECT ${INVITE_COLS} FROM team_invites i JOIN teams t ON t.id=i.team_id WHERE i.id=?`, inviteId);
  const what = [inv.sport, inv.season].filter(Boolean).join(', ');
  noteInvite(req.user.id);
  return sendMail({
    to: inv.email,
    subject: `${req.user.name} invited you to ${inv.team} on Dime Coach`,
    text:
      `Hi,\n\n${req.user.name} (${req.user.email}) invited you to join the team "${inv.team}"${what ? ` (${what})` : ''} on Dime Coach as ${inv.title}.\n\n` +
      `Dime Coach is where coaches plan practices, keep drills and draw plays together.\n\n` +
      `Create your account to join the team:\n\n${publicBase(req)}/join?token=${token}\n\n` +
      `The link works for ${INVITE_DAYS} days. If you were not expecting this, ignore this message and nothing will happen.`,
    secret: token,
  });
}

/** Invites an address with no account to a team, or sends the invitation again. Resolves to { ok, error }. */
export async function inviteToTeam(req, team, email, title, permsJson) {
  const old = get('SELECT id FROM team_invites WHERE team_id=? AND email=?', team.id, email);
  if (old) run('UPDATE team_invites SET title=?, perms_json=?, invited_by=? WHERE id=?', title, permsJson, req.user.id, old.id);
  const id = old ? old.id : Number(run('INSERT INTO team_invites (team_id, email, title, perms_json, invited_by, token_hash, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)', team.id, email, title, permsJson, req.user.id, '', nowIso(), nowIso()).lastInsertRowid);
  const r = await mailInvite(req, id);
  // An invitation nobody received is not left looking as if it were on its way.
  if (!r.ok && !old) run('DELETE FROM team_invites WHERE id=?', id);
  return r;
}
export async function resendInvite(req, teamId, inviteId) {
  const inv = get('SELECT id FROM team_invites WHERE id=? AND team_id=?', inviteId, teamId);
  return inv ? mailInvite(req, inv.id) : null;
}
export const cancelInvite = (teamId, inviteId) => run('DELETE FROM team_invites WHERE id=? AND team_id=?', inviteId, teamId);

/** A team's invitations that have not been taken up, as its owner sees them. */
export const pendingInvites = (teamId) =>
  all(`SELECT i.id, i.email, i.title, i.created_at, i.expires_at, (SELECT name FROM users WHERE id=i.invited_by) AS inviter FROM team_invites i WHERE i.team_id=? ORDER BY i.id`, teamId).map((i) => ({
    id: i.id, email: i.email, title: i.title, invited_at: i.created_at, invited_by: i.inviter || '', expired: i.expires_at < nowIso(),
  }));

/** The invitation a link belongs to, or null when the link is wrong or too old. */
export function inviteByToken(token) {
  const inv = token ? get(`SELECT ${INVITE_COLS} FROM team_invites i JOIN teams t ON t.id=i.team_id WHERE i.token_hash=?`, sha256(String(token))) : null;
  return inv && inv.expires_at > nowIso() ? inv : null;
}

/**
 * Puts a person on every team their address was invited to. Only call this when the address is
 * known to be theirs: they opened a link sent to it, or an administrator made the account.
 * Returns how many teams they joined.
 */
export function claimInvites(userId, email) {
  const me = get('SELECT name FROM users WHERE id=?', userId);
  const invites = all(`SELECT ${INVITE_COLS} FROM team_invites i JOIN teams t ON t.id=i.team_id WHERE i.email=? AND i.expires_at > ?`, String(email).toLowerCase(), nowIso());
  let joined = 0;
  for (const inv of invites) {
    const owns = get("SELECT 1 AS ok FROM memberships WHERE user_id=? AND owner_id=? AND role='owner'", userId, inv.owner_id);
    if (!owns) {
      joined += run('INSERT OR IGNORE INTO team_staff (team_id, user_id, title, perms_json, added_by) VALUES (?,?,?,?,?)', inv.team_id, userId, inv.title, inv.perms_json, inv.invited_by).changes;
      notify(inv.invited_by, { kind: 'team', title: `${me?.name || inv.email} joined ${inv.team}`, body: 'They accepted your invitation and can open the team now.', link: '/teams?tab=people' });
    }
  }
  run('DELETE FROM team_invites WHERE email=?', String(email).toLowerCase());
  return joined;
}

/** Tells someone who already has an account that a team was shared with them. Nothing is sent without an email service. */
export function mailAdded(req, person, team, title) {
  if (!mailerStatus().configured) return;
  sendMail({
    to: person.email,
    subject: `${req.user.name} added you to ${team.name} on Dime Coach`,
    text: `Hi ${person.name},\n\n${req.user.name} added you to the team "${team.name}" on Dime Coach as ${title}.\n\nSign in to open it:\n\n${publicBase(req)}/\n\nAfter signing in, choose ${team.name} under "Shared with you".`,
  });
}

// --- Choosing a new password by email ---
/** Emails a link for choosing a new password. The link works once, for an hour. */
export function mailReset(req, user) {
  const token = newToken();
  run('DELETE FROM password_resets WHERE user_id=? OR expires_at < ?', user.id, nowIso());
  run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), user.id, later(RESET_MINUTES * 60_000));
  return sendMail({
    to: user.email,
    subject: 'Choose a new Dime Coach password',
    text:
      `Hi ${user.name},\n\nSomeone asked to choose a new password for your Dime Coach account. If that was you, open this link:\n\n${publicBase(req)}/reset?token=${token}\n\n` +
      `The link works once, for ${RESET_MINUTES} minutes. If you did not ask for it, ignore this message: your password stays as it is.`,
    secret: token,
  });
}
/** The account a password link belongs to, or null when the link is wrong, used or too old. */
export function resetByToken(token) {
  const row = token ? get("SELECT u.* FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at > ? AND u.status='active'", sha256(String(token)), nowIso()) : null;
  return row || null;
}
export const clearResets = (userId) => run('DELETE FROM password_resets WHERE user_id=?', userId);
