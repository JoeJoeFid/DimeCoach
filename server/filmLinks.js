// Links to a video in a team's Filmroom that can be passed around: in a text message, say.
//
// Sharing in the Filmroom is with a person, by their email address (film.js). A link is for when
// the address is not known: whoever opens it signs in, or makes an account there and then, and
// is put on the team's list as a guest with that one video shared with them. So it still takes
// an account to watch, and the coaches can see who came in by it and stop any of them.
//
// Because a link lets anyone who holds it make an account, only the system administrator can
// make one. Each works for a while and can be turned off sooner. Only the hash of its code is kept.
//
// This stands apart from film.js so that signing in (auth.js) can use it without reaching for
// everything video does.
import crypto from 'node:crypto';
import { all, db, get, run } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS film_links (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                             -- 'video' | 'clip' | 'reel', as a share is
  ref_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  made_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  opened INTEGER NOT NULL DEFAULT 0               -- how many people have come in by it
);
CREATE INDEX IF NOT EXISTS idx_film_links_team ON film_links(team_id);
`);

export const FILM_LINK_DAYS = 30;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowIso = () => new Date().toISOString();

/** What a link is to, by its title, or null when it has been deleted since. */
function titleOf(link) {
  if (link.kind === 'video') return get("SELECT title FROM streams WHERE id=? AND team_id=? AND status='ended' AND saved=1", link.ref_id, link.team_id)?.title ?? null;
  return get(`SELECT title FROM ${link.kind === 'clip' ? 'film_clips' : 'film_reels'} WHERE id=? AND team_id=?`, link.ref_id, link.team_id)?.title ?? null;
}
/** Makes a link, and gives its code this once. */
export function makeFilmLink(teamId, kind, refId, userId) {
  const token = crypto.randomBytes(24).toString('base64url');
  const id = Number(
    run('INSERT INTO film_links (team_id, kind, ref_id, token_hash, made_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?)', teamId, kind, refId, sha256(token), userId, nowIso(), new Date(Date.now() + FILM_LINK_DAYS * 86400_000).toISOString()).lastInsertRowid,
  );
  return { id, token };
}
/** A team's links that still work and are still to something. */
export const filmLinksOf = (teamId) =>
  all('SELECT * FROM film_links WHERE team_id=? AND expires_at>? ORDER BY id DESC', teamId, nowIso())
    .filter((l) => titleOf(l) !== null)
    .map((l) => ({ id: l.id, kind: l.kind, ref_id: l.ref_id, created_at: l.created_at, expires_at: l.expires_at, opened: l.opened }));
export const dropFilmLink = (id, teamId) => run('DELETE FROM film_links WHERE id=? AND team_id=?', Number(id), teamId).changes > 0;

/** The link a code belongs to, with what to show someone who has opened it, or null when it is wrong, too old, or to something deleted. */
export function filmLinkByToken(token) {
  const link = token ? get('SELECT * FROM film_links WHERE token_hash=? AND expires_at>?', sha256(String(token)), nowIso()) : null;
  const team = link && get('SELECT * FROM teams WHERE id=?', link.team_id);
  const title = team ? titleOf(link) : null;
  if (title === null) return null;
  return { link, team, info: { team: team.name, title: title || 'Game video', kind: link.kind, by: get('SELECT name FROM users WHERE id=?', link.made_by)?.name || 'A coach' } };
}
/** Whether an address is waiting on an invitation sent to it. Such an address is not to be claimed by whoever types it first. */
export const addressAwaited = (email) =>
  !!get("SELECT 1 AS ok FROM team_contacts WHERE lower(email)=? AND user_id IS NULL LIMIT 1", email) || !!get('SELECT 1 AS ok FROM team_invites WHERE lower(email)=? LIMIT 1', email);

/**
 * Lets someone in by a link: the video is shared with them, and they are put on the team's list
 * as a guest if they are not on it already. One of the team's own coaches needs neither.
 * Returns where to send them.
 */
export function claimFilmLink({ link, team }, user) {
  const coaches =
    !!get("SELECT 1 AS ok FROM memberships WHERE user_id=? AND owner_id=? AND role='owner'", user.id, team.owner_id) || !!get('SELECT 1 AS ok FROM team_staff WHERE user_id=? AND team_id=?', user.id, team.id);
  if (coaches) return { team_id: team.id, coach: true, share: 0 };
  let contact = get('SELECT * FROM team_contacts WHERE team_id=? AND user_id=? ORDER BY id LIMIT 1', team.id, user.id);
  if (!contact) {
    // On the list by their address, without an account until now.
    const waiting = get('SELECT * FROM team_contacts WHERE team_id=? AND lower(email)=? AND user_id IS NULL ORDER BY id LIMIT 1', team.id, String(user.email).toLowerCase());
    if (waiting) run('UPDATE team_contacts SET user_id=?, token_hash=NULL, token_expires=NULL WHERE id=?', user.id, waiting.id);
    const id = waiting?.id ?? run("INSERT INTO team_contacts (team_id, name, email, kind, player_ids_json, user_id, can_watch, can_broadcast) VALUES (?,?,?,'guest','[]',?,0,0)", team.id, user.name, user.email, user.id).lastInsertRowid;
    contact = get('SELECT * FROM team_contacts WHERE id=?', id);
  }
  const made = run('INSERT OR IGNORE INTO film_shares (team_id, kind, ref_id, contact_id, shared_by, created_at) VALUES (?,?,?,?,?,?)', team.id, link.kind, link.ref_id, contact.id, link.made_by, nowIso());
  if (made.changes) run('UPDATE film_links SET opened=opened+1 WHERE id=?', link.id);
  const share = get('SELECT id FROM film_shares WHERE kind=? AND ref_id=? AND contact_id=?', link.kind, link.ref_id, contact.id);
  return { team_id: team.id, coach: false, share: share?.id ?? 0 };
}
