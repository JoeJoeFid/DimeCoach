import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type RecordGame } from '../api';
import { useApp } from '../App';
import type { Plan, ScheduleEvent, Tag } from '../types';
import { daysBetween, fmtClock, fmtDateShort, fmtDuration, parseClock, planMinutes, todayISO } from '../util';
import SchedulePreview from './SchedulePreview';
import SportIcon from './SportIcon';
import { KIND_LABEL, buildSchedule, isStrayBlank, planFilled, withoutDuplicateBlanks, type ScheduleEntry } from '../schedule';

/** How many lines the list beside the big card shows at once. The arrows under it turn the page. */
const PER_PAGE = 5;
type Entry = ScheduleEntry;

const relative = (date: string, today: string) => {
  const d = daysBetween(today, date);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return d > 0 ? `In ${d} days` : `${-d} days ago`;
};

/**
 * The top of the dashboard: the next thing coming up, large on the left, and beside it the team's
 * practices, games and events as a list in date order, a page at a time, starting with what is next.
 */
export default function PracticeTimeline({ plans, tags }: { plans: Plan[]; tags: Tag[]; /** Kept for the pages that pass it: nothing here changes a plan any more. */ onChanged?: () => void }) {
  const app = useApp();
  const team = app.team!;
  const navigate = useNavigate();
  const today = todayISO();
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  // Which page of the list is showing, counted from the one that starts with what is next: 0 is that one, and earlier pages are below zero.
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  // The games that have been scored to the end, by their plan: the result goes on their cards.
  const [results, setResults] = useState<Map<number, RecordGame>>(new Map());
  useEffect(() => {
    let alive = true;
    api
      .teamRecord(team.id)
      .then((r) => alive && setResults(new Map(r.games.map((g) => [g.plan_id, g]))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [team.id, plans]);
  /** "W 36-27" for a game whose scoring is finished, or nothing. */
  const result = (e: Entry) => {
    const g = e.plan ? results.get(e.plan.id) : undefined;
    if (!g) return null;
    const won = g.us > g.them;
    const lost = g.us < g.them;
    return (
      <span className={`tl-result ${won ? 'w' : lost ? 'l' : ''}`} role="img" aria-label={`${won ? 'Won' : lost ? 'Lost' : 'Tied'} ${g.us} to ${g.them}`}>
        <b>{won ? 'W' : lost ? 'L' : 'T'}</b> {g.us}–{g.them}
      </span>
    );
  };

  useEffect(() => {
    setEvents([]);
    if (!team.calendar_url && !team.community_id) return;
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
  }, [team.id, team.calendar_url, team.community_id]);

  // Blank plans left behind for today or earlier get no card, so "next up" is the next real event.
  const entries = useMemo(() => withoutDuplicateBlanks(buildSchedule(plans, events).filter((e) => !isStrayBlank(e, today))), [plans, events, today]);

  if (entries.length === 0) return null;

  // "Next up" is the first thing today or later. With nothing ahead, it is the most recent one.
  const nextIndex = entries.findIndex((e) => e.date >= today);
  const homeIndex = nextIndex >= 0 ? nextIndex : entries.length - 1;
  // The big card never changes. The list beside it is everything, in pages that begin at what is next.
  const focus = entries[homeIndex];
  const firstPage = Math.floor((0 - homeIndex) / PER_PAGE);
  const lastPage = Math.floor((entries.length - 1 - homeIndex) / PER_PAGE);
  const at = Math.max(firstPage, Math.min(page, lastPage));
  const from = homeIndex + at * PER_PAGE;
  const listed = entries.slice(Math.max(0, from), Math.max(0, from + PER_PAGE));
  const pages = lastPage - firstPage + 1;
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
  /** One line of the list: when it is, what it is, how far along its plan is, and the way in. */
  const line = (e: Entry) => {
    const isNext = e.key === nextKey;
    const past = e.date < today;
    const body = (
      <>
        <span className="tlr-when">
          <strong>{fmtDateShort(e.date)}</strong>
          <small>{timeRange(e)}</small>
        </span>
        <span className={`kind ${e.kind}`}>{KIND_LABEL[e.kind]}</span>
        <span className="tlr-title">{e.title}</span>
        {/* A game scored to the end shows how it went, in place of whether it was planned. */}
        {result(e) ?? planState(e)}
        <svg className="tlr-go" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 5.500l6.500 6.500L9 18.500" />
        </svg>
      </>
    );
    const cls = `tlr-card ${isNext ? 'next' : ''} ${past ? 'past' : ''}`;
    return (
      <li key={e.key} className={`tlr ${isNext ? 'next' : ''} ${past ? 'past' : ''}`} aria-current={isNext ? 'true' : undefined}>
        <span className="tlr-dot" aria-hidden="true" />
        {e.plan ? (
          <Link className={cls} to={`/plans/${e.plan.id}`} title={e.kind === 'game' ? 'Open this game' : e.kind === 'practice' ? 'Open this practice' : 'Open this plan'}>
            {body}
          </Link>
        ) : (
          <button type="button" className={cls} title={`Plan this ${e.kind === 'game' ? 'game' : e.kind === 'practice' ? 'practice' : 'event'}`} onClick={() => planEvent(e)}>
            {body}
          </button>
        )}
      </li>
    );
  };

  const focusDone = focus.date < today;
  const mins = focus.plan ? planMinutes(focus.plan, new Set(tags.map((t) => t.id))) : null;
  const heading = nextIndex >= 0 ? 'Next up' : 'Most recent';

  return (
    <section className="timeline" aria-label="Schedule">
      {/* The name of the box, sitting on its top edge. */}
      <span className="tl-label">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 6h14v14H5ZM5 10h14M9 3.500V7M15 3.500V7" />
        </svg>
        Schedule
      </span>
      {error && <p className="error">{error}</p>}
      <div className="tl-row">
        <div className="tl-track">
          <div data-key={focus.key} className={`tl-card tl-focus ${focus.kind} ${focus.key === nextKey ? 'tl-next' : ''} ${focusDone ? 'done' : ''}`}>
            {/* The ball of the team's sport, faint, in the corner. */}
            <span className="tl-ball" aria-hidden="true">
              <SportIcon sport={app.sport?.name} size={190} />
            </span>
            <div className="tl-eyebrow">
              <span className="tl-upnext">
                {focusDone && doneMark} {focusDone ? 'Completed' : heading} · {relative(focus.date, today)}
              </span>
              <span className={`kind ${focus.kind}`}>{KIND_LABEL[focus.kind]}</span>
            </div>
            <div className="tl-date">{fmtDateShort(focus.date)}</div>
            <div className="tl-title">{focus.title}</div>
            <div className="tl-facts">
              <span className="tl-fact">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.500V12l3 2" />
                </svg>
                <span className="tl-time">{timeRange(focus)}</span>
              </span>
              {focus.location && (
                <span className="tl-fact tl-place">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 21s-6.500-6-6.500-11a6.500 6.500 0 0 1 13 0c0 5-6.500 11-6.500 11ZM12 12.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5Z" />
                  </svg>
                  <span>{focus.location}</span>
                </span>
              )}
            </div>
            <div className="tl-state">{result(focus) ?? planState(focus)}</div>
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
                    Print
                  </Link>
                </>
              ) : (
                <button className="btn primary" onClick={() => planEvent(focus)}>
                  {focus.kind === 'game' ? 'Plan this game' : focus.kind === 'practice' ? 'Plan this practice' : 'Plan this event'}
                </button>
              )}
            </div>
          </div>

          {/* Beside it: the schedule as a list down a line of dots, a page at a time. */}
          <div className="tl-list">
            <ol className="tlr-rows">{listed.map(line)}</ol>
            {pages > 1 && (
              <div className="tlr-pager">
                <button type="button" className="tl-arrow" aria-label="Earlier" disabled={at <= firstPage} onClick={() => setPage(at - 1)}>
                  ‹
                </button>
                {pages <= 9 ? (
                  <span className="tlr-dots" role="img" aria-label={`Page ${at - firstPage + 1} of ${pages}`}>
                    {Array.from({ length: pages }, (_, i) => (
                      <i key={i} className={i === at - firstPage ? 'on' : ''} />
                    ))}
                  </span>
                ) : (
                  <span className="muted small">
                    {at - firstPage + 1} of {pages}
                  </span>
                )}
                <button type="button" className="tl-arrow" aria-label="Later" disabled={at >= lastPage} onClick={() => setPage(at + 1)}>
                  ›
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {!team.calendar_url && (
        <div className="tl-foot">
          <span className="muted small">
            Use GameChanger? <Link to="/teams?tab=schedule">Link the team calendar</Link> to see games and scheduled practices here.
          </span>
        </div>
      )}
    </section>
  );
}
