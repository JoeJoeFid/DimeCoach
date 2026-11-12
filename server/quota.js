// Upload space. Each person's workspace has a cap on how much it may hold in uploaded
// pictures and videos. The system administrator sets a default and can override it per person.
import { get } from './db.js';

/** The cap for someone with no cap of their own, until the system administrator changes it. */
export const FALLBACK_CAP_MB = 500;
export const MAX_CAP_MB = 1_000_000;
const MB = 1024 * 1024;

export function defaultCapMb() {
  const row = get("SELECT value FROM system_settings WHERE key='default_upload_cap_mb'");
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

/** What a workspace holds in uploads right now. */
export const usageOf = (ownerId) => get('SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS files FROM images WHERE owner_id=?', ownerId);

/** Where the signed-in person stands: bytes used, the cap in bytes, and what is left. */
export function spaceFor(req) {
  const used = usageOf(req.ownerId);
  // In a team shared with them, a helper's uploads land in the owner's space and count against the owner's cap.
  const holder =
    (req.staff && get("SELECT u.* FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=? AND m.role='owner' ORDER BY u.id LIMIT 1", req.ownerId)) || req.user;
  const cap = capMbFor(holder) * MB;
  return { used_bytes: used.bytes, files: used.files, cap_bytes: cap, left_bytes: Math.max(0, cap - used.bytes) };
}

const mb = (bytes) => (bytes >= 10 * MB ? Math.round(bytes / MB) : Math.round((bytes / MB) * 10) / 10);
/** The message shown when an upload does not fit. */
export function fullMessage(space) {
  if (space.cap_bytes === 0) return 'Uploads are turned off for your account. Add a link instead, or ask the administrator.';
  return `This does not fit in your upload space: ${mb(space.used_bytes)} MB of ${mb(space.cap_bytes)} MB is used. Remove uploads you no longer need from Resources, add a link instead, or ask the administrator for more space.`;
}
