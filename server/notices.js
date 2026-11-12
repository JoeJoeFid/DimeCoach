// Messages from the app to one person, shown on their Messages page: "you were added to a team",
// "your drill was approved", and the like. Sending one never gets in the way of the thing it reports.
import { all, get, run } from './db.js';

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
  } catch (e) {
    console.error('Could not leave a message:', e.message);
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
