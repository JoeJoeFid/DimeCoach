import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Plan, PlanKind, PlanSummary, ScheduleEvent } from '../types';
import { fmtClock, fmtDateShort, fmtDuration, fmtSynced, parseClock, planMinutes, todayISO } from '../util';
import { buildSchedule, withoutDuplicateBlanks, nextEntry, planStateOf, type ScheduleEntry } from '../schedule';
import { MoreMenu, TagChip, type MenuItem } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { deleteLater, useCompletedDeletes, usePendingDeletes } from '../components/toasts';
import PlanCalendar from '../components/PlanCalendar';
import { CommunityPicker } from '../components/community';

type View = 'list' | 'calendar';
type Filter = 'all' | ScheduleEntry['kind'];
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['practice', 'Practices'],
  ['game', 'Games'],
  ['other', 'Events'],
];
// Small line drawings used in the rows.
const icons = {
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.500V12l3 2',
  pin: 'M12 21s6.500-5.600 6.500-11A6.500 6.500 0 0 0 5.500 10c0 5.400 6.500 11 6.500 11ZM12 12.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5Z',
  check: 'M5 12.500l4.500 4.500L19 7.500',
  alert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.500v5.500M12 16.300v.200',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 5.500H5.500v1.500A2.500 2.500 0 0 0 8 9.500M16 5.500h2.500v1.500a2.500 2.500 0 0 1-2.500 2.500M12 13v4M8.500 20h7M9.500 17h5',
  flag: 'M6 3v18M6 4.500h12l-3 3.500 3 3.500H6',
  chevron: 'M6 9.500l6 6 6-6',
};
const Icon = ({ d }: { d: string }) => (
  <svg className="ps-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const VIEW_KEY = 'pp.practicesView';
const savedView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch {
    return 'list';
  }
};

/**
 * Every practice (or homework sheet) for the team in one list, oldest at the top. For practices the
 * list also carries the team calendar, so games and practices that have no plan yet show in place.
 */
export default function Plans({ kind }: { kind: PlanKind }) {
  const { team, sportTags, user, reload } = useApp();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [templates, setTemplates] = useState<PlanSummary[]>([]);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [fromCommunity, setFromCommunity] = useState(false);
  const [view, setView] = useState<View>(savedView);
  /** The month on show, as "2026-11", and which kind of thing is listed. */
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const [only, setOnly] = useState<Filter>('all');
  // Homework sheets are not tied to dates the same way, so only practices get the calendar.
  const calendar = kind === 'practice' && view === 'calendar';
  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // The choice still holds for this visit.
    }
  };
  const noun = kind === 'practice' ? 'practice' : 'homework sheet';
  const teamId = team!.id;
  const hasCalendar = kind === 'practice' && !!team!.calendar_url;

  const load = useCallback(async () => {
    try {
      const [p, t, ev] = await Promise.all([
        api.plansFull(teamId, kind),
        api.plans(teamId, kind, true),
        hasCalendar ? api.events(teamId, '2000-01-01') : Promise.resolve([]),
      ]);
      setPlans(p);
      setTemplates(t);
      setEvents(ev);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [teamId, kind, hasCalendar]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await api.syncCalendar(teamId);
      await Promise.all([load(), reload()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [teamId, load, reload]);

  useEffect(() => {
    setPlans(null);
    load();
    // The team calendar is only read again when the coach asks: see the status line at the top of the page.
    // Only when the team, the kind of plan or the calendar link changes.
  }, [teamId, kind, hasCalendar]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const today = todayISO();
  const tagIds = useMemo(() => new Set(sportTags.map((t) => t.id)), [sportTags]);
  // Something just deleted is left out straight away, though it can still be undone for a few seconds.
  const gone = usePendingDeletes();
  // A practice deleted from its own page is gone for real once the time to undo runs out: read the list again then.
  const deletes = useCompletedDeletes();
  useEffect(() => {
    if (deletes > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletes]);
  // An empty plan that doubles up a filled-in one for the same day and time is left out, as on the dashboard.
  const entries = useMemo(() => withoutDuplicateBlanks(buildSchedule((plans || []).filter((p) => !gone.has(`plan:${p.id}`)), events)), [plans, events, gone]);
  const next = useMemo(() => nextEntry(entries, today), [entries, today]);
  const shownTemplates = templates.filter((t) => !gone.has(`plan:${t.id}`));

  // Open the page with what is coming up in the middle of the screen: the past above it, the rest
  // of the season below. Clicking the menu link again while here brings it back to the middle.
  const nextRow = useRef<HTMLLIElement>(null);
  const lastRow = useRef<HTMLLIElement>(null);
  const snapped = useRef('');
  const visit = useLocation().key;
  useEffect(() => {
    const where = `${teamId}:${kind}:${calendar}:${visit}`;
    if (plans === null || calendar || snapped.current === where) return;
    snapped.current = where;
    // Open on the month that holds what is coming up, with that row in the middle of the screen.
    if (next) setMonth(next.date.slice(0, 7));
    requestAnimationFrame(() => requestAnimationFrame(() => (nextRow.current ?? lastRow.current)?.scrollIntoView({ block: 'center' })));
  }, [plans, teamId, kind, entries, calendar, visit]);

  const create = (fromPlanId?: number, replace = false) =>
    act(async () => {
      const last = plans?.[0];
      // A new practice is most likely for the next one on the team calendar that has no plan yet.
      // With no calendar, or nothing left to plan, it starts on today's date.
      const open = entries.find((e) => e.date >= today && e.kind === 'practice' && !e.plan);
      const p = await api.createPlan({
        team_id: teamId,
        kind,
        title: kind === 'practice' ? 'Practice' : 'Homework',
        date: open?.date ?? today,
        start_time: fromPlanId ? undefined : open?.time || last?.start_time,
        location: fromPlanId ? undefined : open?.location || last?.location,
        from_plan_id: fromPlanId,
      });
      navigate(`/plans/${p.id}`, { replace });
    });
  // "Plan a practice" on the dashboard lands here asking for a new one: start it as soon as the
  // schedule is known, and take this stop out of the history so Back returns to the dashboard.
  const [params] = useSearchParams();
  const wantsNew = kind === 'practice' && params.get('new') === '1';
  const started = useRef(false);
  useEffect(() => {
    if (!wantsNew || plans === null || started.current) return;
    started.current = true;
    create(undefined, true);
  }, [wantsNew, plans]);
  const planEvent = (e: ScheduleEntry) =>
    act(async () => {
      const p = await api.createPlan({
        team_id: teamId,
        kind: 'practice',
        title: e.kind === 'game' ? e.title : 'Practice',
        is_game: e.kind === 'game',
        date: e.date,
        start_time: e.time || undefined,
        location: e.location,
      });
      navigate(`/plans/${p.id}`);
    });
  /** From the calendar: start the plan for a calendar event, after asking, since a click there is easy to make by accident. */
  const planFromCalendar = async (e: ScheduleEntry) => {
    const what = e.kind === 'game' ? 'game' : 'practice';
    if (!(await confirmDialog({ title: `Plan this ${what}?`, body: `${e.title} on ${fmtDateShort(e.date)} has no plan yet. This starts one.`, confirmLabel: `Plan ${what}` }))) return;
    planEvent(e);
  };
  const createOn = (date: string) =>
    act(async () => {
      const last = plans?.[0];
      const p = await api.createPlan({ team_id: teamId, kind: 'practice', title: 'Practice', date, start_time: last?.start_time, location: last?.location });
      navigate(`/plans/${p.id}`);
    });
  const duplicate = (p: Plan) =>
    act(async () => {
      const copy = await api.createPlan({ team_id: teamId, from_plan_id: p.id, date: today });
      navigate(`/plans/${copy.id}`);
    });
  const remove = (p: PlanSummary, what: string) =>
    act(async () => {
      if (!(await confirmDialog({ title: `Delete this ${what}?`, body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
      deleteLater({ key: `plan:${p.id}`, message: `Deleted the ${what}.`, run: () => api.deletePlan(p.id), done: load, failed: setError });
    });

  const row = (e: ScheduleEntry, i: number) => {
    const p = e.plan;
    const done = e.date < today;
    const isNext = e.key === next?.key;
    const state = planStateOf(e);
    const mins = p ? planMinutes(p, tagIds) : null;
    const total = mins ? mins.work + mins.breaks : 0;
    const start = parseClock(p ? p.start_time : e.time || '00:00');
    const when = p
      ? kind === 'practice'
        ? `${fmtClock(start)} - ${fmtClock(start + total)}`
        : ''
      : !e.time
        ? 'All day'
        : e.event?.end_time
          ? `${fmtClock(start)} - ${fmtClock(parseClock(e.event.end_time))}`
          : fmtClock(start);

    const d = new Date(`${e.date}T12:00:00`);
    const focus = p && mins ? sportTags.filter((t) => mins.byTag.has(t.id)) : [];
    const count = p ? p.items.filter((it) => it.kind === 'item').length : 0;
    // What the pill on the right says: a game is a game; otherwise how far along the plan is.
    const pill =
      e.kind === 'game' ? { cls: 'game', icon: icons.trophy, text: 'Game' } : e.kind === 'other' && !p ? { cls: 'event', icon: icons.flag, text: 'Event' } : state === 'ready' ? { cls: 'planned', icon: icons.check, text: 'Planned' } : state === 'empty' ? { cls: 'todo', icon: icons.alert, text: 'Empty' } : { cls: 'todo', icon: icons.alert, text: 'No plan yet' };
    const more: MenuItem[] = p
      ? [
          { label: 'Print / share', onSelect: () => navigate(`/plans/${p.id}/print`) },
          ...(kind === 'practice' && user.can_import ? [{ label: 'Import an old plan into it', onSelect: () => navigate(`/plans/${p.id}?import=1`) }] : []),
          { label: 'Duplicate', onSelect: () => duplicate(p) },
          { label: 'Delete', onSelect: () => remove(p, noun), danger: true },
        ]
      : [];

    return (
      <li
        key={e.key}
        ref={isNext ? nextRow : i === entries.length - 1 ? lastRow : undefined}
        className={`plan-row ps-row ${done ? 'done' : ''} ${isNext ? 'next' : ''} ${p ? '' : 'unplanned'}`}
        aria-current={isNext ? 'true' : undefined}
      >
        <span className="ps-date">
          <span className="ps-dow">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
          <strong>{d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</strong>
          {isNext && <span className="tl-flag">{e.date === today ? 'Today' : 'Next up'}</span>}
        </span>
        <span className="ps-main">
          {p ? (
            <Link to={`/plans/${p.id}`} className="ps-title plan-main">
              {p.title || 'Untitled'}
            </Link>
          ) : (
            <span className="ps-title">{e.title}</span>
          )}
          <span className="ps-meta">
            {when && (
              <span>
                <Icon d={icons.clock} />
                {when}
              </span>
            )}
            {p && kind === 'practice' && <span className="ps-dot">{fmtDuration(total)}</span>}
            {e.location && (
              <span className="ps-place">
                <Icon d={icons.pin} />
                {e.location.split('\n')[0]}
              </span>
            )}
          </span>
        </span>
        <span className="ps-counts">
          {p && (
            <>
              <span>
                {count} item{count === 1 ? '' : 's'}
              </span>
              {focus.length > 0 && (
                <details className="ps-focus">
                  <summary>
                    {focus.length} focus area{focus.length === 1 ? '' : 's'}
                    <Icon d={icons.chevron} />
                  </summary>
                  <span className="ps-focus-list chips">
                    {focus.map((t) => (
                      <TagChip key={t.id} tag={t} minutes={mins!.byTag.get(t.id)} />
                    ))}
                  </span>
                </details>
              )}
            </>
          )}
        </span>
        <span className={`ps-pill ${pill.cls}`}>
          <Icon d={pill.icon} />
          {pill.text}
        </span>
        <span className="ps-actions">
          {p ? (
            <Link className="btn primary ps-view" to={`/plans/${p.id}`}>
              View
            </Link>
          ) : (
            <button className="btn primary ps-view" onClick={() => planEvent(e)}>
              Plan
            </button>
          )}
          <MoreMenu items={more} label={`More for ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`} />
        </span>
      </li>
    );
  };

  // --- The month on show, the kind filter, and the weeks inside that month ---
  const monthLabel = new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const stepMonth = (by: number) => {
    const m = new Date(`${month}-15T12:00:00`);
    m.setMonth(m.getMonth() + by);
    setMonth(m.toLocaleDateString('en-CA').slice(0, 7));
  };
  const shown = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.date.startsWith(month) && (only === 'all' || e.kind === only));
  const weeks: { label: string; rows: typeof shown }[] = [];
  for (const item of shown) {
    const day = new Date(`${item.e.date}T12:00:00`);
    const from = new Date(day);
    from.setDate(day.getDate() - day.getDay());
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    const short = (x: Date) => x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const label = `Week of ${short(from)} – ${short(to)}`;
    if (weeks[weeks.length - 1]?.label === label) weeks[weeks.length - 1].rows.push(item);
    else weeks.push({ label, rows: [item] });
  }
  const addMenu: MenuItem[] = [
    ...shownTemplates.map((t) => ({ label: `From template: ${t.title || 'Untitled'}`, onSelect: () => create(t.id) })),
    ...(kind === 'practice' ? [{ label: 'From a community', onSelect: () => setFromCommunity(true) }] : []),
    ...(kind === 'practice' && user.can_import ? [{ label: 'Import old plans', onSelect: () => navigate('/import') }] : []),
  ];

  return (
    <div className={`page ${calendar ? '' : 'plans-page'}`}>
      <div className="page-head ps-head">
        <div>
          <h1>{kind === 'practice' ? 'Practice schedule' : 'Homework'}</h1>
          <p className="muted">
            {team!.name}
            {team!.season ? ` · ${team!.season}` : ''}
          </p>
        </div>
        <div className="head-actions">
          {!calendar && (
            <div className="ps-month" role="group" aria-label="Month">
              <button type="button" aria-label="Previous month" onClick={() => stepMonth(-1)}>
                ‹
              </button>
              <span aria-live="polite">{monthLabel}</span>
              <button type="button" aria-label="Next month" onClick={() => stepMonth(1)}>
                ›
              </button>
            </div>
          )}
          <div className="split-btn">
            <button className="btn primary" onClick={() => create()}>
              + Add {noun}
            </button>
            <MoreMenu items={addMenu} label={`More ways to add a ${noun}`} caret />
          </div>
        </div>
      </div>
      <div className="ps-tabs">
        {kind === 'practice' && !calendar && (
          <div className="ps-filter" role="group" aria-label="Show">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" className={only === id ? 'on' : ''} aria-pressed={only === id} onClick={() => setOnly(id)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        {kind === 'practice' && (
          <div className="seg" role="group" aria-label="View">
            <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => chooseView('list')}>
              List
            </button>
            <button className={view === 'calendar' ? 'on' : ''} aria-pressed={view === 'calendar'} onClick={() => chooseView('calendar')}>
              Calendar
            </button>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {fromCommunity && <CommunityPicker kind="plan" onClose={() => setFromCommunity(false)} onAdded={(id) => navigate(`/plans/${id}`)} />}

      {kind === 'practice' && hasCalendar && (
        <div className="sync-status" role="status">
          <span className="sync-dot" aria-hidden="true" />
          <span>
            <strong>Team calendar</strong> last updated {fmtSynced(team!.calendar_synced_at)}
            <span className="muted"> · games and practices from GameChanger or your team app. It is not updated on its own.</span>
          </span>
          <button className="btn small" onClick={sync} disabled={syncing}>
            {syncing ? 'Updating…' : 'Re-sync'}
          </button>
        </div>
      )}
      {kind === 'practice' && (
        <p className="muted small list-note">
          {!hasCalendar && (
            <>
              Use GameChanger, TeamSnap or another team app? <Link to="/teams">Link the team's calendar</Link> to see upcoming games and
              practices in this list.
            </>
          )}
          {next && !calendar && (
            <>
              {!hasCalendar && ' · '}
              <button
                className="link"
                onClick={() => {
                  // The next one may be in another month, or filtered out: show it, then bring it to the middle.
                  setOnly('all');
                  setMonth(next.date.slice(0, 7));
                  requestAnimationFrame(() => requestAnimationFrame(() => nextRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })));
                }}
              >
                Jump to next up
              </button>
            </>
          )}
        </p>
      )}

      {plans === null ? (
        <p className="muted">Loading…</p>
      ) : calendar ? (
        <PlanCalendar entries={entries} today={today} nextKey={next?.key ?? null} onPlan={planFromCalendar} onAdd={createOn} />
      ) : entries.length === 0 ? (
        <div className="empty">
          <h2>No {kind === 'practice' ? 'practices' : 'homework'} yet</h2>
          <p>
            {kind === 'practice'
              ? 'Build your first practice schedule. Times fill in automatically as you add items.'
              : 'Build a workout or homework sheet to send home with players.'}
          </p>
          <button className="btn primary" onClick={() => create()}>
            + New {noun}
          </button>
        </div>
      ) : weeks.length === 0 ? (
        <div className="empty">
          <h2>
            Nothing {only === 'all' ? '' : `of that kind `}in {monthLabel}
          </h2>
          <p>Use the arrows at the top to look at another month, or add a {noun}.</p>
        </div>
      ) : (
        weeks.map((w) => (
          <section key={w.label} className="ps-week">
            <h2>{w.label}</h2>
            <ul className="ps-list">{w.rows.map(({ e, i }) => row(e, i))}</ul>
          </section>
        ))
      )}

      {shownTemplates.length > 0 && (
        <>
          <h2 className="section-title">Templates</h2>
          <ul className="plan-list">
            {shownTemplates.map((t) => (
              <li key={t.id} className="plan-row">
                <Link to={`/plans/${t.id}`} className="plan-main">
                  <span className="plan-title">{t.title || 'Untitled template'}</span>
                </Link>
                <span className="row-actions">
                  <button className="btn small" onClick={() => create(t.id)}>
                    Use
                  </button>
                  <Link className="btn small" to={`/plans/${t.id}`}>
                    Edit
                  </Link>
                  <button className="btn small danger" onClick={() => remove(t, 'template')}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
