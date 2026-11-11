// Reads a team's schedule from a calendar subscription link (iCalendar / .ics feed).
// GameChanger, TeamSnap, SportsEngine and Google Calendar all publish these.

export class CalendarError extends Error {}

const pad = (n) => String(n).padStart(2, '0');
const unescapeText = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

/**
 * Parses an iCalendar date value into a local date and time.
 * - A value with a TZID is the team's wall-clock time, so it is kept as written.
 * - A UTC value (ending in Z) is converted to this computer's time zone.
 * - A date-only value is an all-day event with no time.
 */
function parseWhen(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined) return { date: `${y}-${mo}-${d}`, time: '' };
  if (!z) return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
  const local = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  return {
    date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
  };
}

/** Best guess at what an event is, from its title. The coach can still plan any event as a practice. */
export function classify(title) {
  if (/\b(practice|training|workout|open gym)\b/i.test(title)) return 'practice';
  if (/\b(vs\.?|versus|game|scrimmage|tournament|playoffs?|championship)\b/i.test(title) || /(^|\s)@\s?\S/.test(title)) return 'game';
  return 'other';
}

export function parseIcs(text) {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new CalendarError('That link did not return a calendar. Check that it is the calendar subscription link.');
  // Long lines are folded onto continuation lines that start with a space or tab.
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
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
      else if (name === 'DTSTART') cur.start = parseWhen(value);
      else if (name === 'DTEND') cur.end = parseWhen(value);
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

export async function fetchCalendar(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'text/calendar, text/plain, */*' } });
  } catch {
    throw new CalendarError('Could not reach that calendar link. Check the link and your internet connection.');
  }
  if (!res.ok) throw new CalendarError(`The calendar link returned an error (${res.status}). Copy a fresh link from the app and try again.`);
  const text = await res.text();
  if (text.length > 5_000_000) throw new CalendarError('That calendar is too large to import.');
  return parseIcs(text);
}
