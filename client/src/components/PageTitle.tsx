import { useEffect, useState, type ReactNode } from 'react';
import { api, type RecordGame } from '../api';
import { useApp } from '../App';
import { fmtDateShort } from '../util';
import SportIcon from './SportIcon';

/** What a part of the app is for, said when its "i" is pressed: one line, then the points worth knowing. */
export interface About {
  lead: string;
  points?: string[];
  /** Something to press at the foot of it, such as a longer explanation to open. */
  action?: { label: string; onClick: () => void };
}

/** The games last read for each team, so the record is there at once when the next page opens. */
const known = new Map<number, RecordGame[]>();
/** How many of the latest games the summary lists. */
const LISTED = 8;

/**
 * The team's wins and losses over its finished games, such as "5-3". Pointing at it, or pressing
 * it, opens a short list of the latest results. Nothing is shown until a game has been finished.
 */
function TeamRecord({ teamId }: { teamId: number }) {
  const [games, setGames] = useState<RecordGame[]>(known.get(teamId) || []);
  useEffect(() => {
    let live = true;
    setGames(known.get(teamId) || []);
    api
      .teamRecord(teamId)
      .then((r) => {
        known.set(teamId, r.games);
        if (live) setGames(r.games);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [teamId]);
  if (games.length === 0) return null;
  const wins = games.filter((g) => g.us > g.them).length;
  const losses = games.filter((g) => g.us < g.them).length;
  const ties = games.length - wins - losses;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const words = [count(wins, 'win', 'wins'), count(losses, 'loss', 'losses'), ties > 0 && count(ties, 'tie', 'ties')].filter(Boolean).join(', ');
  // How the latest games in a row went: "Won 2 in a row".
  const last = games[games.length - 1];
  const went = (g: RecordGame) => Math.sign(g.us - g.them);
  let run = 0;
  for (let i = games.length - 1; i >= 0 && went(games[i]) === went(last); i--) run++;
  const streak = run > 1 && went(last) !== 0 ? `${went(last) > 0 ? 'Won' : 'Lost'} ${run} in a row` : '';
  const latest = games.slice(-LISTED).reverse();
  return (
    <span className="team-record">
      <button type="button" className="team-record-btn" aria-label={`Record: ${words}. Show the latest results.`}>
        <span className="team-record-word">Record</span>
        {wins}-{losses}
        {ties > 0 && `-${ties}`}
      </button>
      <span className="team-record-pop" role="tooltip">
        <strong>{words}</strong>
        {streak && <span className="muted small">{streak}</span>}
        <span className="team-record-list">
          {latest.map((g) => (
            <span key={g.plan_id} className="team-record-row">
              <b className={went(g) > 0 ? 'w' : went(g) < 0 ? 'l' : ''}>{went(g) > 0 ? 'W' : went(g) < 0 ? 'L' : 'T'}</b>
              <span className="team-record-score">
                {g.us}-{g.them}
              </span>
              <span className="team-record-opp">{g.opponent ? `vs ${g.opponent}` : g.title || 'Game'}</span>
              <span className="muted">{fmtDateShort(g.date)}</span>
            </span>
          ))}
        </span>
        {games.length > LISTED && <span className="muted small">and {count(games.length - LISTED, 'earlier game', 'earlier games')}</span>}
      </span>
    </span>
  );
}

/**
 * The heading of a page about a team: its logo if it has one, its sport's ball, the team's name,
 * largest, then the season and the record of wins and losses; under that, the name of the part
 * of the app being looked at.
 */
export default function PageTitle({ children, about, beside }: { children: ReactNode; /** What this part of the app is for, behind an "i" beside its name. */ about?: About; /** Something small that stands after the name and the "i", such as how much upload space is used. */ beside?: ReactNode }) {
  const { team, sport } = useApp();
  // Pointing at the "i" shows what it has to say. Pressing it keeps that showing, which is how it is read on a phone.
  const [telling, setTelling] = useState(false);
  const name = typeof children === 'string' ? children : 'this page';
  return (
    <>
      {team && (
        <p className="team-title">
          {team.logo && <img className="team-logo" src={team.logo} alt="" />}
          <SportIcon sport={sport?.name} size={42} colored />
          <span>{team.name}</span>
          {team.season && <span className="team-title-season">{team.season}</span>}
          <TeamRecord teamId={team.id} />
        </p>
      )}
      <h1 className="section-name">
        {children}
        {about && (
          <span className={`about ${telling ? 'open' : ''}`} onMouseLeave={() => setTelling(false)}>
            <button type="button" className="about-btn" aria-label={`What ${name} is for`} aria-expanded={telling} onClick={() => setTelling(!telling)} onBlur={() => setTelling(false)}>
              i
            </button>
            <span className="about-pop" role="tooltip">
              <span className="about-head">About {name}</span>
              <span className="about-lead">{about.lead}</span>
              {!!about.points?.length && (
                <span className="about-points">
                  {about.points.map((p) => (
                    <span key={p}>{p}</span>
                  ))}
                </span>
              )}
              {about.action && (
                // Pressing it must not first take the focus from the "i", which would close this before the press landed.
                <button type="button" className="btn small about-action" onMouseDown={(e) => e.preventDefault()} onClick={() => (setTelling(false), about.action!.onClick())}>
                  {about.action.label} <span aria-hidden="true">→</span>
                </button>
              )}
            </span>
          </span>
        )}
        {beside && <span className="section-beside">{beside}</span>}
      </h1>
    </>
  );
}
