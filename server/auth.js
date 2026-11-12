// Sign-in, sessions, registration and system administration.
//
// Model: a user belongs to a workspace (the `owners` table) through `memberships`. All coaching
// data hangs off a workspace, so once a request is tied to a user, the rest of the API scopes
// every query by that user's workspace. Today each user has exactly one workspace of their own;
// the memberships table is what will let staff share one later.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, db, dbPath, get, run, tx } from './db.js';
import { createWorkspace } from './seed.js';
import { mailerStatus, sendMail } from './mailer.js';
import { MAX_CAP_MB, capMbFor, defaultCapMb, parseCapMb, usageOf } from './quota.js';

const COOKIE = 'pp_session';
const SESSION_DAYS = 30;
const CONFIRM_HOURS = 48;
const MIN_PASSWORD = 10;

const str = (v) => (v == null ? '' : String(v));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normEmail = (v) => str(v).trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

// --- Passwords: scrypt with a per-user salt ---------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = str(stored).split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected);
}
const passwordProblem = (pw) => (str(pw).length < MIN_PASSWORD ? `Use a password of at least ${MIN_PASSWORD} characters.` : '');

// --- Sessions: a random token in an HttpOnly cookie; only its hash is stored ---
function readCookie(req, name) {
  for (const part of str(req.headers.cookie).split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function setSessionCookie(req, res, token, maxAgeSeconds) {
  const secure = req.secure || process.env.PP_COOKIE_SECURE === '1';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`,
  );
}
function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  const now = new Date().toISOString();
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), userId, expires);
  run('INSERT INTO logins (user_id, token_hash, started_at, last_seen_at, ip, agent) VALUES (?,?,?,?,?,?)', userId, sha256(token), now, now, str(req.ip), agentOf(req));
  run('UPDATE users SET last_login_at=? WHERE id=?', now, userId);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}
// --- Sign-in history: when each person signed in, and how long they spent in the app ---
const agentOf = (req) => str(req.headers['user-agent']).slice(0, 300);
/** Requests closer together than this count as one stretch of use. A longer gap is time away. */
const IDLE_SECONDS = 5 * 60;
/** How often, at most, a sign-in's "last seen" time is written. */
const TOUCH_SECONDS = 20;
function touchLogin(req, userId) {
  const hash = sha256(readCookie(req, COOKIE));
  const now = new Date();
  const row = get('SELECT id, last_seen_at FROM logins WHERE token_hash=? AND ended_at IS NULL', hash);
  if (!row) {
    // Signed in before sign-ins were recorded: start the record from when that session began.
    const s = get('SELECT created_at FROM sessions WHERE token_hash=?', hash);
    const began = s ? new Date(s.created_at.includes('T') ? s.created_at : s.created_at.replace(' ', 'T') + 'Z').toISOString() : now.toISOString();
    run('INSERT INTO logins (user_id, token_hash, started_at, last_seen_at, ip, agent) VALUES (?,?,?,?,?,?)', userId, hash, began, now.toISOString(), str(req.ip), agentOf(req));
    return;
  }
  const gap = Math.round((now.getTime() - Date.parse(row.last_seen_at)) / 1000);
  if (gap < TOUCH_SECONDS) return;
  run('UPDATE logins SET last_seen_at=?, active_seconds=active_seconds+? WHERE id=?', now.toISOString(), gap <= IDLE_SECONDS ? gap : 0, row.id);
}
/** Signs a person out everywhere, or everywhere but one device, and closes those sign-in records. */
function endSessions(userId, keepHash = '') {
  run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', userId, keepHash);
  run('UPDATE logins SET ended_at=? WHERE user_id=? AND token_hash<>? AND ended_at IS NULL', new Date().toISOString(), userId, keepHash);
}
/** "Chrome on Windows", from what the browser says about itself. */
function deviceOf(agent) {
  const a = str(agent);
  const browser = /Edg\//.test(a) ? 'Edge' : /OPR\//.test(a) ? 'Opera' : /Firefox\//.test(a) ? 'Firefox' : /Chrome\//.test(a) ? 'Chrome' : /Safari\//.test(a) ? 'Safari' : '';
  const system = /iPhone/.test(a) ? 'iPhone' : /iPad/.test(a) ? 'iPad' : /Android/.test(a) ? 'Android' : /Windows/.test(a) ? 'Windows' : /Mac OS X/.test(a) ? 'Mac' : /Linux/.test(a) ? 'Linux' : '';
  return [browser, system].filter(Boolean).join(' on ') || 'Unknown device';
}

function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash=? AND s.expires_at > ? AND u.status='active'`,
    sha256(token), new Date().toISOString(),
  );
  return row || null;
}
const HEX = /^#[0-9a-f]{6}$/i;
/** Display preferences, with anything unexpected dropped. */
function prefsOf(u) {
  let stored = {};
  try {
    stored = JSON.parse(u.prefs_json || '{}') || {};
  } catch {
    /* treat as no preferences */
  }
  const prefs = HEX.test(String(stored.heat_color)) ? { heat_color: String(stored.heat_color).toLowerCase() } : {};
  // Set once the welcome tour has been finished or skipped, so it is not shown again.
  if (stored.tour_done === true) prefs.tour_done = true;
  return prefs;
}
/**
 * The one account that runs the whole system. It is named by email address, not by a setting
 * anyone can change from inside the app: PP_SYSTEM_ADMIN, or the owner's address by default.
 */
const SYSTEM_ADMIN_EMAIL = String(process.env.PP_SYSTEM_ADMIN || 'fid.joe@gmail.com').trim().toLowerCase();
export const isSystemAdmin = (u) => !!u && String(u.email).trim().toLowerCase() === SYSTEM_ADMIN_EMAIL && u.status === 'active';

const userOut = (u) => ({
  id: u.id, email: u.email, name: u.name, is_admin: !!u.is_admin, can_import: !!u.can_import, is_system_admin: isSystemAdmin(u),
  must_change_password: !!u.must_change_password, prefs: prefsOf(u),
});

// --- Failed sign-in throttle (in memory; resets when the server restarts) ---
const failures = new Map();
const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 10 * 60_000;
function tooManyFailures(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > FAIL_WINDOW_MS) return false;
  return f.count >= FAIL_LIMIT;
}
function noteFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > FAIL_WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else f.count++;
}

// --- Settings ---------------------------------------------------------------
const setting = (key) => get('SELECT value FROM system_settings WHERE key=?', key)?.value ?? '';
const setSetting = (key, value) =>
  run('INSERT INTO system_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);
/**
 * How people get an account. 'closed': only an administrator creates them. 'open': anyone signs up
 * with an email and password and is in straight away. 'verify': the same, but they must first
 * open a link sent to that address.
 */
const registrationMode = () => {
  const mode = setting('registration_mode');
  if (['closed', 'open', 'verify'].includes(mode)) return mode;
  // Before there was a choice, "on" meant with email confirmation.
  return setting('registration_enabled') === '1' ? 'verify' : 'closed';
};
/** Confirmation by email only works while email can be sent. */
const registrationOpen = () => registrationMode() === 'open' || (registrationMode() === 'verify' && mailerStatus().configured);

// Open sign-up has nothing else slowing down a script, so each address may make only a few accounts an hour.
const signups = new Map();
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60_000;
function tooManySignups(ip) {
  const recent = (signups.get(ip) || []).filter((t) => Date.now() - t < SIGNUP_WINDOW_MS);
  signups.set(ip, recent);
  return recent.length >= SIGNUP_LIMIT;
}
const userCount = () => get('SELECT COUNT(*) AS n FROM users').n;

/** Creates an active user with a workspace of their own. Call inside a transaction. */
function createUser({ email, name, password, isAdmin = false, canImport = false, mustChange = false, ownerId = null }) {
  const r = run(
    'INSERT INTO users (email, name, password_hash, is_admin, can_import, status, must_change_password) VALUES (?,?,?,?,?,?,?)',
    email, name, hashPassword(password), isAdmin ? 1 : 0, canImport ? 1 : 0, 'active', mustChange ? 1 : 0,
  );
  const userId = Number(r.lastInsertRowid);
  const workspace = ownerId ?? createWorkspace(`${name}'s workspace`);
  run("INSERT INTO memberships (user_id, owner_id, role) VALUES (?,?,'owner')", userId, workspace);
  return userId;
}

// A request relayed by a proxy also arrives from a local address, so a forwarded header rules it out.
const isLoopback = (req) =>
  !req.headers['x-forwarded-for'] && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

export function mountAuth(app) {
  // The system administrator is always an administrator, whatever was saved before.
  run('UPDATE users SET is_admin=1 WHERE lower(email)=?', SYSTEM_ADMIN_EMAIL);

  // Browsers attach the session cookie to cross-site requests in some cases. Refuse any
  // state-changing request whose Origin is another site.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try {
        host = new URL(origin).host;
      } catch {
        /* malformed: treated as foreign */
      }
      if (host !== req.headers.host) return res.status(403).json({ error: 'This request came from another site and was refused.' });
    }
    next();
  });

  app.get('/api/auth/status', (req, res) => {
    const user = currentUser(req);
    res.json({ setup_needed: userCount() === 0, registration_open: registrationOpen(), registration_mode: registrationOpen() ? registrationMode() : 'closed', user: user ? userOut(user) : null });
  });

  // First run: create the administrator, who takes over the data already on this install.
  app.post('/api/auth/setup', (req, res) => {
    if (userCount() > 0) return res.status(409).json({ error: 'Dime Coach is already set up. Sign in instead.' });
    // On a public server, anyone could reach this page first. Require a token there.
    const token = process.env.PP_SETUP_TOKEN;
    if (token ? str(req.body.setup_token) !== token : !isLoopback(req))
      return res.status(403).json({
        error: token ? 'The setup code is not right.' : 'Setup must be done from the computer running Dime Coach, or with a setup code.',
      });
    const email = normEmail(req.body.email);
    const name = str(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Enter your name.' });
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const problem = passwordProblem(req.body.password);
    if (problem) return res.status(400).json({ error: problem });
    const firstWorkspace = get('SELECT id FROM owners ORDER BY id LIMIT 1')?.id ?? null;
    const userId = tx(() => createUser({ email, name, password: str(req.body.password), isAdmin: true, canImport: true, ownerId: firstWorkspace }));
    startSession(req, res, userId);
    res.json({ user: userOut(get('SELECT * FROM users WHERE id=?', userId)) });
  });

  // Moving in from another copy of Dime Coach. Only possible while this site has no accounts, and
  // behind the same lock as first-run setup. The backup's accounts, teams and plans replace the
  // empty starting data, so people sign in afterwards with the passwords they already had.
  app.post('/api/auth/restore', (req, res) => {
    const refuse = (status, error) => {
      req.resume();
      res.status(status).json({ error });
    };
    if (userCount() > 0) return refuse(409, 'This site already has accounts, so a backup cannot be restored over it.');
    const token = process.env.PP_SETUP_TOKEN;
    if (token ? str(req.headers['x-setup-token']) !== token : !isLoopback(req))
      return refuse(403, token ? 'The setup code is not right.' : 'A restore must be done from the computer running Dime Coach, or with a setup code.');
    const MAX = 300 * 1024 * 1024;
    const file = path.join(path.dirname(dbPath), `restore-${crypto.randomUUID()}.db`);
    const out = fs.createWriteStream(file);
    let bytes = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX && !tooBig) {
        tooBig = true;
        req.unpipe(out);
        out.destroy();
        req.resume();
      }
    });
    req.pipe(out);
    const cleanup = () => fs.rm(file, { force: true }, () => {});
    req.on('aborted', cleanup);
    req.on('end', () => {
      if (tooBig) {
        cleanup();
        return res.status(413).json({ error: 'That backup is too large.' });
      }
      out.end(() => {
        try {
          const people = restoreFrom(file);
          res.json({ ok: true, accounts: people });
        } catch (e) {
          res.status(400).json({ error: e.restoreMessage || 'That file could not be restored. Choose a backup made by Dime Coach.' });
        } finally {
          cleanup();
        }
      });
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = normEmail(req.body.email);
    const key = `${req.ip}|${email}`;
    if (tooManyFailures(key)) return res.status(429).json({ error: 'Too many attempts. Wait ten minutes and try again.' });
    const user = get('SELECT * FROM users WHERE email=?', email);
    // The same message for a wrong email and a wrong password, so neither can be probed.
    if (!user || !verifyPassword(str(req.body.password), user.password_hash)) {
      noteFailure(key);
      return res.status(401).json({ error: 'That email and password do not match.' });
    }
    if (user.status === 'pending') return res.status(403).json({ error: 'Confirm your email address first. Check your inbox for the link.' });
    if (user.status !== 'active') return res.status(403).json({ error: 'This account has been turned off. Contact the administrator.' });
    failures.delete(key);
    startSession(req, res, user.id);
    res.json({ user: userOut(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) {
      run('DELETE FROM sessions WHERE token_hash=?', sha256(token));
      run('UPDATE logins SET ended_at=? WHERE token_hash=? AND ended_at IS NULL', new Date().toISOString(), sha256(token));
    }
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  // --- Registration. Closed unless an administrator opens it, with or without email confirmation. ---
  app.post('/api/auth/register', (req, res) => {
    if (!registrationOpen()) return res.status(403).json({ error: 'Registration is not open yet. Ask the administrator for an account.' });
    const email = normEmail(req.body.email);
    const name = str(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Enter your name.' });
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const problem = passwordProblem(req.body.password);
    if (problem) return res.status(400).json({ error: problem });

    const existing = get('SELECT id, status FROM users WHERE email=?', email);
    if (registrationMode() === 'open') {
      if (tooManySignups(req.ip)) return res.status(429).json({ error: 'Too many new accounts from here. Try again in an hour.' });
      // With no email to send, the only honest answer to a taken address is to say so.
      if (existing && existing.status !== 'pending') return res.status(409).json({ error: 'There is already an account with that email. Sign in instead.' });
      const userId = tx(() => {
        if (!existing) return createUser({ email, name, password: str(req.body.password) });
        // Someone who started under email confirmation and never finished: this completes it.
        run("UPDATE users SET name=?, password_hash=?, status='active', confirm_token_hash=NULL, confirm_expires_at=NULL WHERE id=?", name, hashPassword(str(req.body.password)), existing.id);
        run("INSERT INTO memberships (user_id, owner_id, role) VALUES (?,?,'owner')", existing.id, createWorkspace(`${name}'s workspace`));
        return existing.id;
      });
      signups.get(req.ip).push(Date.now());
      startSession(req, res, userId);
      return res.json({ ok: true, user: userOut(get('SELECT * FROM users WHERE id=?', userId)) });
    }
    // An address that already has a working account gets no new account and no hint that it exists.
    if (!existing || existing.status === 'pending') {
      const token = crypto.randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + CONFIRM_HOURS * 3600_000).toISOString();
      if (existing)
        run('UPDATE users SET name=?, password_hash=?, confirm_token_hash=?, confirm_expires_at=? WHERE id=?',
          name, hashPassword(str(req.body.password)), sha256(token), expires, existing.id);
      else
        run("INSERT INTO users (email, name, password_hash, status, confirm_token_hash, confirm_expires_at) VALUES (?,?,?,'pending',?,?)",
          email, name, hashPassword(str(req.body.password)), sha256(token), expires);
      const base = process.env.PP_PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
      sendMail({
        to: email,
        subject: 'Confirm your Dime Coach account',
        text: `Hi ${name},\n\nConfirm your email address to finish creating your Dime Coach account:\n\n${base}/confirm?token=${token}\n\nThe link works for ${CONFIRM_HOURS} hours. If you did not ask for an account, ignore this message.`,
      });
    }
    res.json({ ok: true });
  });

  app.post('/api/auth/confirm', (req, res) => {
    const token = str(req.body.token);
    const user = token ? get("SELECT * FROM users WHERE confirm_token_hash=? AND status='pending'", sha256(token)) : null;
    if (!user || user.confirm_expires_at < new Date().toISOString())
      return res.status(400).json({ error: 'This confirmation link is not valid or has expired. Register again to get a new one.' });
    tx(() => {
      run("UPDATE users SET status='active', confirm_token_hash=NULL, confirm_expires_at=NULL WHERE id=?", user.id);
      const workspace = createWorkspace(`${user.name}'s workspace`);
      run("INSERT INTO memberships (user_id, owner_id, role) VALUES (?,?,'owner')", user.id, workspace);
    });
    res.json({ ok: true });
  });

  // --- Everything below this line needs a signed-in user ---------------------
  app.use('/api', (req, res, next) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to continue.' });
    const membership = get('SELECT owner_id, role FROM memberships WHERE user_id=? ORDER BY owner_id LIMIT 1', user.id);
    if (!membership) return res.status(403).json({ error: 'This account has no workspace. Contact the administrator.' });
    req.user = user;
    req.ownerId = membership.owner_id;
    touchLogin(req, user.id);
    next();
  });

  app.post('/api/auth/password', (req, res) => {
    if (!verifyPassword(str(req.body.current), req.user.password_hash)) return res.status(400).json({ error: 'Your current password is not right.' });
    const problem = passwordProblem(req.body.next);
    if (problem) return res.status(400).json({ error: problem });
    if (str(req.body.next) === str(req.body.current)) return res.status(400).json({ error: 'Choose a password different from the current one.' });
    run('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', hashPassword(str(req.body.next)), req.user.id);
    // Sign out every other device, keep this one.
    endSessions(req.user.id, sha256(readCookie(req, COOKIE)));
    res.json({ user: userOut(get('SELECT * FROM users WHERE id=?', req.user.id)) });
  });

  // Display preferences follow the person, not the computer.
  app.put('/api/auth/prefs', (req, res) => {
    const prefs = prefsOf(req.user);
    if ('heat_color' in req.body) {
      if (req.body.heat_color === null) delete prefs.heat_color;
      else if (HEX.test(String(req.body.heat_color))) prefs.heat_color = String(req.body.heat_color).toLowerCase();
      else return res.status(400).json({ error: 'That is not a color.' });
    }
    if ('tour_done' in req.body) {
      if (req.body.tour_done === true) prefs.tour_done = true;
      else delete prefs.tour_done;
    }
    run('UPDATE users SET prefs_json=? WHERE id=?', JSON.stringify(prefs), req.user.id);
    res.json({ user: userOut(get('SELECT * FROM users WHERE id=?', req.user.id)) });
  });

  // --- System administration -------------------------------------------------
  const admin = (req, res, next) => (req.user.is_admin ? next() : res.status(403).json({ error: 'Only the administrator can do this.' }));
  const adminUserOut = (u) => ({
    ...userOut(u), status: u.status, created_at: u.created_at, last_login_at: u.last_login_at,
    teams: get('SELECT COUNT(*) AS n FROM teams t JOIN memberships m ON m.owner_id=t.owner_id WHERE m.user_id=?', u.id).n,
  });
  const settingsOut = () => ({
    registration_mode: registrationMode(),
    registration_enabled: registrationMode() !== 'closed',
    registration_open: registrationOpen(),
    mailer: mailerStatus(),
    unsent_emails: get('SELECT COUNT(*) AS n FROM outbox WHERE sent_at IS NULL').n,
  });

  app.get('/api/admin/users', admin, (_req, res) => res.json(all('SELECT * FROM users ORDER BY created_at, id').map(adminUserOut)));

  app.post('/api/admin/users', admin, (req, res) => {
    const email = normEmail(req.body.email);
    const name = str(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Enter a name.' });
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const problem = passwordProblem(req.body.password);
    if (problem) return res.status(400).json({ error: problem });
    if (get('SELECT id FROM users WHERE email=?', email)) return res.status(409).json({ error: 'Someone already has an account with that email.' });
    // The administrator picks a starting password; the person must replace it at first sign-in.
    const userId = tx(() => createUser({ email, name, password: str(req.body.password), canImport: !!req.body.can_import, mustChange: true }));
    res.json(adminUserOut(get('SELECT * FROM users WHERE id=?', userId)));
  });

  app.put('/api/admin/users/:id', admin, (req, res) => {
    const target = get('SELECT * FROM users WHERE id=?', Number(req.params.id));
    if (!target) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const self = target.id === req.user.id;
    if (self && (b.status === 'disabled' || b.is_admin === false))
      return res.status(400).json({ error: 'You cannot turn off or demote your own account.' });
    // The system administrator's account is out of reach of everyone else, and only they hand out the administrator role.
    const system = isSystemAdmin(req.user);
    if (!system && target.email.toLowerCase() === SYSTEM_ADMIN_EMAIL) return res.status(403).json({ error: 'Only the system administrator can change this account.' });
    if (!system && typeof b.is_admin === 'boolean') return res.status(403).json({ error: 'Only the system administrator can change who is an administrator.' });
    if (target.email.toLowerCase() === SYSTEM_ADMIN_EMAIL && (b.is_admin === false || b.status === 'disabled'))
      return res.status(400).json({ error: 'The system administrator account cannot be turned off or demoted.' });
    if (b.password !== undefined) {
      const problem = passwordProblem(b.password);
      if (problem) return res.status(400).json({ error: problem });
    }
    tx(() => {
      if (typeof b.can_import === 'boolean') run('UPDATE users SET can_import=? WHERE id=?', b.can_import ? 1 : 0, target.id);
      if (typeof b.is_admin === 'boolean') run('UPDATE users SET is_admin=? WHERE id=?', b.is_admin ? 1 : 0, target.id);
      if ((b.status === 'active' || b.status === 'disabled') && target.status !== 'pending') {
        run('UPDATE users SET status=? WHERE id=?', b.status, target.id);
        if (b.status === 'disabled') endSessions(target.id);
      }
      if (b.password !== undefined) {
        run('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?', hashPassword(str(b.password)), target.id);
        endSessions(target.id);
      }
    });
    res.json(adminUserOut(get('SELECT * FROM users WHERE id=?', target.id)));
  });

  // --- The system administrator: everyone's accounts and upload space -------------
  const systemOnly = (req, res, next) => (isSystemAdmin(req.user) ? next() : res.status(403).json({ error: 'Only the system administrator can do this.' }));
  const systemUserOut = (u) => {
    const owner = get("SELECT owner_id FROM memberships WHERE user_id=? ORDER BY role='owner' DESC, owner_id LIMIT 1", u.id);
    const used = owner ? usageOf(owner.owner_id) : { bytes: 0, files: 0 };
    const seen = get('SELECT COUNT(*) AS n, COALESCE(SUM(active_seconds), 0) AS secs, MAX(last_seen_at) AS last FROM logins WHERE user_id=?', u.id);
    return {
      ...adminUserOut(u),
      sign_ins: seen.n, active_seconds: seen.secs, last_seen_at: seen.last,
      used_bytes: used.bytes, files: used.files,
      /** This person's own cap, or null when the default applies. */
      upload_cap_mb: u.upload_cap_mb === null || u.upload_cap_mb === undefined ? null : Number(u.upload_cap_mb),
      cap_mb: capMbFor(u),
    };
  };
  const systemOut = () => {
    const users = all('SELECT * FROM users ORDER BY created_at, id').map(systemUserOut);
    const ago = (ms) => new Date(Date.now() - ms).toISOString();
    return {
      default_cap_mb: defaultCapMb(), max_cap_mb: MAX_CAP_MB, total_bytes: get('SELECT COALESCE(SUM(bytes), 0) AS n FROM images').n, users,
      /** People who did something in the last few minutes. */
      online_now: get('SELECT COUNT(DISTINCT user_id) AS n FROM logins WHERE ended_at IS NULL AND last_seen_at > ?', ago(IDLE_SECONDS * 1000)).n,
      sign_ins_7d: get('SELECT COUNT(*) AS n FROM logins WHERE started_at > ?', ago(7 * 86400_000)).n,
      active_people_7d: get('SELECT COUNT(DISTINCT user_id) AS n FROM logins WHERE last_seen_at > ?', ago(7 * 86400_000)).n,
      new_accounts_30d: users.filter((u) => new Date(u.created_at.includes('T') ? u.created_at : u.created_at.replace(' ', 'T') + 'Z').getTime() > Date.now() - 30 * 86400_000).length,
    };
  };
  // One person in detail: every sign-in, how long each lasted, and what they have built.
  app.get('/api/system/users/:id/activity', systemOnly, (req, res) => {
    const u = get('SELECT * FROM users WHERE id=?', Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'Not found' });
    const now = new Date().toISOString();
    const logins = all(
      `SELECT l.*, EXISTS (SELECT 1 FROM sessions s WHERE s.token_hash=l.token_hash AND s.expires_at > ?) AS live
         FROM logins l WHERE l.user_id=? ORDER BY l.started_at DESC LIMIT 100`,
      now, u.id,
    ).map((l) => ({
      id: l.id, started_at: l.started_at, last_seen_at: l.last_seen_at, ended_at: l.ended_at, active_seconds: l.active_seconds,
      ip: l.ip, device: deviceOf(l.agent),
      /** 'open' while the sign-in still works, 'signed_out' when it was ended, 'expired' when it ran out. */
      state: l.ended_at ? 'signed_out' : l.live ? 'open' : 'expired',
    }));
    const owner = get("SELECT owner_id FROM memberships WHERE user_id=? ORDER BY role='owner' DESC, owner_id LIMIT 1", u.id)?.owner_id ?? 0;
    const count = (sql, ...args) => get(sql, ...args).n;
    const totals = get('SELECT COUNT(*) AS n, COALESCE(SUM(active_seconds), 0) AS secs, MAX(active_seconds) AS longest FROM logins WHERE user_id=?', u.id);
    res.json({
      user: systemUserOut(u),
      logins,
      sign_ins: totals.n, active_seconds: totals.secs, longest_seconds: totals.longest || 0,
      sign_ins_30d: count('SELECT COUNT(*) AS n FROM logins WHERE user_id=? AND started_at > ?', u.id, new Date(Date.now() - 30 * 86400_000).toISOString()),
      days_active_30d: count('SELECT COUNT(DISTINCT substr(last_seen_at, 1, 10)) AS n FROM logins WHERE user_id=? AND last_seen_at > ?', u.id, new Date(Date.now() - 30 * 86400_000).toISOString()),
      built: {
        teams: count('SELECT COUNT(*) AS n FROM teams WHERE owner_id=?', owner),
        practices: count("SELECT COUNT(*) AS n FROM plans WHERE owner_id=? AND kind='practice' AND is_template=0", owner),
        homework: count("SELECT COUNT(*) AS n FROM plans WHERE owner_id=? AND kind='homework' AND is_template=0", owner),
        drills: count('SELECT COUNT(*) AS n FROM drills WHERE owner_id=?', owner),
        plays: count('SELECT COUNT(*) AS n FROM plays WHERE owner_id=?', owner),
        communities: count("SELECT COUNT(*) AS n FROM community_members WHERE user_id=? AND status='active'", u.id),
        shared_teams: count('SELECT COUNT(*) AS n FROM team_staff WHERE user_id=?', u.id),
        last_plan_edit: get('SELECT MAX(updated_at) AS t FROM plans WHERE owner_id=?', owner).t,
      },
    });
  });
  app.get('/api/system', systemOnly, (_req, res) => res.json(systemOut()));
  app.put('/api/system/settings', systemOnly, (req, res) => {
    const cap = parseCapMb(req.body.default_cap_mb);
    if (cap === undefined || cap === null) return res.status(400).json({ error: 'Enter the default upload space in MB, 0 or more.' });
    setSetting('default_upload_cap_mb', String(cap));
    res.json(systemOut());
  });
  app.put('/api/system/users/:id', systemOnly, (req, res) => {
    const target = get('SELECT * FROM users WHERE id=?', Number(req.params.id));
    if (!target) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    if ('upload_cap_mb' in b) {
      const cap = parseCapMb(b.upload_cap_mb);
      if (cap === undefined) return res.status(400).json({ error: 'Enter upload space in MB, 0 or more. Leave it empty to use the default.' });
      run('UPDATE users SET upload_cap_mb=? WHERE id=?', cap, target.id);
    }
    if (typeof b.is_admin === 'boolean') {
      if (target.email.toLowerCase() === SYSTEM_ADMIN_EMAIL && !b.is_admin) return res.status(400).json({ error: 'The system administrator account cannot be demoted.' });
      run('UPDATE users SET is_admin=? WHERE id=?', b.is_admin ? 1 : 0, target.id);
    }
    // A new password for someone. They are signed out everywhere. Unless told otherwise they must
    // replace it with one of their own at their next sign-in.
    if (b.password !== undefined) {
      const problem = passwordProblem(b.password);
      if (problem) return res.status(400).json({ error: problem });
      if (target.id === req.user.id) return res.status(400).json({ error: 'Change your own password under your account.' });
      run('UPDATE users SET password_hash=?, must_change_password=? WHERE id=?', hashPassword(str(b.password)), b.must_change === false ? 0 : 1, target.id);
      endSessions(target.id);
    }
    res.json(systemOut());
  });

  // --- Deleting an account for good ---
  /** The workspaces that belong to this person alone. Their contents go when the account goes. */
  const ownWorkspaces = (userId) =>
    all(
      `SELECT m.owner_id AS id FROM memberships m WHERE m.user_id=? AND m.role='owner'
         AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.owner_id=m.owner_id AND o.user_id<>m.user_id)`,
      userId,
    ).map((r) => r.id);
  /** What deleting an account would remove, counted, so it can be shown before anything happens. */
  const deletionOf = (u) => {
    const owners = ownWorkspaces(u.id);
    const inOwners = owners.length ? `owner_id IN (${owners.join(',')})` : '0';
    const n = (sql, ...args) => get(sql, ...args).n;
    const made = all('SELECT id, name FROM communities WHERE created_by=?', u.id).map((c) => ({
      ...c,
      others: n("SELECT COUNT(*) AS n FROM community_members WHERE community_id=? AND user_id<>? AND status='active'", c.id, u.id),
    }));
    return {
      teams: n(`SELECT COUNT(*) AS n FROM teams WHERE ${inOwners}`),
      plans: n(`SELECT COUNT(*) AS n FROM plans WHERE ${inOwners}`),
      drills: n(`SELECT COUNT(*) AS n FROM drills WHERE ${inOwners}`),
      plays: n(`SELECT COUNT(*) AS n FROM plays WHERE ${inOwners}`),
      files: n(`SELECT COUNT(*) AS n FROM images WHERE ${inOwners}`),
      /** People helping on this person's teams, who lose that access. */
      helpers: n(`SELECT COUNT(DISTINCT s.user_id) AS n FROM team_staff s JOIN teams t ON t.id=s.team_id WHERE t.${inOwners}`),
      /** Communities they started that have other members: these are handed to another member. */
      communities_passed_on: made.filter((c) => c.others > 0).map((c) => c.name),
      /** Communities they started with nobody else in them: these are deleted. */
      communities_deleted: made.filter((c) => c.others === 0).map((c) => c.name),
    };
  };
  const deletable = (req, res) => {
    const target = get('SELECT * FROM users WHERE id=?', Number(req.params.id));
    if (!target) return void res.status(404).json({ error: 'Not found' });
    if (target.id === req.user.id) return void res.status(400).json({ error: 'You cannot delete your own account.' });
    if (target.email.toLowerCase() === SYSTEM_ADMIN_EMAIL) return void res.status(400).json({ error: 'The system administrator account cannot be deleted.' });
    return target;
  };
  app.get('/api/system/users/:id/deletion', systemOnly, (req, res) => {
    const target = deletable(req, res);
    if (target) res.json(deletionOf(target));
  });
  // The request must repeat the person's email address, so a stray or replayed call cannot delete anyone.
  app.delete('/api/system/users/:id', systemOnly, (req, res) => {
    const target = deletable(req, res);
    if (!target) return;
    if (normEmail(req.body?.confirm_email) !== target.email.toLowerCase()) return res.status(400).json({ error: 'Type the email address of the account exactly to confirm.' });
    const owners = ownWorkspaces(target.id);
    const files = owners.length ? all(`SELECT filename FROM images WHERE owner_id IN (${owners.join(',')})`).map((f) => f.filename) : [];
    const ownerTables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .map((t) => t.name)
      .filter((t) => t !== 'owners' && all(`PRAGMA table_info("${t}")`).some((c) => c.name === 'owner_id'));
    tx(() => {
      // Communities they started: pass each on to the longest-standing other member, admins first. Empty ones go.
      for (const c of all('SELECT id FROM communities WHERE created_by=?', target.id)) {
        const heir = get(
          "SELECT user_id FROM community_members WHERE community_id=? AND user_id<>? AND status='active' ORDER BY role='admin' DESC, created_at, user_id LIMIT 1",
          c.id, target.id,
        );
        if (!heir) run('DELETE FROM communities WHERE id=?', c.id);
        else {
          run('UPDATE communities SET created_by=? WHERE id=?', heir.user_id, c.id);
          run("UPDATE community_members SET role='creator' WHERE community_id=? AND user_id=?", c.id, heir.user_id);
        }
      }
      for (const owner of owners) {
        // Children before the things they point at. Rows hanging off these (plan items, rosters, helpers) go with them.
        for (const t of ['community_shares', 'resources', 'plans', 'events', 'players', 'teams', 'drills', 'plays', 'tags', 'images', 'settings', 'sports'])
          if (ownerTables.includes(t)) run(`DELETE FROM "${t}" WHERE owner_id=?`, owner);
        // Anything added since that also belongs to a workspace.
        for (const t of ownerTables) run(`DELETE FROM "${t}" WHERE owner_id=?`, owner);
        run('DELETE FROM owners WHERE id=?', owner);
      }
      // Sign-ins, community memberships and posts, and help given on other people's teams go with the account.
      run('DELETE FROM users WHERE id=?', target.id);
    });
    for (const f of files) fs.rm(path.join(path.dirname(dbPath), 'uploads', path.basename(f)), { force: true }, () => {});
    res.json(systemOut());
  });

  // Everything in one file: accounts, teams, practices, plays, communities. Uploaded pictures and
  // videos are files on disk and are not part of it.
  app.get('/api/system/backup', systemOnly, (_req, res) => {
    const file = path.join(path.dirname(dbPath), `backup-${crypto.randomUUID()}.db`);
    db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    res.download(file, `dimecoach-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(file, { force: true }, () => {}));
  });

  app.get('/api/admin/settings', admin, (_req, res) => res.json(settingsOut()));
  // Sends a message to the administrator's own address, to prove the email service is connected.
  app.post('/api/admin/test-email', admin, async (req, res) => {
    const r = await sendMail({
      to: req.user.email,
      subject: 'Dime Coach test email',
      text: `Hi ${req.user.name},\n\nThis is a test from Dime Coach. If you are reading it, email is connected and working.`,
    });
    if (!r.ok) return res.status(502).json({ error: `The test email was not sent. ${r.error}` });
    res.json({ ok: true, to: req.user.email });
  });
  app.put('/api/admin/settings', admin, (req, res) => {
    const mode = typeof req.body.registration_enabled === 'boolean' ? (req.body.registration_enabled ? 'verify' : 'closed') : req.body.registration_mode;
    if (mode !== undefined) {
      if (!['closed', 'open', 'verify'].includes(mode)) return res.status(400).json({ error: 'Choose how people sign up.' });
      if (mode === 'verify' && !mailerStatus().configured)
        return res.status(400).json({ error: 'Email confirmation needs email, and no email service is connected yet.' });
      setSetting('registration_mode', mode);
    }
    res.json(settingsOut());
  });
}

/**
 * Replaces this site's data with a backup file's. Tables and columns are matched by name, so a
 * backup from a slightly older version still fits. Returns how many accounts came across.
 */
function restoreFrom(file) {
  const bad = (message) => Object.assign(new Error(message), { restoreMessage: message });
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3\u0000') throw bad('That file is not a Dime Coach backup.');
  db.exec(`ATTACH DATABASE '${file.replaceAll("'", "''")}' AS src`);
  try {
    const srcTables = new Set(all("SELECT name FROM src.sqlite_master WHERE type='table'").map((r) => r.name));
    if (!srcTables.has('users') || !srcTables.has('owners') || get("SELECT COUNT(*) AS n FROM src.users WHERE status='active'").n === 0)
      throw bad('That file is not a Dime Coach backup, or it has no accounts in it.');
    // Rows arrive table by table, so links between tables are only checked once everything is in.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      const tables = all("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name);
      for (const t of tables) {
        db.exec(`DELETE FROM main."${t}"`);
        // Sign-ins do not carry over: everyone signs in again on the new site.
        if (!srcTables.has(t) || t === 'sessions') continue;
        const theirs = new Set(all(`PRAGMA src.table_info("${t}")`).map((c) => c.name));
        const cols = all(`PRAGMA main.table_info("${t}")`).map((c) => c.name).filter((c) => theirs.has(c)).map((c) => `"${c}"`).join(', ');
        if (cols) db.exec(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM src."${t}"`);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  } finally {
    db.exec('DETACH DATABASE src');
  }
  run('UPDATE users SET is_admin=1 WHERE lower(email)=?', SYSTEM_ADMIN_EMAIL);
  return get('SELECT COUNT(*) AS n FROM users').n;
}

/** Guard for the plan import routes: the administrator grants this per user. */
export const requireImport = (req, res, next) =>
  req.user?.can_import ? next() : res.status(403).json({ error: 'Plan import is not turned on for your account. Ask the administrator.' });
