// The scoring pad for the sports that are not basketball: baseball and softball, football,
// volleyball. One pad for all of them, laid out from what the sport says its plays are
// (../sportScoring.ts). It wears the basketball pad's clothes (ScorePad.tsx) and keeps its plays
// the same way, so a game of any sport is saved and followed alike.
import { useState, type ReactNode } from 'react';
import { BottomSheet, PeriodChanger, PlayerGrid, ordinalPart, type PadPlayer } from './ScorePad';
import SportIcon from './SportIcon';
import { newId, type GameEvent, type ScoreState } from '../scoring';
import { lineText, playOf, playText, sportScore, tallyOf, type SportDef, type SportEvent, type SportPlay } from '../sportScoring';

type Side = 'us' | 'them';
/** What is being asked, one thing at a time, after a button is pressed. */
type Sheet =
  | { kind: 'who'; play: SportPlay }
  | { kind: 'amount'; play: SportPlay; player: number | null }
  /** The second player with a part in the play just put in. */
  | { kind: 'also'; play: SportPlay; first: number | null; v?: number }
  | { kind: 'edit'; id: string }
  | { kind: 'options' };

/** How many: typed, with a way to make it a loss. */
function AmountForm({ unit, onDone }: { unit: string; onDone: (v: number) => void }) {
  const [text, setText] = useState('');
  const [loss, setLoss] = useState(false);
  const value = Math.min(999, Math.max(0, Math.round(Number(text) || 0)));
  return (
    <form
      className="spx-amount"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(loss ? -value : value);
      }}
    >
      <div className="seg" role="group" aria-label="Gained or lost">
        <button type="button" className={loss ? '' : 'on'} aria-pressed={!loss} onClick={() => setLoss(false)}>
          Gained
        </button>
        <button type="button" className={loss ? 'on' : ''} aria-pressed={loss} onClick={() => setLoss(true)}>
          Lost
        </button>
      </div>
      <input className="input" inputMode="numeric" pattern="[0-9]*" maxLength={3} autoFocus aria-label={`How many ${unit}`} placeholder="0" value={text} onChange={(e) => setText(e.target.value.replace(/\D/g, ''))} />
      <span className="muted">{unit}</span>
      <button className="btn primary">Save</button>
    </form>
  );
}

export default function SportPad({
  def,
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
}: {
  def: SportDef;
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
  video?: 'live' | 'none';
  onVideo?: () => void;
  /** The row of tabs under the score, and what shows in place of the pad when another tab is chosen. */
  tabs?: ReactNode;
  children?: ReactNode;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [allPlays, setAllPlays] = useState(false);
  // The plays are kept as a game's plays always are; here they are read as this sport's.
  const list = events as unknown as SportEvent[];
  const final = state.status === 'final';
  const score = sportScore(def, list, state);
  const us = tallyOf(list, 'us');
  const teamName = (side: Side) => (side === 'us' ? usName : themName);
  const playerName = (side: Side, id: number | null) => {
    if (solo) return solo;
    if (id === null || side === 'them') return teamName(side);
    const p = players.find((x) => x.id === id);
    return p ? `${p.name}${p.number ? `, #${p.number}` : ''}` : 'Player';
  };
  const setState = (patch: Partial<ScoreState>) => onChange({ ...state, ...patch }, events);
  const record = (side: Side, player: number | null, type: string, v?: number) =>
    onChange(state, [...events, { id: newId(), side, player, type, period: state.period, clock: null, at: Date.now(), ...(v !== undefined ? { v } : {}) } as unknown as GameEvent]);
  const asksWho = (play: SportPlay) => !solo && !play.team && players.length > 0;
  /** A play, once it is known who and how many: put in, and then its second player asked for when it has one. */
  const finish = (play: SportPlay, player: number | null, v?: number) => {
    record('us', player, play.type, v);
    setSheet(play.also && !solo && players.length > 0 ? { kind: 'also', play, first: player, v } : null);
  };
  const chose = (play: SportPlay, player: number | null) => (play.amount ? setSheet({ kind: 'amount', play, player }) : finish(play, player));
  const press = (play: SportPlay) => (asksWho(play) ? setSheet({ kind: 'who', play }) : chose(play, null));
  const undo = () => onChange(state, events.slice(0, -1));
  const editing = sheet?.kind === 'edit' ? list.find((e) => e.id === sheet.id) : undefined;
  const editingPlay = editing ? playOf(editing.type) : null;
  const sides: Side[] = usHome ? ['them', 'us'] : ['us', 'them'];
  const plays = [...list].reverse();
  const key = (play: SportPlay, side: Side, onPress: () => void) => (
    <button key={`${side}:${play.type}`} type="button" className={`sp-key ${play.tone === 'good' ? 'make' : play.tone === 'bad' ? 'miss' : ''}`} title={play.hint} onClick={onPress}>
      {play.pts && !play.other ? <b>+{play.pts}</b> : null}
      <span>{play.label}</span>
    </button>
  );
  const group = (g: SportDef['groups'][number]) => (
    <div className="spx-group" key={g.title}>
      <h4>
        {g.title} {g.note && <span className="muted small">{g.note}</span>}
      </h4>
      <div className="spx-keys">{g.plays.map((type) => playOf(type)!).map((play) => key(play, 'us', () => press(play)))}</div>
    </div>
  );

  return (
    <div className={`sp spx ${final ? 'final' : ''}`}>
      <div className="sp-head">
        <div className="sp-head-row">
          {onExit ? (
            <button type="button" className="link" onClick={onExit}>
              Exit
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="sp-period-pill" onClick={() => setSheet({ kind: 'options' })} aria-label={`${final ? 'Final' : `${def.period} ${state.period}`}. ${def.period} and options.`}>
            {final ? 'Final' : `${def.period} ${state.period}`} <span aria-hidden="true">▾</span>
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
          <div className="sp-solo-line">{lineText(def, us.total)}</div>
        ) : (
          <>
            <div className="sp-scoreline">
              <span className="sp-side-name">{teamName(sides[0])}</span>
              <strong className="sp-score" aria-label={`${teamName(sides[0])} score`}>
                {score.points[sides[0]]}
              </strong>
              <strong className="sp-score" aria-label={`${teamName(sides[1])} score`}>
                {score.points[sides[1]]}
              </strong>
              <span className="sp-side-name right">{teamName(sides[1])}</span>
            </div>
            {def.sets && (
              <p className="spx-sets" aria-label={`Sets: ${teamName(sides[0])} ${score[sides[0]]}, ${teamName(sides[1])} ${score[sides[1]]}`}>
                Sets {score[sides[0]]} – {score[sides[1]]}
              </p>
            )}
          </>
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
        ) : (
          <>
            {!solo && (
              <section className="sp-team other" aria-label={themName}>
                <header>
                  <strong>{themName}</strong>
                </header>
                <div className="spx-keys">{def.them.map((type) => playOf(type)!).map((play) => key(play, 'them', () => record('them', null, play.type)))}</div>
              </section>
            )}
            <section className="sp-team mine" aria-label={usName}>
              {!solo && (
                <header>
                  <strong>{usName}</strong>
                </header>
              )}
              {def.groups.map(group)}
              {!solo && players.length === 0 && <p className="muted small sp-noroster">This team has no players yet, so plays are recorded for the team. Add players under Team and each press will ask who.</p>}
            </section>
          </>
        ))}

      {!children && !solo && (score.parts.length > 1 || def.sets) && (
        <table className="sp-periods" aria-label={`Score by ${def.period.toLowerCase()}`}>
          <thead>
            <tr>
              <th />
              {score.parts.map((_, i) => (
                <th key={i}>{def.periodName(i + 1).replace(/^(Inn|Set) /, '')}</th>
              ))}
              <th>{def.sets ? 'Sets' : 'T'}</th>
            </tr>
          </thead>
          <tbody>
            {sides.map((side) => (
              <tr key={side}>
                <th>{teamName(side)}</th>
                {score.parts.map((p, i) => (
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

      {!children && (
        <section className="sp-plays" aria-label="Play by play">
          <header>
            <h3>Play by Play</h3>
            <button type="button" className="btn sp-undo" disabled={events.length === 0 || final} onClick={undo} aria-label="Undo the last play">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
              Undo
            </button>
          </header>
          {plays.length === 0 ? (
            <p className="muted small">Nothing yet. Each play shows here, newest first. Tap one to say who it was, or to take it out.</p>
          ) : (
            <ul>
              {plays.slice(0, allPlays ? plays.length : 8).map((e) => (
                <li key={e.id}>
                  <button type="button" className="sp-play" onClick={() => setSheet({ kind: 'edit', id: e.id })}>
                    <span className="sp-what">
                      <strong>{playText(e)}</strong>
                      <span className="muted small">
                        by {playerName(e.side, e.player)}
                        {e.side === 'us' && e.player === null && !solo && players.length > 0 && !playOf(e.type)?.team ? ' · not assigned' : ''}
                      </span>
                    </span>
                    <span className="muted small sp-when">{def.periodName(e.period)}</span>
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
        <BottomSheet title={`${sheet.play.title} by`} sub={sheet.play.hint ?? usName} onClose={() => setSheet(null)}>
          <button type="button" className="btn sp-wide" onClick={() => chose(sheet.play, null)}>
            Assign later
          </button>
          <PlayerGrid players={players} on={[]} onPick={(p) => chose(sheet.play, p.id)} />
        </BottomSheet>
      )}
      {/* How many. */}
      {sheet?.kind === 'amount' && (
        <BottomSheet title={sheet.play.title} sub={`${playerName('us', sheet.player)} · how many ${sheet.play.amount}?`} onClose={() => setSheet(null)}>
          <AmountForm unit={sheet.play.amount!} onDone={(v) => finish(sheet.play, sheet.player, v)} />
        </BottomSheet>
      )}
      {/* The second player with a part in it. */}
      {sheet?.kind === 'also' && sheet.play.also && (
        <BottomSheet title={sheet.play.also.ask} sub={`${sheet.play.title} by ${playerName('us', sheet.first)}`} onClose={() => setSheet(null)}>
          <button type="button" className="btn sp-wide sp-no" onClick={() => setSheet(null)}>
            Nobody, or skip
          </button>
          <PlayerGrid
            players={players.filter((p) => p.id !== sheet.first)}
            on={[]}
            onPick={(p) => {
              const also = playOf(sheet.play.also!.type);
              record('us', p.id, sheet.play.also!.type, also?.amount ? sheet.v : undefined);
              setSheet(null);
            }}
          />
        </BottomSheet>
      )}
      {/* One play, opened from the list: whose it was, or out it goes. */}
      {sheet?.kind === 'edit' && editing && (
        <BottomSheet title={playText(editing)} sub={`${playerName(editing.side, editing.player)} · ${def.periodName(editing.period)}`} onClose={() => setSheet(null)}>
          <button type="button" className="btn sp-wide danger" onClick={() => (onChange(state, events.filter((e) => e.id !== editing.id)), setSheet(null))}>
            Take this play out
          </button>
          {editing.side === 'us' && editingPlay && asksWho(editingPlay) && (
            <>
              <p className="sp-ask-line">
                <strong>Whose was it?</strong> <span className="muted small">{usName}</span>
              </p>
              <PlayerGrid players={players} on={[]} picked={editing.player === null ? [] : [editing.player]} onPick={(p) => (onChange(state, events.map((e) => (e.id === editing.id ? { ...e, player: p.id } : e))), setSheet(null))} />
            </>
          )}
        </BottomSheet>
      )}
      {/* The part of the game it is in, and ending it. */}
      {sheet?.kind === 'options' && (
        <BottomSheet title={final ? 'Final' : `Change ${def.period}`} icon={<SportIcon sport={def.kind} size={26} />} sub={final || !def.sets ? undefined : 'A set counts for whoever is ahead once you move on to the next one, or end the game.'} onClose={() => setSheet(null)}>
          {!final && (
            <PeriodChanger
              sport={def.kind}
              word={def.period}
              current={state.period}
              regular={def.kind === 'baseball' ? 7 : def.kind === 'football' ? 4 : 3}
              detail={(n) => (def.kind === 'football' && n > 4 ? 'Overtime' : ordinalPart(n, def.period))}
              onPick={(n) => setState({ period: n })}
              onNext={() => (setState({ period: state.period + 1 }), setSheet(null))}
            />
          )}
          {final ? (
            <button type="button" className="btn primary sp-wide" onClick={() => (setState({ status: 'live' }), setSheet(null))}>
              Open it again
            </button>
          ) : (
            <button type="button" className="btn sp-wide" onClick={() => (setState({ status: 'final' }), setSheet(null))}>
              {solo ? 'Finish this sheet' : 'End game'}
            </button>
          )}
        </BottomSheet>
      )}
    </div>
  );
}
