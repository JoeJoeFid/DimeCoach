// The screen for keeping score. Tap what happened, then who did it: every tap on a play opens a
// sheet of the players to pick from, and a made shot goes on to ask who assisted. "Assign later"
// records the play for the team so the game is never held up, and it can be given to a player
// afterwards from the play by play.
//
// It keeps nothing itself: every tap hands the new list of plays to whoever is showing it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SCORING, byPeriod, clockText, linesOf, newId, periodName, playWords, scoreOf, type EvType, type GameEvent, type ScoreState, type ScoringConfig, type StatLine } from '../scoring';
import { COURT, Court } from './PlayDiagram';
import { confirmDialog } from './dialogs';

export interface PadPlayer {
  id: number;
  name: string;
  number: string;
}
/** What a button on the pad asks for: a play, or a trip to the free-throw line. */
type Action = EvType | 'ft';
/** How each kind of play is named at the top of the sheet that asks who. */
const ASK: Record<Action, string> = {
  p1: 'Point by', m2: '2-point FG made by', m3: '3-point FG made by', m1: 'Free throw made by', x2: '2-point FG missed by', x3: '3-point FG missed by', x1: 'Free throw missed by',
  reb: 'Rebound by', ast: 'Assist by', stl: 'Steal by', blk: 'Block by', to: 'Turnover by', pf: 'Foul on', ft: 'Free throws by',
};
const SHOT: Partial<Record<EvType, string>> = { m2: '2-point FG made', m3: '3-point FG made', x2: '2-point FG missed', x3: '3-point FG missed', x1: 'Free throw missed' };
const SMALL: [EvType, string][] = [['reb', 'REB'], ['ast', 'AST'], ['to', 'TO'], ['stl', 'STL'], ['blk', 'BLK'], ['pf', 'Foul']];
const byNumber = (a: PadPlayer, b: PadPlayer) => (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name);

type Sheet =
  | { kind: 'who'; side: 'us' | 'them'; action: Action }
  | { kind: 'follow'; follow: 'ast' | 'reb'; shooter: number | null; shot: EvType; /** The shot's own play, so what follows is tied to it. */ shotId: string }
  | { kind: 'ft'; side: 'us' | 'them'; player: number | null }
  | { kind: 'forced'; id: string; side: 'us' | 'them' }
  | { kind: 'place'; id: string; /** What is asked once the spot is marked or skipped. */ next: Sheet | null }
  | { kind: 'assign'; id: string }
  | { kind: 'court' }
  | { kind: 'options' };

/** A panel that comes up from the bottom of the screen over the scoring pad. */
function BottomSheet({ title, sub, onClose, onBack, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; onBack?: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sp-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sp-sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <span className="sp-grip" aria-hidden="true" />
        <header className="sp-sheet-head">
          {onBack && (
            <button type="button" className="btn ghost sp-back" onClick={onBack} aria-label="Back">
              ‹
            </button>
          )}
          <div>
            <strong>{title}</strong>
            {sub && <span className="muted small">{sub}</span>}
          </div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** The players to pick from, by number. The ones on the court are underlined. */
function PlayerGrid({ players, on, picked, onPick }: { players: PadPlayer[]; on: number[]; /** Shown as chosen, for picking who is on the court. */ picked?: number[]; onPick: (p: PadPlayer) => void }) {
  return (
    <>
      <div className="sp-grid">
        {[...players].sort(byNumber).map((p) => (
          <button key={p.id} type="button" className={`sp-person ${on.includes(p.id) ? 'court' : ''} ${picked?.includes(p.id) ? 'picked' : ''}`} aria-pressed={picked ? picked.includes(p.id) : undefined} onClick={() => onPick(p)}>
            <span className="sp-num">{p.number || '–'}</span>
            <span className="sp-name">{p.name}</span>
          </button>
        ))}
      </div>
      {on.length > 0 && !picked && (
        <p className="sp-legend muted small">
          <span aria-hidden="true" /> Players on the court
        </p>
      )}
    </>
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
  usHome = true,
  onExit,
  video,
  onVideo,
  tabs,
  children,
  config = DEFAULT_SCORING,
}: {
  /** What this team tracks: a stat that is off has no button, and the extra questions are only asked when on. */
  config?: ScoringConfig;
  state: ScoreState;
  events: GameEvent[];
  onChange: (state: ScoreState, events: GameEvent[]) => void;
  usName: string;
  themName: string;
  /** The roster, for a team's game. */
  players: PadPlayer[];
  /** One player followed on their own: no picking who, no other team. */
  solo?: string;
  /** Whether this team is at home. The away team is named first, as on a scoreboard. */
  usHome?: boolean;
  onExit?: () => void;
  /** Whether the game is going out on video right now. */
  video?: 'live' | 'none';
  onVideo?: () => void;
  /** The row of tabs under the score, and what shows in place of the pad when another tab is chosen. */
  tabs?: ReactNode;
  children?: ReactNode;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
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
  const pName = (p: number) => periodName(p, config.halves);
  const score = scoreOf(events);
  const us = linesOf(events, 'us');
  const them = linesOf(events, 'them');
  const oppPlayers: PadPlayer[] = state.opp_players.map((p) => ({ id: p.id, name: '', number: p.label }));
  const teamName = (side: 'us' | 'them') => (side === 'us' ? usName : themName);
  const playerName = (side: 'us' | 'them', id: number | null) => {
    if (solo) return solo;
    if (id === null) return teamName(side);
    if (side === 'them') return `${themName} #${state.opp_players.find((p) => p.id === id)?.label ?? '?'}`;
    const p = players.find((x) => x.id === id);
    return p ? `${p.name}${p.number ? `, #${p.number}` : ''}` : 'Player';
  };
  /** Whether a play by this side is given to a player: always for one's own team, whose roster comes up every time, and for the other team when its players are tracked. */
  const asksWho = (side: 'us' | 'them') => !solo && (side === 'us' ? players.length > 0 : state.opp_advanced);
  const setState = (change: Partial<ScoreState>) => onChange({ ...latest.current.state, ...change }, latest.current.events);
  /**
   * Adds a play and gives back its id. `after` is the shot an assist or rebound came from: the
   * shot's id, or null when the play was put in by itself with its own button.
   */
  const record = (side: 'us' | 'them', player: number | null, type: EvType, after?: string | null) => {
    const e: GameEvent = { id: newId(), side, player, type, period: latest.current.state.period, clock: latest.current.state.timed ? left() : null, at: Date.now(), ...(after !== undefined ? { for: after } : {}) };
    onChange(latest.current.state, [...latest.current.events, e]);
    return e.id;
  };
  /** A rebound or an assist pressed by itself came from no shot: that is what makes the rebound a defensive one. */
  const alone = (type: EvType) => (type === 'reb' || type === 'ast' ? null : undefined);
  /** A button on the pad was pressed. */
  const act = (side: 'us' | 'them', action: Action) => {
    if (asksWho(side)) return setSheet({ kind: 'who', side, action });
    if (action === 'ft') return setSheet({ kind: 'ft', side, player: null });
    afterPlay(side, action, null, record(side, null, action, alone(action)));
  };
  /** Changes one play already recorded: where a shot was taken, or who forced a turnover. */
  const amend = (id: string, change: Partial<GameEvent>) => onChange(latest.current.state, latest.current.events.map((e) => (e.id === id ? { ...e, ...change } : e)));
  /** What is asked once a play is down: whether a turnover was forced, where a shot was taken, then who assisted or rebounded. */
  const afterPlay = (side: 'us' | 'them', action: EvType, player: number | null, id: string) => {
    if (action === 'to' && config.forced && !solo) return setSheet({ kind: 'forced', id, side });
    const made = action === 'm2' || action === 'm3';
    const missed = action === 'x2' || action === 'x3';
    // A shot by one's own team goes on to who assisted, or who got the rebound.
    const next: Sheet | null =
      side === 'us' && asksWho('us') && made && config.ast
        ? { kind: 'follow', follow: 'ast', shooter: player, shot: action, shotId: id }
        : side === 'us' && asksWho('us') && missed && config.reb
          ? { kind: 'follow', follow: 'reb', shooter: player, shot: action, shotId: id }
          : null;
    if (side === 'us' && (made || missed) && config.place && !solo) return setSheet({ kind: 'place', id, next });
    setSheet(next);
  };
  /** The player was chosen (or left for later) for the play being asked about. */
  const chose = (side: 'us' | 'them', action: Action, player: number | null) => {
    if (action === 'ft') return setSheet({ kind: 'ft', side, player });
    afterPlay(side, action, player, record(side, player, action, alone(action)));
  };
  const undo = () => events.length > 0 && onChange(state, events.slice(0, -1));
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
    if (!(await confirmDialog({ title: solo ? 'Finish this sheet?' : 'End the game?', body: solo ? 'You can open it again to fix something.' : `The final score is ${usName} ${score.us}, ${themName} ${score.them}. You can open it again to fix something.`, confirmLabel: solo ? 'Finish' : 'End game' }))) return;
    setRunningSince(null);
    setSheet(null);
    onChange({ ...state, status: 'final', clock_left: left() }, events);
  };
  const addOpp = () => {
    const label = oppNumber.trim();
    if (!label) return;
    setState({ opp_players: [...state.opp_players, { id: Math.max(0, ...state.opp_players.map((p) => p.id)) + 1, label }] });
    setOppNumber('');
  };

  const onCourt = state.on.map((id) => players.find((p) => p.id === id)).filter(Boolean) as PadPlayer[];
  const plays = [...events].reverse();
  const said = playWords(events);
  const title = (e: GameEvent) => {
    const w = said.get(e.id)?.words ?? '';
    return w[0].toUpperCase() + w.slice(1);
  };
  const periods = byPeriod(events, state.period);
  const sides: ('us' | 'them')[] = usHome ? ['them', 'us'] : ['us', 'them'];
  const assigning = sheet?.kind === 'assign' ? events.find((e) => e.id === sheet.id) : undefined;
  const ftLine = sheet?.kind === 'ft' ? (sheet.side === 'us' ? us : them) : null;
  const ftNow = sheet?.kind === 'ft' ? (sheet.player === null ? ftLine!.total : ftLine!.players.get(sheet.player)) : undefined;

  /** The big pad for one's own team, laid out as on a scorer's table: makes at the sides, the rest between. */
  const bigPad = (side: 'us' | 'them') => (
    <div className="sp-big">
      <button type="button" className="sp-key make two" onClick={() => act(side, 'm2')}>
        <b>+2</b>
        <span>PT FG</span>
      </button>
      <button type="button" className="sp-key ft" onClick={() => act(side, 'ft')}>
        Free Throw
      </button>
      <button type="button" className="sp-key make three" onClick={() => act(side, 'm3')}>
        <b>+3</b>
        <span>PT FG</span>
      </button>
      <div className="sp-small">
        {SMALL.filter(([t]) => config[t as 'reb' | 'ast' | 'to' | 'stl' | 'blk' | 'pf']).map(([t, label]) => (
          <button key={t} type="button" className="sp-key" onClick={() => act(side, t)}>
            {label}
          </button>
        ))}
      </div>
      <button type="button" className="sp-key miss two" onClick={() => act(side, 'x2')}>
        <b>2PT</b>
        <span>Miss</span>
      </button>
      <button type="button" className="sp-key miss three" onClick={() => act(side, 'x3')}>
        <b>3PT</b>
        <span>Miss</span>
      </button>
    </div>
  );

  return (
    <div className={`sp ${final ? 'final' : ''}`}>
      <div className="sp-head">
        <div className="sp-head-row">
          {onExit ? (
            <button type="button" className="link" onClick={onExit}>
              Exit
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="sp-period-pill" onClick={() => setSheet({ kind: 'options' })} aria-label={`${final ? 'Final' : pName(state.period)}. Period and options.`}>
            {final ? 'Final' : `Period ${state.period}`} <span aria-hidden="true">▾</span>
          </button>
          {solo ? (
            <span />
          ) : (
            <button type="button" className={`sp-video ${video === 'live' ? 'live' : ''}`} onClick={onVideo} disabled={!onVideo}>
              {video === 'live' ? 'LIVE' : 'NO VIDEO'}
            </button>
          )}
        </div>
        {solo ? (
          <div className="sp-solo-line">
            <LineText line={us.total} />
          </div>
        ) : (
          <div className="sp-scoreline">
            <span className="sp-side-name">{teamName(sides[0])}</span>
            <strong className="sp-score" aria-label={`${teamName(sides[0])} score`}>
              {score[sides[0]]}
            </strong>
            <strong className="sp-score" aria-label={`${teamName(sides[1])} score`}>
              {score[sides[1]]}
            </strong>
            <span className="sp-side-name right">{teamName(sides[1])}</span>
          </div>
        )}
        {state.timed && !final && (
          <button type="button" className={`sp-clock ${runningSince ? 'running' : ''}`} onClick={() => (runningSince ? stopClock() : setRunningSince(Date.now()))} aria-label={runningSince ? 'Stop the clock' : 'Start the clock'}>
            {clockText(left())} <span aria-hidden="true">{runningSince ? '❚❚' : '▶'}</span>
          </button>
        )}
        {tabs}
      </div>

      {children ??
        (final ? (
          <div className="sp-final card">
            <strong>{solo ? 'This sheet is finished.' : 'The game is over.'}</strong>
            <button type="button" className="btn small" onClick={() => setState({ status: 'live' })}>
              Open it again
            </button>
          </div>
        ) : solo ? (
          <section className="sp-team mine">{bigPad('us')}</section>
        ) : (
          <>
            {/* The other team: a small pad. "Team" records for the team as a whole; "Players" asks which of them. */}
            <section className="sp-team other" aria-label={themName}>
              <header>
                <strong>{themName}</strong>
                <button type="button" className="link small" onClick={() => setState({ opp_advanced: !state.opp_advanced })} aria-label={`${themName}: ${state.opp_advanced ? 'by player' : 'as a team'}. Change.`}>
                  {state.opp_advanced ? 'Players' : 'Team'} ▾
                </button>
              </header>
              <div className="sp-lite">
                <button type="button" className="sp-key ft" onClick={() => act('them', 'ft')}>
                  Free Throw
                </button>
                <button type="button" className="sp-key make" onClick={() => act('them', 'm2')}>
                  <b>+2</b>
                  <span>PT FG</span>
                </button>
                <button type="button" className="sp-key make" onClick={() => act('them', 'm3')}>
                  <b>+3</b>
                  <span>PT FG</span>
                </button>
              </div>
              <div className="sp-lite four">
                {([['pf', 'Foul'], ['reb', 'REB'], ['to', 'TO'], ['stl', 'STL']] as [EvType, string][]).filter(([t]) => config[t as 'pf' | 'reb' | 'to' | 'stl']).map(([t, label]) => (
                  <button key={t} type="button" className="sp-key" onClick={() => act('them', t)}>
                    {label} <span className="chip-num">{them.total[t as 'pf' | 'reb' | 'to' | 'stl']}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="sp-team mine" aria-label={usName}>
              <header>
                <strong>{usName}</strong>
              </header>
              {bigPad('us')}
              {players.length === 0 && <p className="muted small sp-noroster">This team has no players yet, so plays are recorded for the team. Add players under Team and each press will ask who.</p>}
              {players.length > 0 && (
                <div className="sp-court">
                  <span className="muted small">On the court {onCourt.length}</span>
                  <div className="sp-court-row">
                    {onCourt.length === 0 && <span className="muted small">Nobody yet.</span>}
                    {[...onCourt].sort(byNumber).map((p) => (
                      <span key={p.id} className="sp-court-chip">
                        <b>#{p.number || p.name[0]}</b>
                        <span>
                          {us.players.get(p.id)?.pts ?? 0} · {us.players.get(p.id)?.pf ?? 0} PF
                        </span>
                      </span>
                    ))}
                    <button type="button" className="sp-swap" onClick={() => setSheet({ kind: 'court' })} aria-label="Change who is on the court" title="Change who is on the court">
                      ⇄
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        ))}

      {!children && !solo && periods.length > 1 && (
        <table className="sp-periods" aria-label="Score by period">
          <thead>
            <tr>
              <th />
              {periods.map((_, i) => (
                <th key={i}>{pName(i + 1)}</th>
              ))}
              <th>T</th>
            </tr>
          </thead>
          <tbody>
            {sides.map((side) => (
              <tr key={side}>
                <th>{teamName(side)}</th>
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

      {/* Stats brought in as totals have no plays to list. */}
      {!children && !state.imported && (
        <section className="sp-plays" aria-label="Play by play">
          <header>
            <h3>Play by Play</h3>
            <button type="button" className="link" disabled={events.length === 0 || final} onClick={undo}>
              Undo
            </button>
          </header>
          {plays.length === 0 ? (
            <p className="muted small">Nothing yet. Each play shows here, newest first. Tap one to say who it was, or to take it out.</p>
          ) : (
            <ul>
              {plays.slice(0, allPlays ? plays.length : 8).map((e) => (
                <li key={e.id}>
                  <button type="button" className="sp-play" disabled={final} onClick={() => setSheet({ kind: 'assign', id: e.id })}>
                    <span className="sp-what">
                      <strong>{title(e)}</strong>
                      <span className="muted small">
                        by {playerName(e.side, e.player)}
                        {/* An assist says whose basket it was. */}
                        {said.get(e.id)?.scorer != null ? ` · to ${playerName('us', said.get(e.id)!.scorer)}` : ''}
                        {e.type === 'to' && e.forced && e.by !== undefined ? ` · forced by ${playerName(e.side === 'us' ? 'them' : 'us', e.by)}` : ''}
                        {e.x !== undefined ? ' · spot marked' : ''}
                        {e.player === null && asksWho(e.side) ? ' · not assigned' : ''}
                      </span>
                    </span>
                    <span className="muted small sp-when">
                      {pName(e.period)}
                      {e.clock !== null ? ` ${clockText(e.clock)}` : ''}
                    </span>
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
      )}

      {/* Who did it. */}
      {sheet?.kind === 'who' && (
        <BottomSheet title={ASK[sheet.action]} sub={teamName(sheet.side)} onClose={() => setSheet(null)}>
          <button type="button" className="btn sp-wide" onClick={() => chose(sheet.side, sheet.action, null)}>
            Assign later
          </button>
          <PlayerGrid players={sheet.side === 'us' ? players : oppPlayers} on={sheet.side === 'us' ? state.on : []} onPick={(p) => chose(sheet.side, sheet.action, p.id)} />
          {sheet.side === 'them' && (
            <form
              className="sp-add-opp"
              onSubmit={(e) => {
                e.preventDefault();
                addOpp();
              }}
            >
              <input className="input" inputMode="numeric" maxLength={4} aria-label="Add one of their players by number" placeholder="Add a number" value={oppNumber} onChange={(e) => setOppNumber(e.target.value)} />
              <button className="btn" disabled={!oppNumber.trim()}>
                Add
              </button>
            </form>
          )}
        </BottomSheet>
      )}
      {/* After a shot: who assisted a make, who rebounded a miss. */}
      {sheet?.kind === 'follow' && (
        <BottomSheet title={playerName('us', sheet.shooter)} sub={SHOT[sheet.shot]} onClose={() => setSheet(null)} onBack={() => setSheet(null)}>
          <p className="sp-ask-line">
            <strong>{sheet.follow === 'ast' ? 'Assist by' : 'Offensive rebound by'}</strong> <span className="muted small">{usName}</span>
          </p>
          <div className="sp-two">
            <button type="button" className="btn sp-no" onClick={() => setSheet(null)}>
              {sheet.follow === 'ast' ? 'No Assist' : 'No Rebound'}
            </button>
            {sheet.follow === 'ast' ? (
              <button type="button" className="btn" onClick={() => (record('us', null, 'ast', sheet.shotId), setSheet(null))}>
                Assign Later
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => (record('them', null, 'reb', sheet.shotId), setSheet(null))}>
                {themName}
              </button>
            )}
          </div>
          <PlayerGrid players={players.filter((p) => sheet.follow === 'reb' || p.id !== sheet.shooter)} on={state.on} onPick={(p) => (record('us', p.id, sheet.follow, sheet.shotId), setSheet(null))} />
        </BottomSheet>
      )}
      {/* A turnover: was it forced, and by whom on the other side. */}
      {sheet?.kind === 'forced' &&
        (() => {
          const other = sheet.side === 'us' ? 'them' : 'us';
          const list = other === 'us' ? players : state.opp_advanced ? oppPlayers : [];
          return (
            <BottomSheet title="Was the turnover forced?" sub={`Turnover by ${teamName(sheet.side)}`} onClose={() => setSheet(null)}>
              <div className="sp-two">
                <button type="button" className="btn sp-no" onClick={() => (amend(sheet.id, { forced: false }), setSheet(null))}>
                  Not forced
                </button>
                <button type="button" className="btn" onClick={() => (amend(sheet.id, { forced: true }), setSheet(null))}>
                  {list.length > 0 ? 'Forced, assign later' : 'Forced'}
                </button>
              </div>
              {list.length > 0 && (
                <>
                  <p className="sp-ask-line">
                    <strong>Forced by</strong> <span className="muted small">{teamName(other)}</span>
                  </p>
                  <PlayerGrid players={list} on={other === 'us' ? state.on : []} onPick={(p) => (amend(sheet.id, { forced: true, by: p.id }), setSheet(null))} />
                </>
              )}
            </BottomSheet>
          );
        })()}
      {/* Where a shot was taken: a tap on the half court, or skip it. */}
      {sheet?.kind === 'place' && (
        <BottomSheet title="Where was the shot taken?" sub="Tap the spot on the court." onClose={() => setSheet(sheet.next)}>
          <svg
            className="sp-place play-svg"
            viewBox={`0 0 ${COURT.width} ${COURT.half}`}
            role="img"
            aria-label="Half court. Tap where the shot was taken."
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              amend(sheet.id, { x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000 });
              setSheet(sheet.next);
            }}
          >
            <Court court="half" flipped={false} />
          </svg>
          <button type="button" className="btn sp-wide" onClick={() => setSheet(sheet.next)}>
            Skip
          </button>
        </BottomSheet>
      )}
      {/* A trip to the line: each throw made or missed, then done. */}
      {sheet?.kind === 'ft' && (
        <BottomSheet title="Free throws" sub={playerName(sheet.side, sheet.player)} onClose={() => setSheet(null)}>
          <p className="sp-ft-count">
            <b>
              {ftNow?.ftm ?? 0}/{ftNow?.fta ?? 0}
            </b>{' '}
            <span className="muted small">made this game</span>
          </p>
          <div className="sp-two tall">
            <button type="button" className="sp-key make" onClick={() => record(sheet.side, sheet.player, 'm1')}>
              <b>Made</b>
              <span>+1</span>
            </button>
            <button type="button" className="sp-key miss" onClick={() => record(sheet.side, sheet.player, 'x1')}>
              <b>Missed</b>
            </button>
          </div>
          <button type="button" className="btn primary sp-wide" onClick={() => setSheet(null)}>
            Done
          </button>
        </BottomSheet>
      )}
      {/* A play already recorded: say who it was, or take it out. */}
      {sheet?.kind === 'assign' && assigning && (
        <BottomSheet title={title(assigning)} sub={`by ${playerName(assigning.side, assigning.player)} · ${pName(assigning.period)}`} onClose={() => setSheet(null)}>
          {!solo && (assigning.side === 'us' ? players.length > 0 : oppPlayers.length > 0) && (
            <PlayerGrid
              players={assigning.side === 'us' ? players : oppPlayers}
              on={assigning.side === 'us' ? state.on : []}
              onPick={(p) => (onChange(state, events.map((e) => (e.id === assigning.id ? { ...e, player: p.id } : e))), setSheet(null))}
            />
          )}
          <button type="button" className="btn danger sp-wide" onClick={() => (onChange(state, events.filter((e) => e.id !== assigning.id)), setSheet(null))}>
            Remove this play
          </button>
        </BottomSheet>
      )}
      {/* Who is on the court. */}
      {sheet?.kind === 'court' && (
        <BottomSheet title="On the court" sub="Tap players to put them on or take them off." onClose={() => setSheet(null)}>
          <CourtPicker players={players} on={state.on} onChange={(on) => setState({ on })} />
          <button type="button" className="btn primary sp-wide" onClick={() => setSheet(null)}>
            Done
          </button>
        </BottomSheet>
      )}
      {/* The period, and how the game is being kept. */}
      {sheet?.kind === 'options' && (
        <BottomSheet title={final ? 'Final' : `Period ${state.period}`} sub={final ? undefined : pName(state.period)} onClose={() => setSheet(null)}>
          {!final && (
            <div className="sp-two">
              <button type="button" className="btn" disabled={state.period <= 1} onClick={() => toPeriod(state.period - 1)}>
                ‹ Previous period
              </button>
              <button type="button" className="btn primary" onClick={() => toPeriod(state.period + 1)}>
                Next period ›
              </button>
            </div>
          )}
          <div className="sp-options">
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
          </div>
          {final ? (
            <button type="button" className="btn primary sp-wide" onClick={() => (setState({ status: 'live' }), setSheet(null))}>
              Open it again
            </button>
          ) : (
            <button type="button" className="btn sp-wide" onClick={endGame}>
              {solo ? 'Finish this sheet' : 'End game'}
            </button>
          )}
        </BottomSheet>
      )}
    </div>
  );
}

/** The roster as a grid: tap a player to put them on the court or take them off. Five at most. */
export function CourtPicker({ players, on, onChange }: { players: PadPlayer[]; on: number[]; onChange: (on: number[]) => void }) {
  return (
    <>
      <PlayerGrid players={players} on={on} picked={on} onPick={(p) => onChange(on.includes(p.id) ? on.filter((id) => id !== p.id) : on.length < 5 ? [...on, p.id] : on)} />
      <p className="muted small sp-legend">{on.length} of 5 on the court.{on.length >= 5 ? ' Take someone off to put another on.' : ''}</p>
    </>
  );
}

const COLS: [keyof StatLine | 'fg' | 'tp' | 'ft', string][] = [['pts', 'PTS'], ['fg', 'FG'], ['tp', '3PT'], ['ft', 'FT'], ['oreb', 'OREB'], ['dreb', 'DREB'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['to', 'TO'], ['fto', 'FTO'], ['pf', 'PF']];
const cell = (l: StatLine, k: (typeof COLS)[number][0]) => (k === 'fg' ? `${l.fgm}/${l.fga}` : k === 'tp' ? `${l.tpm}/${l.tpa}` : k === 'ft' ? `${l.ftm}/${l.fta}` : l[k]);
type SortKey = (typeof COLS)[number][0] | 'name' | 'extra';
/** What a column is put in order by: shooting by makes, then by fewer attempts. */
const sortValue = (r: { name: string; line: StatLine; extra?: string | number }, k: SortKey, average: boolean): number | string => {
  if (k === 'name') return r.name.replace(/^#\d+\s*/, '').toLowerCase();
  if (k === 'extra') return Number(r.extra) || 0;
  const [made, tried] = k === 'fg' ? [r.line.fgm, r.line.fga] : k === 'tp' ? [r.line.tpm, r.line.tpa] : k === 'ft' ? [r.line.ftm, r.line.fta] : [0, 0];
  // As averages, shooting goes by how often it went in; as totals, by how many did.
  if (k === 'fg' || k === 'tp' || k === 'ft') return average ? (tried ? made / tried : -1) : made - tried / 1000;
  return average ? r.line[k] / Math.max(1, Number(r.extra) || 1) : r.line[k];
};
/** A cell as an average: a count per game to one place, and shooting as the share that went in. */
const perGame = (l: StatLine, k: (typeof COLS)[number][0], games: number) => {
  const pct = (made: number, tried: number) => (tried ? `${Math.round((made / tried) * 100)}%` : '–');
  if (k === 'fg') return pct(l.fgm, l.fga);
  if (k === 'tp') return pct(l.tpm, l.tpa);
  if (k === 'ft') return pct(l.ftm, l.fta);
  return (l[k] / Math.max(1, games)).toFixed(1);
};
/**
 * A table of stat lines: one row for each name, and a row of totals when asked for. With
 * `sortable`, pressing a heading puts the rows in order by that column, and again turns it round.
 * With `average`, each number is per game played (the `extra` column says how many) and shooting is a percentage.
 */
export function StatTable({
  rows,
  total,
  first: firstCol = 'Player',
  extra,
  sortable,
  average,
  oneReb,
}: {
  /** Rebounds as one number: for the other team and for sheets kept on one player, where the two kinds are not told apart. */
  oneReb?: boolean;
  rows: { key: string | number; name: string; line: StatLine; extra?: string | number }[];
  total?: { name: string; line: StatLine; /** How many games the totals cover, for averages. */ games?: number };
  first?: string;
  /** A column before the numbers, such as games played. */
  extra?: string;
  sortable?: boolean;
  average?: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; down: boolean } | null>(null);
  // Turnovers forced are only asked about by teams that turn that on: with none anywhere, the column is left out.
  const anyForced = rows.some((r) => r.line.fto > 0) || (total?.line.fto ?? 0) > 0;
  const cols = COLS.filter(([k]) => (k !== 'fto' || anyForced) && (!oneReb || (k !== 'oreb' && k !== 'dreb')));
  const ordered = sort
    ? [...rows].sort((a, b) => {
        const x = sortValue(a, sort.key, !!average);
        const y = sortValue(b, sort.key, !!average);
        const way = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number);
        return sort.down ? -way : way;
      })
    : rows;
  // Numbers start with the most at the top; names start at A.
  const press = (key: SortKey) => setSort(sort?.key === key ? { key, down: !sort.down } : { key, down: key !== 'name' });
  const head = (key: SortKey, label: string) =>
    sortable ? (
      <th key={key} aria-sort={sort?.key === key ? (sort.down ? 'descending' : 'ascending') : undefined}>
        <button type="button" className={`sp-sort ${sort?.key === key ? 'on' : ''}`} onClick={() => press(key)} title={`Sort by ${label}`}>
          {label}
          <span aria-hidden="true">{sort?.key === key ? (sort.down ? ' ▾' : ' ▴') : ''}</span>
        </button>
      </th>
    ) : (
      <th key={key}>{label}</th>
    );
  return (
    <div className="table-scroll">
      <table className="table sp-table">
        <thead>
          <tr>
            {head('name', firstCol)}
            {extra && head('extra', extra)}
            {cols.map(([k, label]) => head(k, average && (k === 'fg' || k === 'tp' || k === 'ft') ? `${label}%` : label))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.key}>
              <td>{r.name}</td>
              {extra && <td>{r.extra}</td>}
              {cols.map(([k, label]) => (
                <td key={label}>{average ? perGame(r.line, k, Number(r.extra) || 1) : cell(r.line, k)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr>
              <td>{total.name}</td>
              {extra && <td>{average ? total.games : ''}</td>}
              {cols.map(([k, label]) => (
                <td key={label}>{average ? perGame(total.line, k, total.games || 1) : cell(total.line, k)}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
