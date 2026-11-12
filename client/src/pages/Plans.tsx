import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Plan, PlanKind, PlanSummary, ScheduleEvent } from '../types';
import { fmtClock, fmtDateShort, fmtDuration, fmtSynced, parseClock, planMinutes, todayISO } from '../util';
import { KIND_LABEL, PLAN_STATE_LABEL, buildSchedule, withoutDuplicateBlanks, nextEntry, planStateOf, type ScheduleEntry } from '../schedule';
import { TagChip } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { deleteLater, useCompletedDeletes, usePendingDeletes } from '../components/toasts';
import SchedulePreview from '../components/SchedulePreview';
import PlanCalendar from '../components/PlanCalendar';
import { CommunityPicker } from '../components/community';

type View = 'list' | 'calendar';
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
    (nextRow.current ?? lastRow.current)?.scrollIntoView({ block: 'center' });
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

    const main = (
      <>
        <span className="plan-date">
          {done && (
            <span className="status good done-mark" title="Completed" role="img" aria-label="Completed">
              ✓
            </span>
          )}
          {fmtDateShort(e.date)}
          {isNext && <span className="tl-flag">{e.date === today ? 'Today' : 'Next up'}</span>}
        </span>
        <span className="plan-title">
          {p ? p.title || 'Untitled' : e.title}
          {kind === 'practice' && e.kind !== 'practice' && <span className={`kind ${e.kind}`}>{KIND_LABEL[e.kind]}</span>}
          {e.location && <span className="muted"> · {e.location}</span>}
        </span>
        <span className="plan-meta">
          {[when, p && fmtDuration(total), p && `${p.items.filter((it) => it.kind === 'item').length} items`].filter(Boolean).join(' · ')}
          {kind === 'practice' && (state !== 'ready' || !done) && (
            <span className={`plan-state ${state === 'ready' ? 'ready' : 'missing'}`}>
              <span aria-hidden="true">{state === 'ready' ? '✓' : '!'}</span>
              {PLAN_STATE_LABEL[state]}
            </span>
          )}
        </span>
        {p && mins && (
          <span className="chips">
            {sportTags
              .filter((t) => mins.byTag.has(t.id))
              .map((t) => (
                <TagChip key={t.id} tag={t} minutes={mins.byTag.get(t.id)} />
              ))}
          </span>
        )}
      </>
    );

    return (
      <li
        key={e.key}
        ref={isNext ? nextRow : i === entries.length - 1 ? lastRow : undefined}
        className={`plan-row ${done ? 'done' : ''} ${isNext ? 'next' : ''} ${p ? '' : 'unplanned'}`}
        aria-current={isNext ? 'true' : undefined}
      >
        {p ? (
          <Link to={`/plans/${p.id}`} className="plan-main">
            {main}
          </Link>
        ) : (
          <div className="plan-main">{main}</div>
        )}
        <span className="row-actions">
          {p ? (
            <>
              <SchedulePreview plan={p} />
              <Link className="btn small" to={`/plans/${p.id}/print`}>
                Print / share
              </Link>
              {kind === 'practice' && user.can_import && (
                <Link className="btn small" to={`/plans/${p.id}?import=1`} title="Fill this practice from an old plan">
                  Import
                </Link>
              )}
              <button className="btn small" onClick={() => duplicate(p)}>
                Duplicate
              </button>
              <button className="btn small danger" onClick={() => remove(p, noun)}>
                Delete
              </button>
            </>
          ) : (
            <button className={`btn small ${isNext ? 'primary' : ''}`} onClick={() => planEvent(e)}>
              {e.kind === 'game' ? 'Plan game' : 'Plan practice'}
            </button>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className={`page ${calendar ? '' : 'plans-page'}`}>
      <div className="page-head">
        <div>
          <h1>{kind === 'practice' ? 'Practices' : 'Homework'}</h1>
          <p className="muted">
            {team!.name}
            {team!.season ? ` · ${team!.season}` : ''}
          </p>
        </div>
        <div className="head-actions">
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
          {shownTemplates.length > 0 && (
            <select className="input" aria-label="Start from a template" value="" onChange={(e) => e.target.value && create(Number(e.target.value))}>
              <option value="">New from template…</option>
              {shownTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
          {kind === 'practice' && user.can_import && (
            <Link className="btn" to="/import">
              Import old plans
            </Link>
          )}
          {kind === 'practice' && (
            <button className="btn" onClick={() => setFromCommunity(true)}>
              From a community
            </button>
          )}
          <button className="btn primary" onClick={() => create()}>
            + New {noun}
          </button>
        </div>
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
              <button className="link" onClick={() => nextRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>
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
      ) : (
        <ul className="plan-list">{entries.map(row)}</ul>
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
