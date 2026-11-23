// Game by game: one stat as a line across the games picked, for the team and then for each
// player in a small chart of their own. Every chart shares the same games along the bottom, and
// pointing at a game marks it in all of them at once.
import { useId, useState } from 'react';
import { linesOf, scoreOf, type Scoresheet, type StatLine } from '../scoring';
import { fmtDateShort } from '../util';

export type ChartStat = 'pts' | 'reb' | 'oreb' | 'dreb' | 'ast' | 'stl' | 'blk' | 'to' | 'pf' | 'tpm';
export const CHART_STATS: [ChartStat, string, string][] = [
  ['pts', 'PTS', 'Points'],
  ['reb', 'REB', 'Rebounds'],
  ['oreb', 'OREB', 'Offensive rebounds'],
  ['dreb', 'DREB', 'Defensive rebounds'],
  ['ast', 'AST', 'Assists'],
  ['stl', 'STL', 'Steals'],
  ['blk', 'BLK', 'Blocks'],
  ['to', 'TO', 'Turnovers'],
  ['pf', 'PF', 'Fouls'],
  ['tpm', '3PM', 'Threes made'],
];
const gameName = (g: Scoresheet) => (g.opponent ? `vs. ${g.opponent}` : g.title || 'Game');
/** A round number at or above the largest value, so the top line of the chart is easy to read. */
function ceiling(max: number) {
  if (max <= 4) return 4;
  const step = max <= 10 ? 2 : max <= 20 ? 5 : max <= 50 ? 10 : max <= 100 ? 20 : 50;
  return Math.ceil(max / step) * step;
}

/** A straight line from each game's point to the next. */
const path = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' ');

/**
 * One line chart. `series` are drawn in order: the first in the chart's one color, a second in
 * gray and dashed (the other team, for comparison). `at` is the game being pointed at, shared
 * with the charts beside it.
 */
function Line({
  title,
  series,
  labels,
  top,
  at,
  onAt,
  big,
}: {
  title: string;
  series: { name: string; values: number[] }[];
  /** What each game along the bottom is called, and its date. */
  labels: { name: string; date: string }[];
  /** The top of the scale, shared by charts that are meant to be compared. */
  top: number;
  at: number | null;
  onAt: (i: number | null) => void;
  big?: boolean;
}) {
  const W = big ? 720 : 260;
  const H = big ? 220 : 130;
  const pad = { l: 30, r: big ? 34 : 12, t: big ? 18 : 12, b: 22 };
  // Letters and numbers only: some browsers will not follow url(#...) to an id with other marks in it.
  const fade = `scfade${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const n = labels.length;
  const x = (i: number) => (n <= 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => H - pad.b - (v / top) * (H - pad.t - pad.b);
  const ticks = [0, top / 2, top];
  const nearest = (clientX: number, box: DOMRect) => {
    const px = ((clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    return best;
  };
  const shown = at !== null && at < n ? at : null;
  return (
    <figure className={`sc-chart ${big ? 'big' : ''} ${shown !== null ? 'at' : ''}`}>
      <figcaption>
        <strong>{title}</strong>
        {/* The game pointed at, or else the total over the games shown. */}
        <span className="muted small">
          {shown !== null ? `${labels[shown].name}, ${fmtDateShort(labels[shown].date)}: ${series.map((s) => `${series.length > 1 ? `${s.name} ` : ''}${s.values[shown]}`).join(' · ')}` : `${series[0].values.reduce((a, b) => a + b, 0)} in ${n} ${n === 1 ? 'game' : 'games'}`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}, game by game: ${labels.map((l, i) => `${l.name} ${series[0].values[i]}`).join(', ')}`}
        onMouseMove={(e) => onAt(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onMouseLeave={() => onAt(null)}
        onTouchStart={(e) => onAt(nearest(e.touches[0].clientX, e.currentTarget.getBoundingClientRect()))}
      >
        <defs>
          <linearGradient id={fade} x1="0" x2="0" y1="0" y2="1">
            <stop className="sc-fade-top" offset="0" />
            <stop className="sc-fade-end" offset="1" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="sc-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className="sc-tick" x={pad.l - 6} y={y(t) + 3.5} textAnchor="end">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {/* The first and last game are named along the bottom; the rest are read by pointing. */}
        {n > 0 && (
          <text className="sc-tick" x={x(0)} y={H - 6} textAnchor={n === 1 ? 'middle' : 'start'}>
            {fmtDateShort(labels[0].date)}
          </text>
        )}
        {n > 1 && (
          <text className="sc-tick" x={x(n - 1)} y={H - 6} textAnchor="end">
            {fmtDateShort(labels[n - 1].date)}
          </text>
        )}
        {shown !== null && <line className="sc-cross" x1={x(shown)} x2={x(shown)} y1={pad.t} y2={H - pad.b} />}
        {[...series].reverse().map((s, k) => {
          const other = series.length - 1 - k > 0;
          return (
            <g key={s.name} className={other ? 'sc-other' : 'sc-main'}>
              {n > 1 && !other && <path className="sc-area" fill={`url(#${fade})`} d={`${path(s.values.map((v, i) => [x(i), y(v)]))} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} />}
              {n > 1 && <path className="sc-line" pathLength={other ? undefined : 1} d={path(s.values.map((v, i) => [x(i), y(v)]))} />}
              {/* A small chart shows only where the line ends and the game pointed at: the line carries the rest. */}
              {s.values.map((v, i) =>
                big || shown === i || i === n - 1 ? <circle key={i} className={i === n - 1 ? 'last' : ''} style={{ animationDelay: `${0.25 + (n > 1 ? i / (n - 1) : 0) * 0.85}s` }} cx={x(i)} cy={y(v)} r={shown === i ? 5.5 : i === n - 1 ? (big ? 5 : 3.5) : n > 12 ? 2.5 : 3.5} /> : null,
              )}
              {/* Where each line ends is written beside it, on the side away from the other line. */}
              {big && n > 1 && (
                <text className="sc-end" x={x(n - 1) + 9} y={y(s.values[n - 1]) + 4 + (series.length > 1 && s.values[n - 1] === series[other ? 0 : 1].values[n - 1] ? (other ? 7 : -7) : 0)}>
                  {s.values[n - 1]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <p className="sc-legend muted small">
          {series.map((s, i) => (
            <span key={s.name}>
              <i className={i ? 'other' : ''} aria-hidden="true" /> {s.name}
            </span>
          ))}
        </p>
      )}
    </figure>
  );
}

/** The charts for the games given, oldest first: the team's line, then a small one for each player. */
export default function StatCharts({ games, nameOf, teamName }: { games: Scoresheet[]; nameOf: (playerId: number) => string; teamName: string }) {
  const [stat, setStat] = useState<ChartStat>('pts');
  const [at, setAt] = useState<number | null>(null);
  const ordered = [...games].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const labels = ordered.map((g) => ({ name: gameName(g), date: g.date }));
  const lines = ordered.map((g) => linesOf(g.events, 'us'));
  const word = CHART_STATS.find(([id]) => id === stat)![2];
  const of = (l: StatLine | undefined) => (l ? l[stat] : 0);
  const team = lines.map((l) => of(l.total));
  // Points have the other team's to set beside them. Nothing else is known about the other team for every game.
  const them = ordered.map((g) => scoreOf(g.events).them);
  const ids = [...new Set(lines.flatMap((l) => [...l.players.keys()]))];
  const players = ids
    .map((id) => ({ id, values: lines.map((l) => of(l.players.get(id))) }))
    .map((p) => ({ ...p, total: p.values.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
  const playerTop = ceiling(Math.max(1, ...players.flatMap((p) => p.values)));
  return (
    <div className="sc">
      <div className="sc-bar">
        <div className="seg" role="group" aria-label="Which stat to chart">
          {CHART_STATS.map(([id, short, long]) => (
            <button key={id} type="button" className={stat === id ? 'on' : ''} aria-pressed={stat === id} title={long} onClick={() => setStat(id)}>
              {short}
            </button>
          ))}
        </div>
      </div>
      <Line big key={stat} title={`${teamName}: ${word.toLowerCase()} each game`} series={stat === 'pts' ? [{ name: teamName, values: team }, { name: 'Other team', values: them }] : [{ name: teamName, values: team }]} labels={labels} top={ceiling(Math.max(1, ...team, ...(stat === 'pts' ? them : [])))} at={at} onAt={setAt} />
      {players.length > 0 && (
        <>
          <p className="muted small sc-note">Each player, on the same scale so the charts can be compared. Point at a game to read it in every chart.</p>
          <div className="sc-grid-wrap">
            {players.map((p) => (
              <Line key={`${p.id}-${stat}`} title={nameOf(p.id)} series={[{ name: nameOf(p.id), values: p.values }]} labels={labels} top={playerTop} at={at} onAt={setAt} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
