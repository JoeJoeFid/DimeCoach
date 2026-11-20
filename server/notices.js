// Messages from the app to one person, shown on their Messages page: "you were added to a team",
// "your drill was approved", and the like. Sending one never gets in the way of the thing it reports.
import { all, get, run } from './db.js';
import { poke } from './live.js';
import { mailerStatus, sendMail } from './mailer.js';

/**
 * Leaves a message for someone. `link` is where clicking it goes, if anywhere. With a `ref`, an
 * unread message of the same kind about the same thing is replaced, so repeats do not pile up.
 */
export function notify(userId, { kind, ref = '', title, body = '', link = '' }) {
  if (!userId || !title) return;
  try {
    const old = ref && get('SELECT id FROM notices WHERE user_id=? AND kind=? AND ref=? AND read_at IS NULL', userId, kind, ref);
    if (old) run("UPDATE notices SET title=?, body=?, link=?, created_at=datetime('now') WHERE id=?", title, body, link, old.id);
    else run('INSERT INTO notices (user_id, kind, ref, title, body, link) VALUES (?,?,?,?,?,?)', userId, kind, ref, title, body, link);
    poke(userId);
  } catch (e) {
    console.error('Could not leave a message:', e.message);
  }
}

/**
 * The people named in a message with "@Their Name". `people` is who could be named there, as
 * { id, name }. A name only counts at the start or after a space, so an email address is not a mention.
 */
export const mentionedIn = (body, people) =>
  people.filter((p) => p.name && new RegExp(`(^|[\\s(])@${String(p.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i').test(String(body)));

/** What a person chose about messages. Both are off unless they turned them on. */
export function messagePrefs(user) {
  let stored = {};
  try {
    stored = JSON.parse(user?.prefs_json || '{}') || {};
  } catch {
    /* treat as nothing chosen */
  }
  return { mention_email_off: stored.mention_email_off === true, hide_in_to: stored.hide_in_to === true };
}

/**
 * Tells someone they were named with "@": a message in their Messages that opens the very place,
 * and an email with the same link unless they turned those off. `where` finishes the sentence
 * "Sam mentioned you …", and `base` is the site's address for the link in the email.
 */
export function mention(userId, { by, where, body = '', link, ref = '', base = '' }) {
  const title = `${by} mentioned you ${where}`;
  const words = body.length > 160 ? `${body.slice(0, 160)}…` : body;
  notify(userId, { kind: 'mention', ref, link, title, body: words });
  try {
    const user = get("SELECT * FROM users WHERE id=? AND status='active'", userId);
    if (!user?.email || !base || !mailerStatus().configured || messagePrefs(user).mention_email_off) return;
    const first = String(user.first_name || '').trim() || String(user.name || '').trim().split(/\s+/)[0] || 'there';
    const text = `Hi ${first},\n\n${title}:\n\n"${words}"\n\nSee where you were mentioned:\n\n${base}${link}\n\nYou can turn these emails off in Dime Coach, under Messages, then Settings.`;
    sendMail({ to: user.email, subject: title, text, automatic: true }).catch(() => {});
  } catch (e) {
    console.error('Could not email a mention:', e.message);
  }
}

/** A person's recent messages from the app, in the shape the Messages page lists. */
export const noticesFor = (userId) =>
  all('SELECT * FROM notices WHERE user_id=? ORDER BY id DESC LIMIT 60', userId).map((n) => ({
    key: `notice-${n.id}`, id: n.id, kind: 'notice', community_id: 0, community: '', at: n.created_at, by: '', title: n.title, text: n.body, link: n.link, unread: !n.read_at,
  }));

/** Marks one message read, or with no id all of them. */
export function readNotices(userId, id) {
  if (id) run("UPDATE notices SET read_at=datetime('now') WHERE id=? AND user_id=? AND read_at IS NULL", id, userId);
  else run("UPDATE notices SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL", userId);
}
