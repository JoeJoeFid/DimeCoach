import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { KIND_LABEL, PLAN_STATE_LABEL, planStateOf, type ScheduleEntry } from '../schedule';
import { fmtClock, fmtDateShort, parseClock } from '../util';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
/** "2026-11-12" to the first of its month, as [year, month index]. */
const monthOf = (date: string): [number, number] => [Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1];

/**
 * The team's practices, games and calendar events on a month grid. A planned entry opens its
 * practice. One with no plan yet offers to start it, and any day can have a practice added.
 */
export default function PlanCalendar({
  entries,
  today,
  nextKey,
  onPlan,
  onAdd,
}: {
  entries: ScheduleEntry[];
  today: string;
  nextKey: string | null;
  onPlan: (e: ScheduleEntry) => void;
  onAdd: (date: string) => void;
}) {
  // Open on the month that holds what is coming up next.
  const home = monthOf(entries.find((e) => e.key === nextKey)?.date ?? today);
  const [[year, month], setMonth] = useState<[number, number]>(home);

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
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
  const count = (kind: ScheduleEntry['kind']) => monthEntries.filter((e) => e.kind === kind).length;
  const summary = [
    count('practice') && `${count('practice')} practice${count('practice') === 1 ? '' : 's'}`,
    count('game') && `${count('game')} game${count('game') === 1 ? '' : 's'}`,
    count('other') && `${count('other')} other`,
  ].filter(Boolean);

  const chip = (e: ScheduleEntry) => {
    const done = e.date < today;
    const state = planStateOf(e);
    const time = e.time ? fmtClock(parseClock(e.time)) : '';
    const name = e.plan ? e.plan.title || 'Practice' : e.title;
    const cls = `cal-chip ${e.kind} ${done ? 'done' : ''} ${e.key === nextKey ? 'next' : ''} ${state === 'ready' ? '' : 'unplanned'}`;
    const label = `${KIND_LABEL[e.kind]}: ${name}, ${fmtDateShort(e.date)}${time ? `, ${time}` : ''}. ${done && state === 'ready' ? 'Completed' : PLAN_STATE_LABEL[state]}.`;
    const body = (
      <>
        {done && state === 'ready' && (
          <span className="cal-check" aria-hidden="true">
            ✓
          </span>
        )}
        {time && <span className="cal-time">{time}</span>}
        <span className="cal-name">{name}</span>
      </>
    );
    return e.plan ? (
      <Link key={e.key} to={`/plans/${e.plan.id}`} className={cls} aria-label={label}>
        {body}
      </Link>
    ) : (
      <button key={e.key} type="button" className={cls} aria-label={`${label} Click to plan it.`} onClick={() => onPlan(e)}>
        {body}
      </button>
    );
  };

  return (
    <section className="cal" aria-label="Practice calendar">
      <div className="cal-head">
        <div className="cal-nav">
          <button className="tl-arrow" aria-label="Previous month" onClick={() => shift(-1)}>
            ‹
          </button>
          <h2 className="cal-title">{title}</h2>
          <button className="tl-arrow" aria-label="Next month" onClick={() => shift(1)}>
            ›
          </button>
          {!atHome && (
            <button className="link small" onClick={() => setMonth(home)}>
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
              <button className="cal-add" aria-label={`Add a practice on ${fmtDateShort(c.date)}`} onClick={() => onAdd(c.date)}>
                +
              </button>
            </div>
            {(byDate.get(c.date) ?? []).map(chip)}
          </div>
        ))}
      </div>

      <div className="cal-legend muted small">
        <span className="cal-chip practice">Practice</span>
        <span className="cal-chip game">Game</span>
        <span className="cal-chip other">Event</span>
        <span className="cal-chip practice unplanned">No plan yet</span>
        <span className="cal-chip practice done">
          <span className="cal-check" aria-hidden="true">
            ✓
          </span>
          Completed
        </span>
        <span className="cal-chip practice next">Next up</span>
      </div>
    </section>
  );
}
