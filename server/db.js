// Single place that knows about the database. To move to hosted Postgres later,
// re-implement this module's exports (all/get/run/tx) against the new driver.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.PP_DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
export const dbPath = path.join(dataDir, 'practiceplan.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Every table carries owner_id (directly or through its parent) so that
// multi-user hosting only needs real authentication, not a data migration.
db.exec(`
CREATE TABLE IF NOT EXISTS owners (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sports (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id),
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id),
  sport_id INTEGER NOT NULL REFERENCES sports(id),
  name TEXT NOT NULL, season TEXT DEFAULT '', notes TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id),
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL, number TEXT DEFAULT '', position TEXT DEFAULT '', grade TEXT DEFAULT '',
  parent_name TEXT DEFAULT '', parent_email TEXT DEFAULT '', parent_phone TEXT DEFAULT '',
  notes TEXT DEFAULT '', active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id),
  sport_id INTEGER NOT NULL REFERENCES sports(id),
  name TEXT NOT NULL, color TEXT DEFAULT '#2a78d6', target_pct REAL
);
CREATE TABLE IF NOT EXISTS drills (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id),
  sport_id INTEGER NOT NULL REFERENCES sports(id),
  name TEXT NOT NULL, duration_min INTEGER DEFAULT 10,
  notes_html TEXT DEFAULT '', coach_notes_html TEXT DEFAULT '', callout TEXT DEFAULT '',
  groups_json TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS drill_tags (
  drill_id INTEGER NOT NULL REFERENCES drills(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (drill_id, tag_id)
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id),
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'practice',          -- 'practice' | 'homework'
  title TEXT DEFAULT '', date TEXT DEFAULT '', start_time TEXT DEFAULT '17:30',
  location TEXT DEFAULT '', intro_html TEXT DEFAULT '',
  is_template INTEGER DEFAULT 0,
  assigned_json TEXT DEFAULT '[]',                -- homework: player ids, empty = whole team
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'item',              -- 'item' | 'break'
  title TEXT DEFAULT '', duration_min INTEGER DEFAULT 10,
  notes_html TEXT DEFAULT '', coach_notes_html TEXT DEFAULT '', callout TEXT DEFAULT '',
  reps TEXT DEFAULT '',                           -- homework: "3 x 20", "50 makes"
  groups_json TEXT DEFAULT '[]',                  -- [{name, notes_html, members:[{player_id, role}]}]
  player_notes_json TEXT DEFAULT '[]',            -- [{player_id, note}]  (coach-only)
  drill_id INTEGER REFERENCES drills(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS plan_item_tags (
  item_id INTEGER NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE TABLE IF NOT EXISTS settings (
  owner_id INTEGER NOT NULL REFERENCES owners(id), key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (owner_id, key)
);
CREATE INDEX IF NOT EXISTS idx_plans_team ON plans(team_id, kind, date);
CREATE INDEX IF NOT EXISTS idx_items_plan ON plan_items(plan_id, position);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id),
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    uid TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other',   -- 'practice' | 'game' | 'other'
    title TEXT DEFAULT '', date TEXT NOT NULL, start_time TEXT DEFAULT '', end_time TEXT DEFAULT '',
    location TEXT DEFAULT '', notes TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_events_team ON events(team_id, date);
`);

// Accounts. A user reaches a workspace (the owners table) through memberships.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,                     -- administrator of the whole system
  can_import INTEGER DEFAULT 0,                   -- plan import, granted per user by the administrator
  status TEXT NOT NULL DEFAULT 'active',          -- 'pending' (email not confirmed) | 'active' | 'disabled'
  must_change_password INTEGER DEFAULT 0,
  confirm_token_hash TEXT, confirm_expires_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES owners(id),
  role TEXT NOT NULL DEFAULT 'owner',
  PRIMARY KEY (user_id, owner_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT
);
`);

// Pictures attached to items and drills. The file is on disk; see server/images.js.
db.exec(`
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id),
  filename TEXT NOT NULL, mime TEXT NOT NULL, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, bytes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// The playbook. See server/plays.js for the shape of frames_json.
db.exec(`
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id),
  sport_id INTEGER NOT NULL REFERENCES sports(id),
  name TEXT NOT NULL, category TEXT DEFAULT '', labels_json TEXT DEFAULT '[]',
  court TEXT DEFAULT 'half', flipped INTEGER DEFAULT 0, notes TEXT DEFAULT '',
  frames_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Links, pictures and videos saved to the Resources page. See server/resources.js.
db.exec(`
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id),
  kind TEXT NOT NULL,                              -- 'link' | 'image' | 'video'
  title TEXT DEFAULT '', url TEXT DEFAULT '',
  file_id INTEGER REFERENCES images(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Columns added after the first release. Existing data files get them here.
// Communities. See server/communities.js. People join as users; what they share stays in their own workspace.
db.exec(`
CREATE TABLE IF NOT EXISTS communities (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  share_drills INTEGER DEFAULT 0, share_plays INTEGER DEFAULT 0, share_plans INTEGER DEFAULT 0,
  require_approval INTEGER DEFAULT 1,             -- an admin approves each shared item before others see it
  join_code TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS community_members (
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',            -- 'creator' | 'admin' | 'member'
  status TEXT NOT NULL DEFAULT 'active',          -- 'invited' until the person accepts
  invited_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (community_id, user_id)
);
CREATE TABLE IF NOT EXISTS community_posts (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS community_shares (
  id INTEGER PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES owners(id),
  kind TEXT NOT NULL,                             -- 'drill' | 'play' | 'plan'
  item_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',         -- 'pending' | 'approved'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (community_id, kind, item_id, owner_id)
);
CREATE INDEX IF NOT EXISTS idx_posts_community ON community_posts(community_id, id);
CREATE INDEX IF NOT EXISTS idx_shares_community ON community_shares(community_id, kind, status);
`);

function addColumn(table, column, ddl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('teams', 'calendar_url', "TEXT DEFAULT ''");
addColumn('teams', 'calendar_synced_at', "TEXT DEFAULT ''");
// A game-day plan. It is built like a practice but kept out of the dashboard's category totals.
addColumn('plans', 'is_game', 'INTEGER DEFAULT 0');
// Personal display preferences, such as the base color of the category history.
addColumn('users', 'prefs_json', "TEXT DEFAULT '{}'");
// Upload space in megabytes. NULL means the system default applies.
addColumn('users', 'upload_cap_mb', 'INTEGER');
// Target overrides per tracking period: {"practice": 20, "week": 15, ...}. Missing keys use target_pct.
addColumn('tags', 'targets_json', "TEXT DEFAULT '{}'");
// Pictures on an item or drill: [{id, width_pct, caption}].
addColumn('plan_items', 'images_json', "TEXT DEFAULT '[]'");
addColumn('drills', 'images_json', "TEXT DEFAULT '[]'");
// Plays attached to an item or drill for reference: a list of play ids.
addColumn('plan_items', 'plays_json', "TEXT DEFAULT '[]'");
addColumn('drills', 'plays_json', "TEXT DEFAULT '[]'");
// Links and uploaded videos on an item or drill: {links: [{url, label}], videos: [{id, caption}]}.
addColumn('plan_items', 'extras_json', "TEXT DEFAULT '{}'");
addColumn('drills', 'extras_json', "TEXT DEFAULT '{}'");
// Pictures, videos and links on a play: {images: [...], videos: [...], links: [...]}.
addColumn('plays', 'attachments_json', "TEXT DEFAULT '{}'");

// Callouts used to be a separate one-line field under an item. They now live in the notes:
// any that exist are moved to the end of the notes as a bold line, and the field is emptied.
{
  const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  for (const table of ['plan_items', 'drills']) {
    const rows = db.prepare(`SELECT id, notes_html, callout FROM ${table} WHERE callout IS NOT NULL AND TRIM(callout) <> ''`).all();
    const move = db.prepare(`UPDATE ${table} SET notes_html=?, callout='' WHERE id=?`);
    for (const r of rows) move.run(`${r.notes_html || ''}<p><strong>${escapeHtml(r.callout.trim())}</strong></p>`, r.id);
  }
}

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
