import { useMemo, useState, type ReactNode } from 'react';
import { fmtDateShort } from '../util';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
/** "2026-11-12" to the first of its month, as [year, month index]. */
const monthOf = (date: string): [number, number] => [Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1];

/**
 * A team's month on a grid, the same for a coach and for the team's parents, family and friends.
 * It opens on the month that holds what is next, and today's square stands out.
 *
 * It knows nothing of what a day's entries can do. Whoever uses it draws each one (`chip`), so a
 * coach's opens a plan and a parent's opens something to read; and only someone given `onAdd` has
 * the "+" on each day.
 */
export default function MonthGrid<E extends { key: string; date: string; kind: 'practice' | 'game' | 'other' }>({
  entries,
  today,
  nextKey,
  chip,
  onAdd,
  legend,
  children,
}: {
  entries: E[];
  today: string;
  nextKey: string | null;
  chip: (entry: E) => ReactNode;
  /** Adding something on a day. Left out for someone who can only read. */
  onAdd?: (date: string) => void;
  /** More chips for the key under the grid, after Practice, Game and Event. */
  legend?: ReactNode;
  children?: ReactNode;
}) {
  // Open on the month that holds what is coming up next.
  const home = monthOf(entries.find((e) => e.key === nextKey)?.date ?? today);
  const [[year, month], setMonth] = useState<[number, number]>(home);
  const byDate = useMemo(() => {
    const map = new Map<string, E[]>();
    for (const e of entries) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [entries]);
  const shift = (by: number) => {
    const d = new Date(year, month + by, 1);
    setMonth([d.getFullYear(), d.getMonth()]);
  };
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Whole weeks: leading days from last month and trailing days from the next fill the grid.
  const cells: { date: string; inMonth: boolean; day: number }[] = [];
  for (let i = -first.getDay(); cells.length % 7 !== 0 || i < daysInMonth; i++) {
    const d = new Date(year, month, 1 + i);
    cells.push({ date: iso(d.getFullYear(), d.getMonth(), d.getDate()), inMonth: d.getMonth() === month, day: d.getDate() });
  }
  const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const atHome = year === home[0] && month === home[1];
  const monthEntries = entries.filter((e) => e.date.startsWith(`${year}-${pad(month + 1)}`));
  const count = (kind: E['kind']) => monthEntries.filter((e) => e.kind === kind).length;
  const summary = [
    count('practice') && `${count('practice')} practice${count('practice') === 1 ? '' : 's'}`,
    count('game') && `${count('game')} game${count('game') === 1 ? '' : 's'}`,
    count('other') && `${count('other')} other`,
  ].filter(Boolean);

  return (
    <section className="cal" aria-label="Calendar">
      <div className="cal-head">
        <div className="cal-nav">
          <button type="button" className="tl-arrow" aria-label="Previous month" onClick={() => shift(-1)}>
            ‹
          </button>
          <h2 className="cal-title">{title}</h2>
          <button type="button" className="tl-arrow" aria-label="Next month" onClick={() => shift(1)}>
            ›
          </button>
          {!atHome && (
            <button type="button" className="link small" onClick={() => setMonth(home)}>
              Back to next up
            </button>
          )}
        </div>
        <span className="muted small">{summary.length ? summary.join(' · ') : 'Nothing scheduled this month'}</span>
      </div>

      <div className="cal-grid" role="grid" aria-label={title}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-weekday" role="columnheader">
            {d}
          </div>
        ))}
        {cells.map((c) => (
          <div key={c.date} role="gridcell" className={`cal-day ${c.inMonth ? '' : 'out'} ${c.date === today ? 'today' : ''} ${c.date < today ? 'past' : ''}`}>
            <div className="cal-day-top">
              <span className="cal-num">{c.day}</span>
              {c.date === today && <span className="cal-today">Today</span>}
              {onAdd && (
                <button type="button" className="cal-add" aria-label={`Add a practice on ${fmtDateShort(c.date)}`} onClick={() => onAdd(c.date)}>
                  +
                </button>
              )}
            </div>
            {(byDate.get(c.date) ?? []).map(chip)}
          </div>
        ))}
      </div>

      <div className="cal-legend muted small">
        <span className="cal-chip practice">Practice</span>
        <span className="cal-chip game">Game</span>
        <span className="cal-chip other">Event</span>
        {legend}
        <span className="cal-chip practice done">
          <span className="cal-check" aria-hidden="true">
            ✓
          </span>
          Completed
        </span>
        <span className="cal-chip practice next">Next up</span>
      </div>
      {children}
    </section>
  );
}
