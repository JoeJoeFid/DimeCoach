// What goes with winning: each stat's link with the margin of the game, the strongest first, with
// how the stat averages in wins against losses. A marker at the top says how far the number of
// games behind it can be trusted.
import { linesOf, type Scoresheet } from '../scoring';
import { CONFIDENCE_STEPS, confidence, strength, winLinks, type GameNumbers, type WinRow } from '../wins';

/** How much to trust what is shown: four steps, filled up to the one the number of games has reached. */
function ConfidenceMark({ games, wins, losses, ties }: { games: number; wins: number; losses: number; ties: number }) {
  const c = confidence(games);
  return (
    <div className={`ww-conf l${c.level}`} role="note" aria-label={`Confidence: ${c.label}, from ${games} games`}>
      <span className="ww-pips" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <i key={n} className={n <= c.level ? 'on' : ''} />
        ))}
      </span>
      <span className="ww-conf-words">
        <strong>
          Confidence: {c.label} <span className="muted">· {games} {games === 1 ? 'game' : 'games'}</span>
        </strong>
        <span className="muted small">
          {wins} {wins === 1 ? 'win' : 'wins'}, {losses} {losses === 1 ? 'loss' : 'losses'}
          {ties > 0 ? `, ${ties} ${ties === 1 ? 'tie' : 'ties'}` : ''}. {c.about}
        </span>
        <span className="muted small">
          Under {CONFIDENCE_STEPS.early} games is very low, {CONFIDENCE_STEPS.early} to {CONFIDENCE_STEPS.fair - 1} an early read, {CONFIDENCE_STEPS.fair} to {CONFIDENCE_STEPS.solid - 1} fair, {CONFIDENCE_STEPS.solid} or more solid.
        </span>
      </span>
    </div>
  );
}

export default function WhatWins({ games }: { games: Scoresheet[] }) {
  // A game with a score and nothing else has no stats to weigh.
  const tracked = games.filter((g) => g.events.some((e) => e.side === 'us' && e.type !== 'p1'));
  const numbers: GameNumbers[] = tracked.map((g) => ({ us: linesOf(g.events, 'us').total, them: linesOf(g.events, 'them').total, scoreUs: g.us, scoreThem: g.them }));
  if (tracked.length === 0) return <p className="muted">None of these games has stats recorded, only a score.</p>;
  return <WinTable games={tracked.length} {...winLinks(numbers)} note="Fouls, for one, pile up late in games a team is already losing. Points are left out because the margin is made of them." />;
}

/** The table itself, for any sport: each stat's link with the margin, the strongest first. `games` is how many it is drawn from, and `note` what to add at the foot. */
export function WinTable({ rows, wins, losses, ties, games, note }: { rows: WinRow[]; wins: number; losses: number; ties: number; games: number; note?: string }) {
  const show = (v: number | null, rate: boolean) => (v === null ? '–' : rate ? `${Math.round(v)}%` : v.toFixed(1));
  return (
    <div className="ww">
      <ConfidenceMark games={games} wins={wins} losses={losses} ties={ties} />
      {(wins === 0 || losses === 0) && <p className="muted small">These games are all {wins === 0 ? (losses === 0 ? 'ties' : 'losses') : 'wins'}, so there is no win and loss to set side by side. The link below still uses how much each game was won or lost by.</p>}
      <div className="table-scroll">
        <table className="table ww-table">
          <thead>
            <tr>
              <th>Stat</th>
              <th>In wins</th>
              <th>In losses</th>
              <th>Link with the final margin</th>
              <th>What it says</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  {r.name}
                  {r.games !== games && <span className="muted small"> · {r.games} {r.games === 1 ? 'game' : 'games'}</span>}
                </th>
                <td>{show(r.inWins, r.rate)}</td>
                <td>{show(r.inLosses, r.rate)}</td>
                <td>
                  {r.r === null ? (
                    <span className="muted small">Not enough to tell</span>
                  ) : (
                    <span className="ww-link">
                      <span className={`ww-bar ${r.r >= 0 ? 'up' : 'down'}`} aria-hidden="true">
                        <i style={{ width: `${Math.abs(r.r) * 50}%` }} />
                      </span>
                      <b>{`${r.r > 0 ? '+' : ''}${r.r.toFixed(2)}`}</b>
                    </span>
                  )}
                </td>
                <td>{r.r === null ? '' : Math.abs(r.r) < 0.2 ? strength(r.r) : `${strength(r.r)}: ${r.r > 0 ? 'more' : 'fewer'} goes with winning`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        The link runs from -1 to +1. A bar to the right means the stat is higher in the games won by more; to the left, lower. It is each stat on its own against the final margin, and it shows what moves together, not what causes what. {note}
      </p>
    </div>
  );
}
