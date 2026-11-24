// Notifications that reach a phone or a computer even when Dime Coach is not open on it.
//
// A device that asks for them is given an address by its own maker's push service (Apple's,
// Google's, Mozilla's or Microsoft's), and tells us that address. To notify someone we send a
// small sealed message to each of their addresses; the service wakes the device, and the helper
// in the page (client/public/sw.js) shows it. It costs nothing and needs no account anywhere:
// the site proves who it is with a pair of keys it makes for itself the first time.
import webpush from 'web-push';
import { all, db, get, run } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_ok TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subs(user_id);
`);

const str = (v, max) => String(v ?? '').slice(0, max);
/** The site's own pair of keys, made once and kept with its other settings. */
function keys() {
  const read = (k) => get('SELECT value FROM system_settings WHERE key=?', k)?.value || '';
  let pub = process.env.PP_VAPID_PUBLIC || read('vapid_public');
  let priv = process.env.PP_VAPID_PRIVATE || read('vapid_private');
  if (!pub || !priv) {
    const made = webpush.generateVAPIDKeys();
    pub = made.publicKey;
    priv = made.privateKey;
    run("INSERT INTO system_settings (key, value) VALUES ('vapid_public', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", pub);
    run("INSERT INTO system_settings (key, value) VALUES ('vapid_private', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", priv);
  }
  return { pub, priv };
}
/** Who the push services can write to about this site: its own address, which they ask for. */
let seenBase = '';
const contact = () => {
  const base = String(process.env.PP_PUBLIC_URL || seenBase || '').replace(/\/+$/, '');
  return /^https:\/\//.test(base) ? base : 'https://dimecoach.com';
};

// Only the push services' own addresses are ever written to: an address is handed to us by a
// browser, and without this anyone could have the server send requests wherever they liked.
const SERVICES = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
function allowed(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  // For trying it out on one machine, an address on that machine can be let through by a setting.
  if (process.env.PP_PUSH_ALLOW_LOCAL === '1' && ['localhost', '127.0.0.1'].includes(url.hostname)) return true;
  return url.protocol === 'https:' && SERVICES.some((s) => s.test(url.hostname));
}

/**
 * Notifies every device a person has turned notifications on for. `link` is where pressing it
 * goes, inside the site. Nothing waits on it, and a device that has gone away is forgotten.
 */
// How much a person has waiting unread: each part of the site that keeps such a count adds its own
// here (messages, chats), and a notification carries the total, to go on the app's icon.
const counters = [];
export const countsUnread = (fn) => void counters.push(fn);
function unreadFor(userId) {
  let n = 0;
  for (const count of counters) {
    try {
      n += Number(count(userId)) || 0;
    } catch {
      // One count that cannot be had leaves the others standing.
    }
  }
  return n;
}

export function pushTo(userId, { title, body = '', link = '/', tag = '' }) {
  const subs = all('SELECT * FROM push_subs WHERE user_id=?', userId);
  if (subs.length === 0 || !title) return;
  let k;
  try {
    k = keys();
  } catch (e) {
    return console.error('Push keys could not be made:', e.message);
  }
  const text = String(body).replace(/\s+/g, ' ').trim();
  // The count is taken now, after whatever this is about was set down, so it is counted in.
  const payload = JSON.stringify({ title: str(title, 120), body: text.length > 220 ? `${text.slice(0, 220)}…` : text, link: /^\//.test(link) ? link : '/', tag: str(tag, 60), unread: unreadFor(userId) });
  for (const s of subs) {
    webpush
      .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24, urgency: 'normal', vapidDetails: { subject: contact(), publicKey: k.pub, privateKey: k.priv } })
      .then(() => run('UPDATE push_subs SET last_ok=? WHERE id=?', new Date().toISOString(), s.id))
      .catch((e) => {
        // "Gone" and "not found" are the service saying the device no longer wants these.
        if (e?.statusCode === 404 || e?.statusCode === 410) run('DELETE FROM push_subs WHERE id=?', s.id);
        else console.error(`A notification was not sent (${e?.statusCode || e?.message}).`);
      });
  }
}

export function mountPush(app) {
  app.use('/api/push', (req, _res, next) => {
    if (req.headers.host && !seenBase) seenBase = `${req.protocol}://${req.headers.host}`;
    next();
  });
  // The key a browser needs before it will give out an address, and whether this device is on.
  app.get('/api/push/key', (req, res) => {
    const endpoint = str(req.query.endpoint, 1000);
    res.json({ key: keys().pub, on: !!endpoint && !!get('SELECT 1 AS ok FROM push_subs WHERE endpoint=? AND user_id=?', endpoint, req.user.id), devices: get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?', req.user.id).n });
  });
  app.post('/api/push/subscribe', (req, res) => {
    const endpoint = str(req.body.endpoint, 1000);
    const p256dh = str(req.body.keys?.p256dh, 200);
    const auth = str(req.body.keys?.auth, 100);
    if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'This browser did not give what is needed for notifications.' });
    if (!allowed(endpoint)) return res.status(400).json({ error: 'This browser uses a notification service Dime Coach does not know.' });
    // A device belongs to whoever turned it on last: signing in as someone else moves it to them.
    run(
      'INSERT INTO push_subs (user_id, endpoint, p256dh, auth, device) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth, device=excluded.device',
      req.user.id, endpoint, p256dh, auth, str(req.headers['user-agent'], 200),
    );
    // No more than a handful of devices each: the oldest give way.
    for (const old of all('SELECT id FROM push_subs WHERE user_id=? ORDER BY id DESC LIMIT -1 OFFSET 10', req.user.id)) run('DELETE FROM push_subs WHERE id=?', old.id);
    res.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', (req, res) => {
    run('DELETE FROM push_subs WHERE endpoint=? AND user_id=?', str(req.body.endpoint, 1000), req.user.id);
    res.json({ ok: true });
  });
  // "Send me one now", to see that it works.
  app.post('/api/push/test', (req, res) => {
    const n = get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?', req.user.id).n;
    pushTo(req.user.id, { title: 'Notifications are on', body: 'This is what a notification from Dime Coach looks like.', link: '/', tag: 'test' });
    res.json({ ok: true, devices: n });
  });
}
