// A team's parents, family and friends: people who follow the team without coaching it.
//
// A coach adds them by name and email, says what they are to the team, and can link each one to
// the players they belong to, then or later. Someone linked to nobody is a friend of the whole
// team. An invitation is an email telling them they were added, by whom, to which team. They get
// no account: this is a list of people to keep in touch with.
import { all, db, get, run } from './db.js';
import { mailerStatus, sendMail } from './mailer.js';

db.exec(`
CREATE TABLE IF NOT EXISTS team_contacts (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'parent',            -- 'parent' | 'family' | 'friend'
  player_ids_json TEXT NOT NULL DEFAULT '[]',     -- the players they belong to; empty = the whole team
  invited_at TEXT, invited_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS team_contacts_team ON team_contacts(team_id);
`);

const str = (v, max = 200) => String(v ?? '').slice(0, max);
const KINDS = ['parent', 'family', 'friend'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const parse = (s) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

// Each person may send only so many invitations an hour, so the site cannot be used to send junk.
const sent = new Map();
const LIMIT = 40;
const sentLately = (userId) => {
  const recent = (sent.get(userId) || []).filter((t) => Date.now() - t < 60 * 60_000);
  sent.set(userId, recent);
  return recent.length;
};

export function mountContacts(app) {
  /** The team, when the caller may see the people around it. Answers the request itself when they may not. */
  const enter = (req, res) => {
    const team = get('SELECT * FROM teams WHERE id=? AND owner_id=?', Number(req.params.id), req.ownerId);
    if (!team) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    if (req.staff && !req.staff.perms.contacts) {
      res.status(403).json({ error: 'Parent and family contacts are hidden for you on this team.' });
      return null;
    }
    return team;
  };
  const playersOf = (team) => all('SELECT id, name FROM players WHERE team_id=?', team.id);
  const out = (team) => ({
    mail: mailerStatus().configured,
    contacts: all('SELECT * FROM team_contacts WHERE team_id=? ORDER BY name COLLATE NOCASE, id', team.id).map((c) => {
      const known = new Set(playersOf(team).map((p) => p.id));
      return { id: c.id, name: c.name, email: c.email, kind: c.kind, player_ids: parse(c.player_ids_json).filter((id) => known.has(id)), invited_at: c.invited_at || null };
    }),
  });
  /** The fields of a contact as sent, checked. Null, with the request answered, when something is wrong. */
  const fields = (req, res, team) => {
    const name = str(req.body.name, 120).trim();
    const email = str(req.body.email, 200).trim().toLowerCase();
    if (!name && !email) {
      res.status(400).json({ error: 'Give a name or an email address.' });
      return null;
    }
    if (email && !EMAIL.test(email)) {
      res.status(400).json({ error: 'That does not look like an email address.' });
      return null;
    }
    const known = new Set(playersOf(team).map((p) => p.id));
    const players = [...new Set((Array.isArray(req.body.player_ids) ? req.body.player_ids : []).map(Number))].filter((id) => known.has(id));
    return { name, email, kind: KINDS.includes(req.body.kind) ? req.body.kind : 'parent', players };
  };
  /** Emails one person that they were added. Resolves to { ok, error }. */
  async function invite(req, team, c, note) {
    if (!mailerStatus().configured) return { ok: false, error: 'Email is not set up on this site, so an invitation cannot be sent.' };
    if (!c.email) return { ok: false, error: 'Add an email address for this person first.' };
    if (sentLately(req.user.id) >= LIMIT) return { ok: false, error: 'You have sent a lot of invitations in the last hour. Try again a little later.' };
    sent.set(req.user.id, [...(sent.get(req.user.id) || []), Date.now()]);
    const kids = playersOf(team)
      .filter((p) => parse(c.player_ids_json).includes(p.id))
      .map((p) => p.name);
    const as = c.kind === 'parent' ? 'a parent' : c.kind === 'family' ? 'family' : 'a friend of the team';
    const r = await sendMail({
      to: c.email,
      subject: `${req.user.name} added you to ${team.name} on Dime Coach`,
      text:
        `Hi${c.name ? ` ${c.name}` : ''},\n\n` +
        `${req.user.name} added you to the parents, family and friends of ${team.name}, as ${as}${kids.length ? ` of ${kids.join(' and ')}` : ''}.\n\n` +
        (note ? `${req.user.name} wrote:\n${note}\n\n` : '') +
        `Dime Coach is where the coaches of ${team.name} plan practices and games. Being on this list means they can send you practice plans, schedules and news at this address. You do not need an account.\n\n` +
        `If you would rather not be on the list, write to ${req.user.name} at ${req.user.email}.`,
    });
    if (r.ok) run('UPDATE team_contacts SET invited_at=?, invited_by=? WHERE id=?', new Date().toISOString(), req.user.id, c.id);
    return r;
  }

  app.get('/api/teams/:id/contacts', (req, res) => {
    const team = enter(req, res);
    if (team) res.json(out(team));
  });
  app.post('/api/teams/:id/contacts', async (req, res) => {
    const team = enter(req, res);
    const f = team && fields(req, res, team);
    if (!f) return;
    if (f.email && get('SELECT id FROM team_contacts WHERE team_id=? AND email=?', team.id, f.email)) return res.status(400).json({ error: 'Someone with that email address is already on the list.' });
    const id = Number(run('INSERT INTO team_contacts (team_id, name, email, kind, player_ids_json) VALUES (?,?,?,?,?)', team.id, f.name, f.email, f.kind, JSON.stringify(f.players)).lastInsertRowid);
    let warning = '';
    if (req.body.invite) {
      const r = await invite(req, team, get('SELECT * FROM team_contacts WHERE id=?', id), str(req.body.note, 1000).trim());
      if (!r.ok) warning = `They were added, but the invitation was not sent: ${r.error}`;
    }
    res.json({ ...out(team), warning });
  });
  app.put('/api/teams/:id/contacts/:contactId', (req, res) => {
    const team = enter(req, res);
    const c = team && get('SELECT * FROM team_contacts WHERE id=? AND team_id=?', Number(req.params.contactId), team.id);
    if (team && !c) return res.status(404).json({ error: 'Not found' });
    const f = team && fields(req, res, team);
    if (!f) return;
    if (f.email && get('SELECT id FROM team_contacts WHERE team_id=? AND email=? AND id<>?', team.id, f.email, c.id)) return res.status(400).json({ error: 'Someone with that email address is already on the list.' });
    run('UPDATE team_contacts SET name=?, email=?, kind=?, player_ids_json=? WHERE id=?', f.name, f.email, f.kind, JSON.stringify(f.players), c.id);
    res.json(out(team));
  });
  app.delete('/api/teams/:id/contacts/:contactId', (req, res) => {
    const team = enter(req, res);
    if (!team) return;
    run('DELETE FROM team_contacts WHERE id=? AND team_id=?', Number(req.params.contactId), team.id);
    res.json(out(team));
  });
  app.post('/api/teams/:id/contacts/:contactId/invite', async (req, res) => {
    const team = enter(req, res);
    const c = team && get('SELECT * FROM team_contacts WHERE id=? AND team_id=?', Number(req.params.contactId), team.id);
    if (team && !c) return res.status(404).json({ error: 'Not found' });
    if (!team) return;
    const r = await invite(req, team, c, str(req.body.note, 1000).trim());
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(out(team));
  });
}
