import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import SportIcon from './SportIcon';
import { KIND_LABEL } from '../schedule';
import { daysBetween, fmtDateShort } from '../util';

/** How many lines the list beside the big card shows at once. The arrows under it turn the page. */
const PER_PAGE = 5;

/** One thing on a team's schedule, as the board shows it. */
export interface BoardEntry {
  key: string;
  date: string;
  kind: 'practice' | 'game' | 'other';
  title: string;
  /** When it runs, in words: "5:30 - 7:00", or "All day". */
  time: string;
  location?: string;
}
/** Where pressing something leads: a page, or something to do. */
export type BoardWay = { to: string; title?: string } | { onClick: () => void; title?: string };

const relative = (date: string, today: string) => {
  const d = daysBetween(today, date);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return d > 0 ? `In ${d} days` : `${-d} days ago`;
};

/**
 * The top of a team's dashboard, the same for a coach and for the team's parents, family and
 * friends: the next thing coming up, large on the left, and beside it the schedule as a list down
 * a line of dots, a page at a time, starting with what is next.
 *
 * It knows nothing of what can be done with a thing. Whoever uses it says what stands on the big
 * card (`actions`, `note`), what a line's pill says (`state`), and where pressing a line leads
 * (`way`): so a coach's lines open a plan to change, and a parent's open something to read.
 */
export default function NextUpBoard<E extends BoardEntry>({ entries, today, sport, state, note, actions, way, fullSchedule, foot }: { /** Everything on the schedule, oldest first. Nothing is drawn when it is empty. */ entries: E[]; today: string; /** The team's sport, for the ball in the corner of the big card. */ sport?: string; /** The pill that says how a thing stands: planned or not, or how a game went. */ state?: (e: E) => ReactNode; /** A small line on the big card, under its place. */ note?: (e: E) => ReactNode; /** The buttons on the big card. */ actions: (e: E) => ReactNode; way: (e: E) => BoardWay; /** Where "See full schedule" leads. */ fullSchedule: BoardWay; /** Drawn under the board. */ foot?: ReactNode }) {
  // Which page of the list is showing, counted from the one that starts with what is next: 0 is that one, and earlier pages are below zero.
  const [page, setPage] = useState(0);
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
  const nextKey = nextIndex >= 0 ? entries[nextIndex].key : null;
  const focusDone = focus.date < today;

  /** Something to press, as a link or a button, whichever its way is. */
  const pressed = (w: BoardWay, className: string, children: ReactNode) =>
    'to' in w ? (
      <Link className={className} to={w.to} title={w.title}>
        {children}
      </Link>
    ) : (
      <button type="button" className={className} title={w.title} onClick={w.onClick}>
        {children}
      </button>
    );
  /** One line of the list: when it is, what it is, how it stands, and the way in. */
  const line = (e: E) => {
    const isNext = e.key === nextKey;
    const past = e.date < today;
    return (
      <li key={e.key} className={`tlr ${isNext ? 'next' : ''} ${past ? 'past' : ''}`} aria-current={isNext ? 'true' : undefined}>
        <span className="tlr-dot" aria-hidden="true" />
        {pressed(
          way(e),
          `tlr-card ${isNext ? 'next' : ''} ${past ? 'past' : ''}`,
          <>
            <span className="tlr-when">
              <strong>{fmtDateShort(e.date)}</strong>
              <small>{e.time}</small>
            </span>
            <span className={`kind ${e.kind}`}>{KIND_LABEL[e.kind]}</span>
            <span className="tlr-title">{e.title}</span>
            {state?.(e) ?? <span />}
            <svg className="tlr-go" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5.500l6.500 6.500L9 18.500" />
            </svg>
          </>,
        )}
      </li>
    );
  };

  return (
    <section className="timeline" aria-label="Schedule">
      <div className="tl-row">
        <div className="tl-track">
          <div className="tl-left">
            <div className={`tl-card tl-focus ${focus.kind} ${focus.key === nextKey ? 'tl-next' : ''} ${focusDone ? 'done' : ''}`}>
              {/* The ball of the team's sport, faint, in the corner. */}
              <span className="tl-ball" aria-hidden="true">
                <SportIcon sport={sport} size={300} />
              </span>
              <div className="tl-eyebrow">
                <span className="tl-upnext">
                  {focusDone && (
                    <span className="status good done-mark" title="Completed" role="img" aria-label="Completed">
                      ✓
                    </span>
                  )}{' '}
                  {focusDone ? 'Completed' : nextIndex >= 0 ? 'Next up' : 'Most recent'} · {relative(focus.date, today)}
                </span>
                <span className={`kind ${focus.kind}`}>{KIND_LABEL[focus.kind]}</span>
              </div>
              <div className="tl-date">{fmtDateShort(focus.date)}</div>
              <div className="tl-title">{focus.title}</div>
              <div className="tl-facts">
                {focus.time && (
                  <span className="tl-fact">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.500V12l3 2" />
                    </svg>
                    <span className="tl-time">{focus.time}</span>
                  </span>
                )}
                {focus.location && (
                  <span className="tl-fact tl-place">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 21s-6.500-6-6.500-11a6.500 6.500 0 0 1 13 0c0 5-6.500 11-6.500 11ZM12 12.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5Z" />
                    </svg>
                    <span>{focus.location}</span>
                  </span>
                )}
              </div>
              {note?.(focus)}
              {/* Along the bottom: how it stands, and to its right what can be done about that. */}
              <div className="tl-bottom">
                <div className="tl-state">{state?.(focus)}</div>
                <div className="tl-actions">{actions(focus)}</div>
              </div>
            </div>
            {/* Under the big card: the way to everything on the schedule. */}
            {pressed(
              fullSchedule,
              'btn tl-full',
              <>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.900" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 6h14v14H5ZM5 10h14M9 3.500V7M15 3.500V7" />
                </svg>
                See full schedule
                <span aria-hidden="true">→</span>
              </>,
            )}
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
      {foot}
    </section>
  );
}
