// Pictures, videos and links attached to practice items, drills and plays.
//
// Uploaded files live on disk next to the database, under uploads/. The images table (which holds
// videos too) records who owns each file. Items, drills and plays refer to a file by id, so
// duplicating a practice shares the same file. A hosted version would move the files to object
// storage; only this module would change.
import { fullMessage, spaceFor } from './quota.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dbPath, get, run } from './db.js';

const uploadsDir = path.join(path.dirname(dbPath), 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

/** Identifies the file format from its first bytes, ignoring whatever the browser claimed. */
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  // MP4 and QuickTime files carry "ftyp" at byte 4, followed by a brand.
  if (buf.length > 12 && buf.subarray(4, 8).toString() === 'ftyp')
    return buf.subarray(8, 12).toString().startsWith('qt') ? { mime: 'video/quicktime', ext: '.mov' } : { mime: 'video/mp4', ext: '.mp4' };
  if (buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'video/webm', ext: '.webm' };
  return null;
}
const owned = (fileId, ownerId, kind) =>
  Number.isInteger(fileId) && !!get(`SELECT id FROM images WHERE id=? AND owner_id=? AND mime LIKE '${kind}/%'`, fileId, ownerId);

/** Keeps only pictures this workspace owns, with a sane size and caption. */
export function cleanImages(list, ownerId) {
  const out = [];
  for (const im of Array.isArray(list) ? list : []) {
    const imageId = Number(im?.id);
    if (!owned(imageId, ownerId, 'image')) continue;
    const width = Number(im.width_pct);
    out.push({
      id: imageId,
      width_pct: Number.isFinite(width) ? Math.min(100, Math.max(15, Math.round(width))) : 60,
      caption: String(im.caption ?? '').slice(0, 300),
    });
  }
  return out.slice(0, 12);
}
/** Keeps only videos this workspace owns. */
export function cleanVideos(list, ownerId) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const videoId = Number(v?.id);
    if (owned(videoId, ownerId, 'video')) out.push({ id: videoId, caption: String(v.caption ?? '').slice(0, 300) });
  }
  return out.slice(0, 6);
}
/** Keeps only real web links. Anything that is not http or https is dropped, so a link can never run script. */
export function cleanLinks(list) {
  const out = [];
  for (const l of Array.isArray(list) ? list : []) {
    let url;
    try {
      url = new URL(String(l?.url ?? '').trim());
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (url.href.length > 2000) continue;
    out.push({ url: url.href, label: String(l.label ?? '').trim().slice(0, 200) });
  }
  return out.slice(0, 12);
}

/** Deletes an uploaded file and its record. Only call this once nothing refers to it any more. */
export function deleteUpload(fileId, ownerId) {
  const f = get('SELECT id, filename FROM images WHERE id=? AND owner_id=?', fileId, ownerId);
  if (!f) return;
  run('DELETE FROM images WHERE id=?', f.id);
  fs.rm(path.join(uploadsDir, path.basename(f.filename)), { force: true }, () => {});
}

export function mountImages(app) {
  // How much upload space the signed-in person has used, for the meter on the Resources page.
  app.get('/api/storage', (req, res) => res.json(spaceFor(req)));

  app.post('/api/images', (req, res) => {
    const buf = Buffer.from(String(req.body.data || ''), 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'The picture was empty.' });
    if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'That picture is too large. Use one under 6 MB.' });
    const kind = sniff(buf);
    if (!kind || !kind.mime.startsWith('image/')) return res.status(400).json({ error: 'That file is not a picture PracticePlan can use. Use a JPEG, PNG or WebP.' });
    const space = spaceFor(req);
    if (buf.length > space.left_bytes) return res.status(413).json({ error: fullMessage(space) });
    const filename = crypto.randomUUID() + kind.ext;
    fs.writeFileSync(path.join(uploadsDir, filename), buf);
    const dim = (v) => (Number.isFinite(Number(v)) ? Math.min(20000, Math.max(0, Math.round(Number(v)))) : 0);
    const r = run(
      'INSERT INTO images (owner_id, filename, mime, width, height, bytes) VALUES (?,?,?,?,?,?)',
      req.ownerId, filename, kind.mime, dim(req.body.width), dim(req.body.height), buf.length,
    );
    res.json({ id: Number(r.lastInsertRowid), width: dim(req.body.width), height: dim(req.body.height) });
  });

  // Videos arrive as the raw file, written to disk as it streams in, so a large clip never sits in memory.
  app.post('/api/videos', (req, res) => {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_VIDEO_BYTES) return res.status(413).json({ error: 'That video is too large. Use one under 250 MB.' });
    // Refuse before reading a byte when the sender says how big it is, and again as it streams in.
    const space = spaceFor(req);
    if (space.left_bytes === 0 || declared > space.left_bytes) {
      req.resume();
      return res.status(413).json({ error: fullMessage(space) });
    }
    const temp = path.join(uploadsDir, crypto.randomUUID() + '.part');
    const out = fs.createWriteStream(temp);
    let bytes = 0;
    let head = Buffer.alloc(0);
    let failed = null;
    const fail = (status, error) => {
      if (failed) return;
      failed = { status, error };
      req.unpipe(out);
      out.destroy();
      req.resume(); // let the rest of the upload drain so the browser can read the answer
    };
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
      if (bytes > MAX_VIDEO_BYTES) fail(413, 'That video is too large. Use one under 250 MB.');
      else if (bytes > space.left_bytes) fail(413, fullMessage(space));
    });
    req.pipe(out);
    const cleanup = () => fs.rm(temp, { force: true }, () => {});
    req.on('error', () => fail(400, 'The upload was interrupted. Try again.'));
    req.on('aborted', cleanup);
    out.on('error', () => fail(500, 'The video could not be saved.'));
    req.on('end', () => {
      if (failed) {
        cleanup();
        return res.status(failed.status).json({ error: failed.error });
      }
      out.end(() => {
        const kind = sniff(head);
        if (bytes === 0 || !kind || !kind.mime.startsWith('video/')) {
          cleanup();
          return res.status(400).json({ error: 'That file is not a video PracticePlan can use. Use an MP4, MOV or WebM.' });
        }
        const filename = crypto.randomUUID() + kind.ext;
        fs.renameSync(temp, path.join(uploadsDir, filename));
        const r = run('INSERT INTO images (owner_id, filename, mime, bytes) VALUES (?,?,?,?)', req.ownerId, filename, kind.mime, bytes);
        res.json({ id: Number(r.lastInsertRowid), mime: kind.mime, bytes });
      });
    });
  });

  // One route serves both kinds. sendFile answers byte-range requests, which video players need to seek.
  const serve = (req, res) => {
    const f = get('SELECT filename, mime FROM images WHERE id=? AND owner_id=?', Number(req.params.id), req.ownerId);
    const name = f && path.basename(f.filename);
    if (!name || !fs.existsSync(path.join(uploadsDir, name))) return res.status(404).json({ error: 'Not found' });
    res.sendFile(name, {
      root: uploadsDir,
      headers: {
        'Content-Type': f.mime,
        'X-Content-Type-Options': 'nosniff',
        // A file never changes once uploaded, so the browser can keep it. Private: it needs the sign-in cookie.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  };
  app.get('/api/images/:id', serve);
  app.get('/api/videos/:id', serve);
}
