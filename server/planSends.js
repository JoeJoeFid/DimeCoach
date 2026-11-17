// Sending a practice to other coaches, and the link anyone can open.
//
// A coach picks people (coaches on the same team, members of their communities, or any email
// address). Each gets an email, and a message inside Dime Coach when they have an account, with a
// link of their own. The link opens the practice for reading without signing in. It shows what a
// community share shows: no coach-only notes, no player notes, no uploaded files. A coach who is
// signed in can add a copy to one of their own teams. Removing a link stops it working.
import crypto from 'node:crypto';
import { all, db, get, run, tx } from './db.js';
import { copyPlan, planView } from './communities.js';
import { publicBase } from './invites.js';
import { mailerStatus, sendMail } from './mailer.js';
import { notify } from './notices.js';

db.exec(`
CREATE TABLE IF NOT EXISTS plan_sends (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  to_email TEXT DEFAULT '',                       -- both empty: the link for anyone
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS plan_sends_plan ON plan_sends(plan_id);
`);

const str = (v, max = 200) => String(v ?? '').slice(0, max);
const newToken = () => crypto.randomBytes(18).toString('base64url');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_AT_ONCE = 20;

// Each person may send only so many an hour, so the site cannot be used to send junk.
const sent = new Map();
const SEND_LIMIT = 40;
const HOUR_MS = 60 * 60_000;
const sentLately = (userId) => {
  const recent = (sent.get(userId) || []).filter((t) => Date.now() - t < HOUR_MS);
  sent.set(userId, recent);
  return recent.length;
};
const noteSend = (userId) => sent.set(userId, [...(sent.get(userId) || []), Date.now()]);

const nounOf = (plan) => (plan.kind === 'homework' ? 'homework sheet' : plan.is_game ? 'game plan' : 'practice plan');
const titleOf = (plan) => plan.title || (plan.kind === 'homework' ? 'Homework' : plan.is_game ? 'Game plan' : 'Practice');
const fmtDate = (iso) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? new Date(`${iso}T12:00:00`) : null;
  return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '';
};

/** Who the caller can pick: the other coaches of the plan's team, then the members of the caller's communities. Each person once. */
function peopleFor(req, plan) {
  const seen = new Set([req.user.id]);
  const out = [];
  const add = (rows, where) => {
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: r.id, name: r.name, where });
    }
  };
  add(
    [
      ...all("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.owner_id=? AND m.role='owner'", plan.owner_id),
      ...all('SELECT u.id, u.name FROM team_staff s JOIN users u ON u.id=s.user_id WHERE s.team_id=? ORDER BY u.name COLLATE NOCASE', plan.team_id),
    ],
    'On this team',
  );
  const mine = all("SELECT c.id, c.name FROM communities c JOIN community_members cm ON cm.community_id=c.id WHERE cm.user_id=? AND cm.status='active' ORDER BY c.name COLLATE NOCASE", req.user.id);
  for (const c of mine)
    add(all("SELECT u.id, u.name FROM community_members cm JOIN users u ON u.id=cm.user_id WHERE cm.community_id=? AND cm.status='active' ORDER BY u.name COLLATE NOCASE", c.id), c.name);
  return out;
}

const stateOf = (req, plan) => {
  const rows = all(
    'SELECT s.id, s.token, s.to_user_id, s.to_email, s.created_at, u.name FROM plan_sends s LEFT JOIN users u ON u.id=s.to_user_id WHERE s.plan_id=? ORDER BY s.id DESC',
    plan.id,
  );
  const open = rows.find((r) => !r.to_user_id && !r.to_email);
  return {
    mail: mailerStatus().configured,
    people: peopleFor(req, plan),
    // An address is only shown back when the sender typed it. People picked from a list are shown by name.
    sent: rows.filter((r) => r.to_user_id || r.to_email).map((r) => ({ id: r.id, to: r.to_email || r.name || 'A coach', created_at: r.created_at })),
    link: open ? { id: open.id, url: `${publicBase(req)}/shared/${open.token}` } : null,
  };
};

export function mountPlanSendsPublic(app) {
  /** The practice behind a link, for reading. */
  app.get('/api/public/plans/:token', (req, res) => {
    const s = get('SELECT * FROM plan_sends WHERE token=?', str(req.params.token, 80));
    const plan = s && get('SELECT * FROM plans WHERE id=?', s.plan_id);
    if (!plan) return res.status(404).json({ error: 'This link no longer works. The coach who sent it may have stopped sharing, or deleted the practice.' });
    const team = get('SELECT t.name, (SELECT name FROM sports WHERE id=t.sport_id) AS sport FROM teams t WHERE t.id=?', plan.team_id);
    res.json({
      title: titleOf(plan), noun: nounOf(plan), by: get('SELECT name FROM users WHERE id=?', s.from_user)?.name || 'A coach',
      team: team?.name || '', sport: team?.sport || '', date: plan.kind === 'homework' ? '' : plan.date, note: s.note || '',
      content: planView(plan),
    });
  });
}

export function mountPlanSends(app) {
  const ownPlan = (req, res) => {
    const plan = get('SELECT * FROM plans WHERE id=? AND owner_id=? AND is_template=0', Number(req.params.id), req.ownerId);
    if (!plan) res.status(404).json({ error: 'Not found' });
    return plan;
  };

  app.get('/api/plans/:id/sends', (req, res) => {
    const plan = ownPlan(req, res);
    if (plan) res.json(stateOf(req, plan));
  });

  /** Sends the practice to the people picked and the addresses typed. */
  app.post('/api/plans/:id/sends', async (req, res) => {
    const plan = ownPlan(req, res);
    if (!plan) return;
    const allowed = new Map(peopleFor(req, plan).map((p) => [p.id, p]));
    const ids = [...new Set((Array.isArray(req.body.user_ids) ? req.body.user_ids : []).map(Number))].filter((id) => allowed.has(id));
    const typed = [...new Set((Array.isArray(req.body.emails) ? req.body.emails : []).map((e) => str(e, 200).trim().toLowerCase()).filter(Boolean))];
    const bad = typed.filter((e) => !EMAIL.test(e));
    if (bad.length) return res.status(400).json({ error: `${bad[0]} does not look like an email address.` });
    const mail = mailerStatus().configured;
    if (typed.length && !mail) return res.status(400).json({ error: 'Email is not set up on this site, so a practice can only be sent to coaches picked from the list. They get a message in Dime Coach.' });

    // Everyone it goes to, each once: someone typed by address who has an account counts as that person.
    const to = new Map();
    for (const id of ids) {
      const u = get('SELECT id, name, email FROM users WHERE id=?', id);
      if (u) to.set(String(u.email).toLowerCase(), { user: u, email: u.email, typed: false });
    }
    for (const e of typed) {
      if (e === String(req.user.email).toLowerCase() || to.has(e)) continue;
      const u = get('SELECT id, name, email FROM users WHERE lower(email)=?', e);
      to.set(e, { user: u || null, email: e, typed: true });
    }
    if (!to.size) return res.status(400).json({ error: 'Choose at least one coach, or type an email address.' });
    if (to.size > MAX_AT_ONCE) return res.status(400).json({ error: `Send to ${MAX_AT_ONCE} people at most in one go.` });
    if (sentLately(req.user.id) + to.size > SEND_LIMIT) return res.status(429).json({ error: 'You have sent a lot in the last hour. Try again a little later.' });

    const note = str(req.body.note, 1000).trim();
    const noun = nounOf(plan);
    const title = titleOf(plan);
    const team = get('SELECT name FROM teams WHERE id=?', plan.team_id);
    const when = plan.kind === 'homework' ? '' : fmtDate(plan.date);
    const items = all("SELECT kind, title, duration_min FROM plan_items WHERE plan_id=? ORDER BY position, id", plan.id);
    const work = items.filter((it) => it.kind === 'item');
    const minutes = items.reduce((n, it) => n + (it.duration_min || 0), 0);
    const outline = work.length
      ? `${work.length} ${work.length === 1 ? 'item' : 'items'}, ${minutes} minutes:\n` + work.slice(0, 8).map((it) => `- ${it.title || 'Untitled'} (${it.duration_min} min)`).join('\n') + (work.length > 8 ? `\n- and ${work.length - 8} more` : '')
      : '';

    let mailed = 0;
    let messaged = 0;
    const failed = [];
    for (const r of to.values()) {
      const token = newToken();
      // Sending again to the same person replaces their old link.
      tx(() => {
        if (r.user) run('DELETE FROM plan_sends WHERE plan_id=? AND to_user_id=?', plan.id, r.user.id);
        else run('DELETE FROM plan_sends WHERE plan_id=? AND to_email=?', plan.id, r.email);
        run('INSERT INTO plan_sends (token, plan_id, from_user, to_user_id, to_email, note) VALUES (?,?,?,?,?,?)', token, plan.id, req.user.id, r.user?.id ?? null, r.typed ? r.email : '', note);
      });
      const link = `${publicBase(req)}/shared/${token}`;
      if (r.user) {
        notify(r.user.id, { kind: 'share', ref: `plan-send-${plan.id}`, title: `${req.user.name} sent you a ${noun}: ${title}`, body: note || [team?.name, when].filter(Boolean).join(' · '), link: `/shared/${token}` });
        messaged++;
      }
      if (!mail) continue;
      noteSend(req.user.id);
      const result = await sendMail({
        to: r.email,
        subject: `${req.user.name} sent you a ${noun}: ${title}`,
        text:
          `Hi${r.user ? ` ${r.user.name}` : ''},\n\n` +
          `${req.user.name} (${req.user.email}) sent you a ${noun} on Dime Coach: "${title}"${team ? `, for ${team.name}` : ''}${when ? `, ${when}` : ''}.\n\n` +
          (note ? `${req.user.name} wrote:\n${note}\n\n` : '') +
          (outline ? `${outline}\n\n` : '') +
          `Open it here:\n\n${link}\n\n` +
          `You can read it without an account. If you use Dime Coach, sign in and you can add a copy to your own practices.`,
        secret: token,
      });
      if (result.ok) mailed++;
      else failed.push(r.typed ? r.email : r.user.name);
    }
    res.json({ ...stateOf(req, plan), result: { mailed, messaged, failed, total: to.size } });
  });

  /** The link for anyone: made the first time it is asked for. */
  app.post('/api/plans/:id/sends/link', (req, res) => {
    const plan = ownPlan(req, res);
    if (!plan) return;
    if (!get("SELECT id FROM plan_sends WHERE plan_id=? AND to_user_id IS NULL AND to_email=''", plan.id))
      run("INSERT INTO plan_sends (token, plan_id, from_user, to_email) VALUES (?,?,?,'')", newToken(), plan.id, req.user.id);
    res.json(stateOf(req, plan));
  });

  app.delete('/api/plans/:id/sends/:sendId', (req, res) => {
    const plan = ownPlan(req, res);
    if (!plan) return;
    run('DELETE FROM plan_sends WHERE id=? AND plan_id=?', Number(req.params.sendId), plan.id);
    res.json(stateOf(req, plan));
  });

  /** Adds a copy of the practice behind a link to one of the caller's own teams. */
  app.post('/api/plan-links/:token/copy', (req, res) => {
    const s = get('SELECT * FROM plan_sends WHERE token=?', str(req.params.token, 80));
    const plan = s && get('SELECT * FROM plans WHERE id=?', s.plan_id);
    if (!plan) return res.status(404).json({ error: 'This link no longer works.' });
    // Always the caller's own teams, even while they are working in a team someone shared with them.
    const ownerId = req.homeOwnerId ?? req.ownerId;
    const team = get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(req.body.team_id), ownerId);
    if (!team) return res.status(400).json({ error: 'Choose one of your teams to add this to.' });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date)) ? String(req.body.date) : new Date().toISOString().slice(0, 10);
    res.json({ id: tx(() => copyPlan(plan, ownerId, team, date)) });
  });
}
