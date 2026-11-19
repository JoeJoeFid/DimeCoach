// Sharing a drill, a play or a resource, all the same way.
//
// One of them can go to three kinds of place. To people: other coaches picked from a list, anyone
// by email address, and the parents, family and friends of the coach's own team, who see it on the
// team's page. To communities. And out as a link anyone can open. This file looks after the first
// and the last, and keeps the list of everywhere a thing has been shared, which is shown beside it.
// Sharing with a community is in communities.js, and the team's page is in family.js.
//
// A drill or a play sent to someone is read through a link of their own, as a practice is. It
// shows what a community share shows: no coach-only notes and no uploaded files. A resource that
// is a link is sent as the link itself. Removing a send stops its link working.
import crypto from 'node:crypto';
import { all, db, get, run, tx } from './db.js';
import { copyDrill, copyPlay, drillView, enter, playView } from './communities.js';
import { FAMILY_KINDS, saveFamilyList, settingsOf } from './family.js';
import { publicBase } from './invites.js';
import { mailerStatus, sendMail } from './mailer.js';
import { notify } from './notices.js';
import { resourceList } from './resources.js';

db.exec(`
CREATE TABLE IF NOT EXISTS item_sends (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                             -- 'drill' | 'play' | 'resource'
  ref TEXT NOT NULL,                              -- the drill's or play's id, or the resource's key
  from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  to_email TEXT DEFAULT '',                       -- both empty, and no community: the link for anyone
  community_id INTEGER REFERENCES communities(id) ON DELETE CASCADE,  -- a resource posted in a community's discussions
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS item_sends_item ON item_sends(owner_id, kind, ref);
`);

const KINDS = ['drill', 'play', 'resource'];
/** The part of a team's page each kind shows on, and the list in the team's settings it is kept in. */
const FAMILY_PART = { drill: 'drills', play: 'playbook', resource: 'resources' };
const FAMILY_LIST = { drill: 'drills', play: 'plays', resource: 'resources' };
const NOUN = { drill: 'drill', play: 'play', resource: 'link' };
const KIND_WORDS = { parent: 'Parents', family: 'Family', friend: 'Friends' };
const str = (v, max = 200) => String(v ?? '').slice(0, max);
const newToken = () => crypto.randomBytes(18).toString('base64url');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_AT_ONCE = 20;
const SEND_LIMIT = 40;
const sent = new Map();
const sentLately = (userId) => {
  const recent = (sent.get(userId) || []).filter((t) => Date.now() - t < 60 * 60_000);
  sent.set(userId, recent);
  return recent.length;
};

/** The thing being shared, or null when this workspace has no such thing. */
function itemOf(ownerId, kind, ref) {
  if (kind === 'drill' || kind === 'play') {
    const row = get(`SELECT * FROM ${kind === 'drill' ? 'drills' : 'plays'} WHERE id=? AND owner_id=?`, Number(ref), ownerId);
    return row ? { kind, ref: String(row.id), title: row.name, row, sport_id: row.sport_id } : null;
  }
  if (kind === 'resource') {
    const r = resourceList(ownerId).find((x) => x.key === ref);
    return r ? { kind, ref: r.key, title: r.title, resource: r, sport_id: null } : null;
  }
  return null;
}
/** What is kept in a team's list for this thing: a number for a drill or play, the key for a resource. */
const listed = (item) => (item.kind === 'resource' ? item.ref : Number(item.ref));

/** Who the caller can pick: the other coaches of their team, then the members of their communities. Each person once. */
function peopleFor(req, team) {
  const seen = new Set([req.user.id]);
  const out = [];
  const add = (rows, where) => {
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: r.id, name: r.name, where });
    }
  };
  add(
    [
      ...all("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=? AND m.role='owner'", req.ownerId),
      ...(team ? all('SELECT u.id, u.name FROM team_staff s JOIN users u ON u.id=s.user_id WHERE s.team_id=? ORDER BY u.name COLLATE NOCASE', team.id) : []),
    ],
    team ? 'On this team' : 'Coaches here',
  );
  const mine = all("SELECT c.id, c.name FROM communities c JOIN community_members cm ON cm.community_id=c.id WHERE cm.user_id=? AND cm.status='active' ORDER BY c.name COLLATE NOCASE", req.user.id);
  for (const c of mine)
    add(all("SELECT u.id, u.name FROM community_members cm JOIN users u ON u.id=cm.user_id WHERE cm.community_id=? AND cm.status='active' ORDER BY u.name COLLATE NOCASE", c.id), c.name);
  return out;
}

/** Which kinds of follower see this part of a team's page, in words: "Parents and family". */
function audience(team, part) {
  const access = settingsOf(team).access;
  const on = FAMILY_KINDS.filter((k) => access[k][part]);
  const names = on.map((k) => KIND_WORDS[k]);
  return { sees: Object.fromEntries(FAMILY_KINDS.map((k) => [k, access[k][part]])), words: names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1].toLowerCase()}` : names[0] || '' };
}
const teamsOf = (ownerId, item) => all('SELECT * FROM teams WHERE owner_id=? ORDER BY name COLLATE NOCASE', ownerId).filter((t) => item.sport_id === null || t.sport_id === item.sport_id);
const onTeam = (team, item) => settingsOf(team)[FAMILY_LIST[item.kind]].includes(listed(item));

/** Everywhere a thing has been shared, most personal first: the team, people, communities, then the open link. */
function sharedWith(req, item) {
  const out = [];
  for (const t of teamsOf(req.ownerId, item)) {
    if (!onTeam(t, item)) continue;
    const who = audience(t, FAMILY_PART[item.kind]).words;
    out.push({ key: `team-${t.id}`, type: 'team', label: t.name, detail: who ? `${who} see it on the team's page` : `On the team's page, which nobody is let into this part of yet` });
  }
  const rows = all(
    'SELECT s.*, u.name AS to_name, c.name AS community FROM item_sends s LEFT JOIN users u ON u.id=s.to_user_id LEFT JOIN communities c ON c.id=s.community_id WHERE s.owner_id=? AND s.kind=? AND s.ref=? ORDER BY s.id',
    req.ownerId, item.kind, item.ref,
  );
  for (const r of rows) if (r.to_user_id || r.to_email) out.push({ key: `send-${r.id}`, type: r.to_user_id ? 'coach' : 'email', label: r.to_email || r.to_name || 'A coach', detail: `Sent ${String(r.created_at).slice(0, 10)}`, send_id: r.id });
  if (item.kind !== 'resource')
    for (const s of all('SELECT cs.status, c.name FROM community_shares cs JOIN communities c ON c.id=cs.community_id WHERE cs.owner_id=? AND cs.kind=? AND cs.item_id=? ORDER BY c.name COLLATE NOCASE', req.ownerId, item.kind, Number(item.ref)))
      out.push({ key: `community-${s.name}`, type: 'community', label: s.name, detail: s.status === 'pending' ? 'Waiting for an admin to approve it' : 'In its library' });
  const posted = new Set();
  for (const r of rows) {
    if (!r.community_id || posted.has(r.community_id)) continue;
    posted.add(r.community_id);
    out.push({ key: `post-${r.community_id}`, type: 'community', label: r.community || 'A community', detail: 'Posted in its discussions' });
  }
  const open = rows.find((r) => !r.to_user_id && !r.to_email && !r.community_id);
  if (open) out.push({ key: 'link', type: 'link', label: 'Anyone with the link', detail: 'Can open it without an account', send_id: open.id });
  return out;
}

function stateOf(req, item) {
  const team = get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(req.query.team_id ?? req.body?.team_id), req.ownerId);
  const fits = team && (item.sport_id === null || team.sport_id === item.sport_id);
  const rows = all('SELECT s.id, s.token, s.to_user_id, s.to_email, s.community_id, s.created_at, u.name FROM item_sends s LEFT JOIN users u ON u.id=s.to_user_id WHERE s.owner_id=? AND s.kind=? AND s.ref=? ORDER BY s.id DESC', req.ownerId, item.kind, item.ref);
  const open = rows.find((r) => !r.to_user_id && !r.to_email && !r.community_id);
  const part = FAMILY_PART[item.kind];
  return {
    mail: mailerStatus().configured,
    people: peopleFor(req, fits ? team : null),
    sent: rows.filter((r) => r.to_user_id || r.to_email).map((r) => ({ id: r.id, to: r.to_email || r.name || 'A coach', created_at: r.created_at })),
    // A link of ours for a drill or a play. A resource that is a link is its own link, and a file has none.
    link: item.kind === 'resource' ? null : open ? { id: open.id, url: `${publicBase(req)}/shared/i/${open.token}` } : null,
    team: fits
      ? {
          id: team.id, name: team.name, shared: onTeam(team, item), ...audience(team, part),
          // How many of each kind have made an account, and so can open the team's page.
          joined: Object.fromEntries(FAMILY_KINDS.map((k) => [k, get('SELECT COUNT(*) AS n FROM team_contacts WHERE team_id=? AND kind=? AND user_id IS NOT NULL', team.id, k).n])),
        }
      : null,
    with: sharedWith(req, item),
  };
}

export function mountItemSharesPublic(app) {
  /** The drill or play behind a link, for reading. */
  app.get('/api/public/items/:token', (req, res) => {
    const s = get("SELECT * FROM item_sends WHERE token=? AND kind IN ('drill','play')", str(req.params.token, 80));
    const row = s && get(`SELECT * FROM ${s.kind === 'drill' ? 'drills' : 'plays'} WHERE id=? AND owner_id=?`, Number(s.ref), s.owner_id);
    if (!row) return res.status(404).json({ error: 'This link no longer works. The coach who sent it may have stopped sharing, or deleted it.' });
    res.json({
      kind: s.kind, title: row.name, by: get('SELECT name FROM users WHERE id=?', s.from_user)?.name || 'A coach',
      sport: get('SELECT name FROM sports WHERE id=?', row.sport_id)?.name || '', note: s.note || '',
      content: s.kind === 'drill' ? drillView(row) : playView(row),
    });
  });
}

export function mountItemShares(app) {
  const own = (req, res) => {
    const item = KINDS.includes(req.params.kind) ? itemOf(req.ownerId, req.params.kind, str(req.query.ref ?? req.body?.ref, 2100)) : null;
    if (!item) res.status(404).json({ error: 'Not found' });
    return item;
  };

  // For each thing of a kind that has been shared, the names of where it went. For the lists.
  app.get('/api/shares/:kind/summary', (req, res) => {
    const kind = req.params.kind;
    if (!KINDS.includes(kind)) return res.status(404).json({ error: 'Not found' });
    const refs = new Set(all('SELECT DISTINCT ref FROM item_sends WHERE owner_id=? AND kind=?', req.ownerId, kind).map((r) => r.ref));
    for (const t of all('SELECT * FROM teams WHERE owner_id=?', req.ownerId)) for (const v of settingsOf(t)[FAMILY_LIST[kind]]) refs.add(String(v));
    if (kind !== 'resource') for (const r of all('SELECT DISTINCT item_id FROM community_shares WHERE owner_id=? AND kind=?', req.ownerId, kind)) refs.add(String(r.item_id));
    const out = {};
    for (const ref of refs) {
      const item = itemOf(req.ownerId, kind, ref);
      const list = item ? sharedWith(req, item) : [];
      if (list.length) out[ref] = list.map((w) => w.label);
    }
    res.json(out);
  });

  app.get('/api/shares/:kind', (req, res) => {
    const item = own(req, res);
    if (item) res.json(stateOf(req, item));
  });

  /** Puts it on the team's page for its parents, family and friends, or takes it off. */
  app.put('/api/shares/:kind/team', (req, res) => {
    const item = own(req, res);
    if (!item) return;
    const team = get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(req.body.team_id), req.ownerId);
    if (!team || (item.sport_id !== null && team.sport_id !== item.sport_id)) return res.status(400).json({ error: 'Choose one of your teams.' });
    const list = settingsOf(team)[FAMILY_LIST[item.kind]].filter((v) => v !== listed(item));
    if (req.body.shared) list.push(listed(item));
    saveFamilyList(team, FAMILY_LIST[item.kind], list);
    res.json(stateOf(req, item));
  });

  /** Sends it to the coaches picked and the addresses typed. */
  app.post('/api/shares/:kind/send', async (req, res) => {
    const item = own(req, res);
    if (!item) return;
    if (item.kind === 'resource' && item.resource.kind !== 'link') return res.status(400).json({ error: 'A picture or video is a private file. Share the file itself instead.' });
    const team = get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(req.body.team_id), req.ownerId);
    const allowed = new Map(peopleFor(req, team).map((p) => [p.id, p]));
    const ids = [...new Set((Array.isArray(req.body.user_ids) ? req.body.user_ids : []).map(Number))].filter((id) => allowed.has(id));
    const typed = [...new Set((Array.isArray(req.body.emails) ? req.body.emails : []).map((e) => str(e, 200).trim().toLowerCase()).filter(Boolean))];
    const bad = typed.filter((e) => !EMAIL.test(e));
    if (bad.length) return res.status(400).json({ error: `${bad[0]} does not look like an email address.` });
    const mail = mailerStatus().configured;
    if (typed.length && !mail) return res.status(400).json({ error: 'Email is not set up on this site, so this can only be sent to coaches picked from the list. They get a message in Dime Coach.' });

    // Everyone it goes to, each once: someone typed by address who has an account counts as that person.
    const to = new Map();
    for (const id of ids) {
      const u = get('SELECT id, name, email FROM users WHERE id=?', id);
      if (u) to.set(String(u.email).toLowerCase(), { user: u, email: u.email, typed: false });
    }
    for (const e of typed) {
      if (e === String(req.user.email).toLowerCase() || to.has(e)) continue;
      const u = get('SELECT id, name, email FROM users WHERE lower(email)=?', e);
      to.set(e, { user: u || null, email: e, typed: true });
    }
    if (!to.size) return res.status(400).json({ error: 'Choose at least one coach, or type an email address.' });
    if (to.size > MAX_AT_ONCE) return res.status(400).json({ error: `Send to ${MAX_AT_ONCE} people at most in one go.` });
    if (sentLately(req.user.id) + to.size > SEND_LIMIT) return res.status(429).json({ error: 'You have sent a lot in the last hour. Try again a little later.' });

    const note = str(req.body.note, 1000).trim();
    const noun = NOUN[item.kind];
    let mailed = 0;
    let messaged = 0;
    const failed = [];
    for (const r of to.values()) {
      const token = newToken();
      // Sending again to the same person replaces what they were sent before.
      tx(() => {
        if (r.user) run('DELETE FROM item_sends WHERE owner_id=? AND kind=? AND ref=? AND to_user_id=?', req.ownerId, item.kind, item.ref, r.user.id);
        else run('DELETE FROM item_sends WHERE owner_id=? AND kind=? AND ref=? AND to_email=?', req.ownerId, item.kind, item.ref, r.email);
        run('INSERT INTO item_sends (token, owner_id, kind, ref, from_user, to_user_id, to_email, note) VALUES (?,?,?,?,?,?,?,?)', token, req.ownerId, item.kind, item.ref, req.user.id, r.user?.id ?? null, r.typed ? r.email : '', note);
      });
      // A resource is its own address. A drill or a play is read through a link of the person's own.
      const inApp = item.kind === 'resource' ? item.resource.url : `/shared/i/${token}`;
      const link = item.kind === 'resource' ? item.resource.url : `${publicBase(req)}/shared/i/${token}`;
      if (r.user) {
        notify(r.user.id, { kind: 'share', ref: `item-send-${item.kind}-${item.ref}`.slice(0, 200), title: `${req.user.name} shared a ${noun} with you: ${item.title}`, body: note || (item.kind === 'resource' ? link : ''), link: inApp });
        messaged++;
      }
      if (!mail) continue;
      sent.set(req.user.id, [...(sent.get(req.user.id) || []), Date.now()]);
      const result = await sendMail({
        to: r.email,
        subject: `${req.user.name} shared a ${noun} with you: ${item.title}`,
        text: `Hi${r.user ? ` ${r.user.name}` : ''},\n\n${req.user.name} shared a ${noun} with you from Dime Coach: "${item.title}".\n\n` + (note ? `${req.user.name} wrote:\n${note}\n\n` : '') + `Open it here:\n\n${link}`,
        ...(item.kind === 'resource' ? {} : { secret: token }),
      });
      if (result.ok) mailed++;
      else failed.push(r.typed ? r.email : r.user.name);
    }
    res.json({ ...stateOf(req, item), result: { mailed, messaged, failed, total: to.size } });
  });

  /** The link for anyone: made the first time it is asked for. */
  app.post('/api/shares/:kind/link', (req, res) => {
    const item = own(req, res);
    if (!item) return;
    if (item.kind === 'resource') return res.status(400).json({ error: 'A resource that is a link is shared as the link itself.' });
    if (!get("SELECT id FROM item_sends WHERE owner_id=? AND kind=? AND ref=? AND to_user_id IS NULL AND to_email='' AND community_id IS NULL", req.ownerId, item.kind, item.ref))
      run("INSERT INTO item_sends (token, owner_id, kind, ref, from_user, to_email) VALUES (?,?,?,?,?,'')", newToken(), req.ownerId, item.kind, item.ref, req.user.id);
    res.json(stateOf(req, item));
  });

  /** Notes that a resource was posted in a community's discussions, so it shows among the places it was shared. */
  app.post('/api/shares/:kind/posted', (req, res) => {
    const item = own(req, res);
    if (!item) return;
    req.params.id = String(Number(req.body.community_id));
    const at = enter(req, res);
    if (!at) return;
    run('INSERT INTO item_sends (token, owner_id, kind, ref, from_user, community_id) VALUES (?,?,?,?,?,?)', newToken(), req.ownerId, item.kind, item.ref, req.user.id, at.c.id);
    res.json(stateOf(req, item));
  });

  app.delete('/api/shares/:kind/sends/:sendId', (req, res) => {
    const item = own(req, res);
    if (!item) return;
    run('DELETE FROM item_sends WHERE id=? AND owner_id=? AND kind=? AND ref=?', Number(req.params.sendId), req.ownerId, item.kind, item.ref);
    res.json(stateOf(req, item));
  });

  /** Adds a copy of the drill or play behind a link to the caller's own library, for one of their teams' sports. */
  app.post('/api/item-links/:token/copy', (req, res) => {
    const s = get("SELECT * FROM item_sends WHERE token=? AND kind IN ('drill','play')", str(req.params.token, 80));
    const row = s && get(`SELECT * FROM ${s.kind === 'drill' ? 'drills' : 'plays'} WHERE id=? AND owner_id=?`, Number(s.ref), s.owner_id);
    if (!row) return res.status(404).json({ error: 'This link no longer works.' });
    // Always the caller's own workspace, even while they are working in a team someone shared with them.
    const ownerId = req.homeOwnerId ?? req.ownerId;
    const team = get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(req.body.team_id), ownerId);
    if (!team) return res.status(400).json({ error: 'Choose one of your teams to add this to.' });
    res.json({ kind: s.kind, id: tx(() => (s.kind === 'drill' ? copyDrill(row, ownerId, team.sport_id) : copyPlay(row, ownerId, team.sport_id, new Map()))) });
  });
}
