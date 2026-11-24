// A game followed play by play, as it is scored: the score, a court with where the shots went up,
// the latest play in large words, and the plays before it. It reads the game again whenever the
// app hears that something changed, and every few seconds besides.
import { useCallback, useEffect, useState } from 'react';
import { api, type LiveFeed, type LivePlay } from '../api';
import { partName, scoringOfPlays } from '../sportOf';
import { playOf, playText } from '../sportScoring';
import { COURT, Court } from './PlayDiagram';

const SHOT_WORDS: Record<string, string> = { m2: 'makes a 2-pointer', x2: 'misses a 2-pointer', m3: 'makes a 3-pointer', x3: 'misses a 3-pointer', m1: 'makes a free throw', x1: 'misses a free throw' };
const isShot = (t: string) => t in SHOT_WORDS;
/** Whether a play put points on the board: a made shot, or in another sport whatever the server says scored. */
const made = (p: LivePlay) => !!p.scored || p.type === 'm1' || p.type === 'm2' || p.type === 'm3' || p.type === 'p1';
/** Which shot color a play wears on the court. */
const kindOf = (t: string) => (t.endsWith('3') ? 'k3' : t.endsWith('1') ? 'k1' : 'k2');

/** A play as a line to read. `team` stands in when the play was not given to a player. */
function words(p: LivePlay, team: string, assist?: string) {
  const who = p.who || team;
  // Another sport's play: who, and what it was, as its sport calls it.
  if (playOf(p.type)) return `${who}: ${playText({ id: p.id, side: p.side, player: null, type: p.type, period: p.period, v: p.v })}`;
  if (isShot(p.type)) return `${who} ${SHOT_WORDS[p.type]}${assist ? ` (${assist} assists)` : ''}`;
  switch (p.type) {
    case 'p1':
      return `Point for ${who}`;
    case 'reb':
      return `${p.side === 'us' ? (p.off ? 'Offensive rebound' : 'Defensive rebound') : 'Rebound'} by ${who}`;
    case 'ast':
      return `Assist by ${who}`;
    case 'stl':
      return `Steal by ${who}`;
    case 'blk':
      return `Block by ${who}`;
    case 'to':
      return `Turnover by ${who}${p.forced ? (p.by ? `, forced by ${p.by}` : ', forced') : ''}`;
    case 'pf':
      return p.fts ? `Shooting foul on ${who}: ${p.fts} free ${p.fts === 1 ? 'throw' : 'throws'}` : `Foul on ${who}`;
    default:
      return who;
  }
}

export default function LivePlays({ teamId, teamName }: { teamId: string; teamName: string }) {
  const [feed, setFeed] = useState<LiveFeed | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.familyLive(teamId).then((f) => (setFeed(f), setError('')), (e) => setError((e as Error).message)), [teamId]);
  useEffect(() => {
    load();
    window.addEventListener('dime:news', load);
    const timer = window.setInterval(load, 6000);
    return () => {
      window.removeEventListener('dime:news', load);
      window.clearInterval(timer);
    };
  }, [load]);
  if (error) return <p className="error">{error}</p>;
  if (!feed) return <p className="muted">Loading…</p>;
  if (!feed.game)
    return (
      <div className="card lp-none">
        <h2>No game is being scored right now</h2>
        <p className="muted">When a coach keeps score during a game, every play shows up here as it happens: who did what, and the score.</p>
      </div>
    );
  const g = feed.game;
  // Baseball, football or volleyball, told from the plays: it names the parts of the game, and has no court of shots.
  const def = scoringOfPlays(feed.plays);
  const part = (p: number) => partName(def, p, g.halves);
  const newest = feed.plays[feed.plays.length - 1];
  // A game won by sets shows the set being played, with the sets won beside it.
  const board = def?.sets ? (newest && newest.period === g.period ? { us: newest.us, them: newest.them } : { us: 0, them: 0 }) : { us: g.us, them: g.them };
  const name = (side: 'us' | 'them') => (side === 'us' ? teamName : g.opponent);
  // An assist is read as part of the shot it set up, so it gets no line of its own.
  const assists = new Map(feed.plays.filter((p) => p.type === 'ast' && p.shot).map((p) => [p.shot!, p.who]));
  const lines = feed.plays.filter((p) => !(p.type === 'ast' && p.shot)).reverse();
  const latest = lines[0];
  const spots = feed.plays.filter((p) => p.side === 'us' && p.x !== undefined && p.y !== undefined).slice(-14);
  const lastSpot = latest && latest.x !== undefined ? latest : null;
  // The away team is named first, as on a scoreboard.
  const sides: ('us' | 'them')[] = g.home ? ['them', 'us'] : ['us', 'them'];
  return (
    <div className="lp">
      <div className="card lp-board" role="status" aria-live="polite" aria-label={`${name(sides[0])} ${board[sides[0]]}, ${name(sides[1])} ${board[sides[1]]}, ${part(g.period)}`}>
        <span className="lp-team">{name(sides[0])}</span>
        <strong className="lp-score">{board[sides[0]]}</strong>
        <span className="lp-mid">
          <span className="gv-badge">LIVE</span>
          <span className="lp-period">{part(g.period)}</span>
          {def?.sets && (
            <span className="lp-period">
              Sets {g[sides[0]]}–{g[sides[1]]}
            </span>
          )}
        </span>
        <strong className="lp-score">{board[sides[1]]}</strong>
        <span className="lp-team right">{name(sides[1])}</span>
      </div>
      <div className={`lp-main ${def ? 'no-court' : ''}`}>
        {!def && <div className="card lp-court-card">
          <svg className="lp-court play-svg" viewBox={`0 0 ${COURT.width} ${COURT.half}`} role="img" aria-label={`Half court with ${spots.length} of ${teamName}'s recent shots marked.`}>
            <Court court="half" flipped={false} />
            {lastSpot?.path && <polyline className={`lp-way ${kindOf(lastSpot.type)}`} points={lastSpot.path.map(([x, y]) => `${x * COURT.width},${y * COURT.half}`).join(' ')} />}
            {spots.map((p) => (
              <circle key={p.id} className={`shot ${kindOf(p.type)} ${made(p) ? 'made' : 'miss'} ${lastSpot?.id === p.id ? 'now' : 'then'}`} cx={p.x! * COURT.width} cy={p.y! * COURT.half} r={lastSpot?.id === p.id ? 1.15 : 0.8} />
            ))}
            {/* The newest shot is ringed, and the ring spreads out from it. */}
            {lastSpot && <circle key={`r${lastSpot.id}`} className={`lp-ring ${kindOf(lastSpot.type)}`} cx={lastSpot.x! * COURT.width} cy={lastSpot.y! * COURT.half} r={1.2} />}
          </svg>
          <p className="muted small lp-court-note">{spots.length === 0 ? 'Shots show on the court when the scorer marks where they went up.' : `${teamName}'s recent shots. Filled is made, a ring is missed.`}</p>
        </div>}
        <div className="lp-side">
          {latest && (
            <div key={latest.id} className={`card lp-latest ${latest.side} ${made(latest) ? 'scored' : ''}`}>
              <span className="lp-latest-top">
                <span className="lp-tag">{name(latest.side)}</span>
                <span className="muted small">{part(latest.period)}</span>
              </span>
              <strong>{words(latest, name(latest.side), assists.get(latest.id))}</strong>
              <span className="lp-latest-score">
                {name(sides[0])} {latest[sides[0]]} · {name(sides[1])} {latest[sides[1]]}
              </span>
            </div>
          )}
          <div className="card lp-feed">
            <h2>Play by play</h2>
            <ol>
              {lines.slice(0, 40).map((p) => (
                <li key={p.id} className={`${p.side} ${made(p) ? 'scored' : ''}`}>
                  <span className="lp-when">{part(p.period)}</span>
                  <span className="lp-what">{words(p, name(p.side), assists.get(p.id))}</span>
                  {made(p) && (
                    <span className="lp-run">
                      {p[sides[0]]}–{p[sides[1]]}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {lines.length > 40 && <p className="muted small">The latest 40 of {lines.length} plays.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
