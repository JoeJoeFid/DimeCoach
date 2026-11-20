// Stats. For a team: its season from the games that were scored, and each of those games.
// For one person: the sheets they keep for a single player ("My stats"), which are theirs alone
// and never part of the team's numbers unless they choose to show one to the coaches.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type TrackTeam } from '../api';
import { useApp } from '../App';
import PageTitle from '../components/PageTitle';
import { SubTabs } from '../components/cx';
import { confirmDialog } from '../components/dialogs';
import ScorePad, { LineText, StatTable } from '../components/ScorePad';
import StatCharts from '../components/StatCharts';
import { emptyLine, linesOf, sumLines, type Scoresheet, type StatLine } from '../scoring';
import { fmtDateShort, todayISO } from '../util';
import { SyncNote, useSheet } from './ScoreGame';

/** One sheet being kept: the buttons, the line so far, and sharing it with the coaches. */
function Tracker({ sheet, onBack, onList }: { sheet: Scoresheet; onBack: () => void; onList: (list: { teams: TrackTeam[]; sheets: Scoresheet[] }) => void }) {
  const [shared, setShared] = useState(sheet.shared);
  const [error, setError] = useState('');
  const kept = useSheet(
    `dime.score.track.${sheet.id}`,
    () => Promise.resolve(sheet),
    async (state, events) => ({ status: 200, sheet: (await api.saveTrack(sheet.id, { state, events })).sheet }),
    () => sheet.state,
  );
  const share = async (on: boolean) => {
    try {
      onList(await api.shareTrack(sheet.id, on));
      setShared(on);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!kept.doc) return <p className="muted">Loading…</p>;
  return (
    <div className="track">
      <div className="score-head">
        <button type="button" className="link small" onClick={onBack}>
          ← All sheets
        </button>
        <span className="sp-grow" />
        <SyncNote sync={kept.sync} />
      </div>
      <div className="track-head">
        <h2>{sheet.player_name}</h2>
        <span className="muted">{[sheet.title, fmtDateShort(sheet.date), sheet.team].filter(Boolean).join(' · ')}</span>
      </div>
      <ScorePad state={kept.doc.state} events={kept.doc.events} onChange={kept.change} usName={sheet.player_name} themName="" players={[]} solo={sheet.player_name} />
      {sheet.team_id && (
        <div className="card track-share">
          <label className="check setting">
            <input type="checkbox" checked={shared} onChange={(e) => share(e.target.checked)} />
            <span>
              <strong>Share this sheet with the coaches of {sheet.team || 'the team'}</strong>
              <span className="muted small">They can see it beside the team's stats. It stays yours, it is never added into the team's numbers, and you can stop sharing at any time.</span>
            </span>
          </label>
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** The sheets one person keeps for single players, and starting a new one. */
export function MyStats() {
  const [data, setData] = useState<{ teams: TrackTeam[]; sheets: Scoresheet[] } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [teamId, setTeamId] = useState(0);
  const [playerId, setPlayerId] = useState(0);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const failed = (e: unknown) => setError((e as Error).message);
  const load = () => api.tracks().then(setData, failed);
  useEffect(() => {
    load();
  }, []);
  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const current = data.sheets.find((s) => s.id === open);
  if (current) return <Tracker key={current.id} sheet={current} onBack={() => (setOpen(null), load())} onList={setData} />;

  const team = data.teams.find((t) => t.id === teamId);
  const start = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.addTrack({ team_id: teamId || undefined, player_id: playerId || undefined, player_name: name, title, date });
      setData(r);
      setAdding(false);
      setName('');
      setTitle('');
      setPlayerId(0);
      setOpen(r.id);
    } catch (err) {
      failed(err);
    }
  };
  const remove = async (s: Scoresheet) => {
    if (!(await confirmDialog({ title: 'Delete this sheet?', body: `${s.player_name}, ${fmtDateShort(s.date)}. Its stats are gone for good.`, confirmLabel: 'Delete', danger: true }))) return;
    api.deleteTrack(s.id).then(setData, failed);
  };
  // Everything kept for the same player, added up.
  const byPlayer = new Map<string, { name: string; lines: StatLine[] }>();
  for (const s of data.sheets) {
    const key = s.player_id ? `p${s.player_id}` : `n${s.player_name.toLowerCase()}`;
    if (!byPlayer.has(key)) byPlayer.set(key, { name: s.player_name, lines: [] });
    byPlayer.get(key)!.lines.push(linesOf(s.events, 'us').total);
  }
  return (
    <div className="my-stats">
      <div className="inbox-bar">
        <p className="muted my-stats-about">Stats you keep for one player. They are yours: they are not part of any team's stats unless you share a sheet with its coaches.</p>
        <span className="inbox-space" />
        <button type="button" className="btn primary" onClick={() => setAdding(!adding)}>
          {adding ? 'Close' : '+ Track a player'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {adding && (
        <form className="card fields track-new" onSubmit={start}>
          {data.teams.length > 0 && (
            <label className="field">
              <span className="field-label">Team</span>
              <select className="input" value={teamId} onChange={(e) => (setTeamId(Number(e.target.value)), setPlayerId(0))}>
                <option value={0}>No team</option>
                {data.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {team && team.players.length > 0 && (
            <label className="field">
              <span className="field-label">Player</span>
              <select className="input" value={playerId} onChange={(e) => setPlayerId(Number(e.target.value))}>
                <option value={0}>Someone else…</option>
                {team.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number ? `#${p.number} ` : ''}
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!playerId && (
            <label className="field grow">
              <span className="field-label">Player's name</span>
              <input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="field grow">
            <span className="field-label">Game</span>
            <input className="input" maxLength={120} placeholder="vs. Tigers" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button className="btn primary" disabled={!playerId && !name.trim()}>
            Start
          </button>
        </form>
      )}
      {data.sheets.length === 0 ? (
        <div className="empty">
          <h2>No sheets yet</h2>
          <p>Press "Track a player" at a game to keep one player's points, rebounds, assists and the rest.</p>
        </div>
      ) : (
        <>
          <div className="card">
            <h2>Totals</h2>
            <StatTable rows={[...byPlayer.entries()].map(([key, p]) => ({ key, name: p.name, line: sumLines(p.lines), extra: p.lines.length }))} extra="Games" />
          </div>
          <div className="card">
            <h2>Sheets</h2>
            <ul className="track-list">
              {data.sheets.map((s) => (
                <li key={s.id}>
                  <button type="button" className="track-row" onClick={() => setOpen(s.id)}>
                    <strong>{s.player_name}</strong>
                    <span className="muted small">
                      {[s.title, fmtDateShort(s.date), s.team].filter(Boolean).join(' · ')}
                      {s.shared && ' · shared with the coaches'}
                    </span>
                    <LineText line={linesOf(s.events, 'us').total} />
                  </button>
                  <button type="button" className="link small" onClick={() => remove(s)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

type View = 'season' | 'games' | 'mine' | 'shared';
/** A coach's Stats page. */
export default function Stats() {
  const app = useApp();
  const team = app.team;
  const [view, setView] = useState<View>('season');
  const [data, setData] = useState<{ games: Scoresheet[]; shared: Scoresheet[] } | null>(null);
  const [players, setPlayers] = useState<{ id: number; name: string; number: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!team) return;
    setData(null);
    api.teamScores(team.id).then(setData, (e) => setError((e as Error).message));
    api.players(team.id).then(setPlayers, () => {});
  }, [team?.id]);
  // The games left out of the season's numbers and charts. Everything is in until it is taken out.
  const [out, setOut] = useState<Set<number>>(new Set());
  const [show, setShow] = useState<'table' | 'charts'>('table');
  const [average, setAverage] = useState(false);
  const picked = (data?.games ?? []).filter((g) => !out.has(g.id));
  // The season: every picked game added up for each player, with how many games they have a stat in.
  const season = new Map<number, { games: number; line: StatLine }>();
  const teamLines: StatLine[] = [];
  for (const g of picked) {
    const l = linesOf(g.events, 'us');
    teamLines.push(l.total);
    for (const [id, line] of l.players) {
      const had = season.get(id) ?? { games: 0, line: emptyLine() };
      season.set(id, { games: had.games + 1, line: sumLines([had.line, line]) });
    }
  }
  const nameOf = (id: number) => {
    const p = players.find((x) => x.id === id);
    return p ? `${p.number ? `#${p.number} ` : ''}${p.name}` : 'Former player';
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle>Stats</PageTitle>
          <p className="muted">The team's numbers from the games you score, and the sheets kept for single players.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <SubTabs<View>
        label="Stats"
        value={view}
        onChange={setView}
        tabs={[
          ['season', 'Season'],
          ['games', 'Games', data?.games.length],
          ['mine', 'My stats'],
          ['shared', 'From parents', data?.shared.length],
        ]}
      />
      {view === 'mine' ? (
        <MyStats />
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : view === 'season' ? (
        data.games.length === 0 ? (
          <div className="empty">
            <h2>No games scored yet</h2>
            <p>Open a game on the Schedule and press "Score this game". Its stats add up here.</p>
          </div>
        ) : (
          <>
            <div className="card st-pick">
              <div className="st-pick-head">
                <strong>
                  Games <span className="muted small">{picked.length} of {data.games.length} chosen</span>
                </strong>
                <span className="st-pick-all">
                  <button type="button" className="link small" disabled={out.size === 0} onClick={() => setOut(new Set())}>
                    All
                  </button>
                  <button type="button" className="link small" disabled={picked.length === 0} onClick={() => setOut(new Set(data.games.map((g) => g.id)))}>
                    None
                  </button>
                </span>
              </div>
              <div className="st-games" role="group" aria-label="Games to count">
                {[...data.games]
                  .sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id)
                  .map((g) => {
                    const on = !out.has(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        className={`chip toggle ${on ? 'on' : ''}`}
                        aria-pressed={on}
                        onClick={() => {
                          const next = new Set(out);
                          if (on) next.add(g.id);
                          else next.delete(g.id);
                          setOut(next);
                        }}
                      >
                        {fmtDateShort(g.date)} · {g.opponent ? `vs. ${g.opponent}` : g.title || 'Game'}{' '}
                        <span className="chip-num">
                          {g.us}–{g.them}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
            <div className="st-show">
              <div className="seg" role="group" aria-label="Table or charts">
                <button type="button" className={show === 'table' ? 'on' : ''} aria-pressed={show === 'table'} onClick={() => setShow('table')}>
                  Table
                </button>
                <button type="button" className={show === 'charts' ? 'on' : ''} aria-pressed={show === 'charts'} onClick={() => setShow('charts')}>
                  Game by game
                </button>
              </div>
              {show === 'table' && (
                <div className="seg" role="group" aria-label="Totals or averages">
                  <button type="button" className={!average ? 'on' : ''} aria-pressed={!average} onClick={() => setAverage(false)}>
                    Totals
                  </button>
                  <button type="button" className={average ? 'on' : ''} aria-pressed={average} onClick={() => setAverage(true)}>
                    Averages
                  </button>
                </div>
              )}
            </div>
            {picked.length === 0 ? (
              <p className="muted">Choose at least one game above.</p>
            ) : show === 'table' ? (
              <div className="card">
                <h2>
                  {average ? 'Averages per game' : 'Totals'} <span className="muted small">{picked.length} {picked.length === 1 ? 'game' : 'games'} · press a heading to sort</span>
                </h2>
                {season.size === 0 && <p className="muted small">These games have a score and nothing per player.</p>}
                {average && <p className="muted small">Each player's numbers are divided by the games they have a stat in. Shooting is the share that went in.</p>}
                <StatTable sortable average={average} rows={[...season.entries()].map(([id, s]) => ({ key: id, name: nameOf(id), line: s.line, extra: s.games })).sort((a, b) => b.line.pts - a.line.pts)} total={{ name: 'Team', line: sumLines(teamLines), games: picked.length }} extra="Games" />
              </div>
            ) : (
              <div className="card">
                <StatCharts games={picked} nameOf={nameOf} teamName={team?.name ?? 'Team'} />
              </div>
            )}
          </>
        )
      ) : view === 'games' ? (
        data.games.length === 0 ? (
          <p className="muted">No games scored yet.</p>
        ) : (
          <div className="card">
            <ul className="track-list">
              {data.games.map((g) => (
                <li key={g.id}>
                  <Link className="track-row" to={`/plans/${g.plan_id}?view=score`}>
                    <strong>
                      {g.opponent ? `vs. ${g.opponent}` : g.title || 'Game'} · {g.us}–{g.them}
                    </strong>
                    <span className="muted small">
                      {fmtDateShort(g.date)} · {g.status === 'final' ? 'Final' : 'Not finished'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : data.shared.length === 0 ? (
        <p className="muted">Nothing shared yet. When a parent keeps stats for their own player and shares the sheet, it shows here. It is never added into the team's numbers.</p>
      ) : (
        <div className="card">
          <h2>Shared by parents and coaches</h2>
          <p className="muted small">Kept by one person for one player. These stand beside the team's stats and are not added into them.</p>
          <StatTable first="Player and game" rows={data.shared.map((s) => ({ key: s.id, name: `${s.player_name} · ${[s.title, fmtDateShort(s.date)].filter(Boolean).join(', ')} · by ${s.by}`, line: linesOf(s.events, 'us').total }))} />
        </div>
      )}
    </div>
  );
}
