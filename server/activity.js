// What each person has been doing lately, for the system administrator: one short line for each
// thing made, changed, shared or deleted. Names of things are kept, never what is in them.
import { all, get, run } from './db.js';

/** Saving the same thing again within this long moves its line up instead of adding another. */
const SAME_MS = 10 * 60_000;
/** Only this many lines are kept for each person. */
const KEEP = 200;

function record(userId, text, key) {
  const now = new Date();
  const last = get('SELECT id, at FROM activity WHERE user_id=? AND key=? AND text=? ORDER BY id DESC LIMIT 1', userId, key, text);
  if (last && now.getTime() - Date.parse(last.at) < SAME_MS) return run('UPDATE activity SET at=? WHERE id=?', now.toISOString(), last.id);
  const r = run('INSERT INTO activity (user_id, text, key, at) VALUES (?,?,?,?)', userId, text, key, now.toISOString());
  // Now and then, drop what has fallen off the end of this person's list.
  if (Number(r.lastInsertRowid) % 20 === 0)
    run('DELETE FROM activity WHERE user_id=? AND id NOT IN (SELECT id FROM activity WHERE user_id=? ORDER BY at DESC LIMIT ?)', userId, userId, KEEP);
}

export const recentActivity = (userId, limit = 60) => all('SELECT id, text, at FROM activity WHERE user_id=? ORDER BY at DESC, id DESC LIMIT ?', userId, limit);

const q = (name) => (String(name ?? '').trim() ? ` “${String(name).trim().slice(0, 80)}”` : '');
/** "practice", "game", "homework sheet" or "template", from a plan's row or what was sent to make one. */
const planNoun = (p) => (!p ? 'practice' : p.is_template ? 'template' : p.kind === 'homework' ? 'homework sheet' : p.is_game ? 'game' : 'practice');
const planName = (p) => (p ? q(p.title) || (p.date ? ` on ${p.date}` : '') : '');
const row = (table, cols, id) => (Number(id) ? get(`SELECT ${cols} FROM ${table} WHERE id=?`, Number(id)) : null);

/** The line for a request, or null for one that is not worth a line (marking things read, preferences). */
function describe(method, parts, body) {
  const [area, a, b] = parts;
  const made = method === 'POST';
  const gone = method === 'DELETE';
  const verb = (add, edit, del) => (gone ? del : made ? add : edit);
  switch (area) {
    case 'plans': {
      const plan = a ? row('plans', 'title, date, kind, is_game, is_template', a) : body;
      const what = `${planNoun(plan)}${planName(plan)}`;
      if (b === 'posts') return `${verb('Posted in', 'Edited a post in', 'Deleted a post in')} the discussion on ${what}`;
      return `${verb('Created', 'Edited', 'Deleted')} ${what}`;
    }
    case 'drills':
      return `${verb('Added', 'Edited', 'Deleted')} drill${q(a ? row('drills', 'name', a)?.name : body.name)}`;
    case 'plays':
      return `${verb('Created', 'Edited', 'Deleted')} play${q(a ? row('plays', 'name', a)?.name : body.name)}`;
    case 'tags':
      return `${verb('Added', 'Edited', 'Deleted')} category${q(a ? row('tags', 'name', a)?.name : body.name)}`;
    case 'sports':
      return `Added sport${q(body.name)}`;
    case 'teams': {
      const team = `team${q(a ? row('teams', 'name', a)?.name : body.name)}`;
      if (!b) return `${verb('Created', 'Edited', 'Deleted')} ${team}`;
      if (b === 'players') return parts[3] === 'import' ? `Uploaded a roster to ${team}` : `Added a player to ${team}`;
      if (b === 'staff') return `${verb('Added a coach to', 'Changed a coach on', 'Removed a coach from')} ${team}`;
      if (b === 'calendar') return parts[3] === 'sync' ? `Synced the calendar of ${team}` : `Changed the calendar link of ${team}`;
      if (b === 'positions') return `Changed position names on ${team}`;
      if (b === 'events') return `Edited a calendar event on ${team}`;
      return `Changed ${team}`;
    }
    case 'players':
      return gone ? 'Removed a player' : 'Edited a player';
    case 'shared-teams':
      return 'Left a shared team';
    case 'resources':
      return `${verb('Added', 'Edited', 'Removed')} a resource`;
    case 'images':
      return 'Uploaded an image';
    case 'videos':
      return 'Uploaded a video';
    case 'communities': {
      if (a === 'seen') return null;
      if (a === 'join') return 'Joined a community with a code';
      const where = `community${q(a ? row('communities', 'name', a)?.name : body.name)}`;
      if (!b) return `${verb('Created', 'Changed the settings of', 'Deleted')} ${where}`;
      if (b === 'seen') return null;
      if (b === 'posts') return `${verb('Posted in', 'Edited a post in', 'Deleted a post in')} ${where}`;
      if (b === 'shares') return `Shared something to ${where}`;
      if (b === 'members') return `${gone ? 'Removed a member from' : 'Changed a member of'} ${where}`;
      if (b === 'invite') return `Invited someone to ${where}`;
      if (b === 'accept') return `Joined ${where}`;
      if (b === 'code') return `Changed the join code of ${where}`;
      return `Changed ${where}`;
    }
    case 'community-shares':
      return gone ? 'Removed something shared in a community' : 'Approved something shared in a community';
    case 'community-library':
      return 'Copied something from a community into their library';
    case 'coach-library':
      return parts.includes('copy') ? 'Copied something from the coach library' : 'Changed the coach library';
    case 'ai':
      return a === 'import-plan' ? 'Imported a plan with AI' : null;
    case 'auth':
      return a === 'password' ? 'Changed their password' : null;
    case 'admin':
      return a === 'users' ? (made ? 'Created an account' : 'Changed an account') : a === 'settings' ? 'Changed sign-up settings' : null;
    case 'system':
      return a === 'users' ? (gone ? 'Deleted an account' : 'Changed an account') : a === 'settings' ? 'Changed upload space settings' : null;
    default:
      return null;
  }
}

/**
 * Called for each signed-in request. Reading is ignored. Anything else is put into words now,
 * while the thing it names is still there to be named, and written down once it has worked.
 */
export function trackActivity(req, res) {
  if (req.method === 'GET') return;
  const parts = req.path.split('/').filter(Boolean);
  let text = null;
  try {
    text = describe(req.method, parts, req.body && typeof req.body === 'object' ? req.body : {});
  } catch {
    /* never let the record get in the way of the request */
  }
  if (!text) return;
  // Lines about the same thing share a key: "plans/12", "communities/3/posts".
  const key = [parts[0], parts[1] ?? '', /^\d+$/.test(parts[1] ?? '') ? parts[2] ?? '' : ''].join('/');
  const userId = req.user.id;
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    try {
      record(userId, text, key);
    } catch {
      /* the request has already been answered */
    }
  });
}
