import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Plan, ScheduleEvent, Tag } from '../types';
import { daysBetween, fmtClock, fmtDateShort, fmtDuration, parseClock, planMinutes, todayISO } from '../util';
import { Field, Modal } from './bits';
import SchedulePreview from './SchedulePreview';
import SportIcon from './SportIcon';
import { KIND_LABEL, buildSchedule, isStrayBlank, planFilled, withoutDuplicateBlanks, type ScheduleEntry } from '../schedule';

/** Smaller cards shown to the right of the big one. The arrows move through these; the big one stays. */
const AFTER = 4;
type Entry = ScheduleEntry;

const relative = (date: string, today: string) => {
  const d = daysBetween(today, date);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return d > 0 ? `In ${d} days` : `${-d} days ago`;
};

/**
 * A strip of the team's practices and calendar events in date order. The next one coming up
 * stays large on the left. Beside it are smaller cards for everything else, starting with what
 * follows it: the arrows move those back and forward in time.
 */
export default function PracticeTimeline({ plans, tags, onChanged }: { plans: Plan[]; tags: Tag[]; /** Called after a plan was changed here, so the page reads its plans again. */ onChanged: () => void }) {
  const app = useApp();
  const team = app.team!;
  const navigate = useNavigate();
  const today = todayISO();
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  /** The card being edited: its type, and for a plan its title, date, time and place. */
  const [editing, setEditing] = useState<Entry | null>(null);
  // Where the row of smaller cards starts, counted in everything except the big one. Null is "just after the big one".
  const [startAt, setStartAt] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setEvents([]);
    if (!team.calendar_url) return;
    let alive = true;
    // The events as they were when the calendar was last read. It is read again only from the Practices page, when asked.
    api
      .events(team.id, '2000-01-01')
      .then((ev) => alive && setEvents(ev))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // Only when the team or its link changes, not on every sync timestamp update.
  }, [team.id, team.calendar_url]);

  // Blank plans left behind for today or earlier get no card, so "next up" is the next real event.
  const entries = useMemo(() => withoutDuplicateBlanks(buildSchedule(plans, events).filter((e) => !isStrayBlank(e, today))), [plans, events, today]);

  // When a different card takes the middle, every card glides from where it was to where it now
  // sits (and the one that was clicked grows into the big card), so the strip reads as sliding over.
  const track = useRef<HTMLDivElement>(null);
  const places = useRef(new Map<string, { x: number; y: number; w: number; h: number }>());
  const shownFor = useRef<number | null | undefined>(undefined);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const origin = el.getBoundingClientRect();
    const moved = shownFor.current !== undefined && shownFor.current !== startAt;
    const animate = moved && typeof el.animate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timing = { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
    const now = new Map<string, { x: number; y: number; w: number; h: number }>();
    el.querySelectorAll<HTMLElement>('[data-key]').forEach((node) => {
      // Measured without any glide still running, so a quick second click starts from the right place.
      node.getAnimations().forEach((a) => a.cancel());
      const r = node.getBoundingClientRect();
      const at = { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
      now.set(node.dataset.key!, at);
      if (!animate) return;
      const was = places.current.get(node.dataset.key!);
      if (!was) node.animate([{ opacity: 0 }, { opacity: 1 }], timing);
      else if (was.x !== at.x || was.w !== at.w)
        node.animate(
          [
            { transformOrigin: 'top left', transform: `translate(${was.x - at.x}px, ${was.y - at.y}px) scale(${was.w / at.w}, ${was.h / at.h})` },
            { transformOrigin: 'top left', transform: 'none' },
          ],
          timing,
        );
    });
    places.current = now;
    shownFor.current = startAt;
  });

  if (entries.length === 0) return null;

  // "Next up" is the first thing today or later. With nothing ahead, it is the most recent one.
  const nextIndex = entries.findIndex((e) => e.date >= today);
  const homeIndex = nextIndex >= 0 ? nextIndex : entries.length - 1;
  // The big card never changes. The smaller ones are everything else, and the arrows slide along them.
  const focus = entries[homeIndex];
  const others = entries.filter((_, i) => i !== homeIndex);
  // What comes after the big card is where the row starts, unless there is nothing after it.
  const homeStart = Math.min(homeIndex, Math.max(0, others.length - 1));
  // How many smaller cards fit: four, two on a tablet, one on a phone. The row stops once the last one is showing.
  const fits = window.innerWidth <= 640 ? 1 : window.innerWidth <= 1000 ? 2 : AFTER;
  const lastStart = Math.max(homeStart, others.length - fits, 0);
  const start = Math.max(0, Math.min(startAt ?? homeStart, lastStart));
  // The slot the next-up card would take if it were in the row. Past the last card only when nothing follows it.
  const nowAt = homeIndex - start;
  const nowSlot = nextIndex >= 0 && others.length > 0 && nowAt >= 0 && (nowAt < fits || (nowAt === fits && homeIndex === others.length)) ? nowAt : null;
  // Today's or the next upcoming entry keeps its own color wherever it sits in the strip.
  const nextKey = nextIndex >= 0 ? entries[nextIndex].key : null;

  const planEvent = async (e: Entry) => {
    try {
      const p = await api.createPlan({ team_id: team.id, kind: 'practice', title: e.kind === 'game' ? e.title : 'Practice', is_game: e.kind === 'game', date: e.date, start_time: e.time || undefined, location: e.location });
      navigate(`/plans/${p.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const timeRange = (e: Entry) => {
    if (e.plan) {
      const m = planMinutes(e.plan);
      const start = parseClock(e.plan.start_time);
      return `${fmtClock(start)} - ${fmtClock(start + m.work + m.breaks)}`;
    }
    if (!e.time) return 'All day';
    const start = fmtClock(parseClock(e.time));
    return e.event?.end_time ? `${start} - ${fmtClock(parseClock(e.event.end_time))}` : start;
  };
  // Whether there is a usable plan behind this entry. Shown as a badge so a gap is hard to miss.
  const planState = (e: Entry) => {
    const ready = !!e.plan && planFilled(e.plan);
    return (
      <span className={`plan-state ${ready ? 'ready' : 'missing'}`}>
        <span aria-hidden="true">{ready ? '✓' : '!'}</span>
        {ready ? 'Planned' : e.plan ? 'Plan is empty' : 'No plan yet'}
      </span>
    );
  };

  const doneMark = (
    <span className="status good done-mark" title="Completed" role="img" aria-label="Completed">
      ✓
    </span>
  );
  const small = (e: Entry | undefined, slot: number) => {
    if (!e) return <div key={`blank${slot}`} className="tl-slot tl-blank" aria-hidden="true" />;
    const body = (
      <>
        <span className="tl-when">{fmtDateShort(e.date)}</span>
        <span className="tl-tags">
          {e.date < today && doneMark}
          {e.key === nextKey && <span className="tl-flag">{e.date === today ? 'Today' : 'Next up'}</span>}
          <span className={`kind ${e.kind}`}>{KIND_LABEL[e.kind]}</span>
        </span>
        <span className="tl-title">{e.title}</span>
        <span className="muted small">{timeRange(e)}</span>
        {planState(e)}
      </>
    );
    const past = e.date < today ? 'past done' : '';
    const next = e.key === nextKey ? 'tl-next' : '';
    // The card itself is a link or a button, so the preview button sits beside it in the same slot, not inside it.
    return (
      <div key={e.key} className="tl-slot" data-key={e.key}>
        {e.plan ? (
          <Link className={`tl-card tl-small ${e.kind} ${past} ${next}`} to={`/plans/${e.plan.id}`} title="Open this practice">
            {body}
          </Link>
        ) : (
          <button type="button" className={`tl-card tl-small ${e.kind} ${past} ${next}`} title={`Plan this ${e.kind === 'game' ? 'game' : e.kind === 'practice' ? 'practice' : 'event'}`} onClick={() => planEvent(e)}>
            {body}
          </button>
        )}
        {e.plan && <SchedulePreview plan={e.plan} label="" />}
      </div>
    );
  };

  const focusDone = focus.date < today;
  const mins = focus.plan ? planMinutes(focus.plan, new Set(tags.map((t) => t.id))) : null;
  const heading = nextIndex >= 0 ? 'Next up' : 'Most recent';

  return (
    <section className="timeline" aria-label="Practice timeline">
      {error && <p className="error">{error}</p>}
      <div className="tl-head">
        <Link className="tl-cal-link" to="/practices?view=calendar">
          View calendar <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="tl-row">
        <div className="tl-track" ref={track}>
          <div data-key={focus.key} className={`tl-card tl-focus ${focus.kind} ${focus.key === nextKey ? 'tl-next' : ''} ${focusDone ? 'done' : ''}`}>
            {/* The ball of the team's sport, faint, in the corner. */}
            <span className="tl-ball" aria-hidden="true">
              <SportIcon sport={app.sport?.name} size={190} />
            </span>
            <div className="tl-eyebrow">
              <span>
                {focusDone && doneMark} {focusDone ? 'Completed' : heading} · {relative(focus.date, today)}
              </span>
              <span className={`kind ${focus.kind}`}>{KIND_LABEL[focus.kind]}</span>
            </div>
            <div className="tl-date">{fmtDateShort(focus.date)}</div>
            <div className="tl-title">{focus.title}</div>
            <div className="tl-where">
              <span className="tl-time">{timeRange(focus)}</span>
              {focus.location && (
                <span className="tl-place">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 21s-6.500-6-6.500-11a6.500 6.500 0 0 1 13 0c0 5-6.500 11-6.500 11ZM12 12.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5Z" />
                  </svg>
                  {focus.location}
                </span>
              )}
              {planState(focus)}
            </div>
            {focus.plan && mins && (
              <>
                <div className="muted small">
                  {focus.plan.is_game
                    ? planFilled(focus.plan)
                      ? [focus.plan.game?.opponent && `${focus.plan.game.side === 'away' ? 'at' : 'vs.'} ${focus.plan.game.opponent}`, 'Game plan started'].filter(Boolean).join(' · ')
                      : 'Nothing in this game plan yet.'
                    : focus.plan.items.length === 0
                      ? 'Nothing scheduled in this plan yet.'
                      : `${focus.plan.items.filter((i) => i.kind === 'item').length} items · ${fmtDuration(mins.work + mins.breaks)}`}
                </div>
              </>
            )}
            <div className="tl-actions">
              {focus.plan ? (
                <>
                  <Link className="btn primary" to={`/plans/${focus.plan.id}`}>
                    {focus.plan.is_game ? 'Open game plan' : 'Open practice'}
                  </Link>
                  <SchedulePreview plan={focus.plan} />
                  <Link className="btn" to={`/plans/${focus.plan.id}/print`}>
                    Print / share
                  </Link>
                </>
              ) : (
                <button className="btn primary" onClick={() => planEvent(focus)}>
                  {focus.kind === 'game' ? 'Plan this game' : focus.kind === 'practice' ? 'Plan this practice' : 'Plan this event'}
                </button>
              )}
              <button className="btn" onClick={() => setEditing(focus)} title="Change what this is: a practice, a game or something else">
                Edit
              </button>
            </div>
          </div>

          {/* The arrows sit either side of the smaller cards, since those are what they move. */}
          <div className="tl-rest">
            <button className="tl-arrow" aria-label="Earlier" disabled={start === 0} onClick={() => setStartAt(start - 1)}>
              ‹
            </button>
            <div className="tl-smalls">
              {Array.from({ length: AFTER }, (_, i) => small(others[start + i], i))}
              {/* Where the big card belongs in date order: a line between the cards on either side of it. */}
              {nowSlot !== null && <span className="tl-nowline" style={{ '--i': nowSlot } as React.CSSProperties} role="img" aria-label="Next up falls here" title="Next up falls here" />}
            </div>
            <button className="tl-arrow" aria-label="Later" disabled={start >= lastStart} onClick={() => setStartAt(start + 1)}>
              ›
            </button>
          </div>
        </div>
      </div>
      <div className="tl-foot">
        {start !== homeStart && (
          <button className="link small" onClick={() => setStartAt(null)}>
            Back to what is coming up
          </button>
        )}
        {!team.calendar_url && (
          <span className="muted small">
            Use GameChanger? <Link to="/teams?tab=schedule">Link the team calendar</Link> to see games and scheduled practices here.
          </span>
        )}
      </div>
      {editing && (
        <EditEntry
          entry={editing}
          teamId={team.id}
          onClose={() => setEditing(null)}
          onSaved={(event) => {
            setEditing(null);
            // A calendar event changes here. A plan belongs to the page, which reads its plans again.
            if (event) setEvents((all) => all.map((ev) => (ev.id === event.id ? event : ev)));
            else onChanged();
          }}
        />
      )}
    </section>
  );
}

const KINDS: ScheduleEvent['kind'][] = ['practice', 'game', 'other'];
/**
 * Edits one card. A practice or game that has a plan can change its type, title, date, start time
 * and place. Something that is only on the team calendar can change its type: the rest still
 * comes from the calendar.
 */
function EditEntry({ entry, teamId, onClose, onSaved }: { entry: Entry; teamId: number; onClose: () => void; onSaved: (event?: ScheduleEvent) => void }) {
  const plan = entry.plan;
  const [kind, setKind] = useState<ScheduleEvent['kind']>(entry.kind);
  const [title, setTitle] = useState(plan?.title ?? '');
  const [date, setDate] = useState(plan?.date ?? '');
  const [start, setStart] = useState(plan?.start_time ?? '');
  const [place, setPlace] = useState(plan?.location ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A plan is a practice or a game. Only something left on the calendar can be "another event".
  const kinds = plan ? KINDS.filter((k) => k !== 'other') : KINDS;
  const save = async () => {
    setBusy(true);
    try {
      if (plan) {
        await api.savePlan({ ...plan, is_game: kind === 'game', title, date, start_time: start || plan.start_time, location: place });
        onSaved();
      } else if (entry.event) onSaved(await api.setEventKind(teamId, entry.event.id, kind));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={plan ? 'Edit this practice or game' : 'Edit this event'} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {error && <p className="error">{error}</p>}
        <div className="field">
          <span className="field-label">This is a</span>
          <div className="seg" role="group" aria-label="Type of event">
            {kinds.map((k) => (
              <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === 'other' ? 'Other event' : KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        {plan ? (
          <>
            <Field label="Title">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className="fields">
              <Field label="Date">
                <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Start time">
                <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
            </div>
            <Field label="Location">
              <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} />
            </Field>
            <p className="muted small">A game is left out of the dashboard's practice totals and category targets.</p>
          </>
        ) : (
          <p className="muted small">
            "{entry.title}" on {fmtDateShort(entry.date)} comes from the team calendar, so its date, time and place are changed there. Your choice of type is kept
            each time the calendar is read again.
          </p>
        )}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
