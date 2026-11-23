// Shooting, drawn three ways. For one game: every attempt in order as a line that climbs with the
// score, and the same attempts laid out player by player and period by period. Over many games:
// how much each player shoots against how much each shot is worth.
//
// A made shot is a filled dot and a miss is a ring in the same color, so made and missed are never
// told apart by color alone.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { periodName, type Scoresheet } from '../scoring';
import { attemptsOf, efficiency, hasOrder, sections, streaks, tally, type Attempt, type GameShots, type ShotKind, type Tally } from '../shots';
import { fmtDateShort } from '../util';
import { COURT, Court } from './PlayDiagram';

const KIND_WORD: Record<ShotKind, string> = { 2: '2 point', 3: '3 point', 1: 'Free throw' };
const gameName = (g: Scoresheet) => `${fmtDateShort(g.date)} · ${g.opponent ? `vs. ${g.opponent}` : g.title || 'Game'}`;
const of = (made: number, tried: number) => `${made} of ${tried}`;

type Tip = { x: number; y: number; lines: string[] } | null;
/** A small box of words that comes up over whatever is pointed at or pressed. */
function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  useEffect(() => {
    if (!tip) return;
    const off = () => setTip(null);
    window.addEventListener('scroll', off, true);
    return () => window.removeEventListener('scroll', off, true);
  }, [tip]);
  const show = (el: Element, lines: string[]) => {
    const r = el.getBoundingClientRect();
    setTip({ x: Math.min(Math.max(r.left + r.width / 2, 120), window.innerWidth - 120), y: r.top, lines });
  };
  /** What a dot needs so that pointing at it, or pressing it, says what it is. */
  const on = (lines: string[]) => ({
    onMouseEnter: (e: { currentTarget: Element }) => show(e.currentTarget, lines),
    onMouseLeave: () => setTip(null),
    onClick: (e: { currentTarget: Element; stopPropagation: () => void }) => {
      e.stopPropagation();
      show(e.currentTarget, lines);
    },
  });
  const box = tip && (
    <div className="shot-tip" role="status" style={{ left: tip.x, top: tip.y }}>
      {tip.lines.map((l, i) => (i === 0 ? <strong key={i}>{l}</strong> : <span key={i}>{l}</span>))}
    </div>
  );
  return { on, box };
}

/** What the colors and the two kinds of dot stand for. */
function Legend({ kinds = [2, 3, 1] }: { kinds?: ShotKind[] }) {
  return (
    <p className="shot-legend muted small">
      {kinds.map((k) => (
        <span key={k}>
          <i className={`shot-dot k${k} made`} aria-hidden="true" /> {KIND_WORD[k]}
        </span>
      ))}
      <span className="shot-legend-gap">
        <i className="shot-dot plain made" aria-hidden="true" /> Made
      </span>
      <span>
        <i className="shot-dot plain miss" aria-hidden="true" /> Missed
      </span>
    </p>
  );
}

/** What a dot says about itself. */
const say = (a: Attempt, nameOf: (id: number) => string, teamName: string, halves: boolean) => [
  a.player === null ? `${teamName} (not assigned)` : nameOf(a.player),
  `${KIND_WORD[a.kind]} · ${a.made ? 'Made' : 'Missed'}`,
  `${periodName(a.period, halves)} · ${teamName} ${a.score} after it`,
];

/** Every attempt in order, evenly spaced, on a line that steps up with each make. */
function RunChart({ list, nameOf, teamName, halves }: { list: Attempt[]; nameOf: (id: number) => string; teamName: string; halves: boolean }) {
  const tip = useTip();
  const STEP = 24;
  const pad = { l: 38, r: 118, t: 30, b: 84 };
  const H = 350;
  const n = list.length;
  const W = pad.l + n * STEP + pad.r;
  const total = tally(list);
  // The points of the attempts shown: for one player that is their own, not the team's.
  const running: number[] = [];
  list.reduce((sum, a) => (running.push(sum + a.points), sum + a.points), 0);
  const top = Math.max(5, Math.ceil(total.pts / 5) * 5);
  const x = (i: number) => pad.l + (i + 0.5) * STEP;
  const y = (v: number) => H - pad.b - (v / top) * (H - pad.t - pad.b);
  const line = list.reduce((d, a, i) => `${d} H${x(i)}${a.made ? ` V${y(running[i])}` : ''}`, `M${pad.l},${y(0)}`);
  const parts = sections(list);
  const marks = streaks(list);
  const endY = Math.min(Math.max(y(total.pts) - 4, pad.t + 12), H - pad.b - 46);
  return (
    <>
      <div className="shot-scroll">
        <svg className="shot-run" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Shot by shot: ${n} attempts for ${total.pts} points. Field goals ${of(total.fgm, total.fga)}, threes ${of(total.tpm, total.tpa)}, free throws ${of(total.ftm, total.fta)}.`}>
          {[0, top / 2, top].map((v) => (
            <g key={v}>
              <line className="sc-grid" x1={pad.l} x2={pad.l + n * STEP} y1={y(v)} y2={y(v)} />
              <text className="sc-tick" x={pad.l - 6} y={y(v) + 3.5} textAnchor="end">
                {Math.round(v)}
              </text>
            </g>
          ))}
          {/* Hot and cold stretches: a band behind the line, with a word on it. */}
          {marks.map((s) => (
            <g key={`${s.kind}${s.from}`} className={`shot-streak ${s.kind}`}>
              <rect x={pad.l + s.from * STEP} y={pad.t - 14} width={(s.to - s.from + 1) * STEP} height={H - pad.b - pad.t + 14} rx={4} />
              <text x={pad.l + ((s.from + s.to + 1) / 2) * STEP} y={pad.t - 3} textAnchor="middle">
                {s.kind === 'run' ? `${s.count} makes in a row` : `${s.count} misses in a row`}
              </text>
            </g>
          ))}
          {/* The periods: a line between each, and under each its name and totals. */}
          {parts.map((s, k) => (
            <g key={s.period}>
              {k > 0 && <line className="shot-divide" x1={pad.l + s.start * STEP} x2={pad.l + s.start * STEP} y1={pad.t - 14} y2={H - pad.b + 8} />}
              <text className="shot-period" x={pad.l + ((s.start + s.end) / 2) * STEP} y={H - pad.b + 22} textAnchor="middle">
                <title>{`${periodName(s.period, halves)}: FG ${of(s.totals.fgm, s.totals.fga)}, 3PT ${of(s.totals.tpm, s.totals.tpa)}, FT ${of(s.totals.ftm, s.totals.fta)}`}</title>
                <tspan className="name">{periodName(s.period, halves)}</tspan>
                {/* A period with only a few attempts is too narrow for its totals: they would run into the next period's. */}
                {(s.end - s.start) * STEP >= 74 && (
                  <>
                    <tspan x={pad.l + ((s.start + s.end) / 2) * STEP} dy={14}>
                      FG {of(s.totals.fgm, s.totals.fga)}
                    </tspan>
                    <tspan x={pad.l + ((s.start + s.end) / 2) * STEP} dy={13}>
                      3PT {of(s.totals.tpm, s.totals.tpa)}
                    </tspan>
                    <tspan x={pad.l + ((s.start + s.end) / 2) * STEP} dy={13}>
                      FT {of(s.totals.ftm, s.totals.fta)}
                    </tspan>
                  </>
                )}
              </text>
            </g>
          ))}
          {/* The pace the points came at over the whole game. */}
          <line className="shot-pace" x1={pad.l} y1={y(0)} x2={x(n - 1)} y2={y(total.pts)} />
          <path className="shot-line" d={line} />
          {list.map((a, i) => (
            <circle key={a.id} className={`shot k${a.kind} ${a.made ? 'made' : 'miss'}`} cx={x(i)} cy={y(running[i])} r={6} {...tip.on(say(a, nameOf, teamName, halves))}>
              <title>{say(a, nameOf, teamName, halves).join('. ')}</title>
            </circle>
          ))}
          <text className="shot-end" x={x(n - 1) + 16} y={endY}>
            <tspan className="pts">{total.pts} pts</tspan>
            <tspan x={x(n - 1) + 16} dy={15}>
              2PT {of(total.fgm - total.tpm, total.fga - total.tpa)}
            </tspan>
            <tspan x={x(n - 1) + 16} dy={14}>
              3PT {of(total.tpm, total.tpa)}
            </tspan>
            <tspan x={x(n - 1) + 16} dy={14}>
              FT {of(total.ftm, total.fta)}
            </tspan>
          </text>
        </svg>
      </div>
      <Legend />
      <p className="muted small shot-note">The gray line is the pace the points came at over the whole game. A shaded band marks {RUN_WORDS}.</p>
      {tip.box}
    </>
  );
}
const RUN_WORDS = 'four or more field goals made in a row, or five or more missed in a row; free throws are not counted in either';

/** Makes of attempts for a row's last cell, or a period's foot. */
function Totals({ t }: { t: Tally }) {
  return (
    <>
      <b>FG {of(t.fgm, t.fga)}</b>
      <span className="muted">
        3PT {of(t.tpm, t.tpa)} · FT {of(t.ftm, t.fta)}
      </span>
    </>
  );
}

/** One row for each player, one column for each period: the attempts as dots in the order taken. */
function PeriodGrid({ list, nameOf, teamName, halves }: { list: Attempt[]; nameOf: (id: number) => string; teamName: string; halves: boolean }) {
  const tip = useTip();
  const periods = sections(list).map((s) => s.period);
  const ids = [...new Set(list.map((a) => a.player))];
  const rows = ids
    .map((id) => ({ id, name: id === null ? 'Not assigned' : nameOf(id), mine: list.filter((a) => a.player === id) }))
    .sort((a, b) => Number(a.id === null) - Number(b.id === null) || b.mine.length - a.mine.length);
  return (
    <>
      <div className="table-scroll">
        <table className="table shot-grid">
          <thead>
            <tr>
              <th>Player</th>
              {periods.map((p) => (
                <th key={p}>{periodName(p, halves)}</th>
              ))}
              <th>Game</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <th scope="row">{r.name}</th>
                {periods.map((p) => (
                  <td key={p}>
                    <span className="shot-cell">
                      {r.mine
                        .filter((a) => a.period === p)
                        .map((a) => (
                          <i key={a.id} className={`shot-dot k${a.kind} ${a.made ? 'made' : 'miss'}`} title={say(a, nameOf, teamName, halves).join('. ')} {...tip.on(say(a, nameOf, teamName, halves))} />
                        ))}
                    </span>
                  </td>
                ))}
                <td className="shot-sum">
                  <Totals t={tally(r.mine)} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{teamName}</th>
              {periods.map((p) => (
                <td key={p} className="shot-sum">
                  <Totals t={tally(list.filter((a) => a.period === p))} />
                </td>
              ))}
              <td className="shot-sum">
                <Totals t={tally(list)} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <Legend />
      {tip.box}
    </>
  );
}

/** One dot for each player: how many shots they take a game, against the points each shot brings. */
function Volume({ games, nameOf }: { games: GameShots[]; nameOf: (id: number) => string }) {
  const tip = useTip();
  const [two, setTwo] = useState(true);
  const [three, setThree] = useState(true);
  const { rows, average } = efficiency(games, { two, three });
  const W = 700;
  const H = 400;
  const pad = { l: 50, r: 24, t: 22, b: 46 };
  const maxX = Math.max(2, Math.ceil(Math.max(0, ...rows.map((r) => r.perGame)) * 1.1));
  const maxY = Math.min(3, Math.max(1.5, Math.ceil(Math.max(0, ...rows.map((r) => r.pps)) * 2 + 0.5) / 2));
  const x = (v: number) => pad.l + (v / maxX) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / maxY) * (H - pad.t - pad.b);
  // Names are put down one at a time, each in the first place beside its dot that nothing else is using.
  type Box = { l: number; t: number; r: number; b: number };
  const hits = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  const taken: Box[] = rows.map((r) => ({ l: x(r.perGame) - 7, r: x(r.perGame) + 7, t: y(r.pps) - 7, b: y(r.pps) + 7 }));
  const labels = [...rows]
    .sort((a, b) => b.pps - a.pps)
    .map((r) => {
      const text = nameOf(r.id);
      const w = text.length * 6.3 + 4;
      const cx = x(r.perGame);
      const cy = y(r.pps);
      const places: [number, number][] = [[cx + 10, cy + 4], [cx - 10 - w, cy + 4], [cx - w / 2, cy - 11], [cx - w / 2, cy + 20]];
      for (let down = 12; down <= 72; down += 12) places.push([cx + 10, cy + 4 + down], [cx - 10 - w, cy + 4 + down]);
      const fits = ([lx, ly]: [number, number]) => {
        const box = { l: lx, r: lx + w, t: ly - 11, b: ly + 3 };
        return box.l >= pad.l && box.r <= W - 4 && box.t >= 4 && box.b <= H - pad.b && !taken.some((o) => hits(box, o));
      };
      const [lx, ly] = places.find(fits) ?? places[0];
      taken.push({ l: lx, r: lx + w, t: ly - 11, b: ly + 3 });
      return { id: r.id, text, lx, ly };
    });
  return (
    <>
      <div className="shot-toggles" role="group" aria-label="Which shots to count">
        <button type="button" className={`chip toggle ${two ? 'on' : ''}`} aria-pressed={two} onClick={() => setTwo(!two)}>
          <i className="shot-dot k2 made" aria-hidden="true" /> 2 point
        </button>
        <button type="button" className={`chip toggle ${three ? 'on' : ''}`} aria-pressed={three} onClick={() => setThree(!three)}>
          <i className="shot-dot k3 made" aria-hidden="true" /> 3 point
        </button>
      </div>
      {!two && !three ? (
        <p className="muted">Turn on 2 point or 3 point to see the chart.</p>
      ) : rows.length === 0 ? (
        <p className="muted">No attempts are recorded for a player in these games.</p>
      ) : (
        <>
          <div className="shot-scroll">
            <svg className="shot-volume" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Shot attempts per game against points per shot: ${rows.map((r) => `${nameOf(r.id)}, ${r.perGame.toFixed(1)} a game, ${r.pps.toFixed(2)} points a shot`).join('; ')}`}>
              {[0, maxY / 2, maxY].map((v) => (
                <g key={v}>
                  <line className="sc-grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
                  <text className="sc-tick" x={pad.l - 6} y={y(v) + 3.5} textAnchor="end">
                    {v.toFixed(v % 1 ? 2 : 0)}
                  </text>
                </g>
              ))}
              {[0, maxX / 2, maxX].map((v) => (
                <text key={v} className="sc-tick" x={x(v)} y={H - pad.b + 16} textAnchor="middle">
                  {v % 1 ? v.toFixed(1) : v}
                </text>
              ))}
              <text className="shot-axis" x={(pad.l + W - pad.r) / 2} y={H - 8} textAnchor="middle">
                Shot attempts per game
              </text>
              <text className="shot-axis" transform={`translate(13 ${(pad.t + H - pad.b) / 2}) rotate(-90)`} textAnchor="middle">
                Points per shot
              </text>
              {average !== null && (
                <g>
                  <line className="shot-average" x1={pad.l} x2={W - pad.r} y1={y(average)} y2={y(average)} />
                  <text className="shot-average-word" x={W - pad.r} y={y(average) - 5} textAnchor="end">
                    Team average {average.toFixed(2)}
                  </text>
                </g>
              )}
              {rows.map((r) => {
                const words = [nameOf(r.id), `${r.perGame.toFixed(1)} attempts a game over ${r.games} ${r.games === 1 ? 'game' : 'games'}`, `${r.pps.toFixed(2)} points per shot (${of(r.made, r.attempts)} made)`];
                return (
                  <circle key={r.id} className="shot-player" cx={x(r.perGame)} cy={y(r.pps)} r={6} {...tip.on(words)}>
                    <title>{words.join('. ')}</title>
                  </circle>
                );
              })}
              {labels.map((l) => (
                <text key={l.id} className="shot-name" x={l.lx} y={l.ly}>
                  {l.text}
                </text>
              ))}
            </svg>
          </div>
          <p className="muted small shot-note">Further right is more shots a game; higher is more points from each one. Free throws are not counted here.</p>
        </>
      )}
      {tip.box}
    </>
  );
}

/** Where the shots were taken: each one that had its spot marked, on the half court. */
function ShotMap({ list, nameOf, teamName, halvesOf }: { list: Attempt[]; nameOf: (id: number) => string; teamName: string; /** Whether the game an attempt is from was played in halves. */ halvesOf: (a: Attempt) => boolean }) {
  const tip = useTip();
  const [moves, setMoves] = useState(false);
  /** With movement lines on: the shot being pointed at, by itself or by its line. It stands out and the rest dim. */
  const [focus, setFocus] = useState<string | null>(null);
  const lit = moves ? focus : null;
  const field = list.filter((a) => a.kind !== 1);
  const placed = field.filter((a) => a.x !== undefined && a.y !== undefined);
  if (placed.length === 0)
    return <p className="muted">No shots have a spot marked here. Turn on "Shot placement" under Scoring setup and the pad asks where each shot was taken.</p>;
  const t = tally(placed);
  const drawn = placed.filter((a) => a.path && a.path.length > 1);
  return (
    <>
      {drawn.length > 0 && (
        <div className="shot-toggles">
          <button type="button" className={`chip toggle ${moves ? 'on' : ''}`} aria-pressed={moves} onClick={() => setMoves(!moves)}>
            Movement lines <span className="chip-num">{drawn.length}</span>
          </button>
        </div>
      )}
      <svg className={`shot-map play-svg ${lit ? 'focusing' : ''}`} viewBox={`0 0 ${COURT.width} ${COURT.half}`} role="img" aria-label={`Shot map: ${placed.length} shots with a spot marked, ${t.fgm} made.`} onClick={() => setFocus(null)}>
        <Court court="half" flipped={false} />
        {/* How each shooter got to the spot, from the small dot where they set off. Under the shots, so the dots stay clear. */}
        {moves &&
          drawn.map((a) => (
            <g
              key={`r${a.id}`}
              className={`shot-route k${a.kind} ${lit === a.id ? 'on' : ''}`}
              onMouseEnter={() => setFocus(a.id)}
              onMouseLeave={() => setFocus(null)}
              onClick={(e) => {
                e.stopPropagation();
                setFocus(a.id);
              }}
            >
              {/* A wide unseen line over the thin one, so it is easy to point at. */}
              <polyline className="shot-route-hit" points={a.path!.map(([px, py]) => `${px * COURT.width},${py * COURT.half}`).join(' ')} />
              <polyline points={a.path!.map(([px, py]) => `${px * COURT.width},${py * COURT.half}`).join(' ')} />
              <circle cx={a.path![0][0] * COURT.width} cy={a.path![0][1] * COURT.half} r={0.38} />
            </g>
          ))}
        {/* Misses first, so a make at the same spot is not hidden under one. */}
        {[...placed]
          .sort((a, b) => Number(a.made) - Number(b.made))
          .map((a) => {
            const words = tip.on(say(a, nameOf, teamName, halvesOf(a)));
            return (
              <circle
                key={a.id}
                className={`shot k${a.kind} ${a.made ? 'made' : 'miss'} ${lit === a.id ? 'on' : ''}`}
                cx={a.x! * COURT.width}
                cy={a.y! * COURT.half}
                r={0.95}
                onMouseEnter={(e) => (words.onMouseEnter(e), setFocus(a.id))}
                onMouseLeave={() => (words.onMouseLeave(), setFocus(null))}
                onClick={(e) => (words.onClick(e), setFocus(a.id))}
              >
                <title>{say(a, nameOf, teamName, halvesOf(a)).join('. ')}</title>
              </circle>
            );
          })}
      </svg>
      <Legend kinds={[2, 3]} />
      <p className="muted small shot-note">
        {placed.length} of {field.length} field goal attempts have a spot marked: {of(t.fgm, t.fga)} made, threes {of(t.tpm, t.tpa)}.
        {moves && ' Each line runs from where the player set off, the small dot, to where the shot went up.'}
      </p>
      {tip.box}
    </>
  );
}

type View = 'run' | 'grid' | 'map' | 'volume';
/**
 * The Shooting part of the stats page. `flag` is whether this team has the shot volume and
 * efficiency chart turned on; `picked` is the games chosen above, which that chart counts.
 */
export default function ShotCharts({ games, picked, nameOf, teamName, teamId, flag }: { games: Scoresheet[]; picked: Scoresheet[]; nameOf: (id: number) => string; teamName: string; teamId: number; flag: boolean }) {
  const [view, setView] = useState<View>('run');
  const byDate = [...games].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const [gameId, setGameId] = useState(0);
  const [who, setWho] = useState<'team' | number>('team');
  const game = byDate.find((g) => g.id === gameId) ?? byDate[0];
  /** The shot map can take every game at once. */
  const ALL = -1;
  const [season, setSeason] = useState<({ plan_id: number } & GameShots)[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!flag || view !== 'volume') return;
    api.shotEfficiency(teamId).then((r) => setSeason(r.games), (e) => setError((e as Error).message));
  }, [flag, view, teamId]);
  const now: View = view === 'volume' && !flag ? 'run' : view;
  const everyGame = now === 'map' && gameId === ALL;
  // Halves or quarters is each game's own choice, so each attempt remembers which its game was.
  const inHalves = new Set<string>();
  const from = (g: Scoresheet) => {
    const list = attemptsOf(g.events);
    if (g.state.halves) for (const a of list) inHalves.add(a.id);
    return list;
  };
  const all = everyGame ? byDate.flatMap(from) : game ? from(game) : [];
  const halves = !!game?.state.halves;
  const shooters = [...new Set(all.map((a) => a.player).filter((id): id is number => id !== null))];
  const shown = who === 'team' ? all : all.filter((a) => a.player === who);
  if (byDate.length === 0) return <p className="muted">No games scored yet, so no attempts are recorded.</p>;
  /** Each chart's button: a small drawing of the chart, in a shot color of its own, and its name. */
  const views: [View, string, string, ReactNode][] = [
    ['run', 'Shot by shot', 'k2', <path key="p" d="M3 19h4v-5h5V9h5V5h4" />],
    ['grid', 'By period', 'k3', <path key="p" d="M4 5h16v14H4zM4 12h16M9.500 5v14M14.500 5v14" />],
    [
      'map',
      'Shot map',
      'k1',
      <g key="p">
        <path d="M4 4h16v16H4zM8 4a4 4 0 0 0 8 0" />
        <circle cx="9" cy="14" r="1.300" fill="currentColor" />
        <circle cx="15.500" cy="11.500" r="1.300" />
      </g>,
    ],
  ];
  if (flag)
    views.push([
      'volume',
      'Volume and efficiency',
      'plain',
      <g key="p">
        <path d="M4 4v16h16" />
        <circle cx="9" cy="14" r="1.400" fill="currentColor" />
        <circle cx="13" cy="9.500" r="1.400" fill="currentColor" />
        <circle cx="17.500" cy="12" r="1.400" fill="currentColor" />
      </g>,
    ]);
  return (
    <div className="card shot-card">
      {/* Which chart, which game and whose shots: all inside the box they change. */}
      <div className="shot-bar">
        <div className="seg shot-views" role="group" aria-label="Which shooting chart">
          {views.map(([id, label, color, art]) => (
            <button key={id} type="button" className={now === id ? 'on' : ''} aria-pressed={now === id} onClick={() => setView(id)}>
              <svg className={color} viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.100" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {art}
              </svg>
              {label}
            </button>
          ))}
        </div>
        {now !== 'volume' && (
          <select className="input shot-game" aria-label="Game" value={everyGame ? ALL : game.id} onChange={(e) => (setGameId(Number(e.target.value)), setWho('team'))}>
            {now === 'map' && <option value={ALL}>All games</option>}
            {byDate.map((g) => (
              <option key={g.id} value={g.id}>
                {gameName(g)}
              </option>
            ))}
          </select>
        )}
        {(now === 'run' || now === 'map') && (
          <select className="input shot-game" aria-label="Whose shots" value={who} onChange={(e) => setWho(e.target.value === 'team' ? 'team' : Number(e.target.value))}>
            <option value="team">Team</option>
            {shooters.map((id) => (
              <option key={id} value={id}>
                {nameOf(id)}
              </option>
            ))}
          </select>
        )}
      </div>
      {now === 'volume' ? (
        <>
          <h2>
            Shot volume and efficiency <span className="muted small">{picked.length} {picked.length === 1 ? 'game' : 'games'}</span>
          </h2>
          {error ? <p className="error">{error}</p> : season === null ? <p className="muted">Loading…</p> : <Volume games={season.filter((g) => picked.some((p) => p.plan_id === g.plan_id))} nameOf={nameOf} />}
        </>
      ) : (
        <>
          <h2>
            {now === 'run' ? 'Shot by shot' : now === 'map' ? 'Shot map' : 'Shots by period'} <span className="muted small">{everyGame ? `${byDate.length} ${byDate.length === 1 ? 'game' : 'games'}` : gameName(game)}</span>
          </h2>
          {now === 'map' ? (
            <ShotMap list={shown} nameOf={nameOf} teamName={teamName} halvesOf={(a) => inHalves.has(a.id)} />
          ) : !hasOrder(game.events) ? (
            <p className="muted">This game's stats were brought in as totals from a file, so the order of its shots is not recorded.</p>
          ) : shown.length === 0 ? (
            <p className="muted">No attempts are recorded for this game.</p>
          ) : now === 'run' ? (
            <RunChart list={shown} nameOf={nameOf} teamName={teamName} halves={halves} />
          ) : (
            <PeriodGrid list={all} nameOf={nameOf} teamName={teamName} halves={halves} />
          )}
        </>
      )}
    </div>
  );
}
