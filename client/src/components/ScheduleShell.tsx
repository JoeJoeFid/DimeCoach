import { useState, type ReactNode } from 'react';

/** What a line of a schedule is. */
export type ScheduleKind = 'practice' | 'game' | 'other';
export type ScheduleViewMode = 'list' | 'calendar';
type Filter = 'all' | ScheduleKind;
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['practice', 'Practices'],
  ['game', 'Games'],
  ['other', 'Events'],
];
const monthName = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/**
 * A team's schedule, the same for a coach and for the team's parents, family and friends: a box
 * down the left with the choice of list or calendar and of which kinds show, and beside it the
 * list, month after month and week after week, or the calendar.
 *
 * It knows nothing of what a line can do. Whoever uses it draws each line (`row`) and the calendar,
 * so a coach's lines can be planned and changed, and a parent's can only be read.
 */
export function ScheduleShell<E extends { key: string; date: string; kind: ScheduleKind }>({
  entries,
  view,
  onView,
  row,
  calendar,
  loading,
  empty,
  side,
  before,
  after,
}: {
  /** Everything on the schedule, oldest first. */
  entries: E[];
  view: ScheduleViewMode;
  onView: (v: ScheduleViewMode) => void;
  /** One line of the list. `index` is its place among all the entries, whatever is filtered out. */
  row: (entry: E, index: number) => ReactNode;
  /** The calendar, given what the filter leaves. */
  calendar: (shown: E[]) => ReactNode;
  loading?: boolean;
  /** What the list shows when there is nothing on the schedule at all. */
  empty: ReactNode;
  /** More parts for the box down the left, under the filters. */
  side?: ReactNode;
  /** Drawn above the list or calendar, and under it. */
  before?: ReactNode;
  after?: ReactNode;
}) {
  const [only, setOnly] = useState<Filter>('all');
  const shown = entries.map((e, i) => ({ e, i })).filter(({ e }) => only === 'all' || e.kind === only);
  // A heading for each week, Sunday to Saturday.
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
  return (
    <div className="ps-layout">
      {/* Down the left: how the schedule is seen, and which kinds of thing are in it. */}
      <aside className="card ps-side" aria-label="View and filters">
        <section>
          <h2>View</h2>
          <div className="seg" role="group" aria-label="View">
            <button type="button" className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => onView('list')}>
              List
            </button>
            <button type="button" className={view === 'calendar' ? 'on' : ''} aria-pressed={view === 'calendar'} onClick={() => onView('calendar')}>
              Calendar
            </button>
          </div>
        </section>
        <section>
          <h2>Show</h2>
          <div className="ps-side-filter" role="group" aria-label="Show">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" className={only === id ? 'on' : ''} aria-pressed={only === id} onClick={() => setOnly(id)}>
                <span>{label}</span>
                <span className="ps-side-count">{id === 'all' ? entries.length : entries.filter((e) => e.kind === id).length}</span>
              </button>
            ))}
          </div>
        </section>
        {side}
      </aside>
      <div className="ps-main">
        {before}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : view === 'calendar' ? (
          calendar(shown.map(({ e }) => e))
        ) : entries.length === 0 ? (
          empty
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
        {after}
      </div>
    </div>
  );
}

/** The small line drawings a schedule's lines use. */
export const SCHEDULE_ICONS = {
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.500V12l3 2',
  pin: 'M12 21s6.500-5.600 6.500-11A6.500 6.500 0 0 0 5.500 10c0 5.400 6.500 11 6.500 11ZM12 12.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5Z',
  check: 'M5 12.500l4.500 4.500L19 7.500',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 5.500H5.500v1.500A2.500 2.500 0 0 0 8 9.500M16 5.500h2.500v1.500a2.500 2.500 0 0 1-2.500 2.500M12 13v4M8.500 20h7M9.500 17h5',
  flag: 'M6 3v18M6 4.500h12l-3 3.500 3 3.500H6',
};
export const ScheduleIcon = ({ d }: { d: string }) => (
  <svg className="ps-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
