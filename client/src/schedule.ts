// One timeline of a team's practices and calendar events, shared by the dashboard and the Practices page.
import type { Plan, ScheduleEvent } from './types';
import { gameHasContent } from './game';

/** Whether a plan has anything in it. For a game that means its game plan; for a practice, its items. */
export const planFilled = (p: Pick<Plan, 'items' | 'is_game' | 'game'>) => (p.items?.length ?? 0) > 0 || (!!p.is_game && gameHasContent(p.game));

export interface ScheduleEntry {
  key: string;
  date: string;
  time: string;
  kind: 'practice' | 'game' | 'other';
  title: string;
  location: string;
  /** The practice plan for this entry, if one exists. */
  plan?: Plan;
  /** The calendar event behind this entry, if it came from the team calendar. */
  event?: ScheduleEvent;
}

export const KIND_LABEL = { practice: 'Practice', game: 'Game', other: 'Event' } as const;

/** Plans and calendar events merged into date order. A calendar event that has a plan appears once, as the plan. */
export function buildSchedule(plans: Plan[], events: ScheduleEvent[]): ScheduleEntry[] {
  const list: ScheduleEntry[] = plans
    .filter((p) => p.date)
    .map((p) => ({ key: `p${p.id}`, date: p.date, time: p.start_time, kind: p.is_game ? 'game' : 'practice', title: p.title || 'Practice', location: p.location, plan: p }));
  // When a day has both a filled-in plan and an empty one, the calendar event belongs to the filled-in one.
  const filledFirst = [...list].sort((a, b) => Number(planFilled(b.plan!)) - Number(planFilled(a.plan!)));
  for (const ev of events) {
    // A game only pairs with a plan made for it (same title), so a practice on game day stays separate.
    const planned =
      filledFirst.find((e) => e.plan && e.date === ev.date && !e.event && e.title === ev.title) ||
      (ev.kind !== 'game' ? filledFirst.find((e) => e.plan && e.date === ev.date && !e.event) : undefined);
    if (planned) planned.event = ev;
    else list.push({ key: `e${ev.id}`, date: ev.date, time: ev.start_time, kind: ev.kind, title: ev.title, location: ev.location, event: ev });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

/**
 * An empty plan for today or earlier that is not on the team calendar is not a real practice:
 * it is usually a blank one started and left. It should never be treated as "next up".
 */
export const isStrayBlank = (e: ScheduleEntry, today: string) => !!e.plan && !planFilled(e.plan) && !e.event && e.date <= today;

/**
 * Drops an empty plan when the same day already has another plan of the same kind at the same
 * time, so one practice never shows as two cards.
 */
export function withoutDuplicateBlanks(entries: ScheduleEntry[]): ScheduleEntry[] {
  const twin = (a: ScheduleEntry, b: ScheduleEntry) => a !== b && !!b.plan && a.date === b.date && a.kind === b.kind && a.time === b.time;
  return entries.filter((e, i) => {
    if (!e.plan || planFilled(e.plan)) return true;
    // Keep one of several blanks: the one linked to the calendar, else the first.
    return !entries.some((o, j) => twin(e, o) && (planFilled(o.plan!) || (!!o.event && !e.event) || (!!o.event === !!e.event && j < i)));
  });
}

/** The entry to draw attention to: the first real one today or later. */
export const nextEntry = (entries: ScheduleEntry[], today: string) => entries.find((e) => e.date >= today && !isStrayBlank(e, today)) ?? null;

export type PlanState = 'ready' | 'empty' | 'none';
export const planStateOf = (e: ScheduleEntry): PlanState => (!e.plan ? 'none' : planFilled(e.plan) ? 'ready' : 'empty');
export const PLAN_STATE_LABEL: Record<PlanState, string> = { ready: 'Planned', empty: 'Plan is empty', none: 'No plan yet' };
