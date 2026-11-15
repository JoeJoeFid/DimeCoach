// Small preview pictures for links: the video's own thumbnail for YouTube, Vimeo and TikTok,
// and for any other page the picture it publishes for sharing.
//
// The server finds the picture and hands it to the browser, which shrinks it to a few kilobytes
// and sends that back to be kept. Only the tiny copy is ever stored.
import dns from 'node:dns/promises';
import net from 'node:net';
import { db, get, run } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS link_thumbs (
  owner_id INTEGER NOT NULL, url TEXT NOT NULL,
  /** 'ok' with the picture in data, or 'none' when the page offers no picture. */
  state TEXT NOT NULL, data BLOB, mime TEXT DEFAULT '', at TEXT NOT NULL,
  PRIMARY KEY (owner_id, url)
)`);

/** The largest thumbnail that will be kept. */
const MAX_THUMB_BYTES = 12 * 1024;
/** The largest picture that will be fetched to make one from. */
const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
/** How much of a page is read when looking for its picture. */
const MAX_PAGE_BYTES = 600 * 1024;
const TIMEOUT_MS = 7000;
/** A page with no picture is asked again after this long. */
const RETRY_NONE_MS = 7 * 86400_000;
const AGENT = 'Mozilla/5.0 (compatible; DimeCoach/1.0; link preview)';

/** What is known about each link's thumbnail in this workspace: 'ok', 'none', or absent. */
export function thumbStates(ownerId) {
  const cutoff = new Date(Date.now() - RETRY_NONE_MS).toISOString();
  const known = new Map();
  for (const r of db.prepare('SELECT url, state, at FROM link_thumbs WHERE owner_id=?').all(ownerId)) if (r.state === 'ok' || r.at > cutoff) known.set(r.url, r.state);
  return known;
}

// --- Only public web addresses are ever fetched ---
const privateV4 = (ip) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
};
const privateIp = (ip) => {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:') && net.isIPv4(v.slice(7))) return privateV4(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
};
/** Tests may point at a server on this machine. */
const allowLocal = () => process.env.PP_THUMB_ALLOW_LOCAL === '1';
async function publicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (allowLocal()) return u;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  try {
    const found = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (found.length === 0 || found.some((f) => privateIp(f.address))) return null;
  } catch {
    return null;
  }
  return u;
}

/** Fetches a public address, following a few redirects and checking each one, and reads no more than `max` bytes. */
async function grab(raw, max, accept) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await publicUrl(url);
    if (!u) return null;
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': AGENT, Accept: accept } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), u).href;
      await res.body?.cancel();
      continue;
    }
    if (!res.ok || !res.body) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      chunks.push(chunk);
      if (size > max) {
        // A page is cut short. A picture this large is not used.
        if (accept.startsWith('image')) return null;
        break;
      }
    }
    return { url: u.href, type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), body: Buffer.concat(chunks) };
  }
  return null;
}

const youtubeId = (u) => {
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/) || [])[1] || '';
  return /^[\w-]{6,20}$/.test(id) ? id : '';
};
/** Sites that answer "what is the thumbnail for this link?" directly. */
const OEMBED = [
  [/(^|\.)vimeo\.com$/, (url) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`],
  [/(^|\.)tiktok\.com$/, (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`],
];
const unescapeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** The picture a page names for sharing, from its <meta> tags. */
function sharedImage(html, base) {
  const wanted = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];
  const found = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = (tag.match(/\b(?:property|name)\s*=\s*["']?([^"'\s>]+)/i) || [])[1]?.toLowerCase();
    const content = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (name && content && wanted.includes(name) && !found.has(name)) found.set(name, unescapeHtml(content.trim()));
  }
  for (const name of wanted) {
    if (!found.has(name)) continue;
    try {
      return new URL(found.get(name), base).href;
    } catch {
      /* try the next one */
    }
  }
  return '';
}

/** The picture to make a link's thumbnail from, as { type, body }, or null when there is none to be had. */
async function sourceFor(link) {
  const u = await publicUrl(link);
  if (!u) return null;
  const picture = async (url) => {
    const got = url ? await grab(url, MAX_SOURCE_BYTES, 'image/*') : null;
    return got && got.type.startsWith('image/') && got.type !== 'image/svg+xml' ? got : null;
  };
  const yt = youtubeId(u);
  if (yt) return picture(`https://i.ytimg.com/vi/${yt}/mqdefault.jpg`);
  const oembed = OEMBED.find(([host]) => host.test(u.hostname));
  if (oembed) {
    const got = await grab(oembed[1](u.href), MAX_PAGE_BYTES, 'application/json');
    let named = '';
    try {
      named = String(JSON.parse(got.body.toString('utf8')).thumbnail_url || '');
    } catch {
      /* no answer: fall back to the page itself */
    }
    const found = await picture(named);
    if (found) return found;
  }
  const page = await grab(u.href, MAX_PAGE_BYTES, 'text/html,image/*;q=0.8');
  if (!page) return null;
  // The link may be straight to a picture.
  if (page.type.startsWith('image/')) return page.type === 'image/svg+xml' || page.body.length > MAX_SOURCE_BYTES ? null : page;
  return picture(sharedImage(page.body.toString('utf8'), page.url));
}

const now = () => new Date().toISOString();
const linkOf = (req) => String(req.query.url ?? req.body?.url ?? '').slice(0, 2000);

export function mountLinkThumbs(app) {
  // The stored thumbnail.
  app.get('/api/resources/thumb', (req, res) => {
    const row = get("SELECT data, mime FROM link_thumbs WHERE owner_id=? AND url=? AND state='ok'", req.ownerId, linkOf(req));
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.set({ 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=604800', 'X-Content-Type-Options': 'nosniff' });
    res.end(Buffer.from(row.data));
  });

  // The picture to make one from, passed through for the browser to shrink.
  app.get('/api/resources/thumb-source', async (req, res) => {
    const link = linkOf(req);
    let found = null;
    try {
      found = await sourceFor(link);
    } catch {
      found = null;
    }
    if (!found) {
      // Remember that there is nothing to be had, so it is not asked for on every visit.
      if (link) run("INSERT INTO link_thumbs (owner_id, url, state, at) VALUES (?,?,'none',?) ON CONFLICT(owner_id, url) DO UPDATE SET state='none', data=NULL, at=excluded.at WHERE state<>'ok'", req.ownerId, link, now());
      return res.status(404).json({ error: 'No preview picture for this link.' });
    }
    res.set({ 'Content-Type': found.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(found.body);
  });

  // The shrunken copy, to keep.
  app.post('/api/resources/thumb', (req, res) => {
    const link = linkOf(req);
    const m = /^data:(image\/(?:webp|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data ?? ''));
    if (!link || !m) return res.status(400).json({ error: 'Send a small WebP or JPEG picture.' });
    const data = Buffer.from(m[2], 'base64');
    if (data.length === 0 || data.length > MAX_THUMB_BYTES) return res.status(400).json({ error: `A thumbnail must be under ${MAX_THUMB_BYTES / 1024} KB.` });
    run("INSERT INTO link_thumbs (owner_id, url, state, data, mime, at) VALUES (?,?,'ok',?,?,?) ON CONFLICT(owner_id, url) DO UPDATE SET state='ok', data=excluded.data, mime=excluded.mime, at=excluded.at", req.ownerId, link, data, m[1], now());
    res.json({ ok: true, bytes: data.length });
  });
}
