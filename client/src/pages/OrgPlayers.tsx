// An organization's players for a season: who signed up, which division they are in, and which
// team they are on. Three screens, one job each: the list, putting players on teams, and the
// sign-up form parents fill in.
import { useEffect, useMemo, useState } from 'react';
import { api, GENDER_WORD, type OrgLeague, type OrgSignup, type OrgSignups, type OrgTeam, type SeedOptions, type SeedPlan, type SignupDraft } from '../api';
import { Field, Modal, MoreMenu, type MenuItem } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { Crumbs, PageHead, Pill, SubTabs, type Crumb } from '../components/cx';
import { CopyButton, type OrgPanelProps } from './OrgPanels';

type View = 'list' | 'teams' | 'form';
type Show = 'all' | 'waiting' | 'placed';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (at: string) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const divisionLabel = (l: OrgLeague) => [l.name, GENDER_WORD[l.gender]].filter(Boolean).join(' · ');

export function OrgPlayers({ c, org, act, fail, focus }: OrgPanelProps & { focus?: { view?: string; leagueId?: number } | null }) {
  const manage = org.can.leagues && !org.org.lapsed;
  /** The division this was opened for, when it was opened from one. */
  const from = org.leagues.find((l) => l.id === focus?.leagueId) ?? null;
  const [seasonId, setSeasonId] = useState(() => from?.season_id ?? (org.seasons.find((s) => !s.archived) ?? org.seasons[0])?.id ?? 0);
  const [sportId, setSportId] = useState(0);
  const [leagueId, setLeagueId] = useState(from?.id ?? 0);
  const [view, setView] = useState<View>(focus?.view === 'teams' ? 'teams' : focus?.view === 'form' ? 'form' : 'list');
  const [data, setData] = useState<OrgSignups | null>(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>(focus?.view === 'waiting' ? 'waiting' : 'all');
  const [picked, setPicked] = useState<number[]>([]);
  const [editing, setEditing] = useState<OrgSignup | 'new' | null>(null);
  const [several, setSeveral] = useState(false);
  const [placing, setPlacing] = useState<OrgSignup[] | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [drag, setDrag] = useState(0);

  const season = org.seasons.find((s) => s.id === seasonId) ?? null;
  useEffect(() => {
    setData(null);
    setPicked([]);
    if (seasonId) api.orgSignups(c.id, seasonId).then(setData).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, seasonId]);
  /** Runs a change to the players, and keeps both the list and the organization up to date. */
  const run = (fn: () => Promise<OrgSignups>, done?: string) =>
    act(async () => {
      const r = await fn();
      setData(r);
      return r.org;
    }, done);

  const leagues = useMemo(
    () => org.leagues.filter((l) => l.season_id === seasonId).sort((a, b) => a.sport.localeCompare(b.sport) || a.name.localeCompare(b.name, undefined, { numeric: true })),
    [org.leagues, seasonId],
  );
  const league = leagues.find((l) => l.id === leagueId) ?? null;
  const seasonSports = org.sports.filter((s) => s.season_id === seasonId);
  const sportOf = (l: OrgLeague) => seasonSports.find((s) => s.name.toLowerCase() === l.sport.toLowerCase()) ?? null;
  const sport = league ? sportOf(league) : (seasonSports.find((s) => s.id === sportId) ?? null);
  const inSport = sport ? leagues.filter((l) => l.sport.toLowerCase() === sport.name.toLowerCase()) : leagues;
  const teamsOf = (id: number | null) => org.teams.filter((t) => t.league_id === id).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const seasonTeams = org.teams.filter((t) => leagues.some((l) => l.id === t.league_id));
  const teamName = (id: number | null) => org.teams.find((t) => t.id === id)?.name ?? '';
  const leagueName = (id: number | null) => leagues.find((l) => l.id === id)?.name ?? '';

  const all = data?.signups ?? [];
  // -1 stands for the players who did not choose a division.
  const inDivision = leagueId === -1 ? all.filter((g) => !g.league_id) : league ? all.filter((g) => g.league_id === league.id) : sport ? all.filter((g) => inSport.some((l) => l.id === g.league_id)) : all;
  const noDivision = all.filter((g) => !g.league_id).length;
  const waiting = inDivision.filter((g) => !g.team_id);
  const term = q.trim().toLowerCase();
  const shown = inDivision.filter((g) => (show === 'all' || (show === 'waiting' ? !g.team_id : !!g.team_id)) && (!term || `${g.name} ${g.grade} ${g.parent_name} ${g.parent_email} ${g.parent2_name} ${g.parent2_email} ${teamName(g.team_id)}`.toLowerCase().includes(term)));
  const pickedRows = all.filter((g) => picked.includes(g.id));

  const crumbs: Crumb[] = [
    {
      label: 'Season',
      value: season ? `${season.name}${season.archived ? ' (archived)' : ''}` : '',
      options: org.seasons.map((s) => ({ id: s.id, label: s.name, note: s.archived ? 'Archived' : undefined })),
      current: season?.id ?? 0,
      onPick: (id) => {
        setSeasonId(id);
        setSportId(0);
        setLeagueId(0);
      },
    },
    ...(seasonSports.length
      ? [
          {
            label: 'Sport',
            value: sport?.name ?? 'All sports',
            options: seasonSports.map((s) => ({ id: s.id, label: s.name, note: plural(leagues.filter((l) => l.sport.toLowerCase() === s.name.toLowerCase()).length, 'division') })),
            current: sport?.id ?? 0,
            onPick: (id: number) => {
              setSportId(id);
              setLeagueId(0);
              setPicked([]);
            },
            all: `All sports in ${season?.name ?? 'the season'}`,
          },
        ]
      : []),
    {
      label: 'Division',
      value: leagueId === -1 ? 'No division chosen' : league ? divisionLabel(league) : 'All divisions',
      options: [
        ...inSport.map((l) => ({ id: l.id, label: divisionLabel(l), note: `${sport ? '' : `${l.sport} · `}${plural(all.filter((g) => g.league_id === l.id).length, 'player')}` })),
        ...(noDivision && !sport ? [{ id: -1, label: 'No division chosen', note: plural(noDivision, 'player') }] : []),
      ],
      current: leagueId,
      onPick: (id) => {
        const l = leagues.find((x) => x.id === id);
        if (l) setSportId(sportOf(l)?.id ?? 0);
        setLeagueId(id);
        setPicked([]);
      },
      all: `All divisions in ${sport?.name ?? season?.name ?? 'the season'}`,
    },
  ];

  if (!season)
    return (
      <>
        <PageHead eyebrow="Management / Players" title="Players" sub="Sign-ups, divisions and teams." />
        <div className="card">
          <p className="muted">Players sign up for a season. Start a season under "Seasons & teams" first.</p>
        </div>
      </>
    );

  const rowMenu = (g: OrgSignup): MenuItem[] => [
    { label: 'Edit', onSelect: () => setEditing(g) },
    { label: g.team_id ? 'Move to another team' : 'Put on a team', onSelect: () => setPlacing([g]) },
    ...(g.team_id ? [{ label: `Take off ${teamName(g.team_id)}`, onSelect: () => run(() => api.orgPlaceSignups(c.id, [g.id], 0), `${g.name} is off the team and waiting again.`) }] : []),
    {
      label: 'Remove from the season',
      danger: true,
      onSelect: async () => {
        if (await confirmDialog({ title: `Remove ${g.name}?`, body: `They come off ${season.name}${g.team_id ? ` and off ${teamName(g.team_id)}'s roster` : ''}. This cannot be undone.`, confirmLabel: 'Remove', danger: true }))
          run(() => api.orgDeleteSignup(c.id, g.id), `${g.name} was removed.`);
      },
    },
  ];
  /** On the board: where a player can go from where they are. */
  const moveMenu = (g: OrgSignup, teams: OrgTeam[]): MenuItem[] => [
    ...teams.filter((t) => t.id !== g.team_id).map((t) => ({ label: `${g.team_id ? 'Move to' : 'Put on'} ${t.name}`, onSelect: () => run(() => api.orgPlaceSignups(c.id, [g.id], t.id)) })),
    ...(g.team_id ? [{ label: 'Take off the team', danger: true, onSelect: () => run(() => api.orgPlaceSignups(c.id, [g.id], 0)) }] : []),
  ];
  const drop = (teamId: number) => {
    const g = all.find((x) => x.id === drag);
    setDrag(0);
    if (g && (g.team_id ?? 0) !== teamId) run(() => api.orgPlaceSignups(c.id, [g.id], teamId));
  };
  const boardTeams = league ? teamsOf(league.id) : [];
  const autos = league ? all.filter((g) => g.league_id === league.id && g.placed === 'auto').length : 0;
  const link = data?.season.code ? `${window.location.origin}/signup/${data.season.code}` : '';

  return (
    <>
      <PageHead eyebrow="Management / Players" title="Players" sub="Who signed up, which division they are in, and which team they are on." />
      <Crumbs items={crumbs} />
      <SubTabs<View>
        label="Players"
        value={view}
        onChange={setView}
        tabs={[
          ['list', 'Sign-ups', all.length],
          ['teams', 'Put on teams', all.filter((g) => !g.team_id).length],
          ['form', 'Sign-up form'],
        ]}
      />
      {!data && <p className="muted">Loading…</p>}

      {data && view === 'list' && (
        <section className="card cx-card">
          <div className="cx-filters pl-bar">
            <input className="input" placeholder="Search players" aria-label="Search players" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" aria-label="Which players" value={show} onChange={(e) => setShow(e.target.value as Show)}>
              <option value="all">Everyone ({inDivision.length})</option>
              <option value="waiting">Waiting for a team ({waiting.length})</option>
              <option value="placed">On a team ({inDivision.length - waiting.length})</option>
            </select>
            {manage && (
              <span className="pl-bar-end">
                <button type="button" className="btn" onClick={() => setSeveral(true)}>
                  Add several
                </button>
                <button type="button" className="btn primary" onClick={() => setEditing('new')}>
                  + Add player
                </button>
              </span>
            )}
          </div>
          {manage && picked.length > 0 && (
            <div className="pl-picked" role="status">
              <strong>{plural(picked.length, 'player')} chosen</strong>
              <button type="button" className="btn small" onClick={() => setPlacing(pickedRows)}>
                Put on a team
              </button>
              {pickedRows.some((g) => g.team_id) && (
                <button type="button" className="btn small" onClick={() => run(() => api.orgPlaceSignups(c.id, picked, 0), 'They are off their teams and waiting again.').then(() => setPicked([]))}>
                  Take off their teams
                </button>
              )}
              <button type="button" className="btn small ghost" onClick={() => setPicked([])}>
                Clear
              </button>
            </div>
          )}
          {shown.length === 0 ? (
            <p className="muted">
              {all.length === 0
                ? `Nobody has signed up for ${season.name} yet. Open the sign-up form for parents, or add players yourself.`
                : inDivision.length === 0
                  ? 'No players in this division yet.'
                  : 'No players match.'}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="table pl-table">
                <thead>
                  <tr>
                    {manage && (
                      <th className="pl-check">
                        <input type="checkbox" aria-label="Choose all shown" checked={shown.every((g) => picked.includes(g.id))} onChange={(e) => setPicked(e.target.checked ? shown.map((g) => g.id) : [])} />
                      </th>
                    )}
                    <th>Player</th>
                    <th>Division</th>
                    <th>Team</th>
                    {data.contacts && <th>Parent or guardian</th>}
                    <th>Signed up</th>
                    {manage && <th aria-label="More" />}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((g) => (
                    <tr key={g.id}>
                      {manage && (
                        <td className="pl-check">
                          <input type="checkbox" aria-label={`Choose ${g.name}`} checked={picked.includes(g.id)} onChange={(e) => setPicked((list) => (e.target.checked ? [...list, g.id] : list.filter((id) => id !== g.id)))} />
                        </td>
                      )}
                      <td>
                        <strong>{g.name}</strong>
                        {g.grade && <span className="muted small"> · {g.grade}</span>}
                        {g.notes && <div className="muted small pl-notes">{g.notes}</div>}
                      </td>
                      <td>{leagueName(g.league_id) || <span className="muted">Not chosen</span>}</td>
                      <td>
                        {g.team_id ? (
                          <>
                            {teamName(g.team_id)}
                            <span className="muted small"> · {g.placed === 'auto' ? 'automatic' : 'by hand'}</span>
                          </>
                        ) : (
                          <Pill tone="warn">Waiting</Pill>
                        )}
                      </td>
                      {data.contacts && (
                        <td>
                          {g.parent_name}
                          {(g.parent_email || g.parent_phone) && <div className="muted small">{[g.parent_email, g.parent_phone].filter(Boolean).join(' · ')}</div>}
                          {(g.parent2_name || g.parent2_email || g.parent2_phone) && (
                            <div className="pl-second-parent">
                              {g.parent2_name}
                              <div className="muted small">{[g.parent2_email, g.parent2_phone].filter(Boolean).join(' · ')}</div>
                            </div>
                          )}
                        </td>
                      )}
                      <td className="muted small">
                        {day(g.created_at)} · {g.source === 'form' ? 'form' : 'added'}
                      </td>
                      {manage && (
                        <td className="pl-more">
                          <MoreMenu items={rowMenu(g)} label={`More for ${g.name}`} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data && view === 'teams' && !league && (
        <div className="card">
          <p className="muted">{leagues.length ? 'Choose a division above to put its players on teams.' : `${season.name} has no divisions yet. Add them under "Seasons & teams".`}</p>
          {noDivision > 0 && <p className="muted small">{plural(noDivision, 'player')} did not choose a division. Give them one from the list of sign-ups first.</p>}
        </div>
      )}
      {data && view === 'teams' && league && (
        <>
          <div className="pl-board-bar">
            <p className="muted small">
              {plural(waiting.length, 'player')} waiting · {plural(boardTeams.length, 'team')}. {manage && 'Drag a player to a team, or use the "…" beside them.'}
            </p>
            {manage && (
              <span className="pl-bar-end">
                {autos > 0 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      if (await confirmDialog({ title: 'Undo the automatic placing?', body: `${plural(autos, 'player')} placed automatically ${autos === 1 ? 'goes' : 'go'} back to waiting. Players you placed by hand stay on their teams.`, confirmLabel: 'Undo' }))
                        run(() => api.orgUnseed(c.id, league.id), 'The automatic placing was undone.');
                    }}
                  >
                    Undo automatic placing
                  </button>
                )}
                <button type="button" className="btn primary" disabled={boardTeams.length === 0 || (waiting.length === 0 && autos === 0)} onClick={() => setSeeding(true)}>
                  Place automatically
                </button>
              </span>
            )}
          </div>
          {boardTeams.length === 0 && (
            <div className="card">
              <p className="muted">{league.name} has no teams yet. Add its teams under "Seasons & teams", then come back to fill them.</p>
            </div>
          )}
          <div className="pl-board">
            {[null, ...boardTeams].map((t) => {
              const kids = t ? inDivision.filter((g) => g.team_id === t.id) : waiting;
              const others = t ? (data.others[t.id] ?? 0) : 0;
              return (
                <section
                  key={t?.id ?? 0}
                  className={`card pl-col ${t ? '' : 'waiting'} ${drag ? 'droppable' : ''}`}
                  aria-label={t ? t.name : 'Waiting for a team'}
                  onDragOver={(e) => drag && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(t?.id ?? 0);
                  }}
                >
                  <header>
                    <h3>{t ? t.name : 'Waiting for a team'}</h3>
                    <span className="pl-count">{kids.length + others}</span>
                  </header>
                  {kids.length === 0 && <p className="muted small">{t ? 'Nobody yet.' : 'Everyone in this division is on a team.'}</p>}
                  <ul>
                    {kids.map((g) => (
                      <li key={g.id} draggable={manage} onDragStart={() => setDrag(g.id)} onDragEnd={() => setDrag(0)}>
                        <span className="pl-kid">
                          {g.name}
                          {g.grade && <span className="muted small"> · {g.grade}</span>}
                        </span>
                        {g.placed === 'manual' && (
                          <span className="pl-hand" title="Placed by hand. Automatic placing leaves this player where they are.">
                            by hand
                          </span>
                        )}
                        {manage && <MoreMenu items={moveMenu(g, boardTeams)} label={`Move ${g.name}`} />}
                      </li>
                    ))}
                  </ul>
                  {others > 0 && <p className="muted small">+ {plural(others, 'player')} the coach added to the roster.</p>}
                </section>
              );
            })}
          </div>
        </>
      )}

      {data && view === 'form' && (
        <section className="card cx-card pl-form">
          <h2>Sign-up form for {season.name}</h2>
          <p className="muted">
            A page parents open from a link, without an account. It asks for the player's name, their age or grade, the division they want, and a parent's name, email address and phone number. Each one sent lands in the list of sign-ups.
          </p>
          <div className="pl-form-row">
            <div className="seg" role="group" aria-label="Sign-ups">
              <button type="button" className={data.season.open ? 'on' : ''} aria-pressed={data.season.open} disabled={!manage || season.archived} onClick={() => !data.season.open && run(() => api.orgOpenSignups(c.id, season.id, true))}>
                Open
              </button>
              <button type="button" className={data.season.open ? '' : 'on'} aria-pressed={!data.season.open} disabled={!manage} onClick={() => data.season.open && run(() => api.orgOpenSignups(c.id, season.id, false))}>
                Closed
              </button>
            </div>
            <span className="muted small">{data.season.open ? 'Anyone with the link can sign a player up.' : link ? 'The link shows that sign-ups are closed.' : 'Open it to get a link to send to parents.'}</span>
          </div>
          {season.archived && <p className="muted small">This season is archived, so its form stays closed.</p>}
          {link && (
            <div className="res-share-link">
              <input className="input" readOnly aria-label="Link to the sign-up form" value={link} onFocus={(e) => e.target.select()} />
              <CopyButton text={link} label="Copy link" />
              <a className="btn small" href={link} target="_blank" rel="noopener noreferrer">
                Open
              </a>
            </div>
          )}
          <p className="muted small">
            {plural(all.filter((g) => g.source === 'form').length, 'player')} signed up through the form so far.
            {!data.contacts && ' Parents’ contact details are shown only to admins who may see rosters.'}
          </p>
        </section>
      )}

      {editing && data && (
        <PlayerModal
          player={editing === 'new' ? null : editing}
          leagues={leagues}
          leagueId={leagueId > 0 ? leagueId : null}
          contacts={data.contacts}
          onClose={() => setEditing(null)}
          save={async (b) => {
            const ok = editing === 'new' ? await run(() => api.orgAddSignup(c.id, season.id, b), `${b.name} was added.`) : await run(() => api.orgUpdateSignup(c.id, editing.id, b));
            if (ok) setEditing(null);
          }}
        />
      )}
      {several && (
        <SeveralModal
          leagues={leagues}
          leagueId={leagueId > 0 ? leagueId : null}
          onClose={() => setSeveral(false)}
          save={async (names, id) => {
            if (await run(() => api.orgAddSignup(c.id, season.id, { names, league_id: id }), 'The players were added.')) setSeveral(false);
          }}
        />
      )}
      {placing && (
        <PlaceModal
          players={placing}
          leagues={leagues}
          teams={seasonTeams}
          onClose={() => setPlacing(null)}
          save={async (teamId) => {
            if (await run(() => api.orgPlaceSignups(c.id, placing.map((g) => g.id), teamId), `${placing.length === 1 ? placing[0].name : plural(placing.length, 'player')} ${placing.length === 1 ? 'is' : 'are'} on ${teamName(teamId)}.`)) {
              setPlacing(null);
              setPicked([]);
            }
          }}
        />
      )}
      {seeding && league && (
        <SeedModal
          league={league}
          teams={boardTeams.length}
          total={inDivision.length + boardTeams.reduce((n, t) => n + (data?.others[t.id] ?? 0), 0)}
          autos={autos}
          preview={(b) => api.orgSeedPreview(c.id, league.id, b).then((r) => r.plan)}
          fail={fail}
          onClose={() => setSeeding(false)}
          save={async (b, n) => {
            if (await run(() => api.orgSeed(c.id, league.id, b), `${plural(n, 'player')} ${n === 1 ? 'was' : 'were'} placed on teams.`)) setSeeding(false);
          }}
        />
      )}
    </>
  );
}

function DivisionSelect({ leagues, value, onChange, none }: { leagues: OrgLeague[]; value: number | null; onChange: (id: number | null) => void; none: string }) {
  return (
    <select className="input" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value) || null)}>
      <option value={0}>{none}</option>
      {leagues.map((l) => (
        <option key={l.id} value={l.id}>
          {[l.sport, divisionLabel(l)].join(' · ')}
        </option>
      ))}
    </select>
  );
}

function PlayerModal({ player, leagues, leagueId, contacts, save, onClose }: { player: OrgSignup | null; leagues: OrgLeague[]; leagueId: number | null; contacts: boolean; save: (b: SignupDraft) => Promise<void>; onClose: () => void }) {
  const [b, setB] = useState<SignupDraft>({
    name: player?.name ?? '', grade: player?.grade ?? '', parent_name: player?.parent_name ?? '', parent_email: player?.parent_email ?? '', parent_phone: player?.parent_phone ?? '', notes: player?.notes ?? '',
    parent2_name: player?.parent2_name ?? '', parent2_email: player?.parent2_email ?? '', parent2_phone: player?.parent2_phone ?? '',
    league_id: player ? player.league_id : leagueId,
  });
  const set = (k: keyof SignupDraft) => (e: { target: { value: string } }) => setB((old) => ({ ...old, [k]: e.target.value }));
  const [second, setSecond] = useState(!!(player?.parent2_name || player?.parent2_email || player?.parent2_phone));
  const moving = !!player?.team_id && b.league_id !== player.league_id;
  return (
    <Modal title={player ? `Edit ${player.name}` : 'Add a player'} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={(e) => {
          e.preventDefault();
          save(b);
        }}
      >
        <Field label="Player's name">
          <input className="input" required autoFocus maxLength={80} value={b.name} onChange={set('name')} />
        </Field>
        <Field label="Age or grade (optional)">
          <input className="input" maxLength={40} value={b.grade} onChange={set('grade')} placeholder="5th grade" />
        </Field>
        <Field label="Division">
          <DivisionSelect leagues={leagues} value={b.league_id} onChange={(id) => setB((old) => ({ ...old, league_id: id }))} none="Not chosen yet" />
        </Field>
        {moving && <p className="muted small">Changing the division takes {player?.name} off their team, since it plays in the old one.</p>}
        {contacts && (
          <>
            <Field label="Parent or guardian (optional)">
              <input className="input" maxLength={80} value={b.parent_name} onChange={set('parent_name')} />
            </Field>
            <Field label="Their email address (optional)">
              <input className="input" type="email" maxLength={200} value={b.parent_email} onChange={set('parent_email')} />
            </Field>
            <Field label="Their phone number (optional)">
              <input className="input" type="tel" maxLength={40} value={b.parent_phone} onChange={set('parent_phone')} />
            </Field>
            {second ? (
              <>
                <Field label="Second parent or guardian (optional)">
                  <input className="input" maxLength={80} value={b.parent2_name} onChange={set('parent2_name')} />
                </Field>
                <Field label="Their email address (optional)">
                  <input className="input" type="email" maxLength={200} value={b.parent2_email} onChange={set('parent2_email')} />
                </Field>
                <Field label="Their phone number (optional)">
                  <input className="input" type="tel" maxLength={40} value={b.parent2_phone} onChange={set('parent2_phone')} />
                </Field>
              </>
            ) : (
              <button type="button" className="link small pl-second" onClick={() => setSecond(true)}>
                + Add a second parent or guardian
              </button>
            )}
            <Field label="Notes (optional)">
              <textarea className="input" rows={2} maxLength={1000} value={b.notes} onChange={set('notes')} />
            </Field>
          </>
        )}
        <div className="modal-actions">
          <button className="btn primary">{player ? 'Save' : 'Add player'}</button>
        </div>
      </form>
    </Modal>
  );
}

function SeveralModal({ leagues, leagueId, save, onClose }: { leagues: OrgLeague[]; leagueId: number | null; save: (names: string, leagueId: number | null) => Promise<void>; onClose: () => void }) {
  const [names, setNames] = useState('');
  const [id, setId] = useState(leagueId);
  const count = names.split('\n').filter((n) => n.trim()).length;
  return (
    <Modal title="Add several players" onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={(e) => {
          e.preventDefault();
          save(names, id);
        }}
      >
        <Field label="Division">
          <DivisionSelect leagues={leagues} value={id} onChange={setId} none="Not chosen yet" />
        </Field>
        <Field label="Names, one on each line">
          <textarea className="input" required autoFocus rows={8} value={names} onChange={(e) => setNames(e.target.value)} placeholder={'Sam Rivera\nJo Park'} />
        </Field>
        <p className="muted small">Paste a column from a spreadsheet. Their other details can be filled in afterwards.</p>
        <div className="modal-actions">
          <button className="btn primary" disabled={!count}>
            {count ? `Add ${plural(count, 'player')}` : 'Add players'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Choosing the team for one player or several. A player with a division is offered that division's teams. */
function PlaceModal({ players, leagues, teams, save, onClose }: { players: OrgSignup[]; leagues: OrgLeague[]; teams: OrgTeam[]; save: (teamId: number) => Promise<void>; onClose: () => void }) {
  const [teamId, setTeamId] = useState(0);
  const divisions = [...new Set(players.map((g) => g.league_id))];
  const only = divisions.length === 1 && divisions[0] ? divisions[0] : null;
  const offered = leagues.filter((l) => !only || l.id === only);
  const who = players.length === 1 ? players[0].name : plural(players.length, 'player');
  const chosen = teams.find((t) => t.id === teamId);
  const crossing = !!chosen && players.some((g) => g.league_id && g.league_id !== chosen.league_id);
  return (
    <Modal title={`Put ${who} on a team`} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (teamId) save(teamId);
        }}
      >
        <Field label="Team">
          <select className="input" required autoFocus value={teamId || ''} onChange={(e) => setTeamId(Number(e.target.value))}>
            <option value="">Choose a team</option>
            {offered.map((l) => (
              <optgroup key={l.id} label={[l.sport, divisionLabel(l)].join(' · ')}>
                {teams
                  .filter((t) => t.league_id === l.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.players})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {crossing && <p className="muted small">That team is in another division, so the division changes with it.</p>}
        <p className="muted small">They go on the team's roster, where its coach sees them. Placed by hand, they are left where they are by any automatic placing later.</p>
        <div className="modal-actions">
          <button className="btn primary" disabled={!teamId}>
            Put on the team
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Dealing a division's waiting players out to its teams, with what it would do shown before it is done. */
function SeedModal({ league, teams, total, autos, preview, save, fail, onClose }: { league: OrgLeague; teams: number; total: number; autos: number; preview: (b: SeedOptions) => Promise<SeedPlan>; save: (b: SeedOptions, placed: number) => Promise<void>; fail: (e: unknown) => void; onClose: () => void }) {
  const [ideal, setIdeal] = useState(String(Math.max(1, Math.ceil(total / Math.max(1, teams)))));
  const [extras, setExtras] = useState<'spread' | 'wait'>('spread');
  const [redo, setRedo] = useState(false);
  const [plan, setPlan] = useState<SeedPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Math.floor(Number(ideal));
  const valid = n >= 1 && n <= 99;
  useEffect(() => {
    if (!valid) return setPlan(null);
    let live = true;
    const wait = window.setTimeout(() => preview({ ideal: n, extras, redo }).then((p) => live && setPlan(p), fail), 250);
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, extras, redo]);
  return (
    <Modal title={`Place ${league.name} players automatically`} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || !plan) return;
          setBusy(true);
          await save({ ideal: n, extras, redo }, plan.placed);
          setBusy(false);
        }}
      >
        <p className="muted small">Waiting players are dealt out at random, each to the team with the fewest players. Players already on a team stay there and count toward its size.</p>
        <Field label="Ideal number of players on a team">
          <input className="input pl-ideal" type="number" inputMode="numeric" min={1} max={99} required autoFocus value={ideal} onChange={(e) => setIdeal(e.target.value)} />
        </Field>
        <Field label="When every team has that many">
          <div className="seg" role="group" aria-label="When every team is full">
            <button type="button" className={extras === 'spread' ? 'on' : ''} aria-pressed={extras === 'spread'} onClick={() => setExtras('spread')}>
              Share the rest out evenly
            </button>
            <button type="button" className={extras === 'wait' ? 'on' : ''} aria-pressed={extras === 'wait'} onClick={() => setExtras('wait')}>
              Leave the rest waiting
            </button>
          </div>
        </Field>
        {autos > 0 && (
          <label className="check">
            <input type="checkbox" checked={redo} onChange={(e) => setRedo(e.target.checked)} /> Also deal again the {plural(autos, 'player')} placed automatically before
          </label>
        )}
        {plan && (
          <>
            <table className="table pl-plan">
              <thead>
                <tr>
                  <th>Team</th>
                  <th className="num">Now</th>
                  <th className="num">After</th>
                </tr>
              </thead>
              <tbody>
                {plan.teams.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="num">{t.before}</td>
                    <td className="num">
                      <strong>{t.after}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              {plan.pool === 0 ? 'Nobody is waiting, so there is nothing to place.' : `${plural(plan.placed, 'player')} placed${plan.waiting ? `, ${plan.waiting} left waiting` : ''}.`}
              {plan.teams_short > 0 && ` To keep to ${n} a team, ${league.name} needs ${plural(plan.teams_short, 'more team')}.`}
            </p>
          </>
        )}
        <div className="modal-actions">
          <button className="btn primary" disabled={busy || !valid || !plan || plan.placed === 0}>
            {busy ? 'Placing…' : plan?.placed ? `Place ${plural(plan.placed, 'player')}` : 'Place players'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
