import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Plan, ScheduleEvent, Tag } from '../types';
import { daysBetween, fmtClock, fmtDateShort, fmtDuration, parseClock, planMinutes, todayISO } from '../util';
import { Field, Modal, TagChip } from './bits';
import SchedulePreview from './SchedulePreview';
import { KIND_LABEL, buildSchedule, isStrayBlank, withoutDuplicateBlanks, type ScheduleEntry } from '../schedule';

const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
/** Cards shown on each side of the big one. */
const SIDE = 2;
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
 * sits large in the middle, with earlier ones to its left and later ones to its right.
 */
export default function PracticeTimeline({ plans, tags, onChanged }: { plans: Plan[]; tags: Tag[]; /** Called after a plan was changed here, so the page reads its plans again. */ onChanged: () => void }) {
  const app = useApp();
  const team = app.team!;
  const { reload } = app;
  const navigate = useNavigate();
  const today = todayISO();
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  /** The card being edited: its type, and for a plan its title, date, time and place. */
  const [editing, setEditing] = useState<Entry | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setEvents([]);
    if (!team.calendar_url) return;
    let alive = true;
    const load = () => api.events(team.id, '2000-01-01').then((ev) => alive && setEvents(ev));
    const last = team.calendar_synced_at ? new Date(team.calendar_synced_at).getTime() : 0;
    // Refresh the linked calendar quietly when the last sync is old. A failed refresh keeps the last copy.
    (Date.now() - last > STALE_AFTER_MS ? api.syncCalendar(team.id).then(reload, () => {}) : Promise.resolve())
      .then(load)
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
  const shownFor = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const origin = el.getBoundingClientRect();
    const moved = shownFor.current !== undefined && shownFor.current !== focusKey;
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
    shownFor.current = focusKey;
  });

  if (entries.length === 0) return null;

  // "Next up" is the first thing today or later. With nothing ahead, it is the most recent one.
  const nextIndex = entries.findIndex((e) => e.date >= today);
  const homeIndex = nextIndex >= 0 ? nextIndex : entries.length - 1;
  const found = entries.findIndex((e) => e.key === focusKey);
  const index = found >= 0 ? found : homeIndex;
  const focus = entries[index];
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
    const ready = !!e.plan && e.plan.items.length > 0;
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
    // The card itself is a button, so the preview button sits beside it in the same slot, not inside it.
    return (
      <div key={e.key} className="tl-slot" data-key={e.key}>
        <button type="button" className={`tl-card tl-small ${e.kind} ${past} ${next}`} title="Bring this to the middle" onClick={() => setFocusKey(e.key)}>
          {body}
        </button>
        {e.plan && <SchedulePreview plan={e.plan} label="" />}
      </div>
    );
  };

  const focusDone = focus.date < today;
  const mins = focus.plan ? planMinutes(focus.plan, new Set(tags.map((t) => t.id))) : null;
  const heading = index === homeIndex && nextIndex >= 0 ? 'Next up' : focus.date < today ? 'Earlier' : 'Coming up';

  return (
    <section className="timeline" aria-label="Practice timeline">
      {error && <p className="error">{error}</p>}
      <div className="tl-row">
        <button className="tl-arrow" aria-label="Earlier" disabled={index === 0} onClick={() => setFocusKey(entries[index - 1].key)}>
          ‹
        </button>
        <div className="tl-track" ref={track}>
          {Array.from({ length: SIDE }, (_, i) => small(entries[index - SIDE + i], i))}

          <div data-key={focus.key} className={`tl-card tl-focus ${focus.kind} ${focus.key === nextKey ? 'tl-next' : ''} ${focusDone ? 'done' : ''}`}>
            <div className="tl-eyebrow">
              <span>
                {focusDone && doneMark} {focusDone ? 'Completed' : heading} · {relative(focus.date, today)}
              </span>
              <span className={`kind ${focus.kind}`}>{KIND_LABEL[focus.kind]}</span>
            </div>
            <div className="tl-date">{fmtDateShort(focus.date)}</div>
            <div className="tl-time">
              {timeRange(focus)} {planState(focus)}
            </div>
            <div className="tl-title">
              {focus.title}
              {focus.location && <span className="muted"> · {focus.location}</span>}
            </div>
            {focus.plan && mins && (
              <>
                <div className="muted small">
                  {focus.plan.items.length === 0
                    ? 'Nothing scheduled in this plan yet.'
                    : `${focus.plan.items.filter((i) => i.kind === 'item').length} items · ${fmtDuration(mins.work + mins.breaks)}`}
                </div>
                <div className="chips">
                  {tags
                    .filter((t) => mins.byTag.has(t.id))
                    .map((t) => (
                      <TagChip key={t.id} tag={t} minutes={mins.byTag.get(t.id)} />
                    ))}
                </div>
              </>
            )}
            <div className="tl-actions">
              {focus.plan ? (
                <>
                  <Link className="btn primary" to={`/plans/${focus.plan.id}`}>
                    Open practice
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

          {Array.from({ length: SIDE }, (_, i) => small(entries[index + 1 + i], SIDE + i))}
        </div>
        <button className="tl-arrow" aria-label="Later" disabled={index === entries.length - 1} onClick={() => setFocusKey(entries[index + 1].key)}>
          ›
        </button>
      </div>
      <div className="tl-foot">
        {index !== homeIndex && (
          <button className="link small" onClick={() => setFocusKey(null)}>
            Back to {nextIndex >= 0 ? 'next up' : 'most recent'}
          </button>
        )}
        {!team.calendar_url && (
          <span className="muted small">
            Use GameChanger? <Link to="/teams">Link the team calendar</Link> to see games and scheduled practices here.
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
