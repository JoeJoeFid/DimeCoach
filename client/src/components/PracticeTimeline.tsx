import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type RecordGame } from '../api';
import { useApp } from '../App';
import type { Plan, ScheduleEvent, Tag } from '../types';
import { fmtClock, fmtDuration, parseClock, planMinutes, todayISO } from '../util';
import SchedulePreview from './SchedulePreview';
import NextUpBoard from './NextUpBoard';
import { buildSchedule, isStrayBlank, planFilled, withoutDuplicateBlanks, type ScheduleEntry } from '../schedule';

type Entry = ScheduleEntry;

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

  return (
    <>
      {error && <p className="error">{error}</p>}
      {/* The same board the team's parents, family and friends have at the top of their page. Here a line opens a plan to work on, or starts one. */}
      <NextUpBoard
        entries={entries.map((e) => ({ ...e, time: timeRange(e), src: e }))}
        today={today}
        sport={app.sport?.name}
        // A game scored to the end shows how it went, in place of whether it was planned.
        state={(e) => result(e.src) ?? planState(e.src)}
        note={(e) => {
          const plan = e.src.plan;
          if (!plan) return null;
          const mins = planMinutes(plan, new Set(tags.map((t) => t.id)));
          return (
            <div className="muted small">
              {plan.is_game
                ? planFilled(plan)
                  ? [plan.game?.opponent && `${plan.game.side === 'away' ? 'at' : 'vs.'} ${plan.game.opponent}`, 'Game plan started'].filter(Boolean).join(' · ')
                  : 'Nothing in this game plan yet.'
                : plan.items.length === 0
                  ? 'Nothing scheduled in this plan yet.'
                  : `${plan.items.filter((it) => it.kind === 'item').length} items · ${fmtDuration(mins.work + mins.breaks)}`}
            </div>
          );
        }}
        actions={(e) =>
          e.src.plan ? (
            <>
              <Link className="btn primary" to={`/plans/${e.src.plan.id}`}>
                {e.src.plan.is_game ? 'Open game plan' : 'Open practice'}
              </Link>
              <SchedulePreview plan={e.src.plan} />
              <Link className="btn" to={`/plans/${e.src.plan.id}/print`}>
                Print
              </Link>
            </>
          ) : (
            <button className="btn primary" onClick={() => planEvent(e.src)}>
              {e.kind === 'game' ? 'Plan this game' : e.kind === 'practice' ? 'Plan this practice' : 'Plan this event'}
            </button>
          )
        }
        way={(e) => (e.src.plan ? { to: `/plans/${e.src.plan.id}`, title: e.kind === 'game' ? 'Open this game' : e.kind === 'practice' ? 'Open this practice' : 'Open this plan' } : { onClick: () => planEvent(e.src), title: `Plan this ${e.kind === 'game' ? 'game' : e.kind === 'practice' ? 'practice' : 'event'}` })}
        fullSchedule={{ to: '/practices' }}
        foot={
          !team.calendar_url && (
            <div className="tl-foot">
              <span className="muted small">
                Use GameChanger? <Link to="/teams?tab=schedule">Link the team calendar</Link> to see games and scheduled practices here.
              </span>
            </div>
          )
        }
      />
    </>
  );
}
