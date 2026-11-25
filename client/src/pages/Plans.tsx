import PageTitle from '../components/PageTitle';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type RecordGame } from '../api';
import { useApp } from '../App';
import type { Plan, PlanKind, PlanSummary, ScheduleEvent } from '../types';
import { fmtClock, fmtDateShort, fmtDuration, fmtSynced, parseClock, planMinutes, todayISO } from '../util';
import { buildSchedule, withoutDuplicateBlanks, nextEntry, planStateOf, type ScheduleEntry } from '../schedule';
import { MoreMenu, type MenuItem } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { deleteLater, useCompletedDeletes, usePendingDeletes } from '../components/toasts';
import PlanCalendar, { Peek } from '../components/PlanCalendar';
import { CommunityPicker, ShareDialog } from '../components/community';

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
  const [sharing, setSharing] = useState<Plan | null>(null);
  // The practice whose summary is showing, and where on the screen it goes.
  const [summary, setSummary] = useState<{ entry: ScheduleEntry; left: number; right: number; top: number } | null>(null);
  // It goes away on a click anywhere else, on Escape, and when the page moves under it.
  useEffect(() => {
    if (!summary) return;
    const away = (ev: Event) => !(ev.target as HTMLElement).closest?.('.ps-summary') && setSummary(null);
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && setSummary(null);
    const moved = () => setSummary(null);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', moved);
    };
  }, [summary]);
  // A link can ask for the calendar outright, as "View calendar" on the dashboard does.
  const [view, setView] = useState<View>(() => (new URLSearchParams(window.location.search).get('view') === 'calendar' ? 'calendar' : savedView()));
  /** Which kind of thing is shown, in the list and on the calendar. */
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
  // A team that belongs to an organization has its league games on its calendar, linked or not.
  const hasEvents = hasCalendar || (kind === 'practice' && !!team!.community_id);
  /** Whether any practice or game has been made here yet. */
  const built = (plans || []).some((p) => !p.is_template);

  // The games scored to the end, by their plan: how each went is put on its line.
  const [results, setResults] = useState<Map<number, RecordGame>>(new Map());
  const load = useCallback(async () => {
    api.teamRecord(teamId).then((r) => setResults(new Map(r.games.map((g) => [g.plan_id, g]))), () => {});
    try {
      const [p, t, ev] = await Promise.all([
        api.plansFull(teamId, kind),
        api.plans(teamId, kind, true),
        hasEvents ? api.events(teamId, '2000-01-01') : Promise.resolve([]),
      ]);
      setPlans(p);
      setTemplates(t);
      setEvents(ev);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [teamId, kind, hasCalendar, hasEvents]);

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
    // Open with what is coming up in the middle of the screen.
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
    const count = p ? p.items.filter((it) => it.kind === 'item').length : 0;
    // What the pill on the right says: a game is a game; otherwise how far along the plan is.
    const pill =
      e.kind === 'game' ? { cls: 'game', icon: icons.trophy, text: 'Game' } : e.kind === 'other' && !p ? { cls: 'event', icon: icons.flag, text: 'Event' } : state === 'ready' ? { cls: 'planned', icon: icons.check, text: 'Planned' } : state === 'empty' ? { cls: 'todo', icon: icons.alert, text: 'Empty' } : { cls: 'todo', icon: icons.alert, text: 'No plan yet' };
    const more: MenuItem[] = p
      ? [
          { label: 'Print', onSelect: () => navigate(`/plans/${p.id}/print`) },
          { label: 'Share', onSelect: () => setSharing(p) },
          ...(kind === 'practice' && user.can_import ? [{ label: 'Import an old plan into it', onSelect: () => navigate(`/plans/${p.id}?import=1`) }] : []),
          { label: 'Duplicate', onSelect: () => duplicate(p) },
          { label: 'Delete', onSelect: () => remove(p, noun), danger: true },
        ]
      : [];
    // Kept as it is here because someone worked on it, while the team calendar moved on.
    const ev = e.event;
    const said = ev?.calendar_now;
    // What the team calendar says about this line. For a planned line that is its calendar event,
    // since the line itself shows the plan's own date and time. Only a difference from what the
    // line shows is worth saying.
    const cal = ev && !ev.official && !ev.gone ? (said ?? (p ? ev : null)) : null;
    const whenDiffers = !!cal && (cal.date !== e.date || (!!cal.start_time && cal.start_time !== (e.time || '')));
    const placeDiffers = !!said && said.location !== ev!.location;
    const titleDiffers = !!said && !p && said.title !== ev!.title;
    const now = whenDiffers || placeDiffers || titleDiffers ? cal : null;
    if (ev && (ev.gone || (said && now)))
      more.unshift({
        label: ev.gone ? 'Remove it here too' : 'Use the team calendar’s version',
        onSelect: () => act(() => api.followEvent(teamId, ev.id).then(load)),
      });

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
          {!!e.event?.official && <span className="kind league" title="Set by your organization. It changes there, not here.">Division game</span>}
          {ev?.gone && (
            <span className="kind warn" title="It was worked on in Dime Coach, so it is kept. To drop it, choose “Remove it here too” under the three dots.">
              No longer on the team calendar
            </span>
          )}
          {now && !ev?.gone && (
            <span
              className="kind warn"
              title={
                said
                  ? 'It was worked on in Dime Coach, so it is kept as it is. To take the change, choose “Use the team calendar’s version” under the three dots.'
                  : 'This plan’s date or start time is not what the team calendar says. Open it to change its time, or leave it if that is what you want.'
              }
            >
              Team calendar {said ? 'now ' : ''}says {[whenDiffers ? `${fmtDateShort(now.date)}${now.start_time ? `, ${fmtClock(parseClock(now.start_time))}` : ''}` : '', placeDiffers ? now.location.split('\n')[0] || 'no place' : '', titleDiffers ? `“${now.title}”` : ''].filter(Boolean).join(' · ')}
            </span>
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
            {p && (
              <span className="ps-dot">
                {count} item{count === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </span>
        <span className="ps-pills">
          {/* A game scored to the end: won or lost, and the score, before the pill. */}
          {(() => {
            const g = p ? results.get(p.id) : undefined;
            if (!g) return null;
            const won = g.us > g.them;
            const lost = g.us < g.them;
            return (
              <span className={`tl-result ${won ? 'w' : lost ? 'l' : ''}`} role="img" aria-label={`${won ? 'Won' : lost ? 'Lost' : 'Tied'} ${g.us} to ${g.them}`}>
                <b>{won ? 'W' : lost ? 'L' : 'T'}</b> {g.us}–{g.them}
              </span>
            );
          })()}
          <span className={`ps-pill ${pill.cls}`}>
            <Icon d={pill.icon} />
            {pill.text}
          </span>
        </span>
        <span className="ps-actions">
          {p && (
            <button
              type="button"
              className="btn icon-btn ps-summary"
              aria-label={`Summary of ${p.title || 'this plan'}`}
              aria-expanded={summary?.entry.key === e.key}
              title="Summary: what is in it, and where the time goes"
            onClick={(ev) => {
              if (summary?.entry.key === e.key) return setSummary(null);
              const r = ev.currentTarget.getBoundingClientRect();
              // The summary puts itself beside the button, and keeps itself on the screen.
              setSummary({ entry: e, left: r.left, right: r.right, top: r.top - 8 });
            }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6.500 3.500h11v17h-11zM9.500 8h5M9.500 12h5M9.500 16h3" />
              </svg>
            </button>
          )}
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

  // --- Everything in date order, a heading for each month and each week inside it ---
  const monthName = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shown = entries.map((e, i) => ({ e, i })).filter(({ e }) => only === 'all' || e.kind === only);
  // How tall the part that stays at the top is, so a month jumped to lands under it and not behind it.
  const stickyHead = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stickyHead.current;
    if (!el) return;
    const set = () => el.parentElement?.style.setProperty('--ps-sticky-h', `${el.offsetHeight}px`);
    set();
    const watch = new ResizeObserver(set);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
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
      {/* The heading stays at the top while the list scrolls under it: the page's name, and the button that adds. */}
      <div className="ps-sticky" ref={stickyHead}>
      <div className="page-head ps-head">
        <div>
          <PageTitle
            about={
              kind === 'practice'
                ? { lead: 'Every practice and game for this team.', points: ['Plan a practice minute by minute, or set up a game.', 'Open a game to plan it, keep score, or broadcast it.', 'See it as a list or as a calendar.'] }
                : { lead: 'Work for players to do away from practice.', points: ['Put homework together the way a practice is put together.', 'Parents and players see it on the team’s page.'] }
            }
          >
            {kind === 'practice' ? 'Schedule' : 'Homework'}
          </PageTitle>
        </div>
        <div className="head-actions">
          <div className="split-btn">
            <button className="btn primary" onClick={() => create()}>
              + Add {kind === 'practice' ? 'event' : 'homework'}
            </button>
            <MoreMenu items={addMenu} label={`More ways to add a ${noun}`} caret />
          </div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {summary && <Peek entry={summary.entry} at={summary} today={todayISO()} />}
      {sharing && <ShareDialog kind="plan" itemId={sharing.id} title={sharing.title || (kind === 'homework' ? 'Homework' : 'Practice')} onClose={() => setSharing(null)} />}
      {fromCommunity && <CommunityPicker kind="plan" onClose={() => setFromCommunity(false)} onAdded={(id) => navigate(`/plans/${id}`)} />}

      </div>
      <div className={kind === 'practice' ? 'ps-layout' : ''}>
      {/* Down the left: how the schedule is seen, which kinds of thing are in it, and the team calendar it is brought in from. */}
      {kind === 'practice' && (
        <aside className="card ps-side" aria-label="View and filters">
          <section>
            <h2>View</h2>
            <div className="seg" role="group" aria-label="View">
              <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => chooseView('list')}>
                List
              </button>
              <button className={view === 'calendar' ? 'on' : ''} aria-pressed={view === 'calendar'} onClick={() => chooseView('calendar')}>
                Calendar
              </button>
            </div>
          </section>
          <section>
            <h2>Show</h2>
            <div className="ps-side-filter" role="group" aria-label="Show">
              {FILTERS.map(([id, label]) => (
                <button key={id} type="button" className={only === id ? 'on' : ''} aria-pressed={only === id} onClick={() => setOnly(id)}>
                  {label}
                  <span className="ps-side-count">{id === 'all' ? entries.length : entries.filter((e) => e.kind === id).length}</span>
                </button>
              ))}
            </div>
          </section>
          {/* When the team's calendar was last brought in, and the button that brings it in again. */}
          {hasCalendar && (
            <section className="ps-side-sync" role="status" title="Games and practices from GameChanger or your team app. They are not updated on their own: press Re-sync to bring in changes.">
              <h2>Team calendar</h2>
              <span className="ps-sync">
                <span className="sync-dot" aria-hidden="true" />
                <span className="muted small">Synced {fmtSynced(team!.calendar_synced_at)}</span>
              </span>
              <button className="btn small" onClick={sync} disabled={syncing}>
                {syncing ? 'Updating…' : 'Re-sync'}
              </button>
            </section>
          )}
        </aside>
      )}
      <div className="ps-main">
      {/* The calendar offer, for a team with no calendar linked. It shrinks to one line once a practice has been built. */}
      {kind === 'practice' && !hasCalendar && plans !== null && (
        <section className={`start-cal ${built ? 'compact' : ''}`} aria-label="Bring in your schedule">
          <span className="start-cal-art" aria-hidden="true">
            <svg viewBox="0 0 24 24" width={built ? 18 : 30} height={built ? 18 : 30} fill="none" stroke="currentColor" strokeWidth="1.700" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 6h14v14H5ZM5 10h14M9 3.500V7M15 3.500V7M8.500 14.500l2.300 2.300 4.700-4.700" />
            </svg>
          </span>
          {built ? (
            <p>
              <strong>Use GameChanger, TeamSnap or another team app?</strong> Link its calendar to see upcoming games and practices in this list.
            </p>
          ) : (
            <div>
              <h2>Already have your schedule in a team app?</h2>
              <p>Link your GameChanger, TeamSnap, SportsEngine or Google calendar to see upcoming games and practices in this list, ready to plan.</p>
            </div>
          )}
          <Link className={`btn ${built ? 'small' : 'primary'}`} to="/teams?tab=schedule">
            Link your team calendar
          </Link>
        </section>
      )}
      {plans === null ? (
        <p className="muted">Loading…</p>
      ) : calendar ? (
        <PlanCalendar entries={only === 'all' ? entries : entries.filter((e) => e.kind === only)} today={today} nextKey={next?.key ?? null} onPlan={planFromCalendar} onAdd={createOn} />
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
          <h2>Nothing of that kind yet</h2>
          <p>Choose "All" on the left to see everything.</p>
        </div>
      ) : (
        weeks.map((w, n) => {
          // A month's name stands above the first week that has something from it.
          const ym = w.rows[0].e.date.slice(0, 7);
          const opens = n === 0 || weeks[n - 1].rows[weeks[n - 1].rows.length - 1].e.date.slice(0, 7) !== ym;
          // A week that runs across two months also opens the second one, at its first row there.
          const later = [...new Set(w.rows.map(({ e }) => e.date.slice(0, 7)))].filter((m) => m !== ym);
          return (
            <section key={w.label} className="ps-week">
              {opens && (
                <h2 className="ps-month-head" id={`month-${ym}`}>
                  {monthName(ym)}
                </h2>
              )}
              {later.map((m) => (
                <span key={m} id={`month-${m}`} className="ps-month-anchor" />
              ))}
              <h2>{w.label}</h2>
              <ul className="ps-list">{w.rows.map(({ e, i }) => row(e, i))}</ul>
            </section>
          );
        })
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
      </div>
    </div>
  );
}
