// The coach library: drills, plays and practice plans the system administrator has picked out for
// every coach to search and take a copy of. Publishing makes a frozen copy in a workspace that
// belongs to nobody, so what is published does not change or vanish when the original does. Packs
// are named collections of published things.
import { all, get, run, tx } from './db.js';
import { isSystemAdmin } from './auth.js';
import { copyDrill, copyPlan, copyPlay, drillView, planView, playView, summaryOf, tagNames, titleOf } from './communities.js';

const str = (v, max = 200) => String(v ?? '').slice(0, max).trim();
const parse = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
const KINDS = ['drill', 'play', 'plan'];
const TABLE = { drill: 'drills', play: 'plays', plan: 'plans' };
const OWNER_KEY = 'library_owner';

// --- The workspace the published copies live in -------------------------------
/** The id of the library's workspace, made the first time something is published. Null before then unless asked to make it. */
function libraryOwner(create = false) {
  const saved = Number(get('SELECT value FROM system_settings WHERE key=?', OWNER_KEY)?.value) || 0;
  if (saved && get('SELECT id FROM owners WHERE id=?', saved)) return saved;
  if (!create) return null;
  const id = Number(run('INSERT INTO owners (name) VALUES (?)', 'Dime Coach Library').lastInsertRowid);
  run('INSERT INTO system_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', OWNER_KEY, String(id));
  return id;
}
function librarySport(owner, name) {
  const hit = get('SELECT id FROM sports WHERE owner_id=? AND name=? COLLATE NOCASE', owner, name);
  return hit ? hit.id : Number(run('INSERT INTO sports (owner_id, name) VALUES (?,?)', owner, name).lastInsertRowid);
}
/** Plans have to belong to a team, so the library keeps one per sport to hold them. */
function libraryTeam(owner, sportId) {
  const hit = get('SELECT * FROM teams WHERE owner_id=? AND sport_id=?', owner, sportId);
  if (hit) return hit;
  const id = Number(run('INSERT INTO teams (owner_id, sport_id, name) VALUES (?,?,?)', owner, sportId, 'Library').lastInsertRowid);
  return get('SELECT * FROM teams WHERE id=?', id);
}
/** Categories are matched by name when copying, so the library needs one of each name it is about to receive. */
function ensureTags(tags, owner, sportId) {
  for (const t of tags)
    if (!get('SELECT 1 AS ok FROM tags WHERE owner_id=? AND sport_id=? AND name=? COLLATE NOCASE', owner, sportId, t.name))
      run('INSERT INTO tags (owner_id, sport_id, name, color) VALUES (?,?,?,?)', owner, sportId, t.name, t.color || '#2a78d6');
}
const planItemIds = (planId) => all('SELECT id, plays_json FROM plan_items WHERE plan_id=?', planId);
const planTags = (planId) => {
  const seen = new Map();
  for (const it of planItemIds(planId)) for (const t of tagNames('plan_item_tags', 'item_id', it.id)) seen.set(t.name.toLowerCase(), t);
  return [...seen.values()];
};
const ids = (json) => (Array.isArray(parse(json, [])) ? parse(json, []) : []).map(Number).filter(Boolean);

/** Takes a published copy out of the library's workspace, with the plays that were copied along with it. */
function dropCopy(kind, itemId, owner) {
  const row = get(`SELECT * FROM ${TABLE[kind]} WHERE id=? AND owner_id=?`, itemId, owner);
  if (!row) return;
  const plays = kind === 'drill' ? ids(row.plays_json) : kind === 'plan' ? planItemIds(row.id).flatMap((it) => ids(it.plays_json)) : [];
  run(`DELETE FROM ${TABLE[kind]} WHERE id=?`, row.id);
  for (const p of plays) run('DELETE FROM plays WHERE id=? AND owner_id=?', p, owner);
}

const copyOf = (li, owner) => get(`SELECT * FROM ${TABLE[li.kind]} WHERE id=? AND owner_id=?`, li.item_id, owner);
function itemOut(li, owner, req) {
  const row = copyOf(li, owner);
  if (!row) return null;
  const admin = isSystemAdmin(req.user);
  return {
    id: li.id, kind: li.kind, sport: li.sport, title: titleOf(li.kind, row), summary: summaryOf(li.kind, row), description: li.description,
    tags: li.kind === 'drill' ? tagNames('drill_tags', 'drill_id', row.id) : li.kind === 'plan' ? planTags(row.id) : [],
    packs: all('SELECT pack_id FROM library_pack_items WHERE item_id=?', li.id).map((r) => r.pack_id),
    published_at: li.updated_at,
    // For the administrator only: how often it has been taken, and which of their own things it came from.
    adds: admin ? li.adds : undefined,
    source_item_id: admin && li.source_owner_id === req.ownerId ? li.source_item_id : undefined,
  };
}
function listOut(req) {
  const owner = libraryOwner();
  const items = owner ? all('SELECT * FROM library_items ORDER BY updated_at DESC, id DESC').map((li) => itemOut(li, owner, req)).filter(Boolean) : [];
  const live = new Set(items.map((i) => i.id));
  const packs = all('SELECT * FROM library_packs ORDER BY name COLLATE NOCASE').map((p) => ({
    id: p.id, name: p.name, description: p.description, sport: p.sport,
    item_ids: all('SELECT item_id FROM library_pack_items WHERE pack_id=? ORDER BY position, item_id', p.id).map((r) => r.item_id).filter((i) => live.has(i)),
  }));
  return { can_manage: isSystemAdmin(req.user), items, packs };
}

export function mountCoachLibrary(app) {
  const adminOnly = (req, res, next) => (isSystemAdmin(req.user) ? next() : res.status(403).json({ error: 'Only the system administrator can change the coach library.' }));
  const found = (req, res) => {
    const owner = libraryOwner();
    const li = owner && get('SELECT * FROM library_items WHERE id=?', Number(req.params.id));
    const row = li && copyOf(li, owner);
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    return { li, row, owner };
  };

  // --- For every coach ----------------------------------------------------------
  app.get('/api/coach-library', (req, res) => res.json(listOut(req)));
  app.get('/api/coach-library/items/:id', (req, res) => {
    const at = found(req, res);
    if (!at) return;
    const view = at.li.kind === 'drill' ? drillView(at.row) : at.li.kind === 'play' ? playView(at.row) : planView(at.row);
    res.json({ ...itemOut(at.li, at.owner, req), content: view });
  });
  app.post('/api/coach-library/items/:id/copy', (req, res) => {
    const at = found(req, res);
    if (!at) return;
    const b = req.body;
    let made;
    if (at.li.kind === 'plan') {
      const team = get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(b.team_id), req.ownerId);
      if (!team) return res.status(400).json({ error: 'Choose one of your teams to add this practice to.' });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? String(b.date) : new Date().toISOString().slice(0, 10);
      made = tx(() => copyPlan(at.row, req.ownerId, team, date));
    } else {
      const sport = get('SELECT id FROM sports WHERE id=? AND owner_id=?', Number(b.sport_id), req.ownerId);
      if (!sport) return res.status(400).json({ error: 'Unknown sport' });
      made = tx(() => (at.li.kind === 'drill' ? copyDrill(at.row, req.ownerId, sport.id) : copyPlay(at.row, req.ownerId, sport.id, new Map())));
    }
    run('UPDATE library_items SET adds=adds+1 WHERE id=?', at.li.id);
    res.json({ kind: at.li.kind, id: made });
  });
  /** Every drill and play in a pack at once. Practice plans need a date each, so they are left to be added one at a time. */
  app.post('/api/coach-library/packs/:id/copy', (req, res) => {
    const owner = libraryOwner();
    const pack = get('SELECT * FROM library_packs WHERE id=?', Number(req.params.id));
    if (!owner || !pack) return res.status(404).json({ error: 'Not found' });
    const sport = get('SELECT id FROM sports WHERE id=? AND owner_id=?', Number(req.body.sport_id), req.ownerId);
    if (!sport) return res.status(400).json({ error: 'Unknown sport' });
    const items = all('SELECT li.* FROM library_pack_items pi JOIN library_items li ON li.id=pi.item_id WHERE pi.pack_id=? ORDER BY pi.position, li.id', pack.id);
    const count = { drills: 0, plays: 0, plans_left: 0 };
    tx(() => {
      // One play is only copied once, however many of the pack's drills use it.
      const made = new Map();
      for (const li of items) {
        const row = copyOf(li, owner);
        if (!row) continue;
        if (li.kind === 'plan') {
          count.plans_left++;
          continue;
        }
        if (li.kind === 'drill') copyDrill(row, req.ownerId, sport.id, made);
        else copyPlay(row, req.ownerId, sport.id, made);
        count[li.kind === 'drill' ? 'drills' : 'plays']++;
        run('UPDATE library_items SET adds=adds+1 WHERE id=?', li.id);
      }
    });
    res.json(count);
  });

  // --- For the administrator ------------------------------------------------------
  /** Whether one of the administrator's own things is published, for the share dialog. */
  app.get('/api/coach-library/state', adminOnly, (req, res) => {
    const li = get('SELECT id, updated_at FROM library_items WHERE kind=? AND source_owner_id=? AND source_item_id=?', String(req.query.kind), req.ownerId, Number(req.query.item_id));
    res.json({ id: li?.id ?? null, published_at: li?.updated_at ?? null });
  });
  /** Publishes one of the administrator's own things, or replaces the published copy with how it is now. */
  app.post('/api/coach-library/items', adminOnly, (req, res) => {
    const kind = req.body.kind;
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown kind of thing to publish.' });
    const row = get(`SELECT * FROM ${TABLE[kind]} WHERE id=? AND owner_id=?`, Number(req.body.item_id), req.ownerId);
    if (!row || (kind === 'plan' && row.is_template)) return res.status(404).json({ error: 'Not found' });
    const sportId = kind === 'plan' ? get('SELECT sport_id FROM teams WHERE id=?', row.team_id)?.sport_id : row.sport_id;
    const sportName = get('SELECT name FROM sports WHERE id=?', sportId)?.name || 'Basketball';
    const id = tx(() => {
      const owner = libraryOwner(true);
      const sport = librarySport(owner, sportName);
      ensureTags(kind === 'drill' ? tagNames('drill_tags', 'drill_id', row.id) : kind === 'plan' ? planTags(row.id) : [], owner, sport);
      const copy =
        kind === 'drill' ? copyDrill(row, owner, sport) : kind === 'play' ? copyPlay(row, owner, sport, new Map()) : copyPlan(row, owner, libraryTeam(owner, sport), '');
      const was = get('SELECT * FROM library_items WHERE kind=? AND source_owner_id=? AND source_item_id=?', kind, req.ownerId, row.id);
      if (was) {
        dropCopy(kind, was.item_id, owner);
        run("UPDATE library_items SET item_id=?, sport=?, updated_at=datetime('now') WHERE id=?", copy, sportName, was.id);
        return was.id;
      }
      return Number(
        run(
          'INSERT INTO library_items (kind, item_id, sport, description, source_owner_id, source_item_id, published_by) VALUES (?,?,?,?,?,?,?)',
          kind, copy, sportName, str(req.body.description, 600), req.ownerId, row.id, req.user.id,
        ).lastInsertRowid,
      );
    });
    res.json({ id, ...listOut(req) });
  });
  app.put('/api/coach-library/items/:id', adminOnly, (req, res) => {
    const at = found(req, res);
    if (!at) return;
    run('UPDATE library_items SET description=? WHERE id=?', str(req.body.description, 600), at.li.id);
    res.json(listOut(req));
  });
  app.delete('/api/coach-library/items/:id', adminOnly, (req, res) => {
    const li = get('SELECT * FROM library_items WHERE id=?', Number(req.params.id));
    if (!li) return res.status(404).json({ error: 'Not found' });
    tx(() => {
      const owner = libraryOwner();
      if (owner) dropCopy(li.kind, li.item_id, owner);
      run('DELETE FROM library_items WHERE id=?', li.id);
    });
    res.json(listOut(req));
  });

  const packFields = (b) => ({ name: str(b.name, 80), description: str(b.description, 600), sport: str(b.sport, 40) });
  const setPackItems = (packId, list) => {
    run('DELETE FROM library_pack_items WHERE pack_id=?', packId);
    [...new Set((Array.isArray(list) ? list : []).map(Number))].forEach((itemId, i) => {
      if (get('SELECT 1 AS ok FROM library_items WHERE id=?', itemId)) run('INSERT INTO library_pack_items (pack_id, item_id, position) VALUES (?,?,?)', packId, itemId, i);
    });
  };
  app.post('/api/coach-library/packs', adminOnly, (req, res) => {
    const f = packFields(req.body);
    if (!f.name) return res.status(400).json({ error: 'Give the pack a name.' });
    tx(() => {
      const id = Number(run('INSERT INTO library_packs (name, description, sport) VALUES (?,?,?)', f.name, f.description, f.sport).lastInsertRowid);
      setPackItems(id, req.body.item_ids);
    });
    res.json(listOut(req));
  });
  app.put('/api/coach-library/packs/:id', adminOnly, (req, res) => {
    const pack = get('SELECT * FROM library_packs WHERE id=?', Number(req.params.id));
    if (!pack) return res.status(404).json({ error: 'Not found' });
    const f = packFields({ ...pack, ...req.body });
    if (!f.name) return res.status(400).json({ error: 'Give the pack a name.' });
    tx(() => {
      run('UPDATE library_packs SET name=?, description=?, sport=? WHERE id=?', f.name, f.description, f.sport, pack.id);
      if (req.body.item_ids !== undefined) setPackItems(pack.id, req.body.item_ids);
    });
    res.json(listOut(req));
  });
  app.delete('/api/coach-library/packs/:id', adminOnly, (req, res) => {
    run('DELETE FROM library_packs WHERE id=?', Number(req.params.id));
    res.json(listOut(req));
  });
}
