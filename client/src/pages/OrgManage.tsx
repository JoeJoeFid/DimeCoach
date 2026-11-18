// The management side of an organization, as its managers see it: what needs attention, every
// game in one schedule, and how the organization is using Dime Coach.
import { useEffect, useState } from 'react';
import { api, type OrgGame, type OrgGames, type OrgLeague, type OrgUsage as Usage } from '../api';
import { fmtClock, fmtDateShort, parseClock, todayISO } from '../util';
import { Modal } from '../components/bits';
import { Alert, Badge, PageHead, Pill, Row, Stat } from '../components/cx';
import { GameModal, type OrgPanelProps } from './OrgPanels';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clock = (t: string) => (t ? fmtClock(parseClock(t)) : 'Time not set');
const longDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** Where a manager can be sent from the overview. */
export type ManageGo = (tab: 'seasons' | 'schedule' | 'coaches' | 'announcements', focus?: { leagueId?: number; view?: 'coaches' | 'invites' | 'requirements' }) => void;

/** The first thing a manager sees: what needs fixing, each with the way to fix it, and the common jobs. */
export function ManageOverview({ c, org, fail, go }: OrgPanelProps & { go: ManageGo }) {
  const [games, setGames] = useState<OrgGames | null>(null);
  useEffect(() => {
    api.orgGames(c.id).then(setGames).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const season = org.seasons.find((s) => !s.archived) ?? null;
  const leagues = season ? org.leagues.filter((l) => l.season_id === season.id) : [];
  const teams = org.teams.filter((t) => leagues.some((l) => l.id === t.league_id));
  const today = todayISO();
  const noHead = teams.filter((t) => !t.coaches.some((s) => s.head));
  const clashes = (games?.games ?? []).filter((g) => g.date >= today && g.status === 'scheduled' && g.warnings.length > 0);
  const unchecked = org.people.filter((p) => p.coach && p.compliance.some((x) => x.state === 'missing' || x.state === 'expired'));
  const left = Math.max(0, org.org.seats - org.org.seats_used);
  const issues = (noHead.length ? 1 : 0) + (clashes.length ? 1 : 0) + (unchecked.length ? 1 : 0) + (org.invites.length ? 1 : 0);
  const leagueName = (id: number | null) => org.leagues.find((l) => l.id === id)?.name ?? '';

  return (
    <>
      <PageHead eyebrow="Management / Overview" title={`Run ${c.name}`} sub={season ? `${season.name} · your organization at a glance` : 'Your organization at a glance'} />
      <div className="cx-stats">
        <Stat value={issues} label={issues === 1 ? 'Thing to fix' : 'Things to fix'} note={issues ? 'Needs your attention' : 'Nothing needs fixing'} warn={issues > 0} />
        <Stat value={`${org.org.seats_used} / ${org.org.seats}`} label="Coach seats used" note={`${plural(left, 'seat')} available`} warn={left === 0} onClick={org.can.people ? () => go('coaches') : undefined} />
        <Stat value={leagues.length} label={season ? `${leagues.length === 1 ? 'Division' : 'Divisions'} this season` : 'Divisions'} note={`${plural(teams.length, 'team')} in all`} onClick={() => go('seasons')} />
      </div>
      <div className="cx-cols">
        <section className="card cx-card">
          <h2>Needs attention</h2>
          {issues === 0 && <p className="muted">Nothing right now. Every team has a head coach, no place is booked twice, and nobody is waiting on you.</p>}
          <div className="cx-alerts">
            {noHead.length > 0 && (
              <Alert
                title={`${plural(noHead.length, 'team')} ${noHead.length === 1 ? 'needs' : 'need'} a head coach`}
                sub={noHead
                  .slice(0, 3)
                  .map((t) => `${leagueName(t.league_id)} ${t.name}`)
                  .join(' · ') + (noHead.length > 3 ? ` · and ${noHead.length - 3} more` : '')}
                action={org.can.leagues ? 'Assign coaches' : undefined}
                onAction={() => go('seasons', { leagueId: noHead[0].league_id ?? undefined })}
              />
            )}
            {clashes.length > 0 && (
              <Alert
                title={`Booked twice on ${fmtDateShort(clashes[0].date)}${clashes[0].start_time ? ` at ${clock(clashes[0].start_time)}` : ''}`}
                sub={clashes[0].warnings[0] + (clashes.length > 1 ? ` · and ${plural(clashes.length - 1, 'other game')}` : '')}
                action="Fix booking"
                onAction={() => go('schedule')}
              />
            )}
            {unchecked.length > 0 && (
              <Alert
                title={`${plural(unchecked.length, 'coach', 'coaches')} ${unchecked.length === 1 ? 'has' : 'have'} missing checks`}
                sub={unchecked
                  .slice(0, 3)
                  .map((p) => p.name)
                  .join(' · ') + (unchecked.length > 3 ? ` · and ${unchecked.length - 3} more` : '')}
                action="Review coaches"
                onAction={() => go('coaches', { view: 'requirements' })}
              />
            )}
            {org.invites.length > 0 && (
              <Alert
                title={`${plural(org.invites.length, 'invitation')} ${org.invites.length === 1 ? 'is' : 'are'} waiting`}
                sub={org.invites.some((i) => i.expired) ? 'Sent, but not accepted. Some have run out and can be sent again.' : 'Sent, but not accepted yet'}
                action="View invitations"
                onAction={() => go('coaches', { view: 'invites' })}
              />
            )}
          </div>
        </section>
        <section className="card cx-card">
          <h2>Quick jobs</h2>
          <ul className="cx-rows">
            {org.can.leagues && <Row title={season ? 'Add divisions and teams' : 'Set up a season'} sub={season ? `In ${season.name}` : 'Then add its divisions and teams'} onClick={() => go('seasons')} />}
            {org.can.leagues && leagues.length > 0 && <Row title="Build a game schedule" sub="A round robin, or one game at a time" onClick={() => go('seasons', { leagueId: leagues[0].id })} />}
            {org.can.people && <Row title="Invite coaches" sub={`${plural(left, 'seat')} available`} onClick={() => go('coaches', { view: 'invites' })} />}
            {org.can.announce && <Row title="Send an announcement" sub="To everyone, or to one sport, division or team" onClick={() => go('announcements')} />}
          </ul>
        </section>
      </div>
    </>
  );
}

/** Every game of the organization in one list, narrowed by season, sport, league, team or place. */
export function OrgSchedule({ c, org, fail, say }: OrgPanelProps) {
  const manage = org.can.leagues && !org.org.lapsed;
  const [games, setGames] = useState<OrgGames | null>(null);
  const [seasonId, setSeasonId] = useState(() => org.seasons.find((s) => !s.archived)?.id ?? 0);
  const [sport, setSport] = useState('');
  const [leagueId, setLeagueId] = useState(0);
  const [teamId, setTeamId] = useState(0);
  const [venueId, setVenueId] = useState(0);
  const [past, setPast] = useState(false);
  const [editing, setEditing] = useState<{ league: OrgLeague; game: OrgGame | null } | null>(null);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    api.orgGames(c.id).then(setGames).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const today = todayISO();
  const leagues = org.leagues.filter((l) => (!seasonId || l.season_id === seasonId) && (!sport || l.sport === sport));
  const sports = [...new Set(org.leagues.filter((l) => !seasonId || l.season_id === seasonId).map((l) => l.sport))].sort();
  const teams = org.teams.filter((t) => (leagueId ? t.league_id === leagueId : leagues.some((l) => l.id === t.league_id)));
  const league = (id: number) => org.leagues.find((l) => l.id === id);
  const shown = (games?.games ?? [])
    .filter((g) => leagues.some((l) => l.id === g.league_id))
    .filter((g) => !leagueId || g.league_id === leagueId)
    .filter((g) => !teamId || g.home_team_id === teamId || g.away_team_id === teamId)
    .filter((g) => !venueId || g.venue_id === venueId);
  const upcoming = shown.filter((g) => g.date >= today);
  const list = past ? shown : upcoming;
  const byDate = new Map<string, OrgGame[]>();
  for (const g of list) byDate.set(g.date, [...(byDate.get(g.date) ?? []), g]);
  const clash = upcoming.find((g) => g.status === 'scheduled' && g.warnings.length > 0);
  const add = () => {
    const l = leagueId ? league(leagueId) : leagues.length === 1 ? leagues[0] : null;
    if (l) setEditing({ league: l, game: null });
    else setChoosing(true);
  };
  const state = (g: OrgGame) =>
    g.status === 'final' ? (
      <Pill>
        Final {g.away_score ?? '–'}–{g.home_score ?? '–'}
      </Pill>
    ) : g.status === 'postponed' ? (
      <Pill tone="warn">Postponed</Pill>
    ) : g.status === 'cancelled' ? (
      <Pill tone="warn">Cancelled</Pill>
    ) : g.warnings.length ? (
      <Pill tone="warn">Booked twice</Pill>
    ) : (
      <Pill tone="ok">Scheduled</Pill>
    );

  return (
    <>
      <PageHead eyebrow="Management / Schedule" title="Schedule" sub="Games across every season, division and team.">
        {manage && org.leagues.length > 0 && (
          <button type="button" className="btn primary" onClick={add}>
            + Add game
          </button>
        )}
      </PageHead>
      <div className="cx-filters">
        <select className="input" aria-label="Season" value={seasonId} onChange={(e) => (setSeasonId(Number(e.target.value)), setLeagueId(0), setTeamId(0))}>
          <option value={0}>All seasons</option>
          {org.seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {sports.length > 1 && (
          <select className="input" aria-label="Sport" value={sport} onChange={(e) => (setSport(e.target.value), setLeagueId(0), setTeamId(0))}>
            <option value="">All sports</option>
            {sports.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        <select className="input" aria-label="Division" value={leagueId} onChange={(e) => (setLeagueId(Number(e.target.value)), setTeamId(0))}>
          <option value={0}>All divisions</option>
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {sports.length > 1 && !sport ? ` (${l.sport})` : ''}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Team" value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>
          <option value={0}>All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {org.venues.length > 0 && (
          <select className="input" aria-label="Place" value={venueId} onChange={(e) => setVenueId(Number(e.target.value))}>
            <option value={0}>All places</option>
            {org.venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        {shown.length > upcoming.length && (
          <label className="check">
            <input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} /> Show games already played
          </label>
        )}
      </div>
      {clash && (
        <Alert
          title={`Booked twice: ${longDay(clash.date)}${clash.start_time ? ` at ${clock(clash.start_time)}` : ''}`}
          sub={clash.warnings[0]}
          action={manage ? 'Change this game' : undefined}
          onAction={() => league(clash.league_id) && setEditing({ league: league(clash.league_id)!, game: clash })}
        />
      )}
      {games === null ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <div className="card cx-card">
          <p className="muted">{shown.length ? 'No games to come. Tick "Show games already played" to see results.' : 'No games match. Build a schedule from a division under "Seasons & teams", or add one game here.'}</p>
        </div>
      ) : (
        [...byDate.entries()].map(([date, day]) => (
          <section key={date} className="card cx-card cx-day">
            <h2>{longDay(date)}</h2>
            <ul className="cx-rows">
              {day.map((g) => {
                const l = league(g.league_id);
                return (
                  <Row
                    key={g.id}
                    lead={
                      <span className="cx-date cx-time">
                        <b>{g.start_time ? clock(g.start_time) : "–"}</b>
                      </span>
                    }
                    title={`${g.away} at ${g.home}`}
                    sub={[l?.sport, l?.name, g.venue || 'Place not set'].filter(Boolean).join(' · ')}
                    end={state(g)}
                    onClick={manage && l ? () => setEditing({ league: l, game: g }) : undefined}
                  />
                );
              })}
            </ul>
          </section>
        ))
      )}
      {choosing && (
        <Modal title="Which division is the game in?" onClose={() => setChoosing(false)}>
          <ul className="cx-rows">
            {leagues.map((l) => (
              <Row
                key={l.id}
                lead={<Badge text={l.name} />}
                title={l.name}
                sub={l.sport}
                onClick={() => {
                  setChoosing(false);
                  setEditing({ league: l, game: null });
                }}
              />
            ))}
          </ul>
        </Modal>
      )}
      {editing && (
        <GameModal
          org={org}
          league={editing.league}
          game={editing.game}
          onClose={() => setEditing(null)}
          save={async (b) => {
            try {
              setGames(editing.game ? await api.orgUpdateGame(c.id, editing.game.id, b) : await api.orgAddGame(c.id, { ...b, league_id: editing.league.id }));
              say(editing.game ? 'The game was saved. Both teams have it on their calendars.' : 'The game was added to both teams’ calendars.');
              setEditing(null);
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
    </>
  );
}

/** A line through a handful of numbers, each point saying its own value when pointed at. */
function Trend({ points }: { points: { label: string; value: number }[] }) {
  const W = 560;
  const H = 150;
  const pad = { l: 28, r: 12, t: 12, b: 24 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad.b - (v * (H - pad.t - pad.b)) / max;
  return (
    <svg className="cx-trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Active members by week: ${points.map((p) => `${p.label}, ${p.value}`).join('; ')}`}>
      {[0, max].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="cx-trend-grid" />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} className="cx-trend-line" />
      {points.map((p, i) => (
        <g key={p.label}>
          <circle cx={x(i)} cy={y(p.value)} r="4" className="cx-trend-dot">
            <title>{`Week of ${p.label}: ${p.value} active`}</title>
          </circle>
          {(i === 0 || i === points.length - 1) && (
            <text x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : 'end'}>
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** How the organization is using Dime Coach, in totals. Nothing here says what one person did. */
export function OrgUsage({ c, fail, go }: Pick<OrgPanelProps, 'c' | 'fail'> & { go: ManageGo }) {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    api.orgUsage(c.id).then(setU).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  if (!u) return <p className="muted">Loading…</p>;
  const change = u.active_week - u.active_before;
  const items = u.shared.drill + u.shared.play + u.shared.plan;
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <>
      <PageHead eyebrow="Management / More / Usage" title={`How ${c.name} is using Dime Coach`} sub="Totals for the whole organization, over the last 30 days." />
      <div className="cx-stats">
        <Stat value={u.active_week} label={`of ${plural(u.members, 'member')} active this week`} note={change === 0 ? 'Same as last week' : `${change > 0 ? '↑' : '↓'} ${Math.abs(change)} from last week`} />
        <Stat
          value={u.practices}
          label="Practices planned"
          note={u.practices_before ? `${u.practices >= u.practices_before ? '↑' : '↓'} from ${u.practices_before} in the 30 days before` : 'For the organization’s teams'}
        />
        <Stat value={items} label="Things shared" note={`${plural(u.shared.drill, 'drill')} · ${plural(u.shared.play, 'play')} · ${plural(u.shared.plan, 'plan')}`} />
      </div>
      <div className="cx-cols">
        <div className="cx-stack">
          <section className="card cx-card">
            <h2>Active members over time</h2>
            <p className="muted small">Members who did anything in Dime Coach each week, for the last 8 weeks.</p>
            <Trend points={u.weeks.map((w) => ({ label: day(w.start), value: w.active }))} />
          </section>
          <section className="card cx-card">
            <h2>What coaches copy most</h2>
            {u.top.length === 0 ? (
              <p className="muted">Nobody has taken a copy of something shared yet.</p>
            ) : (
              <ul className="cx-rows">
                {u.top.map((t) => (
                  <Row key={t.id} lead={<Badge text={t.by} />} title={t.title} sub={`${t.by} · ${t.kind === 'plan' ? 'practice plan' : t.kind}`} end={<span className="muted small">{plural(t.copies, 'copy', 'copies')}</span>} />
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="cx-stack">
          <section className="card cx-card">
            <h2>Conversation</h2>
            <div className="cx-stats two">
              <Stat value={u.discussions} label="New conversations" />
              <Stat value={u.replies} label="Replies" />
            </div>
          </section>
          <section className="card cx-card">
            <h2>Teams to check in with</h2>
            {u.quiet.length === 0 ? (
              <p className="muted">Every team has planned a practice in the last two weeks.</p>
            ) : (
              <ul className="cx-rows">
                {u.quiet.map((t) => (
                  <Row
                    key={t.id}
                    lead={<Badge text={t.name} />}
                    title={`${t.name} · ${t.league}`}
                    sub={t.days === null ? 'No practice planned yet' : `No practice planned or changed in ${t.days} days`}
                    end={<Pill tone="warn">Quiet</Pill>}
                    onClick={() => go('seasons')}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
