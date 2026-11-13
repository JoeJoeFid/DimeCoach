// The plan for a game: who is there, who plays when, what the team is trying to do, and how it
// went. It is kept beside the practice schedule on the same plan, never in place of it, so
// switching a plan between practice and game loses nothing on either side.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Drill, GamePlan, GameSubs, Plan, Play, Player } from '../types';
import { sportKind } from '../sports';
import { SITUATIONS, UNIT_CHOICES, availablePlayers, fillEvenly, playingTime, readOpponent, segmentsOf, subsOf } from '../game';
import { fmtClock, parseClock } from '../util';

const Card = ({ title, hint, action, children, wide }: { title: string; hint?: string; action?: ReactNode; children: ReactNode; wide?: boolean }) => (
  <section className={`gp-card ${wide ? 'wide' : ''}`}>
    <div className="gp-card-head">
      <h3>
        {title}
        {hint && <span className="hint">{hint}</span>}
      </h3>
      {action}
    </div>
    {children}
  </section>
);
const three = (list: string[] | undefined) => [0, 1, 2].map((i) => list?.[i] ?? '');

export default function GamePlanner({
  plan,
  players,
  plays,
  drills,
  actions,
  onChange,
  onPractice,
}: {
  plan: Plan;
  players: Player[];
  plays: Play[];
  drills: Drill[];
  /** Print and the other things to do with the whole plan. */
  actions: ReactNode;
  onChange: (game: GamePlan) => void;
  /** Goes back to the practice screen for this plan. */
  onPractice: () => void;
}) {
  const app = useApp();
  const kind = sportKind(app.sport?.name);
  const game: GamePlan = plan.game || {};
  const set = (patch: Partial<GamePlan>) => onChange({ ...game, ...patch });
  const subs = subsOf(game, kind);
  const setSubs = (patch: Partial<GameSubs>) => set({ subs: { ...subs, ...patch } });
  const segments = segmentsOf(subs);
  const lineup = segments.map((_, i) => game.lineup?.[i] ?? []);
  const roster = players.filter((p) => p.active);
  const here = availablePlayers(players, game);
  const nameOf = (id: number) => players.find((p) => p.id === id)?.name ?? 'Removed player';
  const [fromCalendar, setFromCalendar] = useState('');

  // The first time a game is opened, fill in what the team calendar already says about it.
  useEffect(() => {
    if (game.prefilled || (game.opponent || '').trim()) return;
    let alive = true;
    (async () => {
      const team = app.team;
      let title = plan.title;
      let notes = '';
      try {
        if (team?.calendar_url && plan.date) {
          const ev = (await api.events(team.id, plan.date)).filter((e) => e.date === plan.date);
          const hit = ev.find((e) => e.title === plan.title) ?? ev.find((e) => e.kind === 'game');
          if (hit) {
            title = hit.title;
            notes = hit.notes;
          }
        }
      } catch {
        // The plan's own title is still worth reading.
      }
      if (!alive) return;
      const read = readOpponent(title, team?.name ?? '');
      onChange({ ...game, ...(read ? { opponent: read.opponent, side: read.side } : {}), prefilled: true });
      if (read) setFromCalendar(`Opponent and ${read.side === 'away' ? 'away' : 'home'} were filled in from ${notes || title !== plan.title ? 'the team calendar' : 'the title'}. Change anything that is not right.`);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  const flip = (seg: number, playerId: number) => {
    const next = lineup.map((s) => [...s]);
    next[seg] = next[seg].includes(playerId) ? next[seg].filter((x) => x !== playerId) : [...next[seg], playerId];
    set({ lineup: next });
  };
  const setStatus = (id: number, status: 'in' | 'out' | 'late') => {
    const availability = { ...(game.availability || {}) };
    if (status === 'in') delete availability[String(id)];
    else availability[String(id)] = status;
    // Someone marked out comes off the lineup and the batting order.
    set({
      availability,
      ...(status === 'out' ? { lineup: lineup.map((s) => s.filter((x) => x !== id)), batting: (game.batting || []).filter((x) => x !== id) } : {}),
    });
  };
  const keys = { offense: three(game.keys?.offense), defense: three(game.keys?.defense), focus: game.keys?.focus ?? '' };
  const setKey = (side: 'offense' | 'defense', i: number, text: string) => set({ keys: { ...keys, [side]: keys[side].map((k, j) => (j === i ? text : k)) } });
  const sheet = SITUATIONS.map((s) => ({ situation: s, play_ids: game.plays?.find((p) => p.situation === s)?.play_ids ?? [] }));
  const setSheet = (situation: string, play_ids: number[]) => set({ plays: sheet.map((p) => (p.situation === situation ? { situation, play_ids } : p)) });
  const matchups = game.matchups || [];
  const warmup = game.warmup || [];
  const result = { us: '', them: '', went_well: '', work_on: '', ...(game.result || {}) };
  const batting = (game.batting || []).filter((id) => here.some((p) => p.id === id));
  const notBatting = here.filter((p) => !batting.includes(p.id));
  const moveBatter = (i: number, by: number) => {
    const next = [...batting];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set({ batting: next });
  };
  const start = plan.start_time ? fmtClock(parseClock(plan.start_time)) : '';
  const practiceItems = plan.items.filter((i) => i.kind === 'item').length;

  return (
    <div className="plan-column game-plan">
      <div className="plan-column-head">
        <h2 className="plan-column-title">
          {game.opponent ? `${game.side === 'away' ? 'at' : 'vs.'} ${game.opponent}` : 'Game plan'}
          {start && <span className="gp-start"> · {start}</span>}
        </h2>
        <div className="plan-column-actions">{actions}</div>
      </div>
      {practiceItems > 0 && (
        <p className="banner gp-kept">
          This plan also has a practice schedule with {practiceItems} item{practiceItems === 1 ? '' : 's'}. It is kept as it was.{' '}
          <button type="button" className="link" onClick={onPractice}>
            Switch back to practice
          </button>
        </p>
      )}
      {fromCalendar && <p className="banner ok">{fromCalendar}</p>}

      <div className="gp-grid">
        <Card title="Game details">
          <div className="gp-fields">
            <label className="field grow">
              <span className="field-label">Opponent</span>
              <input className="input" value={game.opponent ?? ''} placeholder="Who you are playing" onChange={(e) => set({ opponent: e.target.value })} />
            </label>
            <div className="field">
              <span className="field-label">Where</span>
              <div className="seg" role="group" aria-label="Home or away">
                {(['home', 'away', 'neutral'] as const).map((s) => (
                  <button key={s} type="button" className={game.side === s ? 'on' : ''} aria-pressed={game.side === s} onClick={() => set({ side: game.side === s ? '' : s })}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span className="field-label">Arrive by</span>
              <input className="input" type="time" value={game.arrive ?? ''} onChange={(e) => set({ arrive: e.target.value })} />
            </label>
            <label className="field grow">
              <span className="field-label">Uniform</span>
              <input className="input" value={game.uniform ?? ''} placeholder="Such as white jerseys" onChange={(e) => set({ uniform: e.target.value })} />
            </label>
            <label className="field grow">
              <span className="field-label">Bring</span>
              <input className="input" value={game.bring ?? ''} placeholder="Water, both jerseys…" onChange={(e) => set({ bring: e.target.value })} />
            </label>
          </div>
          <p className="muted small">The date, start time and place are in the box at the top of the page.</p>
        </Card>

        <Card title="Keys to the game" hint="Three short points each. These print large on the bench card.">
          <div className="gp-keys">
            {(['offense', 'defense'] as const).map((side) => (
              <div key={side}>
                <span className="field-label">{side === 'offense' ? 'On offense' : 'On defense'}</span>
                {keys[side].map((k, i) => (
                  <input key={i} className="input" aria-label={`${side} key ${i + 1}`} value={k} placeholder={`${i + 1}.`} maxLength={120} onChange={(e) => setKey(side, i, e.target.value)} />
                ))}
              </div>
            ))}
          </div>
          <label className="field">
            <span className="field-label">Team focus</span>
            <input className="input" value={keys.focus} placeholder="The one thing to remember today" maxLength={160} onChange={(e) => set({ keys: { ...keys, focus: e.target.value } })} />
          </label>
        </Card>

        <Card title="Who is here" hint="Anyone marked out is left off the lineup." wide>
          {roster.length === 0 ? (
            <p className="muted small">
              There is nobody on the roster yet. <Link to="/teams">Add players</Link> to plan a lineup.
            </p>
          ) : (
            <ul className="gp-avail">
              {roster.map((p) => {
                const status = (game.availability || {})[String(p.id)] ?? 'in';
                return (
                  <li key={p.id} className={status}>
                    <span className="gp-avail-name">
                      {p.number && <b>{p.number}</b>}
                      {p.name}
                    </span>
                    <span className="seg" role="group" aria-label={`Is ${p.name} playing`}>
                      {(['in', 'late', 'out'] as const).map((s) => (
                        <button key={s} type="button" className={status === s ? 'on' : ''} aria-pressed={status === s} onClick={() => setStatus(p.id, s)}>
                          {s[0].toUpperCase() + s.slice(1)}
                        </button>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          wide
          title="Lineup and playing time"
          hint="Tick who is on in each stretch. The first column is your starters."
          action={
            here.length > 0 && (
              <span className="row-actions">
                <button type="button" className="btn small" title="Shares the stretches out so everyone plays about the same" onClick={() => set({ lineup: fillEvenly(here.map((p) => p.id), segments.length, subs.on) })}>
                  Share time evenly
                </button>
                <button type="button" className="btn small" onClick={() => set({ lineup: [] })}>
                  Clear
                </button>
              </span>
            )
          }
        >
          <div className="gp-subs">
            <div className="field">
              <span className="field-label">How you sub in this game</span>
              <div className="seg" role="group" aria-label="How you substitute">
                <button type="button" className={subs.mode === 'periods' ? 'on' : ''} aria-pressed={subs.mode === 'periods'} onClick={() => setSubs({ mode: 'periods' })}>
                  By period
                </button>
                <button type="button" className={subs.mode === 'time' ? 'on' : ''} aria-pressed={subs.mode === 'time'} onClick={() => setSubs({ mode: 'time', game_minutes: subs.game_minutes || 32, every: subs.every || 4 })}>
                  By the clock
                </button>
              </div>
            </div>
            {subs.mode === 'periods' ? (
              <>
                <label className="field">
                  <span className="field-label">A period is a</span>
                  <select className="input" value={UNIT_CHOICES.includes(subs.unit) ? subs.unit : 'Period'} onChange={(e) => setSubs({ unit: e.target.value })}>
                    {UNIT_CHOICES.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">How many</span>
                  <input className="input gp-num" type="number" min={1} max={20} value={subs.count} onChange={(e) => setSubs({ count: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
                </label>
                <label className="field">
                  <span className="field-label">Minutes each</span>
                  <input className="input gp-num" type="number" min={0} max={90} value={subs.minutes || ''} placeholder="Not timed" onChange={(e) => setSubs({ minutes: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })} />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span className="field-label">Game length, minutes</span>
                  <input className="input gp-num" type="number" min={1} max={200} value={subs.game_minutes || ''} onChange={(e) => setSubs({ game_minutes: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} />
                </label>
                <label className="field">
                  <span className="field-label">Sub every, minutes</span>
                  <input className="input gp-num" type="number" min={1} max={60} step={0.5} value={subs.every || ''} onChange={(e) => setSubs({ every: Math.max(0.5, Math.min(60, Number(e.target.value) || 1)) })} />
                </label>
              </>
            )}
            <label className="field">
              <span className="field-label">Players on at once</span>
              <input className="input gp-num" type="number" min={1} max={15} value={subs.on} onChange={(e) => setSubs({ on: Math.max(1, Math.min(15, Number(e.target.value) || 1)) })} />
            </label>
          </div>
          {here.length === 0 ? (
            <p className="muted small">Nobody is marked as here yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="gp-lineup">
                <thead>
                  <tr>
                    <th>Player</th>
                    {segments.map((s, i) => (
                      <th key={i} title={s.name}>
                        {s.label}
                      </th>
                    ))}
                    <th className="gp-time-head">Plays</th>
                  </tr>
                </thead>
                <tbody>
                  {here.map((p) => {
                    const time = playingTime(p.id, lineup, segments, subs);
                    return (
                      <tr key={p.id}>
                        <th scope="row">
                          {p.number && <b>{p.number}</b>}
                          {p.name}
                          {(game.availability || {})[String(p.id)] === 'late' && <span className="kind">Late</span>}
                        </th>
                        {segments.map((s, i) => {
                          const on = lineup[i].includes(p.id);
                          return (
                            <td key={i}>
                              <button type="button" className={`gp-cell ${on ? 'on' : ''}`} aria-pressed={on} aria-label={`${p.name}, ${s.name}`} onClick={() => flip(i, p.id)}>
                                {on ? '●' : ''}
                              </button>
                            </td>
                          );
                        })}
                        <td className={`gp-time ${time.count === 0 ? 'none' : ''}`}>{time.text}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">On at once</th>
                    {segments.map((_, i) => {
                      const n = lineup[i].filter((id) => here.some((p) => p.id === id)).length;
                      return (
                        <td key={i} className={n === 0 ? 'none' : n === subs.on ? 'right' : 'wrong'} title={n === subs.on ? 'The right number' : `${n} on, ${subs.on} wanted`}>
                          {n}
                        </td>
                      );
                    })}
                    <td className="gp-time-head">of {subs.on}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        {kind === 'baseball' && (
          <Card title="Batting order" hint="Add players in the order they bat.">
            {batting.length > 0 && (
              <ol className="gp-batting">
                {batting.map((id, i) => (
                  <li key={id}>
                    <span>{nameOf(id)}</span>
                    <input
                      className="input gp-pos"
                      aria-label={`Position for ${nameOf(id)}`}
                      placeholder="Pos"
                      maxLength={6}
                      value={(game.positions || {})[String(id)] ?? ''}
                      onChange={(e) => set({ positions: { ...(game.positions || {}), [String(id)]: e.target.value } })}
                    />
                    <button type="button" className="btn ghost" aria-label={`Move ${nameOf(id)} up`} disabled={i === 0} onClick={() => moveBatter(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="btn ghost" aria-label={`Move ${nameOf(id)} down`} disabled={i === batting.length - 1} onClick={() => moveBatter(i, 1)}>
                      ↓
                    </button>
                    <button type="button" className="btn ghost" aria-label={`Take ${nameOf(id)} out of the order`} onClick={() => set({ batting: batting.filter((x) => x !== id) })}>
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {notBatting.length > 0 && (
              <select className="input" aria-label="Add a batter" value="" onChange={(e) => e.target.value && set({ batting: [...batting, Number(e.target.value)] })}>
                <option value="">+ Add the next batter…</option>
                {notBatting.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Card>
        )}

        <Card title="Play sheet" hint="Plays from your playbook, by situation. They print with their diagrams.">
          {plays.length === 0 ? (
            <p className="muted small">
              No plays yet. Draw them in the <Link to="/playbook">playbook</Link>, then pick them here.
            </p>
          ) : (
            sheet.map((s) => (
              <div key={s.situation} className="gp-situation">
                <span className="field-label">{s.situation}</span>
                <span className="chips">
                  {s.play_ids.map((id) => (
                    <span key={id} className="chip">
                      {plays.find((p) => p.id === id)?.name ?? 'Deleted play'}
                      <button type="button" aria-label="Take this play off the sheet" onClick={() => setSheet(s.situation, s.play_ids.filter((x) => x !== id))}>
                        ✕
                      </button>
                    </span>
                  ))}
                  <select className="input gp-add" aria-label={`Add a play for ${s.situation}`} value="" onChange={(e) => e.target.value && setSheet(s.situation, [...s.play_ids, Number(e.target.value)])}>
                    <option value="">+ Add a play…</option>
                    {plays
                      .filter((p) => !s.play_ids.includes(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </span>
              </div>
            ))
          )}
        </Card>

        <Card
          title="Matchups"
          hint="Who takes whom."
          action={
            <button type="button" className="btn small" onClick={() => set({ matchups: [...matchups, { player_id: here[0]?.id ?? 0, opponent: '', note: '' }] })}>
              + Add
            </button>
          }
        >
          {matchups.length === 0 ? (
            <p className="muted small">None yet. Add one for each player who has a particular job.</p>
          ) : (
            <ul className="gp-rows">
              {matchups.map((m, i) => {
                const patch = (p: Partial<(typeof matchups)[number]>) => set({ matchups: matchups.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <li key={i}>
                    <select className="input" aria-label="Our player" value={m.player_id} onChange={(e) => patch({ player_id: Number(e.target.value) })}>
                      {!here.some((p) => p.id === m.player_id) && <option value={m.player_id}>{m.player_id ? nameOf(m.player_id) : 'Choose a player'}</option>}
                      {here.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input className="input" aria-label="Their player" placeholder="Their player, such as #12" value={m.opponent} onChange={(e) => patch({ opponent: e.target.value })} />
                    <input className="input grow" aria-label="Note" placeholder="What to do" value={m.note} onChange={(e) => patch({ note: e.target.value })} />
                    <button type="button" className="btn ghost" aria-label="Remove this matchup" onClick={() => set({ matchups: matchups.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Warm-up"
          hint={warmup.length > 0 ? `${warmup.reduce((n, w) => n + (w.minutes || 0), 0)} minutes` : 'What the team does before the start.'}
          action={
            <button type="button" className="btn small" onClick={() => set({ warmup: [...warmup, { title: '', minutes: 5 }] })}>
              + Add
            </button>
          }
        >
          {warmup.length > 0 && (
            <ul className="gp-rows">
              {warmup.map((w, i) => {
                const patch = (p: Partial<(typeof warmup)[number]>) => set({ warmup: warmup.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <li key={i}>
                    <input className="input grow" aria-label="What" placeholder="Such as layup lines" value={w.title} onChange={(e) => patch({ title: e.target.value })} />
                    <input className="input gp-num" type="number" min={0} max={90} aria-label="Minutes" value={w.minutes} onChange={(e) => patch({ minutes: Math.max(0, Number(e.target.value) || 0) })} />
                    <span className="muted small">min</span>
                    <button type="button" className="btn ghost" aria-label="Remove this" onClick={() => set({ warmup: warmup.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {drills.length > 0 && (
            <select
              className="input"
              aria-label="Add one of your drills to the warm-up"
              value=""
              onChange={(e) => {
                const d = drills.find((x) => x.id === Number(e.target.value));
                if (d) set({ warmup: [...warmup, { title: d.name, minutes: d.duration_min }] });
              }}
            >
              <option value="">+ Add one of your drills…</option>
              {drills.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.duration_min} min)
                </option>
              ))}
            </select>
          )}
        </Card>

        <Card title="Scouting notes" hint="For the coaches on this team. Left off the sheet for parents.">
          <textarea className="input" rows={5} maxLength={6000} aria-label="Scouting notes" placeholder="What they run, who to watch, what worked last time…" value={game.scouting ?? ''} onChange={(e) => set({ scouting: e.target.value })} />
        </Card>

        <Card title="After the game" hint="Fill this in once it is over." wide>
          <div className="gp-result">
            <label className="field">
              <span className="field-label">Us</span>
              <input className="input gp-score" inputMode="numeric" maxLength={4} aria-label="Our score" value={result.us} onChange={(e) => set({ result: { ...result, us: e.target.value } })} />
            </label>
            <label className="field">
              <span className="field-label">{game.opponent || 'Them'}</span>
              <input className="input gp-score" inputMode="numeric" maxLength={4} aria-label="Their score" value={result.them} onChange={(e) => set({ result: { ...result, them: e.target.value } })} />
            </label>
            <label className="field grow">
              <span className="field-label">What went well</span>
              <textarea className="input" rows={2} maxLength={2000} value={result.went_well} onChange={(e) => set({ result: { ...result, went_well: e.target.value } })} />
            </label>
            <label className="field grow">
              <span className="field-label">What to work on</span>
              <textarea className="input" rows={2} maxLength={2000} value={result.work_on} onChange={(e) => set({ result: { ...result, work_on: e.target.value } })} />
            </label>
          </div>
        </Card>
      </div>
    </div>
  );
}
