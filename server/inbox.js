// Messages from one person to others, kept in each person's Messages beside what the app itself
// tells them. Who can be written to is worked out from what two people share: a team first, then
// a community or an organization. Nobody's email address is given out, only names.
import { all, db, get, run } from './db.js';
import { poke } from './live.js';
import { messagePrefs } from './notices.js';
import { settingsOf } from './family.js';

db.exec(`
CREATE TABLE IF NOT EXISTS direct_messages (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_to INTEGER,
  subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
  sender_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS direct_recipients (
  message_id INTEGER NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT, deleted_at TEXT,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_direct_recipients_user ON direct_recipients(user_id, message_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_from ON direct_messages(from_id, id);
`);

const str = (v, max) => String(v ?? '').slice(0, max);
const MAX_TO = 50;
const FAMILY_ROLE = { parent: 'Parent', family: 'Family', friend: 'Friend' };

/** Everyone who coaches a team: the owner of its workspace, then the people it is shared with. */
export const coachesOfTeam = (team) => [
  ...all("SELECT u.id, u.name, u.prefs_json, 'Coach' AS role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=? AND m.role='owner' AND u.status='active' AND COALESCE(u.follower,0)=0", team.owner_id),
  ...all("SELECT u.id, u.name, u.prefs_json, COALESCE(NULLIF(s.title,''),'Coach') AS role FROM team_staff s JOIN users u ON u.id=s.user_id WHERE s.team_id=? AND u.status='active'", team.id),
];
/** A team's parents, family and friends who have made an account, with the kind each one is. */
export const followersOfTeam = (team) =>
  all("SELECT u.id, u.name, u.prefs_json, c.kind FROM team_contacts c JOIN users u ON u.id=c.user_id WHERE c.team_id=? AND u.status='active' GROUP BY u.id ORDER BY u.name COLLATE NOCASE", team.id).map((p) => ({ ...p, role: FAMILY_ROLE[p.kind] || 'Family' }));

/**
 * Who a person can write to, in groups, nearest first: a group for each team they coach or follow,
 * then one for each community or organization they belong to. `all` keeps the people who asked not
 * to be listed, for checking a reply.
 */
export function peopleFor(user, { everyone = false } = {}) {
  const groups = [];
  const tidy = (people) => {
    const seen = new Set([user.id]);
    const out = [];
    for (const p of people) {
      if (seen.has(p.id) || (!everyone && messagePrefs(p).hide_in_to)) continue;
      seen.add(p.id);
      out.push({ id: p.id, name: p.name, role: p.role });
    }
    return out;
  };
  const add = (key, tier, label, sub, people) => {
    const list = tidy(people);
    if (list.length) groups.push({ key, tier, label, sub, people: list });
  };
  // Teams they coach: the other coaches, and the team's parents, family and friends.
  const coached = all(
    `SELECT DISTINCT t.* FROM teams t
      WHERE t.id IN (SELECT team_id FROM team_staff WHERE user_id=?)
         OR t.owner_id IN (SELECT owner_id FROM memberships WHERE user_id=? AND role='owner')
      ORDER BY t.name COLLATE NOCASE`,
    user.id, user.id,
  );
  const coachedIds = new Set(coached.map((t) => t.id));
  for (const t of coached) add(`team-${t.id}`, 'team', t.name, 'Team you coach', [...coachesOfTeam(t), ...followersOfTeam(t)]);
  // Teams they follow: the coaches, and the other followers when the team's board is open to them.
  for (const c of all('SELECT c.kind, t.* FROM team_contacts c JOIN teams t ON t.id=c.team_id WHERE c.user_id=? GROUP BY t.id ORDER BY t.name COLLATE NOCASE', user.id)) {
    if (coachedIds.has(c.id)) continue;
    const board = !!settingsOf(c).access?.[c.kind]?.board;
    add(`team-${c.id}`, 'team', c.name, 'Team you follow', [...coachesOfTeam(c), ...(board ? followersOfTeam(c) : [])]);
  }
  // Further out: everyone in the same community or organization.
  for (const c of all("SELECT c.id, c.name, c.plan FROM community_members m JOIN communities c ON c.id=m.community_id WHERE m.user_id=? AND m.status='active' ORDER BY c.name COLLATE NOCASE", user.id))
    add(
      `community-${c.id}`, 'community', c.name, c.plan === 'organization' ? 'Organization' : 'Community',
      all(
        `SELECT u.id, u.name, u.prefs_json, CASE m.role WHEN 'creator' THEN 'Admin' WHEN 'admin' THEN 'Admin' ELSE 'Member' END AS role
           FROM community_members m JOIN users u ON u.id=m.user_id
          WHERE m.community_id=? AND m.status='active' AND u.status='active' ORDER BY u.name COLLATE NOCASE`,
        c.id,
      ),
    );
  return groups;
}

const snippet = (body) => {
  const flat = String(body).replace(/\s+/g, ' ').trim();
  return flat.length > 180 ? `${flat.slice(0, 180)}…` : flat;
};
const namesTo = (messageId) => all('SELECT u.id, u.name FROM direct_recipients r JOIN users u ON u.id=r.user_id WHERE r.message_id=? ORDER BY u.name COLLATE NOCASE', messageId);

/** What other people wrote to this person, in the shape the Messages page lists. */
export const directFor = (userId) =>
  all(
    `SELECT d.*, r.read_at, u.name AS by_name FROM direct_recipients r JOIN direct_messages d ON d.id=r.message_id JOIN users u ON u.id=d.from_id
      WHERE r.user_id=? AND r.deleted_at IS NULL ORDER BY d.id DESC LIMIT 100`,
    userId,
  ).map((d) => ({
    key: `dm-${d.id}`, id: d.id, kind: 'direct', community_id: 0, community: '', at: d.created_at, by: d.by_name, by_id: d.from_id,
    title: d.subject || '(no subject)', text: snippet(d.body), body: d.body, link: '', unread: !d.read_at, to: namesTo(d.id).map((p) => p.name),
  }));
/** What this person wrote to others, newest first. */
const sentBy = (userId) =>
  all('SELECT * FROM direct_messages WHERE from_id=? AND sender_deleted=0 ORDER BY id DESC LIMIT 100', userId).map((d) => ({
    key: `sent-${d.id}`, id: d.id, kind: 'sent', community_id: 0, community: '', at: d.created_at, by: 'You', by_id: userId,
    title: d.subject || '(no subject)', text: snippet(d.body), body: d.body, link: '', unread: false, to: namesTo(d.id).map((p) => p.name),
  }));
/** Marks what people wrote to this person as read: one message, or with no id all of them. */
export function readDirect(userId, id) {
  if (id) run("UPDATE direct_recipients SET read_at=datetime('now') WHERE message_id=? AND user_id=? AND read_at IS NULL", id, userId);
  else run("UPDATE direct_recipients SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL", userId);
}

// Each person may send only so many in an hour, so nobody's Messages can be flooded.
const sent = new Map();
const SEND_LIMIT = 40;
function tooMany(userId) {
  const recent = (sent.get(userId) || []).filter((t) => Date.now() - t < 60 * 60_000);
  sent.set(userId, [...recent, Date.now()]);
  return recent.length >= SEND_LIMIT;
}

/** `inbox` gives the whole Messages list back after a change, as the routes beside these do. */
export function mountInbox(app, inbox) {
  app.get('/api/messages/people', (req, res) => res.json(peopleFor(req.user)));
  app.get('/api/messages/sent', (req, res) => res.json(sentBy(req.user.id)));
  app.post('/api/messages/send', (req, res) => {
    const body = str(req.body.body, 8000).trim();
    const subject = str(req.body.subject, 150).replace(/\s+/g, ' ').trim();
    if (!body) return res.status(400).json({ error: 'Write a message first.' });
    const ids = [...new Set((Array.isArray(req.body.to) ? req.body.to : []).map(Number).filter(Number.isInteger))].filter((id) => id !== req.user.id);
    if (ids.length === 0) return res.status(400).json({ error: 'Choose who the message is for.' });
    if (ids.length > MAX_TO) return res.status(400).json({ error: `A message can go to ${MAX_TO} people at most.` });
    // An answer can always go back to whoever wrote, and to the others it was sent to.
    const replyTo = req.body.reply_to ? get('SELECT d.* FROM direct_messages d JOIN direct_recipients r ON r.message_id=d.id WHERE d.id=? AND r.user_id=?', Number(req.body.reply_to), req.user.id) : null;
    const allowed = new Set(peopleFor(req.user).flatMap((g) => g.people.map((p) => p.id)));
    if (replyTo) {
      allowed.add(replyTo.from_id);
      for (const p of namesTo(replyTo.id)) allowed.add(p.id);
    }
    const to = ids.filter((id) => allowed.has(id) && get("SELECT 1 AS ok FROM users WHERE id=? AND status='active'", id));
    if (to.length !== ids.length) return res.status(403).json({ error: 'One of the people you chose can no longer be written to. Take them off and send again.' });
    if (tooMany(req.user.id)) return res.status(429).json({ error: 'You have sent a lot of messages in the last hour. Try again a little later.' });
    const id = Number(run('INSERT INTO direct_messages (from_id, reply_to, subject, body) VALUES (?,?,?,?)', req.user.id, replyTo?.id ?? null, subject, body).lastInsertRowid);
    for (const userId of to) run('INSERT INTO direct_recipients (message_id, user_id) VALUES (?,?)', id, userId);
    poke(to);
    res.json({ ok: true, sent: sentBy(req.user.id) });
  });
  app.post('/api/messages/direct/:id/read', (req, res) => {
    readDirect(req.user.id, Number(req.params.id));
    res.json(inbox(req.user.id));
  });
  // Taking a message out of your own list leaves everyone else's copy alone.
  app.delete('/api/messages/direct/:id', (req, res) => {
    run("UPDATE direct_recipients SET deleted_at=datetime('now'), read_at=COALESCE(read_at, datetime('now')) WHERE message_id=? AND user_id=?", Number(req.params.id), req.user.id);
    res.json(inbox(req.user.id));
  });
  app.delete('/api/messages/sent/:id', (req, res) => {
    run('UPDATE direct_messages SET sender_deleted=1 WHERE id=? AND from_id=?', Number(req.params.id), req.user.id);
    res.json(sentBy(req.user.id));
  });
}
