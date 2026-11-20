// Keeping score for one of a team's games. The sheet is kept on the device first and sent to the
// server whenever there is a connection, so a gym with bad Wi-Fi loses nothing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Plan, Player } from '../types';
import ScorePad, { StatTable } from '../components/ScorePad';
import { linesOf, newState, periodName, scoreOf, type GameEvent, type ScoreState, type Scoresheet } from '../scoring';

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
  return { doc, change, sync, server, error, takeOver, refresh, adopted };
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
        <StatTable rows={oppRows} total={{ name: 'Team', line: them.total }} first={oppRows.length ? 'Player' : ''} />
      </div>
    </>
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
  const [tab, setTab] = useState<'score' | 'box'>('score');
  const planRef = useRef<Plan | null>(null);
  // Asked for once: the sheet waits for it, so the starters can come from the game plan.
  const planAsked = useMemo(() => api.plan(planId), [planId]);
  useEffect(() => {
    planAsked.then(
      (p) => {
        planRef.current = p;
        setPlan(p);
        api.players(p.team_id).then((list) => setPlayers(list.filter((x) => x.active)), () => {});
      },
      (e) => setFailed((e as Error).message),
    );
  }, [planAsked]);
  const sheet = useSheet(
    `dime.score.plan.${planId}`,
    () =>
      planAsked.then((p) => {
        planRef.current = p;
        return api.score(planId).then((r) => r.sheet);
      }),
    (state, events, rev, take) => api.saveScore(planId, { state, events, rev, take }),
    // The starters come from the game plan, when it has a lineup.
    () => ({ ...newState('score'), on: (planRef.current?.game?.lineup?.[0] ?? []).slice(0, 5) }),
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

  return (
    <div className="score-page">
      <div className="score-head">
        <div className="seg" role="group" aria-label="View">
          <button type="button" className={tab === 'score' ? 'on' : ''} aria-pressed={tab === 'score'} onClick={() => setTab('score')}>
            Score
          </button>
          <button type="button" className={tab === 'box' ? 'on' : ''} aria-pressed={tab === 'box'} onClick={() => setTab('box')}>
            Box score
          </button>
        </div>
        <SyncNote sync={sheet.sync} />
      </div>
      {theirs ? (
        <div className="card sp-theirs">
          <h2>
            {usName} {score.us} · {themName} {score.them} <span className="muted small">{state.status === 'final' ? 'Final' : periodName(state.period)}</span>
          </h2>
          <p className="muted">{sheet.server?.scorer || 'Someone else'} is keeping score for this game. One person keeps score at a time; this page follows along.</p>
          <button type="button" className="btn primary" onClick={sheet.takeOver}>
            Take over keeping score
          </button>
        </div>
      ) : tab === 'score' ? (
        <ScorePad state={state} events={events} onChange={sheet.change} usName={usName} themName={themName} players={players} />
      ) : null}
      {(tab === 'box' || theirs) && <BoxScore events={events} players={players} usName={usName} themName={themName} state={state} />}
    </div>
  );
}
