// Storage. Each coach's account (their workspace, with every team in it) has one cap on all it
// keeps: uploaded pictures and videos, and the game video its teams have saved. Clips and cuts are
// only marks on saved video, so they take no room of their own. The system administrator sets a
// default and can override it for one person.
import { get, run } from './db.js';

/** The cap for an account with none of its own, until the system administrator changes it: 5 GB. */
export const FALLBACK_CAP_MB = 5120;
export const MAX_CAP_MB = 1_000_000;
// Done once, when storage came to cover saved game video as well as uploads. A cap of 0 is kept: that is uploads turned off on purpose.
if (!get("SELECT 1 AS ok FROM system_settings WHERE key='storage_caps_reset'")) {
  run('UPDATE users SET upload_cap_mb=NULL WHERE upload_cap_mb IS NOT NULL AND upload_cap_mb<>0');
  run("INSERT INTO system_settings (key, value) VALUES ('storage_caps_reset', '1')");
}
const MB = 1024 * 1024;

export function defaultCapMb() {
  const row = get("SELECT value FROM system_settings WHERE key='default_storage_cap_mb'");
  const n = Number(row?.value);
  return row && Number.isFinite(n) && n >= 0 ? n : FALLBACK_CAP_MB;
}

/** A cap as entered: a whole number of megabytes from 0 (no uploads) up, or null for "use the default". */
export function parseCapMb(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(MAX_CAP_MB, Math.round(n));
}

export const capMbFor = (user) => (user.upload_cap_mb === null || user.upload_cap_mb === undefined ? defaultCapMb() : Number(user.upload_cap_mb));

/**
 * What a workspace holds right now: its uploaded files, and the game video its teams have saved
 * or are bringing in from a file. A broadcast still going out is not counted until it is saved.
 */
export function usageOf(ownerId) {
  const up = get('SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS files FROM images WHERE owner_id=?', ownerId);
  const video = get("SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS files FROM streams WHERE team_id IN (SELECT id FROM teams WHERE owner_id=?) AND ((status='ended' AND saved=1) OR status='uploading')", ownerId);
  return { bytes: up.bytes + video.bytes, files: up.files + video.files, upload_bytes: up.bytes, video_bytes: video.bytes, videos: video.files };
}

/** Where one workspace stands: bytes used, the cap in bytes, and what is left. `fallback` is whose cap applies when the workspace has no owner on record. */
export function spaceOf(ownerId, fallback = null) {
  const used = usageOf(ownerId);
  // Whatever anyone adds lands in the owner's space and counts against the owner's cap: a helper's uploads, a parent's broadcast.
  const holder = get("SELECT u.* FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=? AND m.role='owner' ORDER BY u.id LIMIT 1", ownerId) || fallback;
  // An organization's teams share one space, sized by how many coaches it has seats for.
  const org = get('SELECT seats FROM communities WHERE owner_id=?', ownerId);
  const cap = (org ? Math.max(1, org.seats || 0) * defaultCapMb() : holder ? capMbFor(holder) : defaultCapMb()) * MB;
  return { used_bytes: used.bytes, files: used.files, upload_bytes: used.upload_bytes, video_bytes: used.video_bytes, cap_bytes: cap, left_bytes: Math.max(0, cap - used.bytes) };
}
/** Where the signed-in person stands, in the workspace they are working in. */
export const spaceFor = (req) => spaceOf(req.ownerId, req.user);

const mb = (bytes) => (bytes >= 10 * MB ? Math.round(bytes / MB) : Math.round((bytes / MB) * 10) / 10);
/** The message shown when an upload does not fit. */
export function fullMessage(space) {
  if (space.cap_bytes === 0) return 'Uploads are turned off for your account. Add a link instead, or ask the administrator.';
  return `This does not fit in your storage: ${mb(space.used_bytes)} MB of ${mb(space.cap_bytes)} MB is used by uploads and saved game video. Remove uploads from Resources or game video from the Filmroom that you no longer need, add a link instead, or ask the administrator for more space.`;
}
