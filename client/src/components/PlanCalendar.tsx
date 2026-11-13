import { useMemo, useState, type FocusEvent, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { KIND_LABEL, PLAN_STATE_LABEL, planStateOf, type ScheduleEntry } from '../schedule';
import { fmtClock, fmtDateShort, fmtDuration, parseClock, planMinutes, schedule } from '../util';
import CategoryRows from './CategoryRows';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
/** "2026-11-12" to the first of its month, as [year, month index]. */
const monthOf = (date: string): [number, number] => [Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1];

const PEEK_WIDTH = 320;
/** How many of a practice's items the summary lists before saying how many more there are. */
const PEEK_ITEMS = 7;

/**
 * What pops up beside something on the calendar while the pointer is over it: when and where it
 * is, and for a practice that has been planned, what is in it and where the time goes.
 */
function Peek({ entry, at, today }: { entry: ScheduleEntry; at: { left: number; top: number }; today: string }) {
  const { sportTags } = useApp();
  const plan = entry.plan;
  const state = planStateOf(entry);
  const done = entry.date < today;
  const items = plan?.items ?? [];
  const slots = plan ? schedule(plan.start_time, items) : [];
  const mins = plan ? planMinutes(plan, new Set(sportTags.map((t) => t.id))) : null;
  const total = mins ? mins.work + mins.breaks : 0;
  const start = entry.time ? fmtClock(parseClock(entry.time)) : '';
  // A planned practice ends when its last item does. A calendar event says when it ends.
  const end = slots.length > 0 ? fmtClock(slots[slots.length - 1].end) : entry.event?.end_time ? fmtClock(parseClock(entry.event.end_time)) : '';
  const location = plan?.location || entry.location;
  return (
    <div className="cal-peek" role="tooltip" style={{ left: at.left, top: at.top, width: PEEK_WIDTH }}>
      <div className="cal-peek-top">
        <span className={`kind ${entry.kind === 'game' ? 'game' : entry.kind === 'practice' ? 'practice' : ''}`}>{KIND_LABEL[entry.kind]}</span>
        <span className={`cal-peek-state ${state}`}>{done && state === 'ready' ? 'Completed' : PLAN_STATE_LABEL[state]}</span>
      </div>
      <strong className="cal-peek-title">{plan ? plan.title || 'Practice' : entry.title}</strong>
      <p className="cal-peek-when">
        {[fmtDateShort(entry.date), start && (end ? `${start} to ${end}` : start), total > 0 && fmtDuration(total)].filter(Boolean).join(' · ')}
      </p>
      {location && <p className="cal-peek-where">{location}</p>}
      {entry.event?.notes && <p className="cal-peek-notes">{entry.event.notes}</p>}
      {items.length > 0 ? (
        <>
          <ol className="cal-peek-items">
            {items.slice(0, PEEK_ITEMS).map((it, i) => (
              <li key={i} className={it.kind === 'break' ? 'break' : ''}>
                <time>{fmtClock(slots[i].start)}</time>
                <span>{it.title || (it.kind === 'break' ? 'Break' : 'Untitled')}</span>
                <small>{it.duration_min} min</small>
              </li>
            ))}
          </ol>
          {items.length > PEEK_ITEMS && <p className="cal-peek-more">and {items.length - PEEK_ITEMS} more</p>}
          {mins && [...mins.byTag.keys()].some((k) => k !== 0) && (
            <div className="cal-peek-cats">
              <CategoryRows mins={mins} tags={sportTags} empty="" />
            </div>
          )}
        </>
      ) : (
        <p className="cal-peek-more">
          {plan?.is_game && state === 'ready'
            ? [plan.game?.opponent && `${plan.game.side === 'away' ? 'at' : 'vs.'} ${plan.game.opponent}`, plan.game?.arrive && `arrive by ${fmtClock(parseClock(plan.game.arrive))}`, plan.game?.uniform, 'Game plan started. Click to open it.'].filter(Boolean).join(' · ')
            : entry.kind === 'practice' || plan
              ? plan
                ? 'Nothing has been added to this plan yet. Click to open it.'
                : 'No plan yet. Click to plan it.'
              : 'From the team calendar.'}
        </p>
      )}
    </div>
  );
}

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
  // What the pointer is over, and where its summary should go.
  const [peek, setPeek] = useState<{ entry: ScheduleEntry; left: number; top: number } | null>(null);
  const showPeek = (entry: ScheduleEntry) => (ev: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    // Beside it on the right when there is room, else on the left. Kept on the screen top and bottom.
    const right = r.right + 8 + PEEK_WIDTH <= window.innerWidth - 8;
    const left = right ? r.right + 8 : Math.max(8, r.left - 8 - PEEK_WIDTH);
    const guess = 150 + Math.min(PEEK_ITEMS, entry.plan?.items.length ?? 0) * 26 + (entry.plan?.items.length ? 130 : 0);
    setPeek({ entry, left, top: Math.max(8, Math.min(r.top - 8, window.innerHeight - guess - 8)) });
  };
  const hidePeek = () => setPeek(null);

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
    const hover = { onMouseEnter: showPeek(e), onMouseLeave: hidePeek, onFocus: showPeek(e), onBlur: hidePeek };
    return e.plan ? (
      <Link key={e.key} to={`/plans/${e.plan.id}`} className={cls} aria-label={label} {...hover}>
        {body}
      </Link>
    ) : (
      <button
        key={e.key}
        type="button"
        className={cls}
        aria-label={`${label} Click to plan it.`}
        onClick={() => {
          hidePeek();
          onPlan(e);
        }}
        {...hover}
      >
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
      {peek && <Peek entry={peek.entry} at={peek} today={today} />}
    </section>
  );
}
