// Video kept in Cloudflare R2, away from this server and its disk.
//
// Nothing here carries video. The server only signs links: one that lets a browser put a piece
// of video straight into the bucket, one that lets a browser fetch it straight out. A link is
// good for one piece and for a few minutes. The server also asks R2 how big a piece is once it
// has arrived, and removes pieces that are no longer wanted.
//
// R2 speaks the same language as Amazon S3, so the signing is S3's ("Signature Version 4"),
// done with Node's own crypto. It is turned on by four environment variables, and off, with
// everything as it was, when any of them is missing.
import crypto from 'node:crypto';

const env = (name) => String(process.env[name] || '').trim();
/** Where video is kept and the key to it, or null when R2 has not been set up. Read each time, so nothing is held in memory. */
export function r2Config() {
  const accountId = env('R2_ACCOUNT_ID');
  const accessKey = env('R2_ACCESS_KEY_ID');
  const secret = env('R2_SECRET_ACCESS_KEY');
  const bucket = env('R2_BUCKET');
  if (!accountId || !accessKey || !secret || !bucket) return null;
  // R2_ENDPOINT is for a stand-in on this machine while testing. Left unset, it is the account's own address.
  return { accessKey, secret, bucket, origin: (env('R2_ENDPOINT') || `https://${accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '') };
}

const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest();
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
/** Percent-encoding as S3 wants it: everything but letters, digits and - _ . ~ */
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * A link that carries its own permission: whoever holds it may make this one request, until it
 * runs out. `path` starts with a slash and is already encoded.
 */
export function presign({ method, origin, path, accessKey, secret, region = 'auto', expires, now = new Date() }) {
  const host = new URL(origin).host;
  const stamp = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const scope = `${stamp.slice(0, 8)}/${region}/s3/aws4_request`;
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKey}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(expires)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  const request = [method, path, query, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha(request)].join('\n');
  const key = ['s3', 'aws4_request'].reduce(hmac, hmac(hmac(`AWS4${secret}`, stamp.slice(0, 8)), region));
  return `${origin}${path}?${query}&X-Amz-Signature=${hmac(key, toSign).toString('hex')}`;
}

/** A link to one object in the bucket, for one kind of request, good for `expires` seconds. */
export const linkTo = (cfg, method, key, expires) =>
  presign({ method, origin: cfg.origin, path: `/${enc(cfg.bucket)}/${key.split('/').map(enc).join('/')}`, accessKey: cfg.accessKey, secret: cfg.secret, expires });

const ask = (cfg, method, key) => fetch(linkTo(cfg, method, key, 60), { method, signal: AbortSignal.timeout(10_000) });
/** How many bytes an object holds, or null when it is not there. Throws when R2 cannot be reached or refuses. */
export async function sizeOf(cfg, key) {
  const res = await ask(cfg, 'HEAD', key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The video store answered ${res.status}.`);
  return Number(res.headers.get('content-length')) || 0;
}
/** Removes an object. True when it is gone, which it also is when it was never there. */
export async function remove(cfg, key) {
  try {
    const res = await ask(cfg, 'DELETE', key);
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
