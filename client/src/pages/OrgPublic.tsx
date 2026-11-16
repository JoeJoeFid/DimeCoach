// An organization's public schedule page: leagues, teams, game times, results and standings.
// Anyone with the link can open it, signed in or not. It shows no people.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type PublicOrg } from '../api';
import { fmtClock, fmtDateShort, parseClock, todayISO } from '../util';
import { CopyButton } from './OrgPanels';

type League = PublicOrg['seasons'][number]['leagues'][number];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export default function OrgPublic() {
  const { slug = '' } = useParams();
  const [org, setOrg] = useState<PublicOrg | null>(null);
  const [error, setError] = useState('');
  const [seasonId, setSeasonId] = useState(0);
  const [leagueId, setLeagueId] = useState(0);
  const [teamId, setTeamId] = useState(0);
  useEffect(() => {
    api
      .publicOrg(slug)
      .then((o) => {
        setOrg(o);
        document.title = `${o.name} schedule`;
      })
      .catch((e) => setError((e as Error).message));
  }, [slug]);

  if (error)
    return (
      <div className="pub">
        <div className="pub-inner">
          <div className="card">
            <h1>Nothing here</h1>
            <p className="muted">{error}</p>
          </div>
        </div>
      </div>
    );
  if (!org) return <div className="pub muted">Loading…</div>;
  const season = org.seasons.find((s) => s.id === seasonId) ?? org.seasons[0];
  const league: League | undefined = season?.leagues.find((l) => l.id === leagueId) ?? season?.leagues[0];
  const feed = `${window.location.origin}/api/public/orgs/${slug}/calendar.ics`;
  const today = todayISO();
  const games = (league?.games ?? []).filter((g) => !teamId || g.home_team_id === teamId || g.away_team_id === teamId);
  const upcoming = games.filter((g) => g.date >= today && g.status !== 'final');
  const results = games.filter((g) => g.status === 'final').reverse();
  const byDate = new Map<string, typeof upcoming>();
  for (const g of upcoming) byDate.set(g.date, [...(byDate.get(g.date) ?? []), g]);
  const team = league?.teams.find((t) => t.id === teamId);

  return (
    <div className="pub" style={org.color ? ({ '--pub': org.color } as React.CSSProperties) : undefined}>
      <header className="pub-head">
        <div className="pub-inner">
          <span className="pub-crest" aria-hidden="true">
            {org.image ? <img src={org.image} alt="" /> : initials(org.name)}
          </span>
          <div>
            <h1>{org.name}</h1>
            {org.description && <p>{org.description}</p>}
          </div>
        </div>
      </header>
      <main className="pub-inner">
        {!season ? (
          <div className="card">
            <p className="muted">The schedule has not been published yet. Check back soon.</p>
          </div>
        ) : (
          <>
            <div className="pub-picks">
              {org.seasons.length > 1 && (
                <label>
                  <span className="field-label">Season</span>
                  <select
                    className="input"
                    value={season.id}
                    onChange={(e) => {
                      setSeasonId(Number(e.target.value));
                      setLeagueId(0);
                      setTeamId(0);
                    }}
                  >
                    {org.seasons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span className="field-label">League</span>
                <select
                  className="input"
                  value={league?.id ?? 0}
                  onChange={(e) => {
                    setLeagueId(Number(e.target.value));
                    setTeamId(0);
                  }}
                >
                  {season.leagues.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              {league && (
                <label>
                  <span className="field-label">Team</span>
                  <select className="input" value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>
                    <option value={0}>All teams</option>
                    {league.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {!league ? (
              <div className="card">
                <p className="muted">No leagues in {season.name} yet.</p>
              </div>
            ) : (
              <>
                <p className="pub-sub">
                  {[season.name, league.sport, league.age_group].filter(Boolean).join(' · ')}
                </p>
                <section className="card">
                  <h2>{team ? `${team.name}: games to come` : 'Games to come'}</h2>
                  {upcoming.length === 0 && <p className="muted">No games scheduled.</p>}
                  {[...byDate.entries()].map(([date, list]) => (
                    <div key={date} className="org-day">
                      <h3>{fmtDateShort(date)}</h3>
                      <ul className="org-games">
                        {list.map((g) => (
                          <li key={g.id} className={g.status}>
                            <span className="org-game-time">{g.start_time ? fmtClock(parseClock(g.start_time)) : 'Time to come'}</span>
                            <span className="org-game-teams">
                              {g.away}
                              <span className="muted"> at </span>
                              {g.home}
                              {g.venue && <span className="muted small"> · {g.venue}</span>}
                            </span>
                            {g.status === 'postponed' && <span className="kind warn">Postponed</span>}
                            {g.status === 'cancelled' && <span className="kind warn">Cancelled</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
                <section className="card">
                  <h2>Standings</h2>
                  <div className="table-scroll">
                    <table className="table org-standings">
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th className="num">Played</th>
                          <th className="num">Won</th>
                          <th className="num">Lost</th>
                          <th className="num">Tied</th>
                          <th className="num">For</th>
                          <th className="num">Against</th>
                        </tr>
                      </thead>
                      <tbody>
                        {league.standings.map((s) => (
                          <tr key={s.team_id} className={s.team_id === teamId ? 'on' : ''}>
                            <td>
                              <strong>{s.team}</strong>
                            </td>
                            <td className="num">{s.played}</td>
                            <td className="num">{s.won}</td>
                            <td className="num">{s.lost}</td>
                            <td className="num">{s.tied}</td>
                            <td className="num">{s.points_for}</td>
                            <td className="num">{s.points_against}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                {results.length > 0 && (
                  <section className="card">
                    <h2>Results</h2>
                    <ul className="org-games">
                      {results.map((g) => (
                        <li key={g.id} className="final">
                          <span className="org-game-time">{fmtDateShort(g.date)}</span>
                          <span className="org-game-teams">
                            <span className={(g.away_score ?? 0) > (g.home_score ?? 0) ? 'won' : ''}>{g.away}</span>
                            <span className="muted"> at </span>
                            <span className={(g.home_score ?? 0) > (g.away_score ?? 0) ? 'won' : ''}>{g.home}</span>
                          </span>
                          <span className="org-score">
                            {g.away_score ?? '–'} – {g.home_score ?? '–'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <section className="card pub-feed">
                  <h2>Put {team ? `${team.name}'s` : 'these'} games in your own calendar</h2>
                  <p className="muted small">
                    Copy this link, then in Google Calendar choose "Other calendars", "From URL" (in Apple Calendar: File, "New Calendar Subscription") and paste it. Changes to the schedule then show up in your
                    calendar on their own.
                  </p>
                  <div className="pub-feed-row">
                    <code>{`${feed}?${team ? `team=${team.id}` : `league=${league.id}`}`}</code>
                    <CopyButton text={`${feed}?${team ? `team=${team.id}` : `league=${league.id}`}`} label="Copy link" />
                  </div>
                </section>
              </>
            )}
          </>
        )}
        <p className="pub-foot muted small">
          Schedule by <a href="/">Dime Coach</a>
        </p>
      </main>
    </div>
  );
}
