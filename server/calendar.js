// Reads a team's schedule from a calendar subscription link (iCalendar / .ics feed).
// GameChanger, TeamSnap, SportsEngine and Google Calendar all publish these.

export class CalendarError extends Error {}

const pad = (n) => String(n).padStart(2, '0');
const unescapeText = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

/** A time zone name this computer knows, such as "America/Chicago". Anything else is ''. */
export function validZone(name) {
  const zone = String(name || '').trim();
  if (!zone) return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return '';
  }
}
/** UTC under any of its names. A calendar that says its zone is UTC has not said where the team is. */
const isUtc = (zone) => /^(utc|gmt|z|etc\/(utc|gmt|uct|universal|zulu))$/i.test(zone);

/** A moment, as the date and the time on the clock in a time zone. */
function wallClock(moment, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(moment).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Parses an iCalendar date value into the date and time on the team's clock.
 * - A value with a TZID is the team's wall-clock time, so it is kept as written.
 * - A UTC value (ending in Z) is converted to the team's time zone. Without one, to this
 *   computer's, which is only right when the server sits where the team does.
 * - A date-only value is an all-day event with no time.
 */
function parseWhen(value, zone) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined) return { date: `${y}-${mo}-${d}`, time: '' };
  if (!z) return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
  const moment = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  if (zone) return wallClock(moment, zone);
  return {
    date: `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`,
    time: `${pad(moment.getHours())}:${pad(moment.getMinutes())}`,
  };
}

/**
 * Team apps put the team's name in front of every event: "RAMS Basketball - 6th Grade 12U Practice",
 * "RAMS Basketball - 6th Grade 12U @ Waukee Flyers". This finds those opening words: the longest
 * run of two or more words that at least half the titles start with. '' when the titles share no such opening.
 */
export function sharedOpening(titles) {
  const list = titles.map((t) => String(t || '').trim()).filter(Boolean);
  if (list.length < 3) return '';
  const counts = new Map();
  for (const t of list) {
    const words = t.split(/\s+/);
    // Never the whole title: something has to be left to call the event.
    for (let n = 1; n < words.length; n++) {
      const opening = words.slice(0, n).join(' ');
      counts.set(opening, (counts.get(opening) || 0) + 1);
    }
  }
  const enough = Math.max(3, Math.ceil(list.length * 0.5));
  // A word that joins the team to the rest ("@", "vs", "at", a dash) belongs to what follows, not to the team's name.
  const joins = /^(@|vs\.?|versus|at|v\.?|-|–|—|:|\|)$/i;
  let best = '';
  for (const [opening, n] of counts) {
    if (n < enough || opening.length <= best.length) continue;
    if (joins.test(opening.split(' ').pop())) continue;
    // One word is too little to be sure of, and words that say what the event is ("Practice") are not a team's name.
    if (!opening.includes(' ') || classify(opening) !== 'other') continue;
    best = opening;
  }
  return best.length >= 4 ? best : '';
}
/** A title without the team's name in front. Titles that do not start with it are left alone. */
export function withoutOpening(title, opening) {
  const t = String(title || '').trim();
  if (!opening || !t.startsWith(`${opening} `)) return t;
  return t.slice(opening.length).replace(/^[\s:|–—-]+/, '').trim() || t;
}

/** Best guess at what an event is, from its title. The coach can still plan any event as a practice. */
export function classify(title) {
  if (/\b(practice|training|workout|open gym)\b/i.test(title)) return 'practice';
  if (/\b(vs\.?|versus|game|scrimmage|tournament|playoffs?|championship)\b/i.test(title) || /(^|\s)@\s?\S/.test(title)) return 'game';
  return 'other';
}

/** `teamZone` is where the team is, for times the calendar gives in UTC. A zone the calendar names for itself comes first. */
export function parseIcs(text, teamZone = '') {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new CalendarError('That link did not return a calendar. Check that it is the calendar subscription link.');
  // Long lines are folded onto continuation lines that start with a space or tab.
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const named = validZone((/^X-WR-TIMEZONE:(.+)$/im.exec(text) || [])[1]);
  const zone = named && !isUtc(named) ? named : validZone(teamZone);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) cur = {};
    else if (/^END:VEVENT/i.test(line)) {
      if (cur?.start && cur.status !== 'CANCELLED') {
        const title = cur.summary || 'Event';
        events.push({
          uid: cur.uid || `${cur.start.date}T${cur.start.time}-${title}`,
          title,
          kind: classify(title),
          date: cur.start.date,
          start_time: cur.start.time,
          end_time: cur.end && cur.end.date === cur.start.date ? cur.end.time : '',
          location: cur.location || '',
          notes: cur.description || '',
        });
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const name = line.slice(0, i).split(';')[0].toUpperCase();
      const value = line.slice(i + 1);
      if (name === 'SUMMARY') cur.summary = unescapeText(value);
      else if (name === 'LOCATION') cur.location = unescapeText(value);
      else if (name === 'DESCRIPTION') cur.description = unescapeText(value);
      else if (name === 'UID') cur.uid = value.trim();
      else if (name === 'STATUS') cur.status = value.trim().toUpperCase();
      else if (name === 'DTSTART') cur.start = parseWhen(value, zone);
      else if (name === 'DTEND') cur.end = parseWhen(value, zone);
    }
  }
  return events;
}

/** Accepts the webcal:// links that calendar apps hand out as well as plain https. */
export function normalizeCalendarUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw.replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new CalendarError('That does not look like a link. Paste the full calendar link, starting with webcal:// or https://.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CalendarError('The calendar link must start with webcal://, https:// or http://.');
  return url.toString();
}

export async function fetchCalendar(url, teamZone = '') {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'text/calendar, text/plain, */*' } });
  } catch {
    throw new CalendarError('Could not reach that calendar link. Check the link and your internet connection.');
  }
  if (!res.ok) throw new CalendarError(`The calendar link returned an error (${res.status}). Copy a fresh link from the app and try again.`);
  const text = await res.text();
  if (text.length > 5_000_000) throw new CalendarError('That calendar is too large to import.');
  return parseIcs(text, teamZone);
}
