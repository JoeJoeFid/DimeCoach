// The screen for keeping score. Tap a player, then what they did. Everything is big enough to
// hit with a thumb while watching the game, and one tap on Undo takes the last thing back.
//
// It keeps nothing itself: every tap hands the new list of plays to whoever is showing it.
import { useEffect, useRef, useState } from 'react';
import { EV_WORDS, POINTS, byPeriod, clockText, linesOf, newId, periodName, scoreOf, type EvType, type GameEvent, type ScoreState, type StatLine } from '../scoring';
import { confirmDialog } from './dialogs';

export interface PadPlayer {
  id: number;
  name: string;
  number: string;
}
const PAD: { title: string; made?: boolean; keys: [EvType, string][] }[] = [
  { title: 'Made', made: true, keys: [['m2', '+2'], ['m3', '+3'], ['m1', '+1 FT']] },
  { title: 'Missed', keys: [['x2', 'Miss 2'], ['x3', 'Miss 3'], ['x1', 'Miss FT']] },
  { title: 'Also', keys: [['reb', 'Rebound'], ['ast', 'Assist'], ['stl', 'Steal'], ['blk', 'Block'], ['to', 'Turnover'], ['pf', 'Foul']] },
];
const QUICK: [EvType, string][] = [['reb', 'Rebound'], ['to', 'Turnover'], ['pf', 'Foul'], ['stl', 'Steal']];
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The buttons for what one player did. */
function Pad({ onTap }: { onTap: (type: EvType) => void }) {
  return (
    <div className="sp-pad">
      {PAD.map((row) => (
        <div key={row.title} className={`sp-pad-row ${row.made ? 'made' : ''}`} role="group" aria-label={row.title}>
          {row.keys.map(([type, label]) => (
            <button key={type} type="button" className={`sp-key ${row.made ? 'made' : ''}`} onClick={() => onTap(type)}>
              {label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One line of numbers, as "12 PTS · 4 REB · 3 AST". */
export function LineText({ line }: { line: StatLine }) {
  const parts: [number, string][] = [[line.pts, 'PTS'], [line.reb, 'REB'], [line.ast, 'AST'], [line.stl, 'STL'], [line.blk, 'BLK'], [line.to, 'TO'], [line.pf, 'PF']];
  return (
    <span className="sp-line">
      {parts.map(([n, word]) => (
        <span key={word}>
          <b>{n}</b> {word}
        </span>
      ))}
      <span>
        <b>
          {line.fgm}/{line.fga}
        </b>{' '}
        FG
      </span>
      <span>
        <b>
          {line.ftm}/{line.fta}
        </b>{' '}
        FT
      </span>
    </span>
  );
}

export default function ScorePad({
  state,
  events,
  onChange,
  usName,
  themName,
  players,
  solo,
}: {
  state: ScoreState;
  events: GameEvent[];
  onChange: (state: ScoreState, events: GameEvent[]) => void;
  usName: string;
  themName: string;
  /** The roster, for a team's game. */
  players: PadPlayer[];
  /** One player followed on their own: no floor, no opponent, the buttons always showing. */
  solo?: string;
}) {
  const [sel, setSel] = useState<{ side: 'us' | 'them'; player: number } | null>(null);
  /** The question that follows a shot: who assisted a make, who rebounded a miss. */
  const [ask, setAsk] = useState<{ kind: 'ast' | 'reb'; shooter: number } | null>(null);
  const [options, setOptions] = useState(false);
  const [allPlays, setAllPlays] = useState(false);
  const [oppNumber, setOppNumber] = useState('');
  // The clock runs here and is written down when it stops, so a page loaded again finds it paused.
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const baseLeft = state.clock_left ?? state.period_secs;
  const left = () => (runningSince ? Math.max(0, baseLeft - Math.floor((Date.now() - runningSince) / 1000)) : baseLeft);
  useEffect(() => {
    if (!runningSince) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [runningSince]);
  const latest = useRef({ state, events });
  latest.current = { state, events };

  const final = state.status === 'final';
  const full = state.mode === 'full' || !!solo;
  const score = scoreOf(events);
  const us = linesOf(events, 'us');
  const them = linesOf(events, 'them');
  const nameOf = (side: 'us' | 'them', id: number | null) => {
    if (solo) return solo;
    if (id === null) return side === 'us' ? usName : themName;
    if (side === 'them') return `${themName} #${state.opp_players.find((p) => p.id === id)?.label ?? '?'}`;
    const p = players.find((x) => x.id === id);
    return p ? `${p.number ? `#${p.number} ` : ''}${p.name}` : 'Player';
  };
  const setState = (change: Partial<ScoreState>) => onChange({ ...state, ...change }, events);
  const add = (side: 'us' | 'them', player: number | null, type: EvType) => {
    const e: GameEvent = { id: newId(), side, player, type, period: state.period, clock: state.timed ? left() : null, at: Date.now() };
    onChange(state, [...events, e]);
    // What usually comes next is offered, and can be ignored.
    if (!solo && full && side === 'us' && player !== null) {
      if ((type === 'm2' || type === 'm3') && state.on.length > 1) return setAsk({ kind: 'ast', shooter: player });
      if (type === 'x2' || type === 'x3' || type === 'x1') return setAsk({ kind: 'reb', shooter: player });
    }
    setAsk(null);
  };
  const undo = () => {
    if (events.length === 0) return;
    onChange(state, events.slice(0, -1));
    setAsk(null);
  };
  const stopClock = () => {
    if (!runningSince) return;
    const now = left();
    setRunningSince(null);
    setState({ clock_left: now });
  };
  const toPeriod = (p: number) => {
    setRunningSince(null);
    setState({ period: Math.max(1, p), clock_left: state.period_secs });
  };
  const endGame = async () => {
    if (!(await confirmDialog({ title: 'End the game?', body: `The final score is ${usName} ${score.us}, ${themName} ${score.them}. You can open it again to fix something.`, confirmLabel: 'End game' }))) return;
    setRunningSince(null);
    setSel(null);
    setAsk(null);
    onChange({ ...state, status: 'final', clock_left: left() }, events);
  };

  const onFloor = state.on.map((id) => players.find((p) => p.id === id)).filter(Boolean) as PadPlayer[];
  const bench = players.filter((p) => !state.on.includes(p.id));
  const tile = (p: PadPlayer, where: 'floor' | 'bench') => {
    const line = us.players.get(p.id);
    const on = sel?.side === 'us' && sel.player === p.id;
    return (
      <button key={p.id} type="button" className={`sp-tile ${where} ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => (setSel(on ? null : { side: 'us', player: p.id }), setAsk(null))}>
        <span className="sp-num">{p.number || first(p.name)[0]}</span>
        <span className="sp-name">{first(p.name)}</span>
        {where === 'floor' && (
          <span className="sp-mini">
            {line?.pts ?? 0} pts{line?.pf ? ` · ${line.pf} F` : ''}
          </span>
        )}
      </button>
    );
  };
  const selPlayer = sel?.side === 'us' ? players.find((p) => p.id === sel.player) : undefined;
  const selOnFloor = !!selPlayer && state.on.includes(selPlayer.id);
  const plays = [...events].reverse();
  const periods = byPeriod(events, state.period);

  return (
    <div className={`sp ${final ? 'final' : ''}`}>
      {!solo && (
        <header className="sp-top">
          <div className="sp-side">
            <span className="sp-side-name">{usName}</span>
            <strong className="sp-score" aria-label={`${usName} score`}>
              {score.us}
            </strong>
          </div>
          <div className="sp-mid">
            <div className="sp-period">
              <button type="button" className="btn small" aria-label="Previous period" disabled={final || state.period <= 1} onClick={() => toPeriod(state.period - 1)}>
                ‹
              </button>
              <strong>{final ? 'Final' : periodName(state.period)}</strong>
              <button type="button" className="btn small" aria-label="Next period" disabled={final} onClick={() => toPeriod(state.period + 1)}>
                ›
              </button>
            </div>
            {state.timed && !final && (
              <button type="button" className={`sp-clock ${runningSince ? 'running' : ''}`} onClick={() => (runningSince ? stopClock() : setRunningSince(Date.now()))} aria-label={runningSince ? 'Stop the clock' : 'Start the clock'}>
                {clockText(left())} <span aria-hidden="true">{runningSince ? '❚❚' : '▶'}</span>
              </button>
            )}
          </div>
          <div className="sp-side them">
            <span className="sp-side-name">{themName}</span>
            <strong className="sp-score" aria-label={`${themName} score`}>
              {score.them}
            </strong>
          </div>
        </header>
      )}
      {solo && (
        <header className="sp-solo-top">
          <div className="sp-period">
            <button type="button" className="btn small" aria-label="Previous period" disabled={final || state.period <= 1} onClick={() => toPeriod(state.period - 1)}>
              ‹
            </button>
            <strong>{final ? 'Final' : periodName(state.period)}</strong>
            <button type="button" className="btn small" aria-label="Next period" disabled={final} onClick={() => toPeriod(state.period + 1)}>
              ›
            </button>
          </div>
          <LineText line={us.total} />
        </header>
      )}

      {final ? (
        <div className="sp-final card">
          <strong>{solo ? 'This sheet is finished.' : 'The game is over.'}</strong>
          <button type="button" className="btn small" onClick={() => setState({ status: 'live' })}>
            Open it again
          </button>
        </div>
      ) : (
        <>
          <div className="sp-bar">
            <button type="button" className="btn sp-undo" disabled={events.length === 0} onClick={undo}>
              ↶ Undo{events.length > 0 && <span className="muted small"> {EV_WORDS[events[events.length - 1].type]}</span>}
            </button>
            <span className="sp-grow" />
            {!solo && (
              <div className="seg" role="group" aria-label="How much to track">
                <button type="button" className={!full ? 'on' : ''} aria-pressed={!full} onClick={() => (setState({ mode: 'score' }), setSel(null), setAsk(null))}>
                  Score only
                </button>
                <button type="button" className={full ? 'on' : ''} aria-pressed={full} onClick={() => setState({ mode: 'full' })}>
                  Full stats
                </button>
              </div>
            )}
            <button type="button" className="btn small" aria-expanded={options} onClick={() => setOptions(!options)}>
              Options
            </button>
            <button type="button" className="btn small" onClick={endGame}>
              {solo ? 'Finish' : 'End game'}
            </button>
          </div>
          {options && (
            <div className="sp-options card">
              <label className="check setting">
                <input type="checkbox" checked={state.timed} onChange={(e) => (setRunningSince(null), setState({ timed: e.target.checked, clock_left: state.clock_left ?? state.period_secs }))} />
                <span>
                  <strong>Timed scoring</strong>
                  <span className="muted small">Run a game clock, and each play is marked with the time left in the period. Without it, plays are marked with the period only.</span>
                </span>
              </label>
              {state.timed && (
                <label className="field sp-len">
                  <span className="field-label">Minutes in a period</span>
                  <input className="input" type="number" min={1} max={60} value={Math.round(state.period_secs / 60)} onChange={(e) => setState({ period_secs: Math.min(60, Math.max(1, Number(e.target.value) || 8)) * 60, clock_left: Math.min(60, Math.max(1, Number(e.target.value) || 8)) * 60 })} />
                </label>
              )}
              {!solo && (
                <label className="check setting">
                  <input type="checkbox" checked={state.opp_advanced} onChange={(e) => setState({ opp_advanced: e.target.checked })} />
                  <span>
                    <strong>Track the other team's players</strong>
                    <span className="muted small">Add their numbers and score each of them like your own. Without it, you keep only their score and a few team counts.</span>
                  </span>
                </label>
              )}
            </div>
          )}

          {solo ? (
            <Pad onTap={(type) => add('us', null, type)} />
          ) : (
            <>
              <section className="sp-team" aria-label={usName}>
                <h3>{usName}</h3>
                {!full ? (
                  <div className="sp-points">
                    {(['m1', 'm2', 'm3'] as EvType[]).map((t) => (
                      <button key={t} type="button" className="sp-key made big" onClick={() => add('us', null, t)}>
                        +{POINTS[t]}
                      </button>
                    ))}
                  </div>
                ) : players.length === 0 ? (
                  <p className="muted small">This team has no players yet. Add them under Team, or use "Score only".</p>
                ) : (
                  <>
                    <p className="sp-hint muted small">{onFloor.length === 0 ? 'Tap the players who are starting, then "Put on the floor".' : sel ? '' : 'Tap a player, then what they did.'}</p>
                    {onFloor.length > 0 && <div className="sp-tiles floor">{onFloor.map((p) => tile(p, 'floor'))}</div>}
                    {/* The question takes the place of the buttons, right where the thumb already is. */}
                    {selPlayer && selOnFloor && (ask ? (
<div className="sp-ask" role="group" aria-label={ask.kind === 'ast' ? 'Who assisted' : 'Who got the rebound'}>
              <strong>{ask.kind === 'ast' ? 'Assist?' : 'Rebound?'}</strong>
              {onFloor
                .filter((p) => ask.kind === 'reb' || p.id !== ask.shooter)
                .map((p) => (
                  <button key={p.id} type="button" className="sp-chip" onClick={() => (onChange(state, [...events, { id: newId(), side: 'us', player: p.id, type: ask.kind, period: state.period, clock: state.timed ? left() : null, at: Date.now() }]), setAsk(null))}>
                    {p.number ? `#${p.number} ` : ''}
                    {first(p.name)}
                  </button>
                ))}
              {ask.kind === 'reb' && (
                <button type="button" className="sp-chip" onClick={() => (onChange(state, [...events, { id: newId(), side: 'them', player: null, type: 'reb', period: state.period, clock: state.timed ? left() : null, at: Date.now() }]), setAsk(null))}>
                  {themName}
                </button>
              )}
              <button type="button" className="sp-chip none" onClick={() => setAsk(null)}>
                {ask.kind === 'ast' ? 'No assist' : 'Nobody'}
              </button>
            </div>
                    ) : (
                      <Pad onTap={(type) => add('us', selPlayer.id, type)} />
                    ))}
                    {bench.length > 0 && (
                      <>
                        <span className="side-label sp-bench-label">Bench</span>
                        <div className="sp-tiles bench">{bench.map((p) => tile(p, 'bench'))}</div>
                      </>
                    )}
                    {selPlayer && !selOnFloor && (
                      <div className="sp-ask sub" role="group" aria-label={`Bring ${selPlayer.name} in`}>
                        <strong>Bring {first(selPlayer.name)} in</strong>
                        {onFloor.length < 5 && (
                          <button type="button" className="sp-chip" onClick={() => (setState({ on: [...state.on, selPlayer.id] }), setSel(null))}>
                            Put on the floor
                          </button>
                        )}
                        {onFloor.map((p) => (
                          <button key={p.id} type="button" className="sp-chip" onClick={() => (setState({ on: state.on.map((id) => (id === p.id ? selPlayer.id : id)) }), setSel(null))}>
                            for {p.number ? `#${p.number} ` : ''}
                            {first(p.name)}
                          </button>
                        ))}
                      </div>
                    )}
                    {selPlayer && selOnFloor && (
                      <button type="button" className="link small sp-off" onClick={() => (setState({ on: state.on.filter((id) => id !== selPlayer.id) }), setSel(null))}>
                        Take {first(selPlayer.name)} off the floor
                      </button>
                    )}
                  </>
                )}
              </section>

              <section className="sp-team them" aria-label={themName}>
                <h3>{themName}</h3>
                <div className="sp-points">
                  {(['m1', 'm2', 'm3'] as EvType[]).map((t) => (
                    <button key={t} type="button" className="sp-key made big" onClick={() => add('them', null, t)}>
                      +{POINTS[t]}
                    </button>
                  ))}
                </div>
                <div className="sp-quick">
                  {QUICK.map(([t, label]) => (
                    <button key={t} type="button" className="sp-key" onClick={() => add('them', null, t)}>
                      {label} <span className="chip-num">{them.total[t as 'reb' | 'to' | 'pf' | 'stl']}</span>
                    </button>
                  ))}
                </div>
                {state.opp_advanced && (
                  <div className="sp-opp">
                    <div className="sp-tiles bench">
                      {state.opp_players.map((p) => {
                        const on = sel?.side === 'them' && sel.player === p.id;
                        return (
                          <button key={p.id} type="button" className={`sp-tile bench ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setSel(on ? null : { side: 'them', player: p.id })}>
                            <span className="sp-num">{p.label}</span>
                            <span className="sp-mini">{them.players.get(p.id)?.pts ?? 0} pts</span>
                          </button>
                        );
                      })}
                      <form
                        className="sp-add-opp"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const label = oppNumber.trim();
                          if (!label) return;
                          setState({ opp_players: [...state.opp_players, { id: Math.max(0, ...state.opp_players.map((p) => p.id)) + 1, label }] });
                          setOppNumber('');
                        }}
                      >
                        <input className="input" inputMode="numeric" maxLength={4} aria-label="Their player's number" placeholder="#" value={oppNumber} onChange={(e) => setOppNumber(e.target.value)} />
                        <button className="btn small" disabled={!oppNumber.trim()}>
                          Add
                        </button>
                      </form>
                    </div>
                    {sel?.side === 'them' && <Pad onTap={(type) => add('them', sel.player, type)} />}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}

      {!solo && periods.length > 1 && (
        <table className="sp-periods" aria-label="Score by period">
          <thead>
            <tr>
              <th />
              {periods.map((_, i) => (
                <th key={i}>{periodName(i + 1)}</th>
              ))}
              <th>T</th>
            </tr>
          </thead>
          <tbody>
            {(['us', 'them'] as const).map((side) => (
              <tr key={side}>
                <th>{side === 'us' ? usName : themName}</th>
                {periods.map((p, i) => (
                  <td key={i}>{p[side]}</td>
                ))}
                <td>
                  <b>{score[side]}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="sp-plays" aria-label="Play by play">
        <h3>Play by play</h3>
        {plays.length === 0 ? (
          <p className="muted small">Nothing yet. Each thing you tap shows here, newest first, and can be taken out.</p>
        ) : (
          <ul>
            {plays.slice(0, allPlays ? plays.length : 8).map((e) => (
              <li key={e.id}>
                <span className="muted small sp-when">
                  {periodName(e.period)}
                  {e.clock !== null ? ` ${clockText(e.clock)}` : ''}
                </span>
                <span className="sp-what">
                  <strong>{nameOf(e.side, e.player)}</strong> {EV_WORDS[e.type]}
                </span>
                <button type="button" className="link small" aria-label={`Remove: ${nameOf(e.side, e.player)} ${EV_WORDS[e.type]}`} onClick={() => onChange(latest.current.state, latest.current.events.filter((x) => x.id !== e.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {plays.length > 8 && (
          <button type="button" className="link small" onClick={() => setAllPlays(!allPlays)}>
            {allPlays ? 'Show fewer' : `Show all ${plays.length}`}
          </button>
        )}
      </section>
    </div>
  );
}

const COLS: [keyof StatLine | 'fg' | 'tp' | 'ft', string][] = [['pts', 'PTS'], ['fg', 'FG'], ['tp', '3PT'], ['ft', 'FT'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['to', 'TO'], ['pf', 'PF']];
const cell = (l: StatLine, k: (typeof COLS)[number][0]) => (k === 'fg' ? `${l.fgm}/${l.fga}` : k === 'tp' ? `${l.tpm}/${l.tpa}` : k === 'ft' ? `${l.ftm}/${l.fta}` : l[k]);
/** A table of stat lines: one row for each name, and a row of totals when asked for. */
export function StatTable({ rows, total, first: firstCol = 'Player', extra }: { rows: { key: string | number; name: string; line: StatLine; extra?: string | number }[]; total?: { name: string; line: StatLine }; first?: string; /** A column before the numbers, such as games played. */ extra?: string }) {
  return (
    <div className="table-scroll">
      <table className="table sp-table">
        <thead>
          <tr>
            <th>{firstCol}</th>
            {extra && <th>{extra}</th>}
            {COLS.map(([, label]) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.name}</td>
              {extra && <td>{r.extra}</td>}
              {COLS.map(([k, label]) => (
                <td key={label}>{cell(r.line, k)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr>
              <td>{total.name}</td>
              {extra && <td />}
              {COLS.map(([k, label]) => (
                <td key={label}>{cell(total.line, k)}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
