// Resources: one searchable place for every link, picture and video in a workspace.
//
// Two things feed the list:
//   1. Resources saved directly (the resources table): a link, or an uploaded picture or video, with a title.
//   2. Everything already attached to drills, plays and practice items, gathered on the fly.
// The same link (by address) or file (by id) appears once, with a note of everywhere it is used.
import { all, get, run, tx } from './db.js';
import { cleanLinks, deleteUpload } from './images.js';
import { thumbStates } from './linkThumbs.js';
import { mailerStatus, sendMail } from './mailer.js';

const parse = (s, d) => {
  try {
    const v = JSON.parse(s);
    return v ?? d;
  } catch {
    return d;
  }
};
const list = (v) => (Array.isArray(v) ? v : []);
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Everything attached somewhere in this workspace, as flat rows of {kind, url | file_id, label, use}. */
function attachments(ownerId) {
  const found = [];
  const take = (use, { images, videos, links }) => {
    for (const im of list(images)) found.push({ kind: 'image', file_id: Number(im.id), label: str(im.caption, 200), use });
    for (const v of list(videos)) found.push({ kind: 'video', file_id: Number(v.id), label: str(v.caption, 200), use });
    for (const l of list(links)) found.push({ kind: 'link', url: String(l.url), label: str(l.label, 200), use });
  };
  for (const d of all('SELECT id, name, images_json, extras_json FROM drills WHERE owner_id=?', ownerId)) {
    const extras = parse(d.extras_json, {});
    take({ type: 'drill', id: d.id, name: d.name }, { images: parse(d.images_json, []), videos: extras.videos, links: extras.links });
  }
  for (const p of all('SELECT id, name, attachments_json FROM plays WHERE owner_id=?', ownerId)) {
    take({ type: 'play', id: p.id, name: p.name }, parse(p.attachments_json, {}));
  }
  const items = all(
    `SELECT i.title, i.images_json, i.extras_json, p.id AS plan_id, p.title AS plan_title, p.date, p.kind, p.is_template
     FROM plan_items i JOIN plans p ON p.id = i.plan_id
     WHERE p.owner_id=? AND (i.images_json <> '[]' OR i.extras_json <> '{}')`,
    ownerId,
  );
  for (const it of items) {
    const extras = parse(it.extras_json, {});
    const where = it.is_template ? `template "${it.plan_title}"` : `${it.kind === 'homework' ? 'homework' : 'practice'} ${it.date}`;
    take({ type: 'practice', id: it.plan_id, name: `${it.title || 'Untitled item'} (${where})` }, { images: parse(it.images_json, []), videos: extras.videos, links: extras.links });
  }
  return found;
}

/** The merged list the Resources page and the pickers show. */
function resourceList(ownerId) {
  const byKey = new Map();
  const entry = (kind, key, init) => {
    if (!byKey.has(key)) byKey.set(key, { key, kind, title: '', url: '', file_id: null, resource_id: null, created_at: '', uses: [], tag_ids: [], ...init });
    return byKey.get(key);
  };
  // Saved resources first, so their titles win.
  for (const r of all('SELECT * FROM resources WHERE owner_id=? ORDER BY id DESC', ownerId)) {
    const key = r.kind === 'link' ? `link:${r.url}` : `file:${r.file_id}`;
    const e = entry(r.kind, key, { url: r.url, file_id: r.file_id });
    if (e.resource_id === null) Object.assign(e, { resource_id: r.id, title: r.title, created_at: r.created_at });
  }
  for (const a of attachments(ownerId)) {
    const key = a.kind === 'link' ? `link:${a.url}` : `file:${a.file_id}`;
    const e = entry(a.kind, key, { url: a.url || '', file_id: a.file_id ?? null });
    if (!e.title && a.label) e.title = a.label;
    if (!e.uses.some((u) => u.type === a.use.type && u.id === a.use.id && u.name === a.use.name)) e.uses.push(a.use);
  }
  // The categories each one is filed under.
  for (const t of all('SELECT res_key, tag_id FROM resource_tags WHERE owner_id=? ORDER BY tag_id', ownerId)) byKey.get(t.res_key)?.tag_ids.push(t.tag_id);
  const out = [];
  const thumbs = thumbStates(ownerId);
  for (const e of byKey.values()) {
    // Whether a small preview picture is kept for this link: 'ok', 'none', or null when nobody has looked yet.
    if (e.kind === 'link') e.thumb = thumbs.get(e.url) ?? null;
    if (e.kind !== 'link') {
      // Skip references to files that no longer exist or belong to someone else.
      const f = get('SELECT mime, created_at FROM images WHERE id=? AND owner_id=?', e.file_id, ownerId);
      if (!f || !f.mime.startsWith(e.kind + '/')) continue;
      if (!e.created_at) e.created_at = f.created_at;
    }
    if (!e.title) e.title = e.kind === 'link' ? hostOf(e.url) : e.uses[0] ? `${e.kind === 'image' ? 'Picture' : 'Video'} from ${e.uses[0].name}` : e.kind === 'image' ? 'Picture' : 'Video';
    out.push(e);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

// Sending a link to other coaches by email: at most this many addresses in one go, and this many in an hour.
const MAX_AT_ONCE = 20;
const SEND_LIMIT = 40;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sends = new Map();
const sentLately = (userId) => (sends.get(userId) || []).filter((t) => Date.now() - t < 3600_000);

export function mountResources(app) {
  // Emails a saved link to the addresses given, with a note. Pictures and videos are private
  // files, so they are shared from the device that is showing them, not from here.
  app.post('/api/resources/send', async (req, res) => {
    const r = resourceList(req.ownerId).find((x) => x.key === String(req.body.key ?? ''));
    if (!r) return res.status(404).json({ error: 'That resource was not found.' });
    if (r.kind !== 'link') return res.status(400).json({ error: 'Only links can be sent by email.' });
    if (!mailerStatus().configured) return res.status(400).json({ error: 'Email is not set up on this site. Copy the link and send it yourself.' });
    const to = [...new Set(list(req.body.emails).map((e) => str(e, 200).toLowerCase()).filter(Boolean))];
    const bad = to.find((e) => !EMAIL.test(e));
    if (bad) return res.status(400).json({ error: `${bad} does not look like an email address.` });
    if (!to.length) return res.status(400).json({ error: 'Type at least one email address.' });
    if (to.length > MAX_AT_ONCE) return res.status(400).json({ error: `Send to ${MAX_AT_ONCE} people at most in one go.` });
    const lately = sentLately(req.user.id);
    if (lately.length + to.length > SEND_LIMIT) return res.status(429).json({ error: 'You have sent a lot in the last hour. Try again a little later.' });
    const note = str(req.body.note, 1000);
    const failed = [];
    for (const email of to) {
      lately.push(Date.now());
      const sent = await sendMail({
        to: email,
        subject: `${req.user.name} shared a link with you: ${r.title}`,
        text: `Hi,\n\n${req.user.name} shared a link with you from Dime Coach: "${r.title}".\n\n` + (note ? `${req.user.name} wrote:\n${note}\n\n` : '') + `Open the link:\n\n${r.url}`,
      });
      if (!sent.ok) failed.push(email);
    }
    sends.set(req.user.id, lately);
    res.json({ sent: to.length - failed.length, failed });
  });

  app.get('/api/resources', (req, res) => res.json(resourceList(req.ownerId)));

  app.post('/api/resources', (req, res) => {
    const b = req.body;
    const title = str(b.title, 200);
    if (b.kind === 'link') {
      const [link] = cleanLinks([{ url: b.url }]);
      if (!link) return res.status(400).json({ error: 'Enter a web address, such as https://youtube.com/...' });
      if (get("SELECT id FROM resources WHERE owner_id=? AND kind='link' AND url=?", req.ownerId, link.url))
        return res.status(409).json({ error: 'That link is already in your resources.' });
      run("INSERT INTO resources (owner_id, kind, title, url) VALUES (?,'link',?,?)", req.ownerId, title, link.url);
    } else if (b.kind === 'image' || b.kind === 'video') {
      const f = get('SELECT id, mime FROM images WHERE id=? AND owner_id=?', Number(b.file_id), req.ownerId);
      if (!f || !f.mime.startsWith(b.kind + '/')) return res.status(400).json({ error: 'That upload was not found.' });
      if (!get('SELECT id FROM resources WHERE owner_id=? AND file_id=?', req.ownerId, f.id))
        run('INSERT INTO resources (owner_id, kind, title, file_id) VALUES (?,?,?,?)', req.ownerId, b.kind, title, f.id);
    } else return res.status(400).json({ error: 'Unknown kind of resource.' });
    res.json(resourceList(req.ownerId));
  });

  // Files a resource under categories: the whole set for it, replacing what was there. It is
  // named by its key, since one that is only attached to a drill has no row of its own.
  app.put('/api/resources/tags', (req, res) => {
    const key = String(req.body.key ?? '');
    if (!resourceList(req.ownerId).some((r) => r.key === key)) return res.status(404).json({ error: 'That resource was not found.' });
    const mine = new Set(all('SELECT id FROM tags WHERE owner_id=?', req.ownerId).map((t) => t.id));
    const ids = [...new Set(list(req.body.tag_ids).map(Number))].filter((id) => mine.has(id)).slice(0, 50);
    tx(() => {
      run('DELETE FROM resource_tags WHERE owner_id=? AND res_key=?', req.ownerId, key);
      for (const id of ids) run('INSERT INTO resource_tags (owner_id, res_key, tag_id) VALUES (?,?,?)', req.ownerId, key, id);
    });
    res.json(resourceList(req.ownerId));
  });

  app.put('/api/resources/:id', (req, res) => {
    const r = get('SELECT id FROM resources WHERE id=? AND owner_id=?', Number(req.params.id), req.ownerId);
    if (!r) return res.status(404).json({ error: 'Not found' });
    run('UPDATE resources SET title=? WHERE id=?', str(req.body.title, 200), r.id);
    res.json(resourceList(req.ownerId));
  });

  // Removes a saved resource. Its file is deleted too, unless a drill, play or practice still uses it.
  app.delete('/api/resources/:id', (req, res) => {
    const r = get('SELECT * FROM resources WHERE id=? AND owner_id=?', Number(req.params.id), req.ownerId);
    if (!r) return res.status(404).json({ error: 'Not found' });
    run('DELETE FROM resources WHERE id=?', r.id);
    if (r.file_id && !attachments(req.ownerId).some((a) => a.file_id === r.file_id)) deleteUpload(r.file_id, req.ownerId);
    const left = resourceList(req.ownerId);
    // Gone from the list altogether: its categories go with it.
    const key = r.kind === 'link' ? `link:${r.url}` : `file:${r.file_id}`;
    if (!left.some((x) => x.key === key)) run('DELETE FROM resource_tags WHERE owner_id=? AND res_key=?', req.ownerId, key);
    res.json(left);
  });
}
