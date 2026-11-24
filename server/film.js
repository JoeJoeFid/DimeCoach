// The Filmroom: a team's saved game video, the clips its coaches cut from it, and the videos
// they put together out of clips.
//
// Nothing here makes video. A clip is two marks on a saved game video, with a title and notes.
// A video put together in the Filmroom (a "reel") is a list of clips and whole game videos, in
// an order, each with a choice of whether its notes show over the picture. Playing one plays
// the same pieces of game video that were always there, so a clip or a reel costs no room.
//
// A mark is a piece of the video and how far into that piece, in seconds: the pieces are a few
// seconds each but not all the same length, so "one minute in" would not find the same moment
// twice. Everything here is for the team's coaches, as saved video is.
import crypto from 'node:crypto';
import { all, db, get, run } from './db.js';
import { setSharedPieces, streamOut, videoRole } from './streams.js';
import { FAMILY_INVITE_DAYS } from './contacts.js';
import { publicBase } from './invites.js';
import { mailerStatus, sendMail } from './mailer.js';
import { notify } from './notices.js';
import { slugOf } from './family.js';

db.exec(`
CREATE TABLE IF NOT EXISTS film_clips (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  stream_id INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  start_n INTEGER NOT NULL, start_off REAL NOT NULL DEFAULT 0,
  end_n INTEGER NOT NULL, end_off REAL NOT NULL DEFAULT 0,
  seconds REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_film_clips_team ON film_clips(team_id);
CREATE TABLE IF NOT EXISTS film_reels (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- What a reel is made of, in order: a clip, or a whole game video.
CREATE TABLE IF NOT EXISTS film_reel_items (
  id INTEGER PRIMARY KEY,
  reel_id INTEGER NOT NULL REFERENCES film_reels(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  clip_id INTEGER REFERENCES film_clips(id) ON DELETE CASCADE,
  stream_id INTEGER REFERENCES streams(id) ON DELETE CASCADE,
  show_notes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_film_reel_items ON film_reel_items(reel_id, position);
`);

// Sharing: a game video, a clip or a reel shown to one person on the team's list. Someone who is
// not on it yet is put on it as a guest, who has an account like a parent's but is shown nothing
// of the team except what was shared with them. What a share is of is not tied down in the table,
// so one whose video has since been deleted is simply left out, and cleared away when next seen.
db.exec(`
CREATE TABLE IF NOT EXISTS film_shares (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                             -- 'video' (a whole game video) | 'clip' | 'reel'
  ref_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL REFERENCES team_contacts(id) ON DELETE CASCADE,
  shared_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  watched_at TEXT,
  UNIQUE (kind, ref_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_film_shares_team ON film_shares(team_id);
CREATE INDEX IF NOT EXISTS idx_film_shares_contact ON film_shares(contact_id);
`);
const SHARE_KINDS = ['video', 'clip', 'reel'];
const MAX_SHARE_PEOPLE = 25;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const savedVideo = (id, teamId) => get("SELECT * FROM streams WHERE id=? AND team_id=? AND status='ended' AND saved=1", Number(id), teamId) || null;

// A pause between one part of a reel and the next: how many seconds (none when 0), and whether the screen shown meanwhile says what is coming.
for (const column of ['pause_seconds', 'pause_notes']) if (!all('PRAGMA table_info(film_reels)').some((c) => c.name === column)) db.exec(`ALTER TABLE film_reels ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);

const MAX_ITEMS = 200;
const MAX_PAUSE_SECONDS = 60;
const str = (v, max) => String(v ?? '').slice(0, max);
const nowIso = () => new Date().toISOString();
const whole = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null);
const part = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 1000) / 1000 : 0);
/** A team's saved game videos, newest first. */
const videosOf = (teamId) => all("SELECT * FROM streams WHERE team_id=? AND status='ended' AND saved=1 ORDER BY id DESC", teamId);
const clipOut = (c) => ({
  id: c.id, stream_id: c.stream_id, title: c.title, notes: c.notes,
  start: { n: c.start_n, off: c.start_off }, end: { n: c.end_n, off: c.end_off }, seconds: c.seconds,
  created_at: c.created_at, by: get('SELECT name FROM users WHERE id=?', c.user_id)?.name || '',
});
const reelOut = (r) => ({
  id: r.id, title: r.title, notes: r.notes, pause_seconds: r.pause_seconds || 0, pause_notes: !!r.pause_notes, created_at: r.created_at, updated_at: r.updated_at, by: get('SELECT name FROM users WHERE id=?', r.user_id)?.name || '',
  items: all('SELECT clip_id, stream_id, show_notes FROM film_reel_items WHERE reel_id=? ORDER BY position, id', r.id).map((i) => ({ clip_id: i.clip_id, stream_id: i.stream_id, show_notes: !!i.show_notes })),
});
/**
 * What a share is of, ready to be played: its title and notes, and the parts it plays in order,
 * each a game video and where in it to start and stop. Null when it has been deleted since.
 */
function sharedThing(share) {
  const part = (clip, show) => {
    const s = savedVideo(clip.stream_id, share.team_id);
    return s && { stream: streamOut(s), start: { n: clip.start_n, off: clip.start_off }, end: { n: clip.end_n, off: clip.end_off }, title: clip.title, notes: clip.notes, seconds: clip.seconds, show };
  };
  const whole = (s, show) => ({ stream: streamOut(s), title: s.title || 'Game video', notes: '', seconds: s.seconds, show });
  if (share.kind === 'video') {
    const s = savedVideo(share.ref_id, share.team_id);
    return s && { title: s.title || 'Game video', notes: '', pause_seconds: 0, pause_notes: false, parts: [whole(s, false)] };
  }
  if (share.kind === 'clip') {
    const c = get('SELECT * FROM film_clips WHERE id=? AND team_id=?', share.ref_id, share.team_id);
    const p = c && part(c, false);
    return p ? { title: c.title, notes: c.notes, pause_seconds: 0, pause_notes: false, parts: [p] } : null;
  }
  const r = get('SELECT * FROM film_reels WHERE id=? AND team_id=?', share.ref_id, share.team_id);
  if (!r) return null;
  const parts = all('SELECT clip_id, stream_id, show_notes FROM film_reel_items WHERE reel_id=? ORDER BY position, id', r.id)
    .map((i) => {
      const c = i.clip_id ? get('SELECT * FROM film_clips WHERE id=? AND team_id=?', i.clip_id, share.team_id) : null;
      const s = !c && i.stream_id ? savedVideo(i.stream_id, share.team_id) : null;
      return c ? part(c, !!i.show_notes) : s ? whole(s, !!i.show_notes) : null;
    })
    .filter(Boolean);
  return parts.length ? { title: r.title, notes: r.notes, pause_seconds: r.pause_seconds || 0, pause_notes: !!r.pause_notes, parts } : null;
}
/** A team's shares that are still of something, each with who it is with. The rest are cleared away. */
function sharesOf(teamId) {
  const out = [];
  for (const f of all('SELECT f.*, c.name, c.email, c.kind AS as_kind, c.user_id FROM film_shares f JOIN team_contacts c ON c.id=f.contact_id WHERE f.team_id=? ORDER BY f.id', teamId)) {
    const there = f.kind === 'video' ? savedVideo(f.ref_id, teamId) : get(`SELECT id FROM ${f.kind === 'clip' ? 'film_clips' : 'film_reels'} WHERE id=? AND team_id=?`, f.ref_id, teamId);
    if (!there) run('DELETE FROM film_shares WHERE id=?', f.id);
    // The name is enough to know them by. Addresses stay on the team's own list of people.
    else out.push({ id: f.id, kind: f.kind, ref_id: f.ref_id, contact_id: f.contact_id, name: f.name || f.email, guest: f.as_kind === 'guest', joined: !!f.user_id, created_at: f.created_at, watched_at: f.watched_at || null });
  }
  return out;
}
/** The shares one person has from a team, newest first. */
const sharesFor = (userId, teamId) => all('SELECT f.* FROM film_shares f JOIN team_contacts c ON c.id=f.contact_id WHERE c.user_id=? AND f.team_id=? ORDER BY f.id DESC', userId, teamId);
// Someone a video was shared with may fetch it: all of a game video shared whole, or put whole into a reel, and otherwise only the pieces their clips run over.
setSharedPieces((userId, stream) => {
  const ranges = [];
  for (const f of sharesFor(userId, stream.team_id)) {
    for (const p of sharedThing(f)?.parts ?? []) {
      if (p.stream.id !== stream.id) continue;
      if (!p.end) return 'all';
      ranges.push([p.start.n, p.end.n]);
    }
  }
  return ranges.length ? ranges : null;
});

/** Everything in a team's Filmroom. */
const filmOf = (teamId) => ({
  videos: videosOf(teamId).map(streamOut),
  clips: all('SELECT * FROM film_clips WHERE team_id=? ORDER BY id DESC', teamId).map(clipOut),
  reels: all('SELECT * FROM film_reels WHERE team_id=? ORDER BY updated_at DESC, id DESC', teamId).map(reelOut),
  shares: sharesOf(teamId),
});

export function mountFilm(app) {
  /** The team, when the person asking coaches it. Answers "not found" otherwise, as for anything of a team they have nothing to do with. */
  const coached = (req, res, teamId) => {
    const role = videoRole(req.user, teamId);
    if (!role?.coach) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    return role.team;
  };
  app.get('/api/film', (req, res) => {
    const team = coached(req, res, req.query.team_id);
    if (team) res.json(filmOf(team.id));
  });

  // --- Sharing ---
  /** Whether the person asking is kept from seeing the team's list of parents, family and friends. */
  const listHidden = (req, team) => !!req.staff && req.staff.teamId === team.id && !req.staff.perms?.contacts;
  // The people a video can be shared with: everyone on the team's list who has an email address.
  app.get('/api/film/people', (req, res) => {
    const team = coached(req, res, req.query.team_id);
    if (!team) return;
    if (listHidden(req, team)) return res.json({ hidden: true, mail: mailerStatus().configured, people: [] });
    res.json({
      hidden: false,
      mail: mailerStatus().configured,
      people: all("SELECT id, name, email, kind, user_id FROM team_contacts WHERE team_id=? AND email<>'' ORDER BY name COLLATE NOCASE, id", team.id).map((c) => ({ id: c.id, name: c.name || c.email, email: c.email, kind: c.kind, joined: !!c.user_id })),
    });
  });
  /** Tells one person a video was shared with them: a message here when they have an account, and an email with the way in. */
  async function tell(req, team, contact, share, title, note) {
    const path = `/family/${slugOf(team)}?tab=film&share=${share}`;
    if (contact.user_id) notify(contact.user_id, { kind: 'film', ref: String(share), title: `${req.user.name} shared a video with you`, body: `${title}, from ${team.name}.`, link: path });
    if (!contact.email) return { ok: !!contact.user_id, error: 'They have no email address.' };
    if (!mailerStatus().configured) return { ok: !!contact.user_id, error: 'Email is not set up on this site.' };
    // Someone without an account gets a link to make one, which also shows the address is theirs. It takes the place of any link sent before.
    const token = contact.user_id ? '' : crypto.randomBytes(32).toString('base64url');
    if (token) run('UPDATE team_contacts SET token_hash=?, token_expires=?, invited_at=?, invited_by=? WHERE id=?', sha256(token), new Date(Date.now() + FAMILY_INVITE_DAYS * 86400_000).toISOString(), nowIso(), req.user.id, contact.id);
    const base = publicBase(req);
    return sendMail({
      to: contact.email,
      subject: `${req.user.name} shared a video with you: ${title}`,
      text:
        `Hi${contact.name ? ` ${contact.name}` : ''},\n\n` +
        `${req.user.name} shared a video with you from ${team.name} on Dime Coach: "${title}".\n\n` +
        (note ? `${req.user.name} wrote:\n${note}\n\n` : '') +
        (token
          ? `Dime Coach is where the coaches of ${team.name} keep their game video. The video is for you alone, so it needs an account: choose a name and a password and it opens.\n\n${base}/join?token=${token}\n\nThe link works for ${FAMILY_INVITE_DAYS} days, and only for this address.\n\n`
          : `Sign in to Dime Coach with this address to watch it:\n\n${base}${path}\n\n`) +
        `If this was not meant for you, write to ${req.user.name} at ${req.user.email}.`,
      ...(token ? { secret: token } : {}),
    });
  }
  // Shares one thing with people: ones already on the team's list, and new ones by email, who join it as guests.
  app.post('/api/film/shares', async (req, res) => {
    const team = coached(req, res, req.body.team_id);
    if (!team) return;
    const kind = SHARE_KINDS.includes(req.body.kind) ? req.body.kind : '';
    const thing = kind && sharedThing({ team_id: team.id, kind, ref_id: Number(req.body.ref_id) });
    if (!thing) return res.status(404).json({ error: 'That video is no longer in the Filmroom.' });
    const contacts = [];
    for (const id of Array.isArray(req.body.contact_ids) ? req.body.contact_ids : []) {
      const c = get('SELECT * FROM team_contacts WHERE id=? AND team_id=?', Number(id), team.id);
      if (c) contacts.push(c);
    }
    for (const p of Array.isArray(req.body.people) ? req.body.people : []) {
      const email = str(p?.email, 200).trim().toLowerCase();
      if (!EMAIL.test(email)) return res.status(400).json({ error: `"${str(p?.email, 60)}" does not look like an email address.` });
      // Someone already on the team's list is shared with as who they are. Anyone else joins it as a guest, who is shown nothing but this.
      let c = get('SELECT * FROM team_contacts WHERE team_id=? AND lower(email)=?', team.id, email);
      if (!c) {
        const account = get("SELECT id FROM users WHERE lower(email)=? AND status='active'", email);
        const id = run("INSERT INTO team_contacts (team_id, name, email, kind, player_ids_json, user_id, can_watch, can_broadcast) VALUES (?,?,?,'guest','[]',?,0,0)", team.id, str(p?.name, 120).trim(), email, account?.id ?? null).lastInsertRowid;
        c = get('SELECT * FROM team_contacts WHERE id=?', id);
      }
      contacts.push(c);
    }
    const people = [...new Map(contacts.map((c) => [c.id, c])).values()];
    if (people.length === 0) return res.status(400).json({ error: 'Choose someone to share it with.' });
    if (people.length > MAX_SHARE_PEOPLE) return res.status(400).json({ error: `Share with up to ${MAX_SHARE_PEOPLE} people at a time.` });
    const note = str(req.body.note, 1000).trim();
    const untold = [];
    for (const c of people) {
      const made = run('INSERT OR IGNORE INTO film_shares (team_id, kind, ref_id, contact_id, shared_by, created_at) VALUES (?,?,?,?,?,?)', team.id, kind, Number(req.body.ref_id), c.id, req.user.id, nowIso());
      // Shared with them already: nothing more to say.
      if (!made.changes) continue;
      const r = await tell(req, team, c, Number(made.lastInsertRowid), thing.title, note);
      if (!r.ok) untold.push(`${c.name || c.email} (${r.error})`);
    }
    res.json({ ...filmOf(team.id), warning: untold.length ? `It was shared, but these people could not be told: ${untold.join('; ')}. They will see it the next time they open the team's page, if they have an account.` : '' });
  });
  app.delete('/api/film/shares/:id', (req, res) => {
    const f = get('SELECT * FROM film_shares WHERE id=?', Number(req.params.id));
    const team = coached(req, res, f?.team_id);
    if (!team) return;
    run('DELETE FROM film_shares WHERE id=?', f.id);
    res.json(filmOf(team.id));
  });
  // What has been shared with the person asking, from one team, ready to play. Under /family so an account that only follows teams can ask.
  app.get('/api/family/film', (req, res) => {
    const out = [];
    for (const f of sharesFor(req.user.id, Number(req.query.team_id))) {
      const thing = sharedThing(f);
      if (thing) out.push({ id: f.id, kind: f.kind, ...thing, by: get('SELECT name FROM users WHERE id=?', f.shared_by)?.name || 'A coach', at: f.created_at, watched: !!f.watched_at });
    }
    res.json(out);
  });
  app.post('/api/family/film/:id/watched', (req, res) => {
    run('UPDATE film_shares SET watched_at=? WHERE id=? AND watched_at IS NULL AND contact_id IN (SELECT id FROM team_contacts WHERE user_id=?)', nowIso(), Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  // --- Clips ---
  app.post('/api/film/clips', (req, res) => {
    const s = get("SELECT * FROM streams WHERE id=? AND status='ended' AND saved=1", Number(req.body.stream_id));
    const team = coached(req, res, s?.team_id);
    if (!team) return;
    const [sn, en] = [whole(req.body.start?.n), whole(req.body.end?.n)];
    const [so, eo] = [part(req.body.start?.off), part(req.body.end?.off)];
    // The end has to come after the start, and both have to be in the video.
    if (sn === null || en === null || en >= s.segments || en < sn || (en === sn && eo <= so)) return res.status(400).json({ error: 'A clip ends after it starts, inside the video.' });
    const title = str(req.body.title, 120).trim();
    if (!title) return res.status(400).json({ error: 'Give the clip a title.' });
    run(
      'INSERT INTO film_clips (team_id, stream_id, user_id, title, notes, start_n, start_off, end_n, end_off, seconds, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      team.id, s.id, req.user.id, title, str(req.body.notes, 2000).trim(), sn, so, en, eo, Math.max(0, Math.min(part(req.body.seconds), s.seconds + 60)), nowIso(),
    );
    res.json(filmOf(team.id));
  });
  const clipOf = (req, res) => {
    const c = get('SELECT * FROM film_clips WHERE id=?', Number(req.params.id));
    return coached(req, res, c?.team_id) ? c : null;
  };
  app.put('/api/film/clips/:id', (req, res) => {
    const c = clipOf(req, res);
    if (!c) return;
    const title = str(req.body.title, 120).trim();
    if (!title) return res.status(400).json({ error: 'Give the clip a title.' });
    run('UPDATE film_clips SET title=?, notes=? WHERE id=?', title, str(req.body.notes, 2000).trim(), c.id);
    res.json(filmOf(c.team_id));
  });
  app.delete('/api/film/clips/:id', (req, res) => {
    const c = clipOf(req, res);
    if (!c) return;
    run('DELETE FROM film_clips WHERE id=?', c.id);
    res.json(filmOf(c.team_id));
  });

  // --- Videos put together from clips and game videos ---
  /** What a reel is to be made of, checked: each thing has to be this team's own. */
  const itemsFrom = (teamId, list) => {
    const out = [];
    for (const i of Array.isArray(list) ? list.slice(0, MAX_ITEMS) : []) {
      const clip = i?.clip_id ? get('SELECT id FROM film_clips WHERE id=? AND team_id=?', Number(i.clip_id), teamId) : null;
      const video = !clip && i?.stream_id ? get("SELECT id FROM streams WHERE id=? AND team_id=? AND status='ended' AND saved=1", Number(i.stream_id), teamId) : null;
      if (clip || video) out.push({ clip_id: clip?.id ?? null, stream_id: video?.id ?? null, show_notes: i.show_notes ? 1 : 0 });
    }
    return out;
  };
  const putItems = (reelId, items) => {
    run('DELETE FROM film_reel_items WHERE reel_id=?', reelId);
    items.forEach((i, at) => run('INSERT INTO film_reel_items (reel_id, position, clip_id, stream_id, show_notes) VALUES (?,?,?,?,?)', reelId, at, i.clip_id, i.stream_id, i.show_notes));
  };
  const reelFrom = (req, res, teamId) => {
    const title = str(req.body.title, 120).trim();
    const items = itemsFrom(teamId, req.body.items);
    if (!title) return void res.status(400).json({ error: 'Give the video a title.' });
    if (items.length === 0) return void res.status(400).json({ error: 'Add at least one clip or game video.' });
    const pause = Math.max(0, Math.min(MAX_PAUSE_SECONDS, Math.round(Number(req.body.pause_seconds)) || 0));
    return { title, notes: str(req.body.notes, 2000).trim(), items, pause, pauseNotes: pause > 0 && req.body.pause_notes === true ? 1 : 0 };
  };
  app.post('/api/film/reels', (req, res) => {
    const team = coached(req, res, req.body.team_id);
    if (!team) return;
    const r = reelFrom(req, res, team.id);
    if (!r) return;
    const id = Number(run('INSERT INTO film_reels (team_id, user_id, title, notes, pause_seconds, pause_notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', team.id, req.user.id, r.title, r.notes, r.pause, r.pauseNotes, nowIso(), nowIso()).lastInsertRowid);
    putItems(id, r.items);
    res.json({ id, ...filmOf(team.id) });
  });
  const reelOf = (req, res) => {
    const r = get('SELECT * FROM film_reels WHERE id=?', Number(req.params.id));
    return coached(req, res, r?.team_id) ? r : null;
  };
  app.put('/api/film/reels/:id', (req, res) => {
    const was = reelOf(req, res);
    if (!was) return;
    const r = reelFrom(req, res, was.team_id);
    if (!r) return;
    run('UPDATE film_reels SET title=?, notes=?, pause_seconds=?, pause_notes=?, updated_at=? WHERE id=?', r.title, r.notes, r.pause, r.pauseNotes, nowIso(), was.id);
    putItems(was.id, r.items);
    res.json({ id: was.id, ...filmOf(was.team_id) });
  });
  app.delete('/api/film/reels/:id', (req, res) => {
    const r = reelOf(req, res);
    if (!r) return;
    run('DELETE FROM film_reels WHERE id=?', r.id);
    res.json(filmOf(r.team_id));
  });
}
