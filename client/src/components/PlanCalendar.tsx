import { useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { KIND_LABEL, PLAN_STATE_LABEL, planStateOf, type ScheduleEntry } from '../schedule';
import { fmtClock, fmtDateShort, fmtDuration, parseClock, planMinutes, schedule } from '../util';
import CategoryRows from './CategoryRows';
import MonthGrid from './MonthGrid';


const PEEK_WIDTH = 320;
/** With the schedule on the left and the categories on the right. */
const PEEK_WIDE = 600;
/** How many of a practice's items the summary lists before saying how many more there are. */
const PEEK_ITEMS = 14;

/**
 * What pops up beside something on the calendar while the pointer is over it: when and where it
 * is, and for a practice that has been planned, what is in it and where the time goes.
 */
export function Peek({ entry, at, today }: { entry: ScheduleEntry; at: { left: number; right: number; top: number }; today: string }) {
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
  // With categories to show, they go beside the schedule, so the summary is wide, not tall.
  const cats = !!mins && [...mins.byTag.keys()].some((k) => k !== 0);
  const wide = items.length > 0 && cats && window.innerWidth >= 640;
  const width = wide ? PEEK_WIDE : PEEK_WIDTH;
  // Stacked, on a narrow screen, the categories need the room under a shorter schedule.
  const rows = cats && !wide ? 7 : PEEK_ITEMS;
  // `at` is the sides of what it describes: beside it on the right when there is room, else on the left.
  const left = at.right + 8 + width <= window.innerWidth - 8 ? at.right + 8 : Math.max(8, at.left - 8 - width);
  // It starts level with what it describes, then moves up by however much of it would fall off
  // the bottom of the screen. Its real height is measured, since it depends on what is in it.
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(at.top);
  useLayoutEffect(() => {
    const height = box.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(at.top, window.innerHeight - height - 8)));
  }, [at.top, entry.key]);
  return (
    <div className="cal-peek" role="tooltip" ref={box} style={{ left, top, width }}>
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
        <div className={`cal-peek-cols ${wide ? 'two' : ''}`}>
          <div>
          <ol className="cal-peek-items">
            {items.slice(0, rows).map((it, i) => (
              <li key={i} className={it.kind === 'break' ? 'break' : ''}>
                <time>{fmtClock(slots[i].start)}</time>
                <span>{it.title || (it.kind === 'break' ? 'Break' : 'Untitled')}</span>
                <small>{it.duration_min} min</small>
              </li>
            ))}
          </ol>
          {items.length > rows && <p className="cal-peek-more">and {items.length - rows} more</p>}
          </div>
          {mins && cats && (
            <div className="cal-peek-cats">
              <CategoryRows mins={mins} tags={sportTags} empty="" />
            </div>
          )}
        </div>
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
  // What the pointer is over, and where its summary should go.
  const [peek, setPeek] = useState<{ entry: ScheduleEntry; left: number; right: number; top: number } | null>(null);
  const showPeek = (entry: ScheduleEntry) => (ev: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    // The summary puts itself beside this, and keeps itself on the screen.
    setPeek({ entry, left: r.left, right: r.right, top: r.top - 8 });
  };
  const hidePeek = () => setPeek(null);

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
    <MonthGrid
      entries={entries}
      today={today}
      nextKey={nextKey}
      chip={chip}
      onAdd={onAdd}
      legend={<span className="cal-chip practice unplanned">No plan yet</span>}
    >
      {peek && <Peek entry={peek.entry} at={peek} today={today} />}
    </MonthGrid>
  );
}
