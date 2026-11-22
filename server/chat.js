// Chat: a running back-and-forth among a group of people, like a group chat on a phone.
//
// Every team has one of its own, with its coaches and (unless a coach turns that off) its parents,
// family and friends. Anyone can also start a chat with people they could write a message to: one
// person, or several. What is said arrives at once in every open browser, a line shows who is
// typing, and a phone with notifications on is told when the chat is not in front of its owner.
import { all, db, get, run } from './db.js';
import { tell } from './live.js';
import { coachesOfTeam, followersOfTeam, peopleFor } from './inbox.js';
import { slugOf } from './family.js';
import { pushTo } from './push.js';

db.exec(`
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'group',
  team_id INTEGER UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  -- A team's chat: whether its parents, family and friends are in it, or the coaches alone.
  families INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
-- What each person has read of a chat, and whether they silenced it.
CREATE TABLE IF NOT EXISTS chat_state (
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  -- Numbers are never used twice: what a person has read is kept as the number they got to, and a line taken out must not hand its number to the next.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- 'text' is something a person said. 'note' is the chat saying what happened: someone joined, left, renamed it.
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, id);
-- An emoji a person put on something that was said. One of each kind per person.
CREATE TABLE IF NOT EXISTS chat_reactions (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  UNIQUE (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_message ON chat_reactions(message_id);
`);

const str = (v, max) => String(v ?? '').slice(0, max);
const MAX_PEOPLE = 50;
const PAGE = 60;
/** Nothing but emoji: pictures, flags, and the joiners and skin tones that go with them. */
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u200d\ufe0f\u20e3\u{1f3fb}-\u{1f3ff}])+$/u;
const MAX_KINDS = 20;

/** The teams a person coaches. */
const coachedTeams = (userId) =>
  all(
    `SELECT DISTINCT t.* FROM teams t
      WHERE t.id IN (SELECT team_id FROM team_staff WHERE user_id=?)
         OR t.owner_id IN (SELECT owner_id FROM memberships WHERE user_id=? AND role='owner')`,
    userId, userId,
  );
/** The teams a person is a parent, family member or friend of. */
const followedTeams = (userId) => all('SELECT t.* FROM team_contacts c JOIN teams t ON t.id=c.team_id WHERE c.user_id=? GROUP BY t.id', userId);
const coaches = (team, userId) => coachesOfTeam(team).some((p) => p.id === userId);

/** A team's own chat, made the first time it is wanted. */
function teamChat(team) {
  const found = get('SELECT * FROM chats WHERE team_id=?', team.id);
  if (found) return found;
  run("INSERT OR IGNORE INTO chats (kind, team_id) VALUES ('team', ?)", team.id);
  return get('SELECT * FROM chats WHERE team_id=?', team.id);
}
const teamOf = (chat) => (chat.team_id ? get('SELECT * FROM teams WHERE id=?', chat.team_id) : null);

/** Everyone in a chat, with what each is to it. */
function membersOf(chat) {
  if (chat.kind === 'team') {
    const team = teamOf(chat);
    if (!team) return [];
    const seen = new Set();
    return [...coachesOfTeam(team), ...(chat.families ? followersOfTeam(team) : [])].filter((p) => !seen.has(p.id) && seen.add(p.id)).map((p) => ({ id: p.id, name: p.name, role: p.role }));
  }
  return all("SELECT u.id, u.name, '' AS role FROM chat_members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND u.status='active' ORDER BY u.name COLLATE NOCASE", chat.id);
}
/** Whether a person may take things out of a chat that are not theirs, and change who is in it. */
const runs = (chat, userId) => (chat.kind === 'team' ? coaches(teamOf(chat), userId) : chat.created_by === userId);

/** The chats a person is in. A team's chat exists as soon as the team does. */
function chatsOf(user) {
  const mine = [];
  const seen = new Set();
  for (const t of coachedTeams(user.id)) {
    const c = teamChat(t);
    seen.add(c.id);
    mine.push(c);
  }
  for (const t of followedTeams(user.id)) {
    const c = teamChat(t);
    if (!seen.has(c.id) && c.families) mine.push(c);
    seen.add(c.id);
  }
  return [...mine, ...all("SELECT c.* FROM chat_members m JOIN chats c ON c.id=m.chat_id WHERE m.user_id=? AND c.kind='group'", user.id)];
}
/** The chat with this number, if this person is in it. */
function chatFor(user, id) {
  const chat = get('SELECT * FROM chats WHERE id=?', Number(id));
  if (!chat) return null;
  return membersOf(chat).some((p) => p.id === user.id) ? chat : null;
}

/** The emoji put on a line, in the order each was first used, with who used it. */
function reactionsOf(messageId) {
  const kinds = [];
  for (const r of all("SELECT r.emoji, r.user_id, u.name FROM chat_reactions r JOIN users u ON u.id=r.user_id WHERE r.message_id=? ORDER BY r.id", messageId)) {
    let kind = kinds.find((k) => k.emoji === r.emoji);
    if (!kind) kinds.push((kind = { emoji: r.emoji, users: [] }));
    kind.users.push({ id: r.user_id, name: r.name });
  }
  return kinds;
}
const lineOut = (m) => ({ id: m.id, chat_id: m.chat_id, user_id: m.user_id, by: m.by_name || 'Someone', kind: m.kind, body: m.body, at: m.created_at, reactions: m.kind === 'text' ? reactionsOf(m.id) : [] });
const stateOf = (chatId, userId) => get('SELECT * FROM chat_state WHERE chat_id=? AND user_id=?', chatId, userId) ?? { last_read: 0, muted: 0 };
const setState = (chatId, userId, change) => {
  const now = { ...stateOf(chatId, userId), ...change };
  run('INSERT INTO chat_state (chat_id, user_id, last_read, muted) VALUES (?,?,?,?) ON CONFLICT(chat_id, user_id) DO UPDATE SET last_read=excluded.last_read, muted=excluded.muted', chatId, userId, now.last_read, now.muted ? 1 : 0);
};

/** One chat as the list shows it: who is in it, the last thing said, and how much is unread. */
function chatOut(chat, user) {
  const team = teamOf(chat);
  const state = stateOf(chat.id, user.id);
  const last = get('SELECT m.*, u.name AS by_name FROM chat_messages m LEFT JOIN users u ON u.id=m.user_id WHERE m.chat_id=? ORDER BY m.id DESC LIMIT 1', chat.id);
  return {
    id: chat.id, kind: chat.kind, team_id: chat.team_id, name: chat.kind === 'team' ? team?.name || 'Team' : chat.name,
    families: !!chat.families, members: membersOf(chat), can_run: runs(chat, user.id), muted: !!state.muted,
    last: last ? lineOut(last) : null,
    unread: get("SELECT COUNT(*) AS n FROM chat_messages WHERE chat_id=? AND id>? AND kind='text' AND COALESCE(user_id,0)<>?", chat.id, state.last_read, user.id).n,
  };
}
function listOut(user) {
  const chats = chatsOf(user).map((c) => chatOut(c, user));
  // The one talked in most recently first; a chat nobody has spoken in yet goes after those, teams before the rest.
  chats.sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0) || (a.kind === 'team' ? -1 : 1) - (b.kind === 'team' ? -1 : 1) || a.id - b.id);
  return { chats, unread: chats.filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0) };
}

/** Where a person opens a chat: a coach's Chat page, or for someone who only follows teams, the one on a team's page. */
function chatPath(user, chat) {
  if (!user.follower) return `/chat/${chat.id}`;
  const team = (chat.team_id && followedTeams(user.id).find((t) => t.id === chat.team_id)) || followedTeams(user.id)[0];
  return team ? `/family/${slugOf(team)}?tab=chat&chat=${chat.id}` : '/';
}

// Who has a chat open in front of them right now. They are not sent a notification for what they are watching arrive.
const here = new Map();
const HERE_MS = 30_000;
const watching = (userId, chatId) => {
  const h = here.get(userId);
  return !!h && h.chat === chatId && Date.now() - h.at < HERE_MS;
};
// Each person may say only so much in a minute, so a chat cannot be flooded.
const said = new Map();
function tooFast(userId) {
  const recent = (said.get(userId) || []).filter((t) => Date.now() - t < 60_000);
  said.set(userId, [...recent, Date.now()]);
  return recent.length >= 40;
}

/** Puts a line in a chat and tells everyone in it. */
function say(chat, user, body, kind = 'text') {
  const at = new Date().toISOString();
  const id = Number(run('INSERT INTO chat_messages (chat_id, user_id, kind, body, created_at) VALUES (?,?,?,?,?)', chat.id, user.id, kind, body, at).lastInsertRowid);
  // What a person says themselves, they have read.
  setState(chat.id, user.id, { last_read: id });
  const people = membersOf(chat);
  tell(people.map((p) => p.id), 'chat', { chat_id: chat.id, id });
  if (kind !== 'text') return id;
  const team = teamOf(chat);
  const flat = body.replace(/\s+/g, ' ').trim();
  for (const p of people) {
    if (p.id === user.id || watching(p.id, chat.id) || stateOf(chat.id, p.id).muted) continue;
    const person = get('SELECT * FROM users WHERE id=?', p.id);
    if (!person) continue;
    const where = chat.kind === 'team' ? team?.name : chat.name || (people.length > 2 ? 'a group chat' : '');
    pushTo(p.id, { title: where ? `${user.name} in ${where}` : user.name, body: flat, link: chatPath(person, chat), tag: `chat-${chat.id}` });
  }
  return id;
}

export function mountChat(app) {
  app.get('/api/chat', (req, res) => res.json(listOut(req.user)));

  // The people a chat can be started with: the same ones a message can be written to.
  app.get('/api/chat/people', (req, res) => res.json(peopleFor(req.user)));

  // Starting a chat with one person or several. With one person, the chat the two already have is opened again.
  app.post('/api/chat', (req, res) => {
    const ids = [...new Set((Array.isArray(req.body.to) ? req.body.to : []).map(Number).filter(Number.isInteger))].filter((id) => id !== req.user.id);
    if (ids.length === 0) return res.status(400).json({ error: 'Choose who the chat is with.' });
    if (ids.length >= MAX_PEOPLE) return res.status(400).json({ error: `A chat can have ${MAX_PEOPLE} people at most.` });
    const allowed = new Set(peopleFor(req.user).flatMap((g) => g.people.map((p) => p.id)));
    if (!ids.every((id) => allowed.has(id) && get("SELECT 1 AS ok FROM users WHERE id=? AND status='active'", id))) return res.status(403).json({ error: 'One of the people you chose can no longer be written to. Take them off and try again.' });
    const name = str(req.body.name, 60).replace(/\s+/g, ' ').trim();
    if (ids.length === 1 && !name) {
      const both = get(
        `SELECT c.id FROM chats c WHERE c.kind='group' AND c.name=''
            AND (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id=c.id)=2
            AND EXISTS (SELECT 1 FROM chat_members m WHERE m.chat_id=c.id AND m.user_id=?)
            AND EXISTS (SELECT 1 FROM chat_members m WHERE m.chat_id=c.id AND m.user_id=?)`,
        req.user.id, ids[0],
      );
      if (both) return res.json({ id: both.id, ...listOut(req.user) });
    }
    const id = Number(run("INSERT INTO chats (kind, name, created_by) VALUES ('group', ?, ?)", name, req.user.id).lastInsertRowid);
    for (const userId of [req.user.id, ...ids]) run('INSERT INTO chat_members (chat_id, user_id) VALUES (?,?)', id, userId);
    tell(ids, 'chat', { chat_id: id, id: 0 });
    res.json({ id, ...listOut(req.user) });
  });

  // What has been said: the newest, or with `before` the ones earlier than that.
  app.get('/api/chat/:id/messages', (req, res) => {
    const chat = chatFor(req.user, req.params.id);
    if (!chat) return res.status(404).json({ error: 'That chat is not there, or you are no longer in it.' });
    const before = Number(req.query.before) || 0;
    const rows = all(
      `SELECT m.*, u.name AS by_name FROM chat_messages m LEFT JOIN users u ON u.id=m.user_id WHERE m.chat_id=? ${before ? 'AND m.id<?' : ''} ORDER BY m.id DESC LIMIT ${PAGE + 1}`,
      ...(before ? [chat.id, before] : [chat.id]),
    );
    res.json({ chat: chatOut(chat, req.user), messages: rows.slice(0, PAGE).reverse().map(lineOut), more: rows.length > PAGE });
  });

  app.post('/api/chat/:id/messages', (req, res) => {
    const chat = chatFor(req.user, req.params.id);
    if (!chat) return res.status(404).json({ error: 'That chat is not there, or you are no longer in it.' });
    const body = str(req.body.body, 4000).trim();
    if (!body) return res.status(400).json({ error: 'Write something first.' });
    if (tooFast(req.user.id)) return res.status(429).json({ error: 'That is a lot at once. Give it a moment.' });
    here.set(req.user.id, { chat: chat.id, at: Date.now() });
    const id = say(chat, req.user, body);
    res.json(lineOut({ ...get('SELECT * FROM chat_messages WHERE id=?', id), by_name: req.user.name }));
  });

  // Taking a line back: your own, or anyone's for whoever runs the chat.
  app.delete('/api/chat/:id/messages/:mid', (req, res) => {
    const chat = chatFor(req.user, req.params.id);
    const m = chat && get("SELECT * FROM chat_messages WHERE id=? AND chat_id=? AND kind='text'", Number(req.params.mid), chat.id);
    if (!m) return res.status(404).json({ error: 'That is no longer there.' });
    if (m.user_id !== req.user.id && !runs(chat, req.user.id)) return res.status(403).json({ error: 'Only the person who wrote it, or whoever runs the chat, can take it out.' });
    run('DELETE FROM chat_reactions WHERE message_id=?', m.id);
    run('DELETE FROM chat_messages WHERE id=?', m.id);
    tell(membersOf(chat).map((p) => p.id), 'chat', { chat_id: chat.id, id: 0, gone: m.id });
    res.json({ ok: true });
  });

  // Putting an emoji on something that was said, or taking your own off again. It shows for everyone at once, and nobody is notified.
  app.post('/api/chat/:id/messages/:mid/react', (req, res) => {
    const chat = chatFor(req.user, req.params.id);
    const m = chat && get("SELECT * FROM chat_messages WHERE id=? AND chat_id=? AND kind='text'", Number(req.params.mid), chat.id);
    if (!m) return res.status(404).json({ error: 'That is no longer there.' });
    const emoji = str(req.body.emoji, 24).trim();
    if (!EMOJI.test(emoji)) return res.status(400).json({ error: 'Pick an emoji.' });
    const mine = get('SELECT id FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, req.user.id, emoji);
    if (mine) run('DELETE FROM chat_reactions WHERE id=?', mine.id);
    else {
      const kinds = all('SELECT DISTINCT emoji FROM chat_reactions WHERE message_id=?', m.id).map((r) => r.emoji);
      if (!kinds.includes(emoji) && kinds.length >= MAX_KINDS) return res.status(400).json({ error: 'That has plenty of different emoji on it already. Pick one that is there.' });
      run('INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES (?,?,?)', m.id, req.user.id, emoji);
    }
    const line = lineOut(get('SELECT m.*, u.name AS by_name FROM chat_messages m LEFT JOIN users u ON u.id=m.user_id WHERE m.id=?', m.id));
    tell(membersOf(chat).map((p) => p.id), 'chat', { chat_id: chat.id, id: 0, line });
    res.json(line);
  });

  // "Pat is typing": passed straight on to the others, and kept nowhere.
  app.post('/api/chat/:id/typing', (req, res) => {
    const chat = chatFor(req.user, req.params.id);
    if (!chat) return res.status(404).json({ error: 'Not found' });
    here.set(req.user.id, { chat: chat.id, at: Date.now() });
    tell(membersOf(chat).map((p) => p.id).filter((id) => id !== req.user.id), 'typing', { chat_id: chat.id, user_id: req.user.id, name: req.user.name });
    res.json({ ok: true });
  });

  // The chat is open in front of this person, and they have read up to here.
  app.post('/api/chat/:id/read', (req, res) => {
    const chat = chatFor(req.user, req.params.id);
    if (!chat) return res.status(404).json({ error: 'Not found' });
    here.set(req.user.id, { chat: chat.id, at: Date.now() });
    const newest = get('SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE chat_id=?', chat.id).id;
    if (newest > stateOf(chat.id, req.user.id).last_read) setState(chat.id, req.user.id, { last_read: newest });
    res.json({ unread: listOut(req.user).unread });
  });
  // And when they turn away from it.
  app.post('/api/chat/away', (req, res) => {
    here.delete(req.user.id);
    res.json({ ok: true });
  });

  // A chat's own settings: silencing it for yourself, its name, and for a team whether families are in it.
  app.put('/api/chat/:id', (req, res) => {
    const chat = chatFor(req.user, req.params.id);
    if (!chat) return res.status(404).json({ error: 'Not found' });
    if (typeof req.body.muted === 'boolean') setState(chat.id, req.user.id, { muted: req.body.muted ? 1 : 0 });
    if (typeof req.body.name === 'string' && chat.kind === 'group') {
      const name = str(req.body.name, 60).replace(/\s+/g, ' ').trim();
      if (name !== chat.name) {
        run('UPDATE chats SET name=? WHERE id=?', name, chat.id);
        say({ ...chat, name }, req.user, name ? `${req.user.name} named the chat "${name}"` : `${req.user.name} took the chat's name off`, 'note');
      }
    }
    if (typeof req.body.families === 'boolean' && chat.kind === 'team') {
      if (!runs(chat, req.user.id)) return res.status(403).json({ error: 'Only a coach of the team can change who is in its chat.' });
      const before = membersOf(chat).map((p) => p.id);
      run('UPDATE chats SET families=? WHERE id=?', req.body.families ? 1 : 0, chat.id);
      const now = get('SELECT * FROM chats WHERE id=?', chat.id);
      tell([...new Set([...before, ...membersOf(now).map((p) => p.id)])], 'chat', { chat_id: chat.id, id: 0 });
    }
    res.json(chatOut(get('SELECT * FROM chats WHERE id=?', chat.id), req.user));
  });

  // Bringing more people into a group chat. Anyone in it can, from the people they could write to.
  app.post('/api/chat/:id/members', (req, res) => {
    const chat = chatFor(req.user, req.params.id);
    if (!chat || chat.kind !== 'group') return res.status(404).json({ error: 'Not found' });
    const inIt = new Set(membersOf(chat).map((p) => p.id));
    const ids = [...new Set((Array.isArray(req.body.add) ? req.body.add : []).map(Number).filter(Number.isInteger))].filter((id) => !inIt.has(id));
    if (ids.length === 0) return res.json(chatOut(chat, req.user));
    if (inIt.size + ids.length > MAX_PEOPLE) return res.status(400).json({ error: `A chat can have ${MAX_PEOPLE} people at most.` });
    const allowed = new Set(peopleFor(req.user).flatMap((g) => g.people.map((p) => p.id)));
    if (!ids.every((id) => allowed.has(id))) return res.status(403).json({ error: 'One of the people you chose cannot be added.' });
    const names = [];
    for (const id of ids) {
      run('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?,?)', chat.id, id);
      // Someone brought in starts from here: what was said before is there to read, and is not counted as new.
      setState(chat.id, id, { last_read: get('SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE chat_id=?', chat.id).id });
      names.push(get('SELECT name FROM users WHERE id=?', id)?.name || 'someone');
    }
    say(chat, req.user, `${req.user.name} added ${names.join(', ')}`, 'note');
    res.json(chatOut(chat, req.user));
  });

  // Leaving a group chat. A team's chat is left by leaving the team.
  app.post('/api/chat/:id/leave', (req, res) => {
    const chat = chatFor(req.user, req.params.id);
    if (!chat || chat.kind !== 'group') return res.status(404).json({ error: 'Not found' });
    say(chat, req.user, `${req.user.name} left`, 'note');
    run('DELETE FROM chat_members WHERE chat_id=? AND user_id=?', chat.id, req.user.id);
    run('DELETE FROM chat_state WHERE chat_id=? AND user_id=?', chat.id, req.user.id);
    // The last one out takes the chat with them.
    if (get('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id=?', chat.id).n === 0) run('DELETE FROM chats WHERE id=?', chat.id);
    res.json(listOut(req.user));
  });
}
