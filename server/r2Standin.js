// A stand-in for Cloudflare R2, for testing on this machine with no account and no real keys.
//
// It keeps objects in memory and answers the four requests the site makes of R2: put, get, head
// and delete, each by a signed link. It checks the signature and the time limit the way R2
// does, and answers a browser's cross-origin questions the way a bucket's CORS rule would.
// It is never used by the running site.
//
// To run it by hand:
//   R2_ENDPOINT=http://localhost:4899 R2_ACCESS_KEY_ID=test R2_SECRET_ACCESS_KEY=test R2_BUCKET=video node server/r2Standin.js
// and start the site with the same variables, plus any R2_ACCOUNT_ID.
// R2_STANDIN_ORIGINS, a comma-separated list, limits which sites' pages may use it, as a bucket's CORS rule does.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { presign } from './r2.js';

/** Starts the stand-in. `origins` are the sites whose pages may use it, as in a bucket's CORS rule. */
export function startStandin({ port = 0, accessKey = 'test', secret = 'test', bucket = 'video', origins = ['*'] } = {}) {
  const objects = new Map();
  /** Every request made of it, for a test to look through. */
  const log = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const origin = req.headers.origin;
    const allowed = origin && (origins.includes('*') || origins.includes(origin));
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Expose-Headers', 'ETag');
      res.setHeader('Vary', 'Origin');
    }
    const done = (status, body = '', headers = {}) => {
      log.push({ method: req.method, path: url.pathname, status, bytes: req.method === 'PUT' ? req.bytes || 0 : Buffer.byteLength(body) });
      res.writeHead(status, headers).end(req.method === 'HEAD' ? undefined : body);
    };
    // What a test asks to see what happened.
    if (url.pathname === '/__standin') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ objects: [...objects].map(([key, o]) => ({ key, bytes: o.body.length, type: o.type })), log }));
    }
    if (req.method === 'OPTIONS') {
      if (!allowed) return done(403);
      return done(204, '', { 'Access-Control-Allow-Methods': 'GET, PUT, HEAD', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*', 'Access-Control-Max-Age': '3600' });
    }
    // The link has to be one this bucket's key signed, for this request, and still in time.
    const q = url.searchParams;
    const stamp = q.get('X-Amz-Date') || '';
    const made = new Date(stamp.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z'));
    const expires = Number(q.get('X-Amz-Expires'));
    if (Number.isNaN(made.getTime()) || !(expires > 0)) return done(403, 'AccessDenied');
    const right = presign({ method: req.method, origin: `http://${req.headers.host}`, path: url.pathname, accessKey, secret, expires, now: made });
    if (new URL(right).searchParams.get('X-Amz-Signature') !== q.get('X-Amz-Signature') || !String(q.get('X-Amz-Credential')).startsWith(`${accessKey}/`)) return done(403, 'SignatureDoesNotMatch');
    if (Date.now() > made.getTime() + expires * 1000) return done(403, 'Request has expired');
    if (!url.pathname.startsWith(`/${bucket}/`)) return done(404, 'NoSuchBucket');
    const key = decodeURIComponent(url.pathname.slice(bucket.length + 2));
    if (req.method === 'PUT') {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => {
        const body = Buffer.concat(parts);
        req.bytes = body.length;
        objects.set(key, { body, type: req.headers['content-type'] || 'application/octet-stream' });
        done(200, '', { ETag: `"${body.length}"` });
      });
      return;
    }
    const found = objects.get(key);
    if (req.method === 'DELETE') {
      objects.delete(key);
      return done(204);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return done(405);
    if (!found) return done(404, 'NoSuchKey');
    if (req.method === 'HEAD') return done(200, '', { 'Content-Type': found.type, 'Content-Length': found.body.length });
    done(200, found.body, { 'Content-Type': found.type, 'Content-Length': found.body.length });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ port: server.address().port, objects, log, close: () => new Promise((r) => server.close(r)) })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(new URL(process.env.R2_ENDPOINT || 'http://localhost:4899').port) || 4899;
  startStandin({ port, accessKey: process.env.R2_ACCESS_KEY_ID, secret: process.env.R2_SECRET_ACCESS_KEY, bucket: process.env.R2_BUCKET, origins: process.env.R2_STANDIN_ORIGINS ? process.env.R2_STANDIN_ORIGINS.split(',') : ['*'] }).then((s) => console.log(`R2 stand-in on http://localhost:${s.port}`));
}
