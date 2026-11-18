// Automatic emails: rules the system administrator writes, of the form "when someone has been in
// this state for more than N days, send them this email".
//
// A rule starts switched off. While it is on, the server looks every half hour for the people it
// applies to and sends each of them the email once. Someone gets it a second time only if they
// were active again after the first one and then fell back into the same state.
import { all, db, get, run } from './db.js';
import { freshInviteLink, isSystemAdmin } from './auth.js';
import { htmlFor, mailerStatus, sendMail } from './mailer.js';

db.exec(`
CREATE TABLE IF NOT EXISTS mail_rules (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, trigger TEXT NOT NULL, days INTEGER NOT NULL DEFAULT 3,
  subject TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mail_rule_sends (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES mail_rules(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_rule_sends ON mail_rule_sends(rule_id, user_id);
`);

const DAY = 86400_000;
const EVERY_MINUTES = 30;
/** The most emails one look may send, across every rule: a mistake in a rule cannot flood anyone. */
const MAX_PER_RUN = 100;
const str = (v, max) => String(v ?? '').trim().slice(0, max);
/** Times are kept two ways: "2026-11-18 14:03:11" (UTC, by the database) and ISO. */
const asTime = (s) => (s ? new Date(/T/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`).getTime() : 0);
const lastActive = (u) => Math.max(asTime(u.last_action_at), asTime(u.last_login_at));

/**
 * The states a rule can watch for. `since` is when the person entered the state, or 0 when they
 * are not in it. The words are the starting point for a new rule and can all be changed.
 */
const TRIGGERS = [
  {
    id: 'invited',
    label: 'Invited, and has not finished setting up',
    since: (u) => (u.status === 'invited' ? asTime(u.invited_at) || asTime(u.created_at) : 0),
    days: 3,
    subject: 'Your Dime Coach invitation is waiting',
    body: 'Hi {first_name},\n\nYou were invited to Dime Coach {days} days ago, and your account is still waiting for you. It takes a minute: choose a password and you are in.\n\nFinish setting up your account:\n\n{link}\n\nIf you were not expecting this, ignore this message and nothing will happen.',
  },
  {
    id: 'inactive',
    label: 'Has an account, and has not been active',
    since: (u) => (u.status === 'active' ? lastActive(u) || asTime(u.created_at) : 0),
    days: 14,
    subject: 'Your practices are waiting on Dime Coach',
    body: 'Hi {first_name},\n\nIt has been {days} days since you were last on Dime Coach. Your drills, plays and practices are right where you left them.\n\nOpen Dime Coach:\n\n{link}',
  },
  {
    id: 'no_practice',
    label: 'Has an account, and has not planned a practice',
    since: (u) =>
      u.status === 'active' && !get('SELECT 1 AS x FROM plans p JOIN memberships m ON m.owner_id=p.owner_id WHERE m.user_id=? AND p.is_template=0 LIMIT 1', u.id) ? asTime(u.created_at) : 0,
    days: 3,
    subject: 'Plan your first practice on Dime Coach',
    body: 'Hi {first_name},\n\nYou joined Dime Coach {days} days ago and have not planned a practice yet. Pick a date, drop in a few drills, and you have a plan you can print or pull up at the gym.\n\nPlan a practice:\n\n{link}',
  },
];
const triggerOf = (id) => TRIGGERS.find((t) => t.id === id);

/** The address of the site, for links. Known from the settings, or else from the last request that came in. */
let seenBase = '';
const siteBase = () => String(process.env.PP_PUBLIC_URL || seenBase).replace(/\/+$/, '');

/** The people a rule applies to right now and has not yet written to, with how many days each has been in the state. */
function matchesOf(rule) {
  const trigger = triggerOf(rule.trigger);
  if (!trigger) return [];
  const sent = new Map(all('SELECT user_id, MAX(sent_at) AS at FROM mail_rule_sends WHERE rule_id=? GROUP BY user_id', rule.id ?? 0).map((s) => [s.user_id, asTime(s.at)]));
  const now = Date.now();
  const out = [];
  for (const u of all("SELECT * FROM users WHERE status IN ('active','invited') ORDER BY name")) {
    const since = trigger.since(u);
    if (!since || now - since < rule.days * DAY) continue;
    // Written to before: again only if they came back after that, and have gone quiet since.
    if (sent.has(u.id) && lastActive(u) <= sent.get(u.id)) continue;
    out.push({ user: u, days: Math.floor((now - since) / DAY) });
  }
  return out;
}

/** The subject and the words for one person. `link` is where the button leads. */
function fill(rule, user, days, link) {
  const first = String(user.first_name || '').trim() || String(user.name || '').trim().split(/\s+/)[0] || 'there';
  const put = (s) =>
    String(s)
      .replace(/\{first_name\}/g, first)
      .replace(/\{name\}/g, user.name || first)
      .replace(/\{days\}/g, String(days))
      .replace(/\{link\}/g, link);
  return { subject: put(rule.subject).replace(/\s+/g, ' ').trim(), text: put(rule.body).trim() };
}

let running = false;
/** One look at every rule that is on. Resolves to how many emails went out. */
export async function runMailRules() {
  if (running || !mailerStatus().configured) return 0;
  const base = siteBase();
  // Without the site's address there is nothing to put behind the button.
  if (!base) return 0;
  running = true;
  let sentCount = 0;
  try {
    for (const rule of all('SELECT * FROM mail_rules WHERE enabled=1 ORDER BY id')) {
      for (const { user, days } of matchesOf(rule)) {
        if (sentCount >= MAX_PER_RUN) return sentCount;
        // Someone still setting up gets a link that finishes their account. It is a new one each time, and is not written down.
        const invite = user.status === 'invited' ? freshInviteLink(user, base) : null;
        const { subject, text } = fill(rule, user, days, invite ? invite.link : `${base}/`);
        const r = await sendMail({ to: user.email, subject, text, secret: invite ? invite.token : '', automatic: true });
        // Written down either way, so one address that refuses mail is not tried every half hour.
        run('INSERT INTO mail_rule_sends (rule_id, user_id, sent_at) VALUES (?,?,?)', rule.id, user.id, new Date().toISOString());
        if (r.ok) sentCount++;
      }
    }
  } finally {
    running = false;
  }
  return sentCount;
}

const ruleOut = (r) => {
  const stats = get('SELECT COUNT(*) AS n, MAX(sent_at) AS last FROM mail_rule_sends WHERE rule_id=?', r.id);
  const waiting = matchesOf(r);
  return {
    id: r.id,
    name: r.name,
    trigger: r.trigger,
    days: r.days,
    subject: r.subject,
    body: r.body,
    enabled: !!r.enabled,
    sent: stats.n,
    last_sent_at: stats.last || null,
    waiting: waiting.length,
  };
};
const listOut = () => ({
  rules: all('SELECT * FROM mail_rules ORDER BY id').map(ruleOut),
  triggers: TRIGGERS.map((t) => ({ id: t.id, label: t.label, days: t.days, subject: t.subject, body: t.body })),
  every_minutes: EVERY_MINUTES,
  can_send: mailerStatus().configured,
});

/** What was sent in, checked. Returns { error } or the fields of a rule. */
function clean(body) {
  const trigger = triggerOf(body.trigger);
  if (!trigger) return { error: 'Choose when the email should go out.' };
  const days = Math.round(Number(body.days));
  if (!(days >= 1 && days <= 365)) return { error: 'Enter a number of days from 1 to 365.' };
  const subject = str(body.subject, 150);
  const text = String(body.body ?? '').slice(0, 5000).trim();
  if (!subject) return { error: 'Give the email a subject.' };
  if (!text) return { error: 'Write the email.' };
  return { name: str(body.name, 80) || trigger.label, trigger: trigger.id, days, subject, body: text };
}

export function mountMailRules(app) {
  const admin = (req, res, next) => (isSystemAdmin(req.user) ? next() : res.status(403).json({ error: 'Only the system administrator can do this.' }));
  app.use('/api', (req, _res, next) => {
    if (req.headers.host) seenBase = `${req.protocol}://${req.headers.host}`;
    next();
  });

  app.get('/api/admin/mail-rules', admin, (_req, res) => res.json(listOut()));
  app.post('/api/admin/mail-rules', admin, (req, res) => {
    const c = clean(req.body);
    if (c.error) return res.status(400).json({ error: c.error });
    // Always off to begin with: nothing goes out until it has been looked over and switched on.
    run('INSERT INTO mail_rules (name, trigger, days, subject, body, enabled) VALUES (?,?,?,?,?,0)', c.name, c.trigger, c.days, c.subject, c.body);
    res.json(listOut());
  });
  // How the email would look, written to the administrator, and who would get it now.
  app.post('/api/admin/mail-rules/preview', admin, (req, res) => {
    const c = clean(req.body);
    if (c.error) return res.status(400).json({ error: c.error });
    const existing = get('SELECT id FROM mail_rules WHERE id=?', Number(req.body.id) || 0);
    const waiting = matchesOf({ ...c, id: existing?.id ?? 0 });
    const { subject, text } = fill(c, req.user, c.days, `${siteBase() || `${req.protocol}://${req.headers.host}`}/`);
    res.json({ subject, html: htmlFor(text, subject), waiting: waiting.length, people: waiting.slice(0, 30).map((w) => ({ name: w.user.name, email: w.user.email, days: w.days })) });
  });
  app.post('/api/admin/mail-rules/run', admin, async (_req, res) => {
    if (!mailerStatus().configured) return res.status(400).json({ error: 'No email service is connected, so nothing can be sent.' });
    res.json({ sent: await runMailRules(), ...listOut() });
  });
  app.put('/api/admin/mail-rules/:id', admin, (req, res) => {
    const r = get('SELECT * FROM mail_rules WHERE id=?', Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'Not found' });
    // Switching it on or off is its own small change. Anything else is the whole rule.
    if (typeof req.body.enabled === 'boolean' && req.body.subject === undefined) {
      run('UPDATE mail_rules SET enabled=? WHERE id=?', req.body.enabled ? 1 : 0, r.id);
      return res.json(listOut());
    }
    const c = clean(req.body);
    if (c.error) return res.status(400).json({ error: c.error });
    run('UPDATE mail_rules SET name=?, trigger=?, days=?, subject=?, body=? WHERE id=?', c.name, c.trigger, c.days, c.subject, c.body, r.id);
    res.json(listOut());
  });
  app.post('/api/admin/mail-rules/:id/test', admin, async (req, res) => {
    const r = get('SELECT * FROM mail_rules WHERE id=?', Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'Not found' });
    const { subject, text } = fill(r, req.user, r.days, `${siteBase()}/`);
    const sent = await sendMail({ to: req.user.email, subject: `[Test] ${subject}`, text });
    if (!sent.ok) return res.status(502).json({ error: `The test was not sent. ${sent.error}` });
    res.json({ ok: true, to: req.user.email });
  });
  app.delete('/api/admin/mail-rules/:id', admin, (req, res) => {
    run('DELETE FROM mail_rules WHERE id=?', Number(req.params.id));
    res.json(listOut());
  });

  // The look itself: a minute after starting, then every half hour. It never keeps the server from stopping.
  const look = () => runMailRules().catch((e) => console.error('Automatic emails stopped:', e.message));
  setTimeout(look, 60_000).unref();
  setInterval(look, EVERY_MINUTES * 60_000).unref();
}
