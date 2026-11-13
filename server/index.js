import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, tx } from './db.js';
import { seedIfEmpty, seedSport } from './seed.js';
import { ImportError, analyzePlan, claudeStatus, manualPrompt, parseDraft } from './ai.js';
import { CalendarError, fetchCalendar, normalizeCalendarUrl } from './calendar.js';
import { mountAuth, requireImport } from './auth.js';
import { mountCoachLibrary } from './coachLibrary.js';
import { mountCommunities } from './communities.js';
import { mountLive } from './live.js';
import { notify } from './notices.js';
import { cleanImages, cleanLinks, cleanVideos, mountImages } from './images.js';
import { cleanPlayIds, mountPlays } from './plays.js';
import { mountResources } from './resources.js';
import { mountStaff, staffBootstrap } from './staff.js';

seedIfEmpty();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
// Plan imports carry a whole file as base64, so that one route gets a larger body limit.
const jsonSmall = express.json({ limit: '5mb' });
const jsonLarge = express.json({ limit: '45mb' });
const LARGE_BODY = ['/api/ai/import-plan', '/api/images'];
app.use((req, res, next) => (LARGE_BODY.includes(req.path) ? jsonLarge : jsonSmall)(req, res, next));
app.use((req, _res, next) => {
  req.body ??= {};
  next();
});
// Behind a hosting provider's proxy, this makes req.ip and req.secure reflect the real visitor.
if (process.env.PP_TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');

// --- Identity -------------------------------------------------------------
// Sign-in routes come first. After mountAuth, every /api request has req.user and
// req.ownerId (that user's workspace), and every query below scopes by req.ownerId. mountStaff
// swaps in the owner's workspace when someone is working in a team shared with them.
mountAuth(app);
mountStaff(app);
mountImages(app);
mountCommunities(app);
mountCoachLibrary(app);
mountLive(app);
mountPlays(app);
mountResources(app);

const id = (v) => Number(v);
const str = (v, d = '') => (v == null ? d : String(v));
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);
const parse = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
const notFound = (res) => res.status(404).json({ error: 'Not found' });

const TARGET_SCOPES = ['practice', 'week', 'month', 'season'];
const tagOut = (t) => {
  const stored = parse(t.targets_json, {});
  const targets = {};
  for (const s of TARGET_SCOPES) if (Number.isFinite(stored?.[s])) targets[s] = stored[s];
  return { id: t.id, sport_id: t.sport_id, name: t.name, color: t.color, target_pct: t.target_pct, targets };
};
/** Links and videos travel together in one column on items and drills. */
const extrasOut = (row) => {
  const e = parse(row.extras_json, {});
  return { links: Array.isArray(e?.links) ? e.links : [], videos: Array.isArray(e?.videos) ? e.videos : [] };
};
const extrasJson = (b, ownerId) => JSON.stringify({ links: cleanLinks(b.links), videos: cleanVideos(b.videos, ownerId) });
const TEAM_COLS = 'id, sport_id, name, season, notes, calendar_url, calendar_synced_at';

// --- Bootstrap ------------------------------------------------------------
app.get('/api/bootstrap', (req, res) => {
  res.json({
    sports: all('SELECT id, name FROM sports WHERE owner_id=? ORDER BY name', req.ownerId),
    teams: all(`SELECT ${TEAM_COLS} FROM teams WHERE owner_id=? ORDER BY id DESC`, req.ownerId).filter((t) => !req.staff || t.id === req.staff.teamId),
    tags: all('SELECT * FROM tags WHERE owner_id=? ORDER BY name', req.ownerId).map(tagOut),
    // Turned on by an administrator for sites where people work without a mouse: adds buttons for
    // things that are otherwise done by dragging.
    keyboard_access: get("SELECT value FROM system_settings WHERE key='keyboard_access'")?.value === '1',
    ...staffBootstrap(req),
  });
});

// --- Sports ---------------------------------------------------------------
app.post('/api/sports', (req, res) => {
  const name = str(req.body.name).trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const existing = get('SELECT id, name FROM sports WHERE owner_id=? AND lower(name)=lower(?)', req.ownerId, name);
  if (existing) return res.json(existing);
  // Baseball and football arrive with starter categories and drills. Other sports start empty.
  const sportId = tx(() => seedSport(req.ownerId, name.slice(0, 40)).sport);
  res.json(get('SELECT id, name FROM sports WHERE id=?', sportId));
});

// --- Teams ----------------------------------------------------------------
const ownTeam = (req, teamId) => get('SELECT * FROM teams WHERE id=? AND owner_id=?', id(teamId), req.ownerId);

app.post('/api/teams', (req, res) => {
  const b = req.body;
  if (!str(b.name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!get('SELECT id FROM sports WHERE id=? AND owner_id=?', id(b.sport_id), req.ownerId))
    return res.status(400).json({ error: 'Unknown sport' });
  const r = run(
    'INSERT INTO teams (owner_id, sport_id, name, season, notes) VALUES (?,?,?,?,?)',
    req.ownerId, id(b.sport_id), str(b.name).trim(), str(b.season), str(b.notes),
  );
  res.json(get(`SELECT ${TEAM_COLS} FROM teams WHERE id=?`, Number(r.lastInsertRowid)));
});
app.put('/api/teams/:id', (req, res) => {
  if (!ownTeam(req, req.params.id)) return notFound(res);
  const b = req.body;
  run('UPDATE teams SET name=?, season=?, notes=? WHERE id=?', str(b.name).trim(), str(b.season), str(b.notes), id(req.params.id));
  res.json(get(`SELECT ${TEAM_COLS} FROM teams WHERE id=?`, id(req.params.id)));
});
app.delete('/api/teams/:id', (req, res) => {
  if (!ownTeam(req, req.params.id)) return notFound(res);
  run('DELETE FROM teams WHERE id=?', id(req.params.id));
  res.json({ ok: true });
});

// --- Schedule calendar (GameChanger and other iCalendar feeds) ------------
const calendarFail = (res, e) => {
  if (e instanceof CalendarError) return res.status(400).json({ error: e.message });
  console.error(e);
  return res.status(500).json({ error: 'The schedule sync failed unexpectedly.' });
};
async function syncCalendar(team) {
  const events = await fetchCalendar(team.calendar_url);
  tx(() => {
    run('DELETE FROM events WHERE team_id=?', team.id);
    for (const ev of events)
      run(
        'INSERT INTO events (owner_id, team_id, uid, kind, title, date, start_time, end_time, location, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
        team.owner_id, team.id, ev.uid, ev.kind, ev.title, ev.date, ev.start_time, ev.end_time, ev.location, ev.notes,
      );
    // Where the coach has said what an event really is, that wins over the guess made from its title.
    run(
      `UPDATE events SET kind=(SELECT k.kind FROM event_kinds k WHERE k.team_id=events.team_id AND k.uid=events.uid)
        WHERE team_id=? AND EXISTS (SELECT 1 FROM event_kinds k WHERE k.team_id=events.team_id AND k.uid=events.uid)`,
      team.id,
    );
    run('UPDATE teams SET calendar_synced_at=? WHERE id=?', new Date().toISOString(), team.id);
  });
  return events.length;
}
// Changes what a calendar event counts as. Its date, time and place still come from the calendar.
app.put('/api/teams/:id/events/:eventId', (req, res) => {
  if (!ownTeam(req, req.params.id)) return notFound(res);
  const ev = get('SELECT * FROM events WHERE id=? AND team_id=?', id(req.params.eventId), id(req.params.id));
  if (!ev) return notFound(res);
  const kind = str(req.body.kind);
  if (!['practice', 'game', 'other'].includes(kind)) return res.status(400).json({ error: 'Choose practice, game or other event.' });
  tx(() => {
    run('UPDATE events SET kind=? WHERE id=?', kind, ev.id);
    run('INSERT INTO event_kinds (team_id, uid, kind) VALUES (?,?,?) ON CONFLICT(team_id, uid) DO UPDATE SET kind=excluded.kind', ev.team_id, ev.uid, kind);
  });
  res.json(get('SELECT id, kind, title, date, start_time, end_time, location, notes FROM events WHERE id=?', ev.id));
});
// Saves (or clears) the calendar link, then syncs it.
app.put('/api/teams/:id/calendar', async (req, res) => {
  const team = ownTeam(req, req.params.id);
  if (!team) return notFound(res);
  try {
    const url = normalizeCalendarUrl(req.body.url);
    if (!url) {
      tx(() => {
        run("UPDATE teams SET calendar_url='', calendar_synced_at='' WHERE id=?", team.id);
        run('DELETE FROM events WHERE team_id=?', team.id);
      });
      return res.json({ count: 0, team: get(`SELECT ${TEAM_COLS} FROM teams WHERE id=?`, team.id) });
    }
    // Only keep the link if it actually works.
    const count = await syncCalendar({ ...team, calendar_url: url });
    run('UPDATE teams SET calendar_url=? WHERE id=?', url, team.id);
    res.json({ count, team: get(`SELECT ${TEAM_COLS} FROM teams WHERE id=?`, team.id) });
  } catch (e) {
    calendarFail(res, e);
  }
});
app.post('/api/teams/:id/calendar/sync', async (req, res) => {
  const team = ownTeam(req, req.params.id);
  if (!team) return notFound(res);
  if (!team.calendar_url) return res.status(400).json({ error: 'This team has no calendar link yet.' });
  try {
    const count = await syncCalendar(team);
    res.json({ count, team: get(`SELECT ${TEAM_COLS} FROM teams WHERE id=?`, team.id) });
  } catch (e) {
    calendarFail(res, e);
  }
});
app.get('/api/teams/:id/events', (req, res) => {
  if (!ownTeam(req, req.params.id)) return notFound(res);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(req.query.from)) ? str(req.query.from) : '0000-00-00';
  res.json(
    all(
      'SELECT id, kind, title, date, start_time, end_time, location, notes FROM events WHERE team_id=? AND date>=? ORDER BY date, start_time, id',
      id(req.params.id), from,
    ),
  );
});

// --- Players --------------------------------------------------------------
const PLAYER_FIELDS = ['name', 'number', 'position', 'grade', 'parent_name', 'parent_email', 'notes'];
const insertPlayer = (ownerId, teamId, p) =>
  run(
    `INSERT INTO players (owner_id, team_id, ${PLAYER_FIELDS.join(',')}) VALUES (?,?,${PLAYER_FIELDS.map(() => '?').join(',')})`,
    ownerId, teamId, ...PLAYER_FIELDS.map((f) => str(p[f]).trim()),
  );

app.get('/api/teams/:id/players', (req, res) => {
  if (!ownTeam(req, req.params.id)) return notFound(res);
  const players = all('SELECT * FROM players WHERE team_id=? ORDER BY name COLLATE NOCASE', id(req.params.id));
  // A helper who was not given the contact details gets names, numbers and positions only.
  // Parent phone numbers are no longer kept. Any saved before stay out of what is sent.
  for (const p of players) delete p.parent_phone;
  if (req.staff && !req.staff.perms.contacts) for (const p of players) p.parent_name = p.parent_email = p.notes = '';
  res.json(players);
});
app.post('/api/teams/:id/players', (req, res) => {
  if (!ownTeam(req, req.params.id)) return notFound(res);
  if (!str(req.body.name).trim()) return res.status(400).json({ error: 'Name is required' });
  const r = insertPlayer(req.ownerId, id(req.params.id), req.body);
  res.json(get('SELECT * FROM players WHERE id=?', Number(r.lastInsertRowid)));
});
app.post('/api/teams/:id/players/import', (req, res) => {
  if (!ownTeam(req, req.params.id)) return notFound(res);
  const rows = (Array.isArray(req.body.players) ? req.body.players : []).filter((p) => str(p?.name).trim());
  tx(() => {
    if (req.body.replace) run('DELETE FROM players WHERE team_id=?', id(req.params.id));
    for (const p of rows) insertPlayer(req.ownerId, id(req.params.id), p);
  });
  res.json({ imported: rows.length });
});
app.put('/api/players/:id', (req, res) => {
  const p = get('SELECT id FROM players WHERE id=? AND owner_id=?', id(req.params.id), req.ownerId);
  if (!p) return notFound(res);
  if (!str(req.body.name).trim()) return res.status(400).json({ error: 'Name is required' });
  run(
    `UPDATE players SET ${PLAYER_FIELDS.map((f) => f + '=?').join(', ')}, active=? WHERE id=?`,
    ...PLAYER_FIELDS.map((f) => str(req.body[f]).trim()), req.body.active === 0 || req.body.active === false ? 0 : 1, p.id,
  );
  res.json(get('SELECT * FROM players WHERE id=?', p.id));
});
app.delete('/api/players/:id', (req, res) => {
  run('DELETE FROM players WHERE id=? AND owner_id=?', id(req.params.id), req.ownerId);
  res.json({ ok: true });
});

// --- Tags -----------------------------------------------------------------
const pct = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.min(100, Math.max(0, Number(v))));
const targetsJson = (input) => {
  const out = {};
  for (const s of TARGET_SCOPES) {
    const v = pct(input?.[s]);
    if (v != null) out[s] = v;
  }
  return JSON.stringify(out);
};
app.post('/api/tags', (req, res) => {
  const b = req.body;
  if (!str(b.name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!get('SELECT id FROM sports WHERE id=? AND owner_id=?', id(b.sport_id), req.ownerId))
    return res.status(400).json({ error: 'Unknown sport' });
  const r = run(
    'INSERT INTO tags (owner_id, sport_id, name, color, target_pct, targets_json) VALUES (?,?,?,?,?,?)',
    req.ownerId, id(b.sport_id), str(b.name).trim(), str(b.color, '#2a78d6'), pct(b.target_pct), targetsJson(b.targets),
  );
  res.json(tagOut(get('SELECT * FROM tags WHERE id=?', Number(r.lastInsertRowid))));
});
app.put('/api/tags/:id', (req, res) => {
  const t = get('SELECT id FROM tags WHERE id=? AND owner_id=?', id(req.params.id), req.ownerId);
  if (!t) return notFound(res);
  const b = req.body;
  if (!str(b.name).trim()) return res.status(400).json({ error: 'Name is required' });
  run('UPDATE tags SET name=?, color=?, target_pct=?, targets_json=? WHERE id=?', str(b.name).trim(), str(b.color, '#2a78d6'), pct(b.target_pct), targetsJson(b.targets), t.id);
  res.json(tagOut(get('SELECT * FROM tags WHERE id=?', t.id)));
});
app.delete('/api/tags/:id', (req, res) => {
  run('DELETE FROM tags WHERE id=? AND owner_id=?', id(req.params.id), req.ownerId);
  res.json({ ok: true });
});

const linkTags = (table, col, rowId, tagIds, ownerId) => {
  run(`DELETE FROM ${table} WHERE ${col}=?`, rowId);
  for (const t of new Set((tagIds || []).map(Number))) {
    // The SELECT drops tag ids that do not belong to this owner.
    run(`INSERT OR IGNORE INTO ${table} (${col}, tag_id) SELECT ?, id FROM tags WHERE id=? AND owner_id=?`, rowId, t, ownerId);
  }
};

// --- Drill library --------------------------------------------------------
const drillOut = (d) => ({
  id: d.id, sport_id: d.sport_id, name: d.name, duration_min: d.duration_min,
  notes_html: d.notes_html, coach_notes_html: d.coach_notes_html, callout: d.callout,
  groups: parse(d.groups_json, []),
  images: parse(d.images_json, []),
  play_ids: parse(d.plays_json, []),
  ...extrasOut(d),
  tag_ids: all('SELECT tag_id FROM drill_tags WHERE drill_id=?', d.id).map((r) => r.tag_id),
});
// Library drills never carry player assignments, only the station layout.
const stripMembers = (groups) =>
  (Array.isArray(groups) ? groups : []).map((g) => ({ name: str(g.name), notes_html: str(g.notes_html), members: [] }));

app.get('/api/drills', (req, res) => {
  res.json(all('SELECT * FROM drills WHERE owner_id=? ORDER BY name COLLATE NOCASE', req.ownerId).map(drillOut));
});
app.post('/api/drills', (req, res) => {
  const b = req.body;
  if (!str(b.name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!get('SELECT id FROM sports WHERE id=? AND owner_id=?', id(b.sport_id), req.ownerId))
    return res.status(400).json({ error: 'Unknown sport' });
  const newId = tx(() => {
    const r = run(
      'INSERT INTO drills (owner_id, sport_id, name, duration_min, notes_html, coach_notes_html, callout, groups_json) VALUES (?,?,?,?,?,?,?,?)',
      req.ownerId, id(b.sport_id), str(b.name).trim(), int(b.duration_min, 10), str(b.notes_html), str(b.coach_notes_html),
      str(b.callout), JSON.stringify(stripMembers(b.groups)),
    );
    linkTags('drill_tags', 'drill_id', Number(r.lastInsertRowid), b.tag_ids, req.ownerId);
    run('UPDATE drills SET images_json=?, plays_json=?, extras_json=? WHERE id=?', JSON.stringify(cleanImages(b.images, req.ownerId)), JSON.stringify(cleanPlayIds(b.play_ids, req.ownerId)), extrasJson(b, req.ownerId), Number(r.lastInsertRowid));
    return Number(r.lastInsertRowid);
  });
  res.json(drillOut(get('SELECT * FROM drills WHERE id=?', newId)));
});
app.put('/api/drills/:id', (req, res) => {
  const d = get('SELECT id FROM drills WHERE id=? AND owner_id=?', id(req.params.id), req.ownerId);
  if (!d) return notFound(res);
  const b = req.body;
  if (!str(b.name).trim()) return res.status(400).json({ error: 'Name is required' });
  tx(() => {
    run(
      'UPDATE drills SET name=?, duration_min=?, notes_html=?, coach_notes_html=?, callout=?, groups_json=? WHERE id=?',
      str(b.name).trim(), int(b.duration_min, 10), str(b.notes_html), str(b.coach_notes_html), str(b.callout),
      JSON.stringify(stripMembers(b.groups)), d.id,
    );
    linkTags('drill_tags', 'drill_id', d.id, b.tag_ids, req.ownerId);
    run('UPDATE drills SET images_json=?, plays_json=?, extras_json=? WHERE id=?', JSON.stringify(cleanImages(b.images, req.ownerId)), JSON.stringify(cleanPlayIds(b.play_ids, req.ownerId)), extrasJson(b, req.ownerId), d.id);
  });
  res.json(drillOut(get('SELECT * FROM drills WHERE id=?', d.id)));
});
app.delete('/api/drills/:id', (req, res) => {
  run('DELETE FROM drills WHERE id=? AND owner_id=?', id(req.params.id), req.ownerId);
  res.json({ ok: true });
});

// --- Plans (practices, homework, templates) -------------------------------
const itemOut = (it) => ({
  id: it.id, kind: it.kind, title: it.title, duration_min: it.duration_min,
  notes_html: it.notes_html, coach_notes_html: it.coach_notes_html, callout: it.callout, reps: it.reps,
  groups: parse(it.groups_json, []), player_notes: parse(it.player_notes_json, []), drill_id: it.drill_id,
  images: parse(it.images_json, []),
  play_ids: parse(it.plays_json, []),
  ...extrasOut(it),
  // Runs at the same time as the item before it, sharing that item's time slot.
  beside: parse(it.extras_json, {})?.beside === true,
  tag_ids: all('SELECT tag_id FROM plan_item_tags WHERE item_id=?', it.id).map((r) => r.tag_id),
});
const planOut = (p, withItems = true) => ({
  id: p.id, team_id: p.team_id, kind: p.kind, title: p.title, date: p.date, start_time: p.start_time,
  location: p.location, intro_html: p.intro_html, is_template: !!p.is_template, is_game: !!p.is_game,
  notes: p.notes ?? '', print_notes: p.print_notes !== 0,
  assigned: parse(p.assigned_json, []), updated_at: p.updated_at,
  ...(withItems
    ? { items: all('SELECT * FROM plan_items WHERE plan_id=? ORDER BY position, id', p.id).map(itemOut) }
    : {}),
});
const ownPlan = (req, planId) => get('SELECT * FROM plans WHERE id=? AND owner_id=?', id(planId), req.ownerId);

function writeItems(planId, items, ownerId) {
  run('DELETE FROM plan_items WHERE plan_id=?', planId);
  (Array.isArray(items) ? items : []).forEach((it, i) => {
    const groups = (Array.isArray(it.groups) ? it.groups : []).map((g) => ({
      name: str(g.name),
      notes_html: str(g.notes_html),
      members: (Array.isArray(g.members) ? g.members : []).map((m) => ({ player_id: id(m.player_id), role: str(m.role) })),
    }));
    const playerNotes = (Array.isArray(it.player_notes) ? it.player_notes : []).map((n) => ({
      player_id: id(n.player_id),
      note: str(n.note),
    }));
    const drillId = it.drill_id && get('SELECT id FROM drills WHERE id=? AND owner_id=?', id(it.drill_id), ownerId) ? id(it.drill_id) : null;
    const r = run(
      `INSERT INTO plan_items (plan_id, position, kind, title, duration_min, notes_html, coach_notes_html, callout, reps,
         groups_json, player_notes_json, drill_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      planId, i, it.kind === 'break' ? 'break' : 'item', str(it.title), int(it.duration_min, 0), str(it.notes_html),
      str(it.coach_notes_html), str(it.callout), str(it.reps), JSON.stringify(groups), JSON.stringify(playerNotes), drillId,
    );
    linkTags('plan_item_tags', 'item_id', Number(r.lastInsertRowid), it.kind === 'break' ? [] : it.tag_ids, ownerId);
    const images = it.kind === 'break' ? [] : cleanImages(it.images, ownerId);
    if (images.length) run('UPDATE plan_items SET images_json=? WHERE id=?', JSON.stringify(images), Number(r.lastInsertRowid));
    const playIds = it.kind === 'break' ? [] : cleanPlayIds(it.play_ids, ownerId);
    if (playIds.length) run('UPDATE plan_items SET plays_json=? WHERE id=?', JSON.stringify(playIds), Number(r.lastInsertRowid));
    if (it.kind !== 'break' && ((it.links || []).length || (it.videos || []).length || it.beside === true))
      run('UPDATE plan_items SET extras_json=? WHERE id=?', JSON.stringify({ ...JSON.parse(extrasJson(it, ownerId)), ...(it.beside === true ? { beside: true } : {}) }), Number(r.lastInsertRowid));
  });
}

app.get('/api/plans', (req, res) => {
  const q = req.query;
  if (!ownTeam(req, q.team_id)) return notFound(res);
  const where = ['team_id=?', 'is_template=?'];
  const params = [id(q.team_id), q.templates === '1' ? 1 : 0];
  if (q.kind === 'practice' || q.kind === 'homework') {
    where.push('kind=?');
    params.push(q.kind);
  }
  const rows = all(`SELECT * FROM plans WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC`, ...params);
  res.json(rows.map((p) => planOut(p, q.full === '1')));
});
app.get('/api/plans/:id', (req, res) => {
  const p = ownPlan(req, req.params.id);
  if (!p) return notFound(res);
  res.json(planOut(p));
});
app.post('/api/plans', (req, res) => {
  const b = req.body;
  if (!ownTeam(req, b.team_id)) return res.status(400).json({ error: 'Unknown team' });
  const src = b.from_plan_id ? ownPlan(req, b.from_plan_id) : null;
  if (b.from_plan_id && !src) return res.status(400).json({ error: 'Unknown source plan' });
  // Asking for a practice on a day that already has a blank one uses that one, so a double click,
  // a second "Plan this practice", or starting from a template never leaves two for the same day.
  if (!b.is_template && str(b.date ?? '')) {
    const blank = get(
      `SELECT * FROM plans p WHERE owner_id=? AND team_id=? AND kind=? AND date=? AND is_game=? AND is_template=0
         AND NOT EXISTS (SELECT 1 FROM plan_items i WHERE i.plan_id=p.id) ORDER BY id LIMIT 1`,
      req.ownerId, id(b.team_id), b.kind ?? src?.kind ?? 'practice', str(b.date), (b.is_game ?? src?.is_game) ? 1 : 0,
    );
    if (blank && !src) return res.json(planOut(blank));
    if (blank && src.id !== blank.id) {
      // Started from a template or an earlier practice: its items go into the blank one already there.
      tx(() => {
        let items = planOut(src).items;
        if (src.is_template || src.team_id !== blank.team_id) items = items.map((it) => ({ ...it, player_notes: [], groups: it.groups.map((g) => ({ ...g, members: [] })) }));
        writeItems(blank.id, items, req.ownerId);
        run('UPDATE plans SET updated_at=CURRENT_TIMESTAMP WHERE id=?', blank.id);
      });
      return res.json(planOut(get('SELECT * FROM plans WHERE id=?', blank.id)));
    }
  }
  const newId = tx(() => {
    const r = run(
      `INSERT INTO plans (owner_id, team_id, kind, title, date, start_time, location, intro_html, is_template, assigned_json, is_game, notes, print_notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      req.ownerId, id(b.team_id), b.kind ?? src?.kind ?? 'practice', str(b.title ?? src?.title),
      str(b.date ?? ''), str(b.start_time ?? src?.start_time ?? '17:30'), str(b.location ?? src?.location),
      str(src?.intro_html), b.is_template ? 1 : 0, '[]', (b.is_game ?? src?.is_game) ? 1 : 0,
      str(src?.notes), src?.print_notes === 0 ? 0 : 1,
    );
    const planId = Number(r.lastInsertRowid);
    if (src) {
      let items = planOut(src).items;
      // A template or a copy for another team must not carry player assignments over.
      if (b.is_template || src.team_id !== id(b.team_id)) {
        items = items.map((it) => ({ ...it, player_notes: [], groups: it.groups.map((g) => ({ ...g, members: [] })) }));
      }
      writeItems(planId, items, req.ownerId);
    }
    return planId;
  });
  res.json(planOut(get('SELECT * FROM plans WHERE id=?', newId)));
});
app.put('/api/plans/:id', (req, res) => {
  const p = ownPlan(req, req.params.id);
  if (!p) return notFound(res);
  const b = req.body;
  tx(() => {
    run(
      `UPDATE plans SET title=?, date=?, start_time=?, location=?, intro_html=?, assigned_json=?, is_game=?, notes=?, print_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      str(b.title), str(b.date), str(b.start_time, '17:30'), str(b.location), str(b.intro_html),
      JSON.stringify((Array.isArray(b.assigned) ? b.assigned : []).map(Number)), b.is_game ? 1 : 0,
      str(b.notes).slice(0, 20000), b.print_notes === false ? 0 : 1, p.id,
    );
    writeItems(p.id, b.items, req.ownerId);
    // A practice with something in it makes an empty one for the same day, time and team redundant:
    // it is usually a blank that was started and left. Removing it stops the day showing twice.
    if (!p.is_template && str(b.date) && Array.isArray(b.items) && b.items.length > 0)
      run(
        `DELETE FROM plans WHERE owner_id=? AND team_id=? AND kind=? AND date=? AND start_time=? AND is_game=? AND is_template=0 AND id<>?
           AND COALESCE(notes, '')='' AND NOT EXISTS (SELECT 1 FROM plan_items i WHERE i.plan_id=plans.id)`,
        req.ownerId, p.team_id, p.kind, str(b.date), str(b.start_time, '17:30'), b.is_game ? 1 : 0, p.id,
      );
  });
  res.json(planOut(get('SELECT * FROM plans WHERE id=?', p.id)));
});
app.delete('/api/plans/:id', (req, res) => {
  run('DELETE FROM plans WHERE id=? AND owner_id=?', id(req.params.id), req.ownerId);
  res.json({ ok: true });
});

// --- Discussion on a plan ---------------------------------------------------
// The team's owner and everyone the team is shared with can talk about one practice. Reading and
// writing here needs no permission to change the plan itself: see the gate in server/staff.js.
const planPostsOut = (req, plan) => {
  const rows = all('SELECT p.*, u.name FROM plan_posts p JOIN users u ON u.id=p.user_id WHERE p.plan_id=? ORDER BY p.id', plan.id);
  // The owner, or a helper who manages the team, can remove anyone's message.
  const moderator = !req.staff || req.staff.perms.manage;
  const under = new Map();
  for (const r of rows) if (r.parent_id) under.set(r.parent_id, [...(under.get(r.parent_id) ?? []), r]);
  const tree = (r) => ({
    id: r.id, body: r.body, created_at: r.created_at, by: r.name, by_id: r.user_id, mine: r.user_id === req.user.id,
    can_delete: r.user_id === req.user.id || moderator, parent_id: r.parent_id ?? null, replies: (under.get(r.id) ?? []).map(tree),
  });
  // Newest conversation first; inside one, replies in the order they were written.
  return rows.filter((r) => !r.parent_id).reverse().map(tree);
};
/** Everyone who works on a plan's team: the owner of its workspace, and the people the team is shared with. */
const coachesOf = (plan) => [
  ...all("SELECT user_id FROM memberships WHERE owner_id=? AND role='owner'", plan.owner_id),
  ...all('SELECT user_id FROM team_staff WHERE team_id=?', plan.team_id),
].map((r) => r.user_id);
/** Who works on a plan: the team's owner, then everyone the team is shared with, and whether each may change plans. */
app.get('/api/plans/:id/collaborators', (req, res) => {
  const plan = ownPlan(req, req.params.id);
  if (!plan) return notFound(res);
  const owners = all("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=? AND m.role='owner' ORDER BY u.id", plan.owner_id);
  const staff = all('SELECT u.id, u.name, s.title, s.perms_json FROM team_staff s JOIN users u ON u.id=s.user_id WHERE s.team_id=? ORDER BY u.name COLLATE NOCASE', plan.team_id);
  const perms = (json) => {
    try {
      return JSON.parse(json) || {};
    } catch {
      return {};
    }
  };
  res.json([
    ...owners.map((u) => ({ id: u.id, name: u.name, role: 'Owner', owner: true, can_edit: true, you: u.id === req.user.id })),
    ...staff.map((u) => ({ id: u.id, name: u.name, role: u.title || 'Coach', owner: false, can_edit: !!perms(u.perms_json).plans, you: u.id === req.user.id })),
  ]);
});
app.get('/api/plans/:id/posts', (req, res) => {
  const plan = ownPlan(req, req.params.id);
  if (!plan) return notFound(res);
  res.json(planPostsOut(req, plan));
});
app.post('/api/plans/:id/posts', (req, res) => {
  const plan = ownPlan(req, req.params.id);
  if (!plan) return notFound(res);
  const body = str(req.body.body).slice(0, 4000).trim();
  if (!body) return res.status(400).json({ error: 'Write something first.' });
  const parent = req.body.parent_id ? get('SELECT id FROM plan_posts WHERE id=? AND plan_id=?', id(req.body.parent_id), plan.id) : null;
  if (req.body.parent_id && !parent) return res.status(404).json({ error: 'The message you are replying to has been deleted.' });
  run('INSERT INTO plan_posts (plan_id, user_id, parent_id, body) VALUES (?,?,?,?)', plan.id, req.user.id, parent?.id ?? null, body);
  // Every other coach on the team hears about it in their Messages.
  const team = get('SELECT name FROM teams WHERE id=?', plan.team_id);
  const what = plan.kind === 'homework' ? 'homework' : 'practice';
  const label = [plan.title || (what === 'homework' ? 'Homework' : 'Practice'), plan.date].filter(Boolean).join(', ');
  for (const userId of new Set(coachesOf(plan)))
    if (userId !== req.user.id)
      notify(userId, {
        kind: 'plan-post', ref: `plan-${plan.id}`, link: `/go/plan/${plan.team_id}/${plan.id}`,
        title: `${req.user.name} ${parent ? 'replied' : 'wrote'} about a ${what} for ${team?.name ?? 'your team'}`,
        body: `${label}: ${body.length > 140 ? `${body.slice(0, 140)}…` : body}`,
      });
  res.json(planPostsOut(req, plan));
});
app.delete('/api/plans/:id/posts/:postId', (req, res) => {
  const plan = ownPlan(req, req.params.id);
  const post = plan && get('SELECT * FROM plan_posts WHERE id=? AND plan_id=?', id(req.params.postId), plan.id);
  if (!post) return notFound(res);
  if (post.user_id !== req.user.id && req.staff && !req.staff.perms.manage) return res.status(403).json({ error: 'Only the person who wrote it, or someone who manages this team, can delete a message.' });
  // Its replies go with it, and the replies to those.
  run(
    `WITH RECURSIVE thread(id) AS (SELECT ? UNION ALL SELECT c.id FROM plan_posts c JOIN thread t ON c.parent_id=t.id)
     DELETE FROM plan_posts WHERE id IN (SELECT id FROM thread)`,
    post.id,
  );
  res.json(planPostsOut(req, plan));
});

// --- Plan import ----------------------------------------------------------
// No API key: analysis runs through the Claude Code program on this computer, or the coach
// pastes a reply from claude.ai. An API key saved by an earlier version is no longer used, so remove it.
run("DELETE FROM settings WHERE key='anthropic_api_key'");

const importContext = (req, teamId) => {
  const team = ownTeam(req, teamId);
  if (!team) return null;
  return {
    sport: get('SELECT name FROM sports WHERE id=?', team.sport_id)?.name || 'Unknown',
    tagNames: all('SELECT name FROM tags WHERE owner_id=? AND sport_id=? ORDER BY name', req.ownerId, team.sport_id).map((t) => t.name),
  };
};
const importFail = (res, e) => {
  if (e instanceof ImportError) return res.status(e.status).json({ error: e.message });
  console.error(e);
  return res.status(500).json({ error: 'The import failed unexpectedly. Check the Dime Coach console window for details.' });
};

// Plan import is granted per user by the system administrator.
app.use('/api/ai', requireImport);
app.get('/api/ai/status', async (_req, res) => res.json(await claudeStatus()));
// Automatic: Claude Code on this computer reads the upload.
app.post('/api/ai/import-plan', async (req, res) => {
  const ctx = importContext(req, req.body.team_id);
  if (!ctx) return res.status(400).json({ error: 'Unknown team' });
  try {
    res.json(await analyzePlan({ source: req.body.source, ...ctx }));
  } catch (e) {
    importFail(res, e);
  }
});
// Manual: the prompt to paste into claude.ai, and a check of the reply pasted back.
app.get('/api/ai/prompt', (req, res) => {
  const ctx = importContext(req, req.query.team_id);
  if (!ctx) return res.status(400).json({ error: 'Unknown team' });
  res.json({ prompt: manualPrompt(ctx.sport, ctx.tagNames) });
});
app.post('/api/ai/parse-draft', (req, res) => {
  try {
    res.json(parseDraft(req.body.reply));
  } catch (e) {
    importFail(res, e);
  }
});

app.use('/api', (_req, res) => notFound(res));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// --- Static client --------------------------------------------------------
const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 4780;
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`Dime Coach is running at http://localhost:${port}`));
