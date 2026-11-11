import DOMPurify from 'dompurify';
import type { Item, Plan } from './types';

/** Notes are stored as HTML. Always pass them through here before rendering. */
export const clean = (html: string) => ({ __html: DOMPurify.sanitize(html || '') });

export const isBlankHtml = (html: string) => !html || html.replace(/<[^>]*>/g, '').trim() === '';

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const parseDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tuesday - 11/10/26", the header style of the printed sheet. */
export const fmtDateSheet = (iso: string) => {
  if (!iso) return '';
  const d = parseDate(iso);
  return `${WEEKDAYS[d.getDay()]} - ${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
};
/** "Tue, Nov 10" */
export const fmtDateShort = (iso: string) => {
  if (!iso) return 'No date';
  const d = parseDate(iso);
  return `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
/** "Nov 10" */
export const fmtDateTiny = (iso: string) => {
  if (!iso) return '';
  const d = parseDate(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
export const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((parseDate(toIso).getTime() - parseDate(fromIso).getTime()) / 86400000);

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The stretch of time the dashboard measures categories and targets over. */
export type Period = 'last' | 'week' | 'lastweek' | 'month' | 'lastmonth' | '4w' | 'season';
export const PERIODS: { id: Period; label: string; phrase: string }[] = [
  { id: 'last', label: 'Most recent practice', phrase: 'in the most recent practice' },
  { id: 'week', label: 'This week', phrase: 'this week' },
  { id: 'lastweek', label: 'Last week', phrase: 'last week' },
  { id: 'month', label: 'This month', phrase: 'this month' },
  { id: 'lastmonth', label: 'Last month', phrase: 'last month' },
  { id: '4w', label: 'Last 4 weeks', phrase: 'in the last 4 weeks' },
  { id: 'season', label: 'Whole season', phrase: 'this season' },
];
/** First and last day (inclusive) of a period, as ISO dates. Weeks run Monday to Sunday. Nothing after today counts. */
export function periodBounds(period: Period, todayIso: string): { from: string; to: string } {
  const t = parseDate(todayIso);
  const day = (offset: number) => isoOf(new Date(t.getFullYear(), t.getMonth(), t.getDate() + offset));
  const sinceMonday = (t.getDay() + 6) % 7;
  switch (period) {
    case 'week':
      return { from: day(-sinceMonday), to: todayIso };
    case 'lastweek':
      return { from: day(-sinceMonday - 7), to: day(-sinceMonday - 1) };
    case 'month':
      return { from: isoOf(new Date(t.getFullYear(), t.getMonth(), 1)), to: todayIso };
    case 'lastmonth':
      return { from: isoOf(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: isoOf(new Date(t.getFullYear(), t.getMonth(), 0)) };
    case '4w':
      return { from: day(-27), to: todayIso };
    default:
      return { from: '0000-00-00', to: todayIso };
  }
}

/** A category can have a different target for each of these stretches of time. */
export type TargetScope = 'practice' | 'week' | 'month' | 'season';
export const SCOPES: { id: TargetScope; label: string; phrase: string }[] = [
  { id: 'practice', label: 'Practice', phrase: 'a single practice' },
  { id: 'week', label: 'Week', phrase: 'a week' },
  { id: 'month', label: 'Month', phrase: 'a month' },
  { id: 'season', label: 'Season', phrase: 'the season' },
];
/** Which target a dashboard period is judged against. */
export const scopeOf = (period: Period): TargetScope =>
  period === 'last' ? 'practice' : period === 'week' || period === 'lastweek' ? 'week' : period === 'season' ? 'season' : 'month';
/** The target for a period: its override if set, otherwise the category's default. */
export const targetFor = (tag: { target_pct: number | null; targets: Partial<Record<TargetScope, number>> }, scope: TargetScope) =>
  tag.targets[scope] ?? tag.target_pct;

/** When the team calendar was last read, in the viewer's own format. */
export const fmtSynced = (iso: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';

export const parseClock = (hhmm: string) => {
  const [h, m] = (hhmm || '17:30').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
/** Minutes since midnight to "5:30" (12-hour, no AM/PM, as on the printed sheet). */
export const fmtClock = (mins: number) => {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60) % 12 || 12;
  return `${h}:${String(m % 60).padStart(2, '0')}`;
};
export const fmtDuration = (mins: number) => {
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  return m % 60 === 0 ? `${m / 60} hr` : `${Math.floor(m / 60)} hr ${m % 60} min`;
};

export interface Slot {
  start: number;
  end: number;
}
/** Each item starts when the one before it ends. */
export function schedule(startTime: string, items: Pick<Item, 'duration_min'>[]): Slot[] {
  let t = parseClock(startTime);
  return items.map((it) => {
    const slot = { start: t, end: t + (it.duration_min || 0) };
    t = slot.end;
    return slot;
  });
}
export const slotLabel = (s: Slot) => `${fmtClock(s.start)} - ${fmtClock(s.end)}`;

export const UNTAGGED = 0;
export interface PlanMinutes {
  /**
   * Minutes per tag id. Every tag on an item is credited with the item's full length, because one
   * drill often trains several skills at once. So these can add up to more than `work`. Key 0 is untagged.
   */
  byTag: Map<number, number>;
  /** Minutes of real work, breaks excluded. */
  work: number;
  breaks: number;
}
export function planMinutes(plan: Pick<Plan, 'items'>, validTagIds?: Set<number>): PlanMinutes {
  const byTag = new Map<number, number>();
  let work = 0;
  let breaks = 0;
  for (const it of plan.items) {
    const mins = it.duration_min || 0;
    if (it.kind === 'break') {
      breaks += mins;
      continue;
    }
    work += mins;
    const tags = validTagIds ? it.tag_ids.filter((t) => validTagIds.has(t)) : it.tag_ids;
    if (tags.length === 0) byTag.set(UNTAGGED, (byTag.get(UNTAGGED) || 0) + mins);
    for (const t of tags) byTag.set(t, (byTag.get(t) || 0) + mins);
  }
  return { byTag, work, breaks };
}

/** Starter kinds of play per sport. Coaches can type any category; these are suggestions. */
export const PLAY_CATEGORIES_BY_SPORT: Record<string, string[]> = {
  basketball: ['Man offense', 'Zone offense', 'Quick hitter', 'Baseline out of bounds', 'Sideline out of bounds', 'Press break', 'Transition', 'Man defense', 'Zone defense', 'Press', 'End of game'],
};
export const PLAY_CATEGORIES = PLAY_CATEGORIES_BY_SPORT.basketball;
/** Sports the play builder can draw a court for. */
export const playBuilderSupports = (sportName: string | undefined) => (sportName || '').trim().toLowerCase() in PLAY_CATEGORIES_BY_SPORT;

/** The default base color of the category history. */
export const HEAT_BASE = '#2a78d6';
export const HEAT_PRESETS = ['#2a78d6', '#0f8a6b', '#6250d6', '#c2410c', '#be185d', '#475569'];

/**
 * Five clearly separated shades of one color, from faint to strong, for a light page and for a dark one.
 *
 * Each shade is tuned to a fixed brightness, the same for every color. Plain "lightness" steps do not
 * do this: a mid green or yellow looks far brighter than a mid blue, and its steps bunch together.
 */
export function heatRamp(baseHex: string) {
  const n = parseInt(/^#[0-9a-f]{6}$/i.test(baseHex) ? baseHex.slice(1) : HEAT_BASE.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60) + 360) % 360;
  const l = (max + min) / 2;
  // Keep enough color in it that the faint steps still read as the chosen hue. A gray stays gray.
  const sat = d === 0 ? 0 : Math.max(0.55, d / (1 - Math.abs(2 * l - 1)));

  const rgbAt = (lightness: number) => {
    const c = (1 - Math.abs(2 * lightness - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = lightness - c / 2;
    const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r1 + m, g1 + m, b1 + m].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
  };
  const brightness = ([r2, g2, b2]: number[]) => 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2;
  /** The shade of this hue whose brightness is `target` (0 to 255). */
  const shade = (target: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (brightness(rgbAt(mid)) < target) lo = mid;
      else hi = mid;
    }
    const [r3, g3, b3] = rgbAt((lo + hi) / 2);
    return `rgb(${r3}, ${g3}, ${b3})`;
  };
  return {
    light: [228, 190, 146, 100, 58].map(shade),
    dark: [34, 54, 82, 128, 190].map(shade),
  };
}

export const TAG_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export const blankItem = (key: string, kind: 'item' | 'break' = 'item'): Item => ({
  key,
  kind,
  title: kind === 'break' ? 'Water break' : '',
  duration_min: kind === 'break' ? 5 : 10,
  notes_html: '',
  coach_notes_html: '',
  callout: '',
  reps: '',
  groups: [],
  images: [],
  play_ids: [],
  links: [],
  videos: [],
  player_notes: [],
  drill_id: null,
  tag_ids: [],
});

/** One-line plain text summary of stored notes HTML. */
export function htmlPreview(html: string) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = DOMPurify.sanitize(html);
  return [...d.querySelectorAll('p')]
    .map((p) => (p.textContent || '').trim())
    .filter(Boolean)
    .join(' · ');
}
