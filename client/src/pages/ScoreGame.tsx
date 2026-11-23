// Keeping score for one of a team's games. The sheet is kept on the device first and sent to the
// server whenever there is a connection, so a gym with bad Wi-Fi loses nothing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Plan, Player } from '../types';
import ScorePad, { CourtPicker, StatTable } from '../components/ScorePad';
import AssistDuos from '../components/AssistDuos';
import { Modal } from '../components/bits';
import type { StatsFile } from '../api';
import { DEFAULT_SCORING, linesOf, newState, periodName, scoreOf, type GameEvent, type ScoreState, type ScoringConfig, type Scoresheet } from '../scoring';
import { confirmDialog } from '../components/dialogs';
import { sportKind } from '../sports';

type Saved = { status: number; sheet?: Scoresheet; error?: string };
type Kept = { state: ScoreState; events: GameEvent[]; rev: number; dirty: boolean };
const read = (key: string): Kept | null => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};
const write = (key: string, kept: Kept) => {
  try {
    localStorage.setItem(key, JSON.stringify(kept));
  } catch {
    /* no room on the device: the server copy still gets every change */
  }
};

/**
 * A scoresheet that is changed here and kept in step with the server. Every change is written to
 * the device at once and sent a moment later; while there is no connection it keeps trying.
 */
export function useSheet(key: string, load: () => Promise<Scoresheet | null>, send: (state: ScoreState, events: GameEvent[], rev: number, take: boolean) => Promise<Saved>, fresh: () => ScoreState) {
  const [doc, setDoc] = useState<{ state: ScoreState; events: GameEvent[] } | null>(null);
  const [sync, setSync] = useState<'saved' | 'saving' | 'offline' | 'taken'>('saved');
  const [server, setServer] = useState<Scoresheet | null>(null);
  const [error, setError] = useState('');
  /** True once this device is the one keeping the sheet: it held a copy already, saved one, or took over. */
  const [adopted, setAdopted] = useState(false);
  const now = useRef<Kept | null>(null);
  const timer = useRef(0);
  const busy = useRef(false);
  const changes = useRef(0);
  const sender = useRef(send);
  sender.current = send;

  const push = useCallback(async () => {
    const kept = now.current;
    if (!kept || !kept.dirty || busy.current) return;
    busy.current = true;
    setSync('saving');
    const at = changes.current;
    try {
      const r = await sender.current(kept.state, kept.events, kept.rev, false);
      if (r.status === 200 && r.sheet) {
        // Anything tapped while this was on its way is still to be sent.
        now.current = { ...now.current!, rev: r.sheet.rev, dirty: changes.current !== at };
        write(key, now.current);
        setServer(r.sheet);
        setAdopted(true);
        setSync(now.current.dirty ? 'saving' : 'saved');
        if (now.current.dirty) timer.current = window.setTimeout(push, 600);
      } else if (r.status === 409) {
        setServer(r.sheet ?? null);
        setSync('taken');
      } else {
        setError(r.error || 'The score could not be saved.');
        setSync('offline');
        timer.current = window.setTimeout(push, 8000);
      }
    } catch {
      setSync('offline');
      timer.current = window.setTimeout(push, 8000);
    }
    busy.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    let alive = true;
    const local = read(key);
    load().then(
      (sheet) => {
        if (!alive) return;
        setServer(sheet);
        // What this device has and has not yet sent wins, as long as nobody else has saved since.
        const mine = local && local.dirty && (!sheet || sheet.rev === local.rev);
        now.current = mine ? local : { state: sheet?.state ?? fresh(), events: sheet?.events ?? [], rev: sheet?.rev ?? 0, dirty: false };
        setDoc({ state: now.current.state, events: now.current.events });
        if (local && (!sheet || sheet.rev === local.rev)) setAdopted(true);
        if (mine) push();
      },
      (e) => {
        if (!alive) return;
        // No connection: carry on from what the device holds.
        if (local) {
          now.current = local;
          setDoc({ state: local.state, events: local.events });
          setSync('offline');
          timer.current = window.setTimeout(push, 8000);
        } else setError((e as Error).message);
      },
    );
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const change = (state: ScoreState, events: GameEvent[]) => {
    if (!now.current) return;
    changes.current++;
    now.current = { ...now.current, state, events, dirty: true };
    write(key, now.current);
    setDoc({ state, events });
    setSync((was) => (was === 'taken' || was === 'offline' ? was : 'saving'));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(push, 1200);
  };
  /** Carries on from what the server holds, as the one keeping score from now on. */
  const takeOver = async () => {
    try {
      const r = await sender.current(now.current?.state ?? fresh(), now.current?.events ?? [], 0, true);
      if (r.status !== 200 || !r.sheet) return setError(r.error || 'Could not take over.');
      now.current = { state: r.sheet.state, events: r.sheet.events, rev: r.sheet.rev, dirty: false };
      write(key, now.current);
      setServer(r.sheet);
      setDoc({ state: r.sheet.state, events: r.sheet.events });
      setAdopted(true);
      setSync('saved');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** Reads the server's copy again, for someone who is only watching. */
  const refresh = () =>
    load().then((sheet) => {
      setServer(sheet);
      if (sheet && now.current && !now.current.dirty) {
        now.current = { state: sheet.state, events: sheet.events, rev: sheet.rev, dirty: false };
        setDoc({ state: sheet.state, events: sheet.events });
      }
    }, () => {});
  /** Takes up a sheet the server has just made, as after an import. */
  const adopt = (sheet: Scoresheet) => {
    window.clearTimeout(timer.current);
    now.current = { state: sheet.state, events: sheet.events, rev: sheet.rev, dirty: false };
    write(key, now.current);
    setServer(sheet);
    setDoc({ state: sheet.state, events: sheet.events });
    setAdopted(true);
    setSync('saved');
  };
  return { doc, change, sync, server, error, takeOver, refresh, adopted, adopt };
}

/** "Saved", "Saving…", or that the device is holding the score until there is a connection. */
export function SyncNote({ sync }: { sync: 'saved' | 'saving' | 'offline' | 'taken' }) {
  return <span className={`sp-sync ${sync}`}>{sync === 'saved' ? 'Saved' : sync === 'saving' ? 'Saving…' : sync === 'offline' ? 'No connection. Kept on this device.' : 'Not saving'}</span>;
}

/** A game's box score: each player's line, the team's totals, and the other team's. */
export function BoxScore({ events, players, usName, themName, state }: { events: GameEvent[]; players: Pick<Player, 'id' | 'name' | 'number'>[]; usName: string; themName: string; state: ScoreState }) {
  const us = linesOf(events, 'us');
  const them = linesOf(events, 'them');
  const rows = players.filter((p) => us.players.has(p.id)).map((p) => ({ key: p.id, name: `${p.number ? `#${p.number} ` : ''}${p.name}`, line: us.players.get(p.id)! }));
  const oppRows = state.opp_players.filter((p) => them.players.has(p.id)).map((p) => ({ key: p.id, name: `#${p.label}`, line: them.players.get(p.id)! }));
  return (
    <>
      <div className="card">
        <h2>{usName}</h2>
        {rows.length === 0 && <p className="muted small">No player has a stat yet. With "Score only" the game has a score and nothing per player.</p>}
        <StatTable rows={rows} total={{ name: 'Team', line: us.total }} />
      </div>
      <div className="card">
        <h2>{themName}</h2>
        <StatTable oneReb rows={oppRows} total={{ name: 'Team', line: them.total }} first={oppRows.length ? 'Player' : ''} />
      </div>
      {us.total.ast > 0 && (
        <div className="card">
          <h2>Who set up whom</h2>
          <AssistDuos games={[{ events }]} nameOf={(id) => players.find((p) => p.id === id)?.name ?? 'Former player'} />
        </div>
      )}
    </>
  );
}

/**
 * Bringing a game's stats in from the file another scorekeeping app exports. The file is read
 * first; the coach then says which of their own players each line of it is, and only then is
 * anything saved.
 */
function ImportStats({ planId, their, themName, onClose, onDone }: { planId: number; their: number; themName: string; onClose: () => void; onDone: (sheet: Scoresheet) => void }) {
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [read, setRead] = useState<StatsFile | null>(null);
  const [map, setMap] = useState<Record<number, number | 'team' | 'skip'>>({});
  const [them, setThem] = useState(their ? String(their) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choose = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    try {
      const csv = await f.text();
      const r = await api.readStats(planId, csv);
      setFile({ name: f.name, csv });
      setRead(r);
      // Each line starts on the player it looks like; a line nobody matches is left for the coach to place.
      setMap(Object.fromEntries(r.rows.map((row, i) => [i, row.player_id || (row.unassigned ? 'team' : 'skip')])));
    } catch (e) {
      setRead(null);
      setError((e as Error).message);
    }
  };
  const picked = Object.values(map).filter((v): v is number => typeof v === 'number');
  const twice = picked.some((id, i) => picked.indexOf(id) !== i);
  const unplaced = read ? read.rows.filter((_, i) => map[i] === 'skip').length : 0;
  const total = read ? read.rows.reduce((n, row, i) => n + (map[i] === 'skip' ? 0 : row.stats.pts), 0) : 0;
  const save = async () => {
    if (!file || !read || twice) return;
    setBusy(true);
    try {
      onDone((await api.importStats(planId, { csv: file.csv, file: file.name, map, them: Number(them) || 0 })).sheet);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Import stats" onClose={onClose} wide>
      <div className="stat-import">
        {!read ? (
          <>
            <p className="muted">Choose the stats file exported from your scorekeeping app (a .csv file), filtered to this one game. You will match its players to your roster before anything is saved.</p>
            <input type="file" accept=".csv,text/csv,text/plain" aria-label="Stats file" onChange={(e) => choose(e.target.files?.[0])} />
          </>
        ) : (
          <>
            <p className="muted small">
              <strong>{file?.name}</strong>: {read.rows.length} {read.rows.length === 1 ? 'line' : 'lines'} with stats. Match each one to a player on your roster.
            </p>
            {read.games > 1 && <p className="notice">This file adds up {read.games} games. Everything in it will be counted as this one game. To bring in one game, export the stats filtered to that game.</p>}
            {read.existing > 0 && <p className="notice">This game already has {read.existing} {read.existing === 1 ? 'play' : 'plays'} scored. Importing replaces them.</p>}
            <div className="table-scroll">
              <table className="table stat-match">
                <thead>
                  <tr>
                    <th>In the file</th>
                    <th>PTS</th>
                    <th>FG</th>
                    <th>3PT</th>
                    <th>FT</th>
                    <th>REB</th>
                    <th>AST</th>
                    <th>STL</th>
                    <th>BLK</th>
                    <th>TO</th>
                    <th>PF</th>
                    <th>On your roster</th>
                  </tr>
                </thead>
                <tbody>
                  {read.rows.map((row, i) => {
                    const mine = map[i];
                    const clash = typeof mine === 'number' && picked.filter((id) => id === mine).length > 1;
                    return (
                      <tr key={i} className={mine === 'skip' ? 'skipped' : ''}>
                        <td>
                          {row.unassigned ? (
                            <strong>Unassigned</strong>
                          ) : (
                            <>
                              {row.number && <b>#{row.number} </b>}
                              {[row.first, row.last].filter(Boolean).join(' ')}
                            </>
                          )}
                        </td>
                        <td>{row.stats.pts}</td>
                        <td>
                          {row.stats.fgm}-{row.stats.fga}
                        </td>
                        <td>
                          {row.stats.tpm}-{row.stats.tpa}
                        </td>
                        <td>
                          {row.stats.ftm}-{row.stats.fta}
                        </td>
                        <td>{row.stats.reb}</td>
                        <td>{row.stats.ast}</td>
                        <td>{row.stats.stl}</td>
                        <td>{row.stats.blk}</td>
                        <td>{row.stats.to}</td>
                        <td>{row.stats.pf}</td>
                        <td>
                          <select
                            className={`input ${clash ? 'clash' : ''}`}
                            aria-label={`Who ${row.unassigned ? 'the unassigned line' : [row.first, row.last].filter(Boolean).join(' ') || `number ${row.number}`} is on your roster`}
                            value={String(mine)}
                            onChange={(e) => setMap({ ...map, [i]: e.target.value === 'team' || e.target.value === 'skip' ? e.target.value : Number(e.target.value) })}
                          >
                            <option value="skip">Do not import</option>
                            <option value="team">The team, not a player</option>
                            {read.roster.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.number ? `#${p.number} ` : ''}
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {twice && <p className="error">One player is chosen for more than one line. Each line has to go to a different player.</p>}
            {unplaced > 0 && !twice && <p className="muted small">{unplaced === 1 ? 'One line is' : `${unplaced} lines are`} set to "Do not import" and will be left out.</p>}
            <label className="field stat-them">
              <span className="field-label">{themName}'s final score</span>
              <input className="input" inputMode="numeric" maxLength={3} value={them} onChange={(e) => setThem(e.target.value.replace(/\D/g, ''))} />
            </label>
            <p className="muted small">
              Your team's score from the lines being imported: <strong>{total}</strong>. The game is marked as finished.
            </p>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          {read && (
            <button type="button" className="btn" onClick={() => (setRead(null), setFile(null))}>
              Choose another file
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {read && (
            <button type="button" className="btn primary" disabled={busy || twice || read.rows.every((_, i) => map[i] === 'skip')} onClick={save}>
              {busy ? 'Importing…' : 'Import these stats'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** The old address of the scoring screen: it now lives in the game's own page. */
export default function ScoreGame() {
  const { id } = useParams();
  return <Navigate to={`/plans/${id}?view=score`} replace />;
}

/** Keeping score for one game, inside the game's page. */
export function ScoreGameView({ planId }: { planId: number }) {
  const app = useApp();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [failed, setFailed] = useState('');
  const [tab, setTab] = useState<'score' | 'box' | 'roster'>('score');
  const navigate = useNavigate();
  const [canImport, setCanImport] = useState(false);
  // What this team tracks while scoring: which buttons the pad has and what it asks.
  const [config, setConfig] = useState<ScoringConfig>(DEFAULT_SCORING);
  const [importing, setImporting] = useState(false);
  // Whether this game is going out on video right now, for the mark at the top.
  const [live, setLive] = useState(false);
  const planRef = useRef<Plan | null>(null);
  // Asked for once: the sheet waits for it, so the starters can come from the game plan.
  const planAsked = useMemo(() => api.plan(planId), [planId]);
  useEffect(() => {
    planAsked.then(
      (p) => {
        planRef.current = p;
        setPlan(p);
        api.players(p.team_id).then((list) => setPlayers(list.filter((x) => x.active)), () => {});
        api.teamScoring(p.team_id).then((r) => setConfig(r.scoring), () => {});
      },
      (e) => setFailed((e as Error).message),
    );
  }, [planAsked]);
  useEffect(() => {
    if (!plan) return;
    const look = () => api.streams(plan.team_id).then((l) => setLive(l.live.some((x) => x.plan_id === plan.id)), () => {});
    look();
    window.addEventListener('dime:news', look);
    return () => window.removeEventListener('dime:news', look);
  }, [plan]);
  const sheet = useSheet(
    `dime.score.plan.${planId}`,
    () =>
      planAsked.then((p) => {
        planRef.current = p;
        return api.score(planId).then((r) => {
          setCanImport(r.can_import);
          return r.sheet;
        });
      }),
    (state, events, rev, take) => api.saveScore(planId, { state, events, rev, take }),
    // The starters come from the game plan, when it has a lineup.
    // A basketball game starts out in halves; it is changed for the game under the period button.
    () => ({ ...newState('full', sportKind(app.sport?.name) === 'basketball'), on: (planRef.current?.game?.lineup?.[0] ?? []).slice(0, 5) }),
  );
  // Someone only watching sees the score move as it is kept.
  const { refresh } = sheet;
  useEffect(() => {
    window.addEventListener('dime:news', refresh);
    return () => window.removeEventListener('dime:news', refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed || sheet.error)
    return (
      <p className="error">{failed || sheet.error}</p>
    );
  if (!plan || !sheet.doc) return <p className="muted">Loading…</p>;
  const usName = app.team?.name ?? 'Us';
  const themName = plan.game?.opponent?.trim() || 'Opponent';
  const { state, events } = sheet.doc;
  // Another person has the sheet: they are the scorer until this device takes over.
  const theirs = sheet.sync === 'taken' || (!!sheet.server && sheet.server.status === 'live' && !!sheet.server.scorer_id && sheet.server.scorer_id !== app.user.id && sheet.server.events.length > 0 && !sheet.adopted);
  const score = scoreOf(events);

  /** Throws away everything recorded for this game and starts its scoring again from nothing. */
  const redo = async () => {
    const ok = await confirmDialog({
      title: "Delete this game's stats and start over?",
      body: `ALL of the stats recorded for this game will be deleted: ${events.length} ${events.length === 1 ? 'play' : 'plays'}, and the score of ${usName} ${score.us}, ${themName} ${score.them}. They are gone for good and cannot be brought back. The game then starts again at 0 to 0.`,
      confirmLabel: 'Delete the old stats and start over',
      danger: true,
    });
    if (!ok) return;
    // How the game is kept stays as it was set: the clock, the other team's numbers, who is on the court.
    sheet.change({ ...newState('full', !!state.halves), on: state.on, timed: state.timed, period_secs: state.period_secs, opp_advanced: state.opp_advanced, opp_players: state.opp_players }, []);
    setTab('score');
  };
  const seg = (
    <div className="sp-tabs" role="tablist" aria-label="Scoring, stats and roster">
      {(
        [
          ['score', 'Scoring'],
          ['box', 'Stats'],
          ['roster', 'Roster'],
        ] as const
      ).map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <div className="score-page">
      <div className="score-head">
        {canImport && !theirs && (
          <button type="button" className="btn small" onClick={() => setImporting(true)}>
            Import stats
          </button>
        )}
        {!theirs && events.length > 0 && (
          <button type="button" className="btn small danger" onClick={redo}>
            Redo stats
          </button>
        )}
        <SyncNote sync={sheet.sync} />
      </div>
      {state.imported && <p className="muted small sp-imported">These stats were brought in from {state.imported}, as totals for the game. There is no play by play for them.</p>}
      {importing && (
        <ImportStats
          planId={planId}
          their={Number(plan.game?.result?.them) || 0}
          themName={themName}
          onClose={() => setImporting(false)}
          onDone={(made) => {
            sheet.adopt(made);
            setImporting(false);
            setTab('box');
          }}
        />
      )}
      {theirs ? (
        <>
          <div className="card sp-theirs">
            <h2>
              {usName} {score.us} · {themName} {score.them} <span className="muted small">{state.status === 'final' ? 'Final' : periodName(state.period, !!state.halves)}</span>
            </h2>
            <p className="muted">{sheet.server?.scorer || 'Someone else'} is keeping score for this game. One person keeps score at a time; this page follows along.</p>
            <button type="button" className="btn primary" onClick={sheet.takeOver}>
              Take over keeping score
            </button>
          </div>
          <BoxScore events={events} players={players} usName={usName} themName={themName} state={state} />
        </>
      ) : (
        <ScorePad
          state={state}
          events={events}
          onChange={sheet.change}
          usName={usName}
          themName={themName}
          players={players}
          usHome={plan.game?.side !== 'away'}
          onExit={() => navigate(`/plans/${planId}`)}
          video={live ? 'live' : 'none'}
          onVideo={() => navigate(`/plans/${planId}?view=video`)}
          tabs={seg}
          config={config}
        >
          {tab === 'box' ? (
            <BoxScore events={events} players={players} usName={usName} themName={themName} state={state} />
          ) : tab === 'roster' ? (
            <div className="card">
              <h2>On the court</h2>
              {players.length === 0 ? <p className="muted">This team has no players yet. Add them under Team.</p> : <CourtPicker players={players} on={state.on} onChange={(on) => sheet.change({ ...state, on }, events)} />}
            </div>
          ) : undefined}
        </ScorePad>
      )}
    </div>
  );
}
