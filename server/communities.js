// Communities: groups of coaches who talk to each other and, if the community allows it, share
// drills, plays and practice plans. A person belongs to a community as themselves (a user), while
// the things they share live in their own workspace (an owner). Sharing never moves anything:
// a share points at the original, and "add to mine" makes a separate copy for the taker.
import crypto from 'node:crypto';
import { all, get, run, tx } from './db.js';
import { poke } from './live.js';
import { noticesFor, notify, readNotices } from './notices.js';

const str = (v, max = 200) => String(v ?? '').slice(0, max);
const parse = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
const KINDS = ['drill', 'play', 'plan'];
const TABLE = { drill: 'drills', play: 'plays', plan: 'plans' };
const KIND_FLAG = { drill: 'share_drills', play: 'share_plays', plan: 'share_plans' };
const newCode = () => crypto.randomBytes(5).toString('hex').toUpperCase();

// --- Who may do what ----------------------------------------------------------
const membership = (communityId, userId) => get('SELECT * FROM community_members WHERE community_id=? AND user_id=?', communityId, userId);
const isAdminRole = (m) => !!m && m.status === 'active' && (m.role === 'creator' || m.role === 'admin');
// What an admin may do. The creator gives each one separately, and can do all of them.
//   moderate: delete anyone's messages and replies, and take shared things down
//   approve:  approve or decline what members share; their own shares need no approval
//   settings: the name, description, picture, and what may be shared
//   people:   invite and remove members, and see the join code
const COMMUNITY_PERMS = ['moderate', 'approve', 'settings', 'people'];
const POWER_WORDS = { moderate: 'remove messages and shared items', approve: 'approve what is shared', settings: 'change the settings', people: 'invite and remove people' };
function permsOf(m) {
  const all = (v) => Object.fromEntries(COMMUNITY_PERMS.map((p) => [p, v]));
  if (!m || m.status !== 'active' || m.role === 'member') return all(false);
  if (m.role === 'creator') return all(true);
  // An admin made before powers were separate has all of them.
  const saved = parse(m.perms_json, {}) || {};
  return Object.fromEntries(COMMUNITY_PERMS.map((p) => [p, saved[p] === undefined ? true : !!saved[p]]));
}
const can = (m, perm) => permsOf(m)[perm];

/** Loads the community and the caller's place in it. Answers the request itself when they have none. */
function enter(req, res, { perm = '', creator = false } = {}) {
  const c = get('SELECT * FROM communities WHERE id=?', Number(req.params.id));
  const m = c && membership(c.id, req.user.id);
  if (!c || !m || m.status !== 'active') {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  if (creator && m.role !== 'creator') {
    res.status(403).json({ error: 'Only the person who created this community can do that.' });
    return null;
  }
  if (perm && !can(m, perm)) {
    res.status(403).json({ error: 'You have not been given permission to do that in this community.' });
    return null;
  }
  return { c, m };
}

// --- What a shared thing looks like to other members ----------------------------
// Coach-only notes, player notes, player assignments and uploaded files never leave the owner's workspace.
const linksOf = (json) => {
  const e = parse(json, {});
  return Array.isArray(e?.links) ? e.links : [];
};
export const tagNames = (table, col, rowId) => all(`SELECT t.name, t.color FROM ${table} x JOIN tags t ON t.id=x.tag_id WHERE x.${col}=? ORDER BY t.name`, rowId);
const stations = (json) => (Array.isArray(parse(json, [])) ? parse(json, []) : []).map((g) => ({ name: str(g?.name), notes_html: str(g?.notes_html, 20000), members: [] }));
export const playView = (p) => ({
  id: p.id, name: p.name, category: p.category, labels: parse(p.labels_json, []), court: p.court, flipped: !!p.flipped,
  notes: p.notes, frames: parse(p.frames_json, [{ note: '', objects: [] }]), links: linksOf(p.attachments_json),
});
const playsOf = (json, ownerId) =>
  (Array.isArray(parse(json, [])) ? parse(json, []) : [])
    .map((pid) => get('SELECT * FROM plays WHERE id=? AND owner_id=?', Number(pid), ownerId))
    .filter(Boolean);
export const drillView = (d) => ({
  name: d.name, duration_min: d.duration_min, notes_html: d.notes_html, groups: stations(d.groups_json),
  links: linksOf(d.extras_json), tags: tagNames('drill_tags', 'drill_id', d.id), plays: playsOf(d.plays_json, d.owner_id).map(playView),
});
const planItems = (planId) => all('SELECT * FROM plan_items WHERE plan_id=? ORDER BY position, id', planId);
export const planView = (p) => ({
  title: p.title, kind: p.kind, is_game: !!p.is_game, start_time: p.start_time, intro_html: p.intro_html,
  items: planItems(p.id).map((it) => ({
    kind: it.kind, title: it.title, duration_min: it.duration_min, notes_html: it.notes_html, reps: it.reps,
    links: linksOf(it.extras_json), tags: tagNames('plan_item_tags', 'item_id', it.id), plays: playsOf(it.plays_json, p.owner_id).map(playView),
  })),
});
const source = (share) => get(`SELECT * FROM ${TABLE[share.kind]} WHERE id=? AND owner_id=?`, share.item_id, share.owner_id);
export const titleOf = (kind, row) => (kind === 'plan' ? row.title || 'Practice' : row.name);
export function summaryOf(kind, row) {
  if (kind === 'drill') return `${row.duration_min} min`;
  if (kind === 'play') return [row.category, `${parse(row.frames_json, []).length || 1} step${(parse(row.frames_json, []).length || 1) === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  const items = planItems(row.id);
  const mins = items.reduce((n, it) => n + (it.duration_min || 0), 0);
  return `${items.filter((it) => it.kind === 'item').length} items · ${mins} min`;
}
/** What to draw on a shared thing's card: a play's first step, or the first lines of a practice. */
function artOf(kind, row) {
  const play = kind === 'play' ? row : kind === 'drill' ? playsOf(row.plays_json, row.owner_id)[0] : null;
  if (play) return { play: { court: play.court, flipped: !!play.flipped, frame: parse(play.frames_json, [])[0] ?? { note: '', objects: [] } } };
  if (kind === 'plan') return { lines: planItems(row.id).slice(0, 4).map((it) => ({ kind: it.kind, title: it.title, duration_min: it.duration_min })) };
  // A drill with no play attached: the start of its notes, as plain words.
  const words = String(row.notes_html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  return words ? { text: words.slice(0, 180) } : {};
}
/** One row of a library listing. Null when the original has been deleted. */
function shareOut(s, userId) {
  const row = source(s);
  if (!row) return null;
  return {
    id: s.id, community_id: s.community_id, community_name: s.community_name, kind: s.kind, status: s.status,
    title: titleOf(s.kind, row), summary: summaryOf(s.kind, row), by: s.by_name, by_id: s.user_id, mine: s.user_id === userId, shared_at: s.created_at,
    art: artOf(s.kind, row),
    // Which of their own things this is, so the sharer's lists can mark it. Not told to anyone else.
    item_id: s.user_id === userId ? s.item_id : undefined,
    tags: s.kind === 'drill' ? tagNames('drill_tags', 'drill_id', row.id) : [],
  };
}
const SHARE_SELECT = `SELECT s.*, u.name AS by_name, c.name AS community_name FROM community_shares s
  JOIN users u ON u.id=s.user_id JOIN communities c ON c.id=s.community_id`;

// --- Copying a shared thing into the taker's workspace ------------------------
function mapTags(names, ownerId, sportId) {
  const mine = all('SELECT id, name FROM tags WHERE owner_id=? AND sport_id=?', ownerId, sportId);
  const ids = [];
  for (const n of names) {
    const hit = mine.find((t) => t.name.trim().toLowerCase() === n.name.trim().toLowerCase());
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return ids;
}
export function copyPlay(p, ownerId, sportId, made) {
  if (made.has(p.id)) return made.get(p.id);
  const r = run(
    'INSERT INTO plays (owner_id, sport_id, name, category, labels_json, court, flipped, notes, frames_json, attachments_json) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ownerId, sportId, p.name, p.category, p.labels_json, p.court, p.flipped ? 1 : 0, p.notes, p.frames_json,
    JSON.stringify({ images: [], videos: [], links: linksOf(p.attachments_json) }),
  );
  made.set(p.id, Number(r.lastInsertRowid));
  return made.get(p.id);
}
export function copyDrill(d, ownerId, sportId, made = new Map()) {
  const r = run(
    'INSERT INTO drills (owner_id, sport_id, name, duration_min, notes_html, coach_notes_html, callout, groups_json) VALUES (?,?,?,?,?,?,?,?)',
    ownerId, sportId, d.name, d.duration_min, d.notes_html, '', '', JSON.stringify(stations(d.groups_json)),
  );
  const newId = Number(r.lastInsertRowid);
  const plays = playsOf(d.plays_json, d.owner_id).map((p) => copyPlay(p, ownerId, sportId, made));
  run('UPDATE drills SET images_json=?, plays_json=?, extras_json=? WHERE id=?', '[]', JSON.stringify(plays), JSON.stringify({ links: linksOf(d.extras_json), videos: [] }), newId);
  for (const t of mapTags(tagNames('drill_tags', 'drill_id', d.id), ownerId, sportId)) run('INSERT OR IGNORE INTO drill_tags (drill_id, tag_id) VALUES (?,?)', newId, t);
  return newId;
}
export function copyPlan(p, ownerId, team, date) {
  const made = new Map();
  const r = run(
    `INSERT INTO plans (owner_id, team_id, kind, title, date, start_time, location, intro_html, is_template, assigned_json, is_game)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ownerId, team.id, p.kind, p.title, date, p.start_time, '', p.intro_html, 0, '[]', p.is_game ? 1 : 0,
  );
  const planId = Number(r.lastInsertRowid);
  planItems(p.id).forEach((it, i) => {
    const ri = run(
      `INSERT INTO plan_items (plan_id, position, kind, title, duration_min, notes_html, coach_notes_html, callout, reps, groups_json, player_notes_json, drill_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      planId, i, it.kind, it.title, it.duration_min, it.notes_html, '', '', it.reps, JSON.stringify(stations(it.groups_json)), '[]', null,
    );
    const itemId = Number(ri.lastInsertRowid);
    const plays = playsOf(it.plays_json, p.owner_id).map((pl) => copyPlay(pl, ownerId, team.sport_id, made));
    run('UPDATE plan_items SET images_json=?, plays_json=?, extras_json=? WHERE id=?', '[]', JSON.stringify(plays), JSON.stringify({ links: linksOf(it.extras_json), videos: [] }), itemId);
    for (const t of mapTags(tagNames('plan_item_tags', 'item_id', it.id), ownerId, team.sport_id)) run('INSERT OR IGNORE INTO plan_item_tags (item_id, tag_id) VALUES (?,?)', itemId, t);
  });
  return planId;
}

const SHARE_NOUN = { drill: 'drill', play: 'play', plan: 'practice plan' };
/** Tells everyone in a community, bar the person who did it, that there is something new to see. */
const pokeMembers = (communityId, exceptUserId) =>
  poke(all("SELECT user_id FROM community_members WHERE community_id=? AND status='active' AND user_id<>?", communityId, exceptUserId ?? 0).map((m) => m.user_id));

export function mountCommunities(app) {
  const communityOut = (c, m) => ({
    id: c.id, name: c.name, description: c.description,
    share_drills: !!c.share_drills, share_plays: !!c.share_plays, share_plans: !!c.share_plans, require_approval: !!c.require_approval,
    role: m.role, status: m.status, image: c.image || '', can: permsOf(m),
    members: get("SELECT COUNT(*) AS n FROM community_members WHERE community_id=? AND status='active'", c.id).n,
    created_by_name: get('SELECT name FROM users WHERE id=?', c.created_by)?.name ?? '',
  });
  const detailOut = (c, m) => {
    const admin = can(m, 'people');
    return {
      ...communityOut(c, m),
      // The join code and people's email addresses are for those who manage the people.
      join_code: admin ? c.join_code : undefined,
      people: all(
        `SELECT u.id, u.name, u.email, cm.role, cm.status, cm.perms_json FROM community_members cm JOIN users u ON u.id=cm.user_id
         WHERE cm.community_id=? ORDER BY CASE cm.role WHEN 'creator' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name COLLATE NOCASE`,
        c.id,
      )
        .filter((p) => admin || p.status === 'active')
        .map((p) => ({ id: p.id, name: p.name, email: admin ? p.email : undefined, role: p.role, status: p.status, perms: permsOf(p) })),
      pending_shares: can(m, 'approve') ? get("SELECT COUNT(*) AS n FROM community_shares WHERE community_id=? AND status='pending'", c.id).n : 0,
    };
  };

  // --- Communities ------------------------------------------------------------
  app.get('/api/communities', (req, res) => {
    const rows = all(
      `SELECT c.*, cm.role AS my_role, cm.status AS my_status, cm.user_id AS my_user FROM communities c
       JOIN community_members cm ON cm.community_id=c.id WHERE cm.user_id=? ORDER BY c.name COLLATE NOCASE`,
      req.user.id,
    );
    res.json(rows.map((c) => communityOut(c, { role: c.my_role, status: c.my_status, user_id: c.my_user })));
  });
  app.post('/api/communities', (req, res) => {
    const name = str(req.body.name, 80).trim();
    if (!name) return res.status(400).json({ error: 'Give the community a name.' });
    const newId = tx(() => {
      const r = run('INSERT INTO communities (name, description, created_by, join_code) VALUES (?,?,?,?)', name, str(req.body.description, 600).trim(), req.user.id, newCode());
      run("INSERT INTO community_members (community_id, user_id, role, status) VALUES (?,?,'creator','active')", Number(r.lastInsertRowid), req.user.id);
      return Number(r.lastInsertRowid);
    });
    res.json(detailOut(get('SELECT * FROM communities WHERE id=?', newId), membership(newId, req.user.id)));
  });
  app.post('/api/communities/join', (req, res) => {
    const code = str(req.body.code, 40).trim().toUpperCase();
    const c = code && get('SELECT * FROM communities WHERE join_code=?', code);
    if (!c) return res.status(404).json({ error: 'That join code does not match a community. Check it with whoever sent it.' });
    const m = membership(c.id, req.user.id);
    if (m) run("UPDATE community_members SET status='active' WHERE community_id=? AND user_id=?", c.id, req.user.id);
    else run("INSERT INTO community_members (community_id, user_id, role, status) VALUES (?,?,'member','active')", c.id, req.user.id);
    res.json(communityOut(c, membership(c.id, req.user.id)));
  });
  // --- What is new: invitations, messages and shared things since the caller last looked ---
  /** Everything recent in the caller's communities from other people, newest first, each marked read or not. */
  const newsFor = (userId) => {
    const items = [];
    const mine = all(
      `SELECT c.*, cm.status AS my_status, cm.created_at AS joined, COALESCE(cm.seen_at, cm.created_at) AS seen,
              (SELECT name FROM users WHERE id=cm.invited_by) AS inviter
         FROM community_members cm JOIN communities c ON c.id=cm.community_id WHERE cm.user_id=?`,
      userId,
    );
    for (const c of mine) {
      const base = { community_id: c.id, community: c.name };
      if (c.my_status === 'invited') {
        // An invitation stays new until it is accepted or declined.
        items.push({ ...base, key: `invite-${c.id}`, kind: 'invite', at: c.joined, by: c.inviter || c.name, text: '', unread: true });
        continue;
      }
      for (const p of all(
        `SELECT p.id, p.body, p.created_at, u.name FROM community_posts p JOIN users u ON u.id=p.user_id
          WHERE p.community_id=? AND p.user_id<>? ORDER BY p.id DESC LIMIT 25`,
        c.id, userId,
      ))
        items.push({ ...base, key: `post-${p.id}`, kind: 'post', at: p.created_at, by: p.name, text: p.body.length > 180 ? `${p.body.slice(0, 180)}…` : p.body, unread: p.created_at > c.seen });
      for (const sh of all(`${SHARE_SELECT} WHERE s.community_id=? AND s.status='approved' AND s.user_id<>? ORDER BY s.id DESC LIMIT 25`, c.id, userId)) {
        if (!c[KIND_FLAG[sh.kind]]) continue;
        const row = source(sh);
        if (row) items.push({ ...base, key: `share-${sh.id}`, kind: 'share', share_kind: sh.kind, at: sh.created_at, by: sh.by_name, text: titleOf(sh.kind, row), unread: sh.created_at > c.seen });
      }
    }
    items.push(...noticesFor(userId));
    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { unread: items.filter((i) => i.unread).length, items: items.slice(0, 80) };
  };
  app.get('/api/communities/news', (req, res) => res.json(newsFor(req.user.id)));
  // The Messages page: the same list, and reading one message from the app or everything at once.
  app.get('/api/messages', (req, res) => res.json(newsFor(req.user.id)));
  app.post('/api/messages/read', (req, res) => {
    readNotices(req.user.id);
    run("UPDATE community_members SET seen_at=datetime('now') WHERE user_id=? AND status='active'", req.user.id);
    res.json(newsFor(req.user.id));
  });
  app.post('/api/messages/:id/read', (req, res) => {
    readNotices(req.user.id, Number(req.params.id));
    res.json(newsFor(req.user.id));
  });
  // Opening a community, or "mark all as read", moves the line: nothing older counts as new any more.
  app.post('/api/communities/seen', (req, res) => {
    run("UPDATE community_members SET seen_at=datetime('now') WHERE user_id=? AND status='active'", req.user.id);
    res.json(newsFor(req.user.id));
  });
  app.post('/api/communities/:id/seen', (req, res) => {
    const at = enter(req, res);
    if (!at) return;
    run("UPDATE community_members SET seen_at=datetime('now') WHERE community_id=? AND user_id=?", at.c.id, req.user.id);
    res.json(newsFor(req.user.id));
  });

  app.get('/api/communities/:id', (req, res) => {
    const at = enter(req, res);
    if (at) res.json(detailOut(at.c, at.m));
  });
  app.put('/api/communities/:id', (req, res) => {
    const at = enter(req, res, { perm: 'settings' });
    if (!at) return;
    const b = req.body;
    const name = b.name === undefined ? at.c.name : str(b.name, 80).trim();
    if (!name) return res.status(400).json({ error: 'Give the community a name.' });
    const flag = (key) => (typeof b[key] === 'boolean' ? (b[key] ? 1 : 0) : at.c[key]);
    // The picture arrives already shrunk by the browser. Anything else is turned away.
    let image = at.c.image || '';
    if (b.image !== undefined) {
      image = String(b.image || '');
      if (image && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 400000))
        return res.status(400).json({ error: 'That picture could not be used. Choose a JPG, PNG or WebP image.' });
    }
    run(
      'UPDATE communities SET name=?, description=?, share_drills=?, share_plays=?, share_plans=?, require_approval=?, image=? WHERE id=?',
      name, b.description === undefined ? at.c.description : str(b.description, 600).trim(),
      flag('share_drills'), flag('share_plays'), flag('share_plans'), flag('require_approval'), image, at.c.id,
    );
    // Turning approval off lets everything waiting through.
    if (b.require_approval === false) run("UPDATE community_shares SET status='approved' WHERE community_id=?", at.c.id);
    pokeMembers(at.c.id, req.user.id);
    res.json(detailOut(get('SELECT * FROM communities WHERE id=?', at.c.id), at.m));
  });
  app.delete('/api/communities/:id', (req, res) => {
    const at = enter(req, res, { creator: true });
    if (!at) return;
    // The request must repeat the community's name, so a stray or replayed call cannot delete one.
    if (str(req.body?.confirm, 200).trim().toLowerCase() !== at.c.name.trim().toLowerCase()) return res.status(400).json({ error: 'Type the name of the community exactly to delete it.' });
    for (const m of all("SELECT user_id FROM community_members WHERE community_id=? AND status='active' AND user_id<>?", at.c.id, req.user.id))
      notify(m.user_id, { kind: 'community', title: `${req.user.name} deleted the community ${at.c.name}`, body: 'Anything you added to your own drills, plays or practices from it is still yours.' });
    run('DELETE FROM communities WHERE id=?', at.c.id);
    res.json({ ok: true });
  });
  app.post('/api/communities/:id/code', (req, res) => {
    const at = enter(req, res, { perm: 'people' });
    if (!at) return;
    run('UPDATE communities SET join_code=? WHERE id=?', newCode(), at.c.id);
    res.json(detailOut(get('SELECT * FROM communities WHERE id=?', at.c.id), at.m));
  });

  // --- People -----------------------------------------------------------------
  app.post('/api/communities/:id/invite', (req, res) => {
    const at = enter(req, res, { perm: 'people' });
    if (!at) return;
    const email = str(req.body.email, 200).trim().toLowerCase();
    const u = email && get("SELECT id, name FROM users WHERE lower(email)=? AND status='active'", email);
    if (!u) return res.status(404).json({ error: 'Nobody has a Dime Coach account with that email yet. They need an account first, or you can send them the join code once they have one.' });
    const m = membership(at.c.id, u.id);
    if (m?.status === 'active') return res.status(409).json({ error: `${u.name} is already in this community.` });
    if (!m) run("INSERT INTO community_members (community_id, user_id, role, status, invited_by) VALUES (?,?,'member','invited',?)", at.c.id, u.id, req.user.id);
    poke(u.id);
    res.json(detailOut(at.c, at.m));
  });
  // The invited person says yes. Declining, leaving and being removed all use the delete below.
  app.post('/api/communities/:id/accept', (req, res) => {
    const m = membership(Number(req.params.id), req.user.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    run("UPDATE community_members SET status='active' WHERE community_id=? AND user_id=?", m.community_id, req.user.id);
    if (m.status === 'invited' && m.invited_by) {
      const c = get('SELECT name FROM communities WHERE id=?', m.community_id);
      notify(m.invited_by, { kind: 'community', title: `${req.user.name} joined ${c.name}`, body: 'They accepted your invitation.', link: `/communities/${m.community_id}` });
    }
    res.json({ ok: true });
  });
  app.put('/api/communities/:id/members/:userId', (req, res) => {
    const at = enter(req, res, { creator: true });
    if (!at) return;
    const target = membership(at.c.id, Number(req.params.userId));
    if (!target || target.status !== 'active') return res.status(404).json({ error: 'Not found' });
    if (target.role === 'creator') return res.status(400).json({ error: 'The creator stays the creator.' });
    // Either a role ("admin" gives every power, "member" none), or the powers one by one.
    // Someone with at least one power is an admin; with none, a member.
    let perms;
    if (req.body.perms && typeof req.body.perms === 'object') perms = Object.fromEntries(COMMUNITY_PERMS.map((p) => [p, req.body.perms[p] === undefined ? permsOf(target)[p] : !!req.body.perms[p]]));
    else if (req.body.role === 'admin' || req.body.role === 'member') perms = Object.fromEntries(COMMUNITY_PERMS.map((p) => [p, req.body.role === 'admin']));
    else return res.status(400).json({ error: 'Choose admin or member.' });
    const role = COMMUNITY_PERMS.some((p) => perms[p]) ? 'admin' : 'member';
    const before = JSON.stringify(permsOf(target));
    run('UPDATE community_members SET role=?, perms_json=? WHERE community_id=? AND user_id=?', role, JSON.stringify(perms), at.c.id, target.user_id);
    if (before !== JSON.stringify(perms)) {
      const powers = COMMUNITY_PERMS.filter((p) => perms[p]).map((p) => POWER_WORDS[p]);
      notify(target.user_id, {
        kind: 'community-role', ref: `community-${at.c.id}`, link: `/communities/${at.c.id}`,
        title: role === 'member' ? `You are no longer an admin of ${at.c.name}` : target.role === 'admin' ? `${req.user.name} changed what you can do in ${at.c.name}` : `${req.user.name} made you an admin of ${at.c.name}`,
        body: role === 'member' ? 'You are still a member.' : `You can now ${powers.length > 1 ? `${powers.slice(0, -1).join(', ')} and ${powers[powers.length - 1]}` : powers[0]}.`,
      });
    }
    res.json(detailOut(at.c, at.m));
  });
  app.delete('/api/communities/:id/members/:userId', (req, res) => {
    const c = get('SELECT * FROM communities WHERE id=?', Number(req.params.id));
    const me = c && membership(c.id, req.user.id);
    const target = c && membership(c.id, Number(req.params.userId));
    if (!c || !me || !target) return res.status(404).json({ error: 'Not found' });
    const self = target.user_id === req.user.id;
    if (target.role === 'creator') return res.status(400).json({ error: self ? 'You created this community, so you cannot leave it. You can delete it instead.' : 'The creator cannot be removed.' });
    if (!self) {
      if (!can(me, 'people')) return res.status(403).json({ error: 'You have not been given permission to remove people from this community.' });
      if (target.role === 'admin' && me.role !== 'creator') return res.status(403).json({ error: 'Only the creator can remove another admin.' });
    }
    tx(() => {
      // What they shared goes with them. Their messages stay, as part of the conversation.
      run('DELETE FROM community_shares WHERE community_id=? AND user_id=?', c.id, target.user_id);
      run('DELETE FROM community_members WHERE community_id=? AND user_id=?', c.id, target.user_id);
    });
    if (!self && target.status === 'active') notify(target.user_id, { kind: 'community', title: `${req.user.name} removed you from ${c.name}`, body: 'What you shared there was taken down. Your own drills, plays and practices are untouched.' });
    res.json({ ok: true });
  });

  // --- Messages ---------------------------------------------------------------
  /**
   * The newest 200 messages, newest first. Each carries the replies to it, oldest first, and each
   * reply the replies to it in turn. After them come the replies made to shared things, which name
   * the share they answer.
   */
  const postsOut = (c, m) => {
    const rows = all(
      `SELECT p.id, p.body, p.created_at, p.user_id, p.parent_id, p.share_id, p.attach_share_id, u.name FROM community_posts p JOIN users u ON u.id=p.user_id
       WHERE p.community_id=? AND (p.share_id IS NULL OR EXISTS (SELECT 1 FROM community_shares s WHERE s.id=p.share_id)) ORDER BY p.id`,
      c.id,
    ).map((p) => ({
      id: p.id, body: p.body, created_at: p.created_at, by: p.name, by_id: p.user_id, mine: p.user_id === m.user_id, can_delete: p.user_id === m.user_id || can(m, 'moderate'),
      parent_id: p.parent_id ?? null, share_id: p.share_id ?? null, attach_share_id: p.attach_share_id ?? null,
    }));
    const under = new Map();
    for (const r of rows) if (r.parent_id) under.set(r.parent_id, [...(under.get(r.parent_id) ?? []), r]);
    const tree = (r) => ({ ...r, replies: (under.get(r.id) ?? []).map(tree) });
    const tops = rows.filter((r) => !r.parent_id && !r.share_id).slice(-200).reverse();
    return [...tops.map(tree), ...rows.filter((r) => !r.parent_id && r.share_id).map(tree)];
  };
  app.get('/api/communities/:id/posts', (req, res) => {
    const at = enter(req, res);
    if (at) res.json(postsOut(at.c, at.m));
  });
  app.post('/api/communities/:id/posts', (req, res) => {
    const at = enter(req, res);
    if (!at) return;
    const body = str(req.body.body, 4000).trim();
    // Something of the writer's own, already shared here, can go with the message.
    const attach = req.body.attach_share_id ? get('SELECT id FROM community_shares WHERE id=? AND community_id=? AND user_id=?', Number(req.body.attach_share_id), at.c.id, req.user.id) : null;
    if (req.body.attach_share_id && !attach) return res.status(404).json({ error: 'What you attached is no longer shared here.' });
    if (!body && !attach) return res.status(400).json({ error: 'Write something first.' });
    // A reply answers a message, another reply, or a shared thing.
    const parent = req.body.parent_id ? get('SELECT * FROM community_posts WHERE id=? AND community_id=?', Number(req.body.parent_id), at.c.id) : null;
    if (req.body.parent_id && !parent) return res.status(404).json({ error: 'The message you are replying to has been deleted.' });
    let shareId = parent?.share_id ?? null;
    if (req.body.share_id) {
      const share = get('SELECT id FROM community_shares WHERE id=? AND community_id=?', Number(req.body.share_id), at.c.id);
      if (!share) return res.status(404).json({ error: 'What you are replying to is no longer shared here.' });
      shareId = share.id;
    }
    run('INSERT INTO community_posts (community_id, user_id, body, parent_id, share_id, attach_share_id) VALUES (?,?,?,?,?,?)', at.c.id, req.user.id, body, parent?.id ?? null, shareId, attach?.id ?? null);
    pokeMembers(at.c.id, req.user.id);
    res.json(postsOut(at.c, at.m));
  });
  app.delete('/api/communities/:id/posts/:postId', (req, res) => {
    const at = enter(req, res);
    if (!at) return;
    const p = get('SELECT * FROM community_posts WHERE id=? AND community_id=?', Number(req.params.postId), at.c.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (p.user_id !== req.user.id && !can(at.m, 'moderate')) return res.status(403).json({ error: 'Only the author or someone who moderates this community can delete a message.' });
    // Its replies go with it, and the replies to those.
    run(
      `WITH RECURSIVE thread(id) AS (SELECT ? UNION ALL SELECT c.id FROM community_posts c JOIN thread t ON c.parent_id=t.id)
       DELETE FROM community_posts WHERE id IN (SELECT id FROM thread)`,
      p.id,
    );
    res.json(postsOut(at.c, at.m));
  });

  // --- Sharing ----------------------------------------------------------------
  /** Everything in one community's library the caller may see: approved things, their own, and for admins what is waiting. */
  const sharesOut = (c, m) =>
    all(`${SHARE_SELECT} WHERE s.community_id=? ORDER BY s.id DESC`, c.id)
      .filter((s) => c[KIND_FLAG[s.kind]] && (s.status === 'approved' || s.user_id === m.user_id || can(m, 'approve')))
      .map((s) => shareOut(s, m.user_id))
      .filter(Boolean);
  app.get('/api/communities/:id/shares', (req, res) => {
    const at = enter(req, res);
    if (at) res.json(sharesOut(at.c, at.m));
  });
  app.post('/api/communities/:id/shares', (req, res) => {
    const at = enter(req, res);
    if (!at) return;
    const kind = req.body.kind;
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown kind of thing to share.' });
    if (!at.c[KIND_FLAG[kind]]) return res.status(400).json({ error: `This community does not share ${kind === 'plan' ? 'practice plans' : `${kind}s`}.` });
    const row = get(`SELECT * FROM ${TABLE[kind]} WHERE id=? AND owner_id=?`, Number(req.body.item_id), req.ownerId);
    if (!row || (kind === 'plan' && row.is_template)) return res.status(404).json({ error: 'Not found' });
    // Admins' own shares, and every share in a community that does not ask for approval, show at once.
    const status = !at.c.require_approval || can(at.m, 'approve') ? 'approved' : 'pending';
    run(
      'INSERT INTO community_shares (community_id, user_id, owner_id, kind, item_id, status) VALUES (?,?,?,?,?,?) ON CONFLICT(community_id, kind, item_id, owner_id) DO NOTHING',
      at.c.id, req.user.id, req.ownerId, kind, row.id, status,
    );
    pokeMembers(at.c.id, req.user.id);
    res.json(sharesOut(at.c, at.m));
  });
  const shareAnd = (req, res) => {
    const s = get('SELECT * FROM community_shares WHERE id=?', Number(req.params.shareId));
    const c = s && get('SELECT * FROM communities WHERE id=?', s.community_id);
    const m = c && membership(c.id, req.user.id);
    if (!s || !m || m.status !== 'active') {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    return { s, c, m };
  };
  app.post('/api/community-shares/:shareId/approve', (req, res) => {
    const at = shareAnd(req, res);
    if (!at) return;
    if (!can(at.m, 'approve')) return res.status(403).json({ error: 'You have not been given permission to approve what is shared here.' });
    run("UPDATE community_shares SET status='approved' WHERE id=?", at.s.id);
    pokeMembers(at.c.id, req.user.id);
    if (at.s.status !== 'approved' && at.s.user_id !== req.user.id)
      notify(at.s.user_id, { kind: 'community', title: `Your ${SHARE_NOUN[at.s.kind] || 'item'} was approved in ${at.c.name}`, body: `${req.user.name} approved it. Everyone in the community can see it now.`, link: `/communities/${at.c.id}` });
    res.json(sharesOut(at.c, at.m));
  });
  app.delete('/api/community-shares/:shareId', (req, res) => {
    const at = shareAnd(req, res);
    if (!at) return;
    // Declining something that is waiting goes with approving. Taking down something already shared is moderating.
    if (at.s.user_id !== req.user.id && !can(at.m, at.s.status === 'pending' ? 'approve' : 'moderate'))
      return res.status(403).json({ error: 'Only the person who shared it, or someone given that job in this community, can remove it.' });
    run('DELETE FROM community_shares WHERE id=?', at.s.id);
    if (at.s.user_id !== req.user.id)
      notify(at.s.user_id, {
        kind: 'community', link: `/communities/${at.c.id}`,
        title: at.s.status === 'approved' ? `${req.user.name} took down your ${SHARE_NOUN[at.s.kind] || 'item'} in ${at.c.name}` : `Your ${SHARE_NOUN[at.s.kind] || 'item'} was not approved in ${at.c.name}`,
        body: 'Your own copy is untouched.',
      });
    res.json(sharesOut(at.c, at.m));
  });
  /** For one of the caller's own things: each of their communities, and whether it is shared there. */
  app.get('/api/community-shares/mine', (req, res) => {
    const kind = String(req.query.kind);
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown kind.' });
    const rows = all(
      `SELECT c.* FROM communities c JOIN community_members cm ON cm.community_id=c.id
       WHERE cm.user_id=? AND cm.status='active' ORDER BY c.name COLLATE NOCASE`,
      req.user.id,
    );
    res.json(
      rows.map((c) => {
        const s = get('SELECT id, status FROM community_shares WHERE community_id=? AND kind=? AND item_id=? AND owner_id=?', c.id, kind, Number(req.query.item_id), req.ownerId);
        return { community_id: c.id, name: c.name, allowed: !!c[KIND_FLAG[kind]], share_id: s?.id ?? null, status: s?.status ?? null };
      }),
    );
  });

  // --- The community library, across communities ------------------------------
  /** A share the caller may open: approved, in a community they belong to that shares that kind. */
  const visibleShare = (req, shareId) => {
    const s = get(`${SHARE_SELECT} WHERE s.id=?`, Number(shareId));
    const c = s && get('SELECT * FROM communities WHERE id=?', s.community_id);
    const m = c && membership(c.id, req.user.id);
    if (!s || !m || m.status !== 'active' || !c[KIND_FLAG[s.kind]]) return null;
    if (s.status !== 'approved' && s.user_id !== req.user.id && !can(m, 'approve')) return null;
    return s;
  };
  app.get('/api/community-library', (req, res) => {
    const kind = String(req.query.kind);
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown kind.' });
    const only = req.query.community && req.query.community !== 'all' ? Number(req.query.community) : null;
    const rows = all(
      `${SHARE_SELECT} JOIN community_members cm ON cm.community_id=s.community_id AND cm.user_id=? AND cm.status='active'
       WHERE s.kind=? AND s.status='approved' AND c.${KIND_FLAG[kind]}=1 ${only ? 'AND s.community_id=?' : ''} ORDER BY s.id DESC`,
      ...(only ? [req.user.id, kind, only] : [req.user.id, kind]),
    );
    // Something shared with several of the caller's communities is listed once.
    const seen = new Set();
    const out = [];
    for (const s of rows) {
      const key = `${s.owner_id}:${s.item_id}`;
      if (seen.has(key)) continue;
      const row = shareOut(s, req.user.id);
      if (!row) continue;
      seen.add(key);
      out.push(row);
    }
    res.json(out);
  });
  app.get('/api/community-library/:shareId', (req, res) => {
    const s = visibleShare(req, req.params.shareId);
    const row = s && source(s);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const view = s.kind === 'drill' ? drillView(row) : s.kind === 'play' ? playView(row) : planView(row);
    res.json({ ...shareOut(s, req.user.id), content: view });
  });
  app.post('/api/community-library/:shareId/copy', (req, res) => {
    const s = visibleShare(req, req.params.shareId);
    const row = s && source(s);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    if (s.kind === 'plan') {
      const team = get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(b.team_id), req.ownerId);
      if (!team) return res.status(400).json({ error: 'Choose one of your teams to add this practice to.' });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? String(b.date) : new Date().toISOString().slice(0, 10);
      return res.json({ kind: 'plan', id: tx(() => copyPlan(row, req.ownerId, team, date)) });
    }
    const sport = get('SELECT id FROM sports WHERE id=? AND owner_id=?', Number(b.sport_id), req.ownerId);
    if (!sport) return res.status(400).json({ error: 'Unknown sport' });
    res.json({ kind: s.kind, id: tx(() => (s.kind === 'drill' ? copyDrill(row, req.ownerId, sport.id) : copyPlay(row, req.ownerId, sport.id, new Map()))) });
  });
}
