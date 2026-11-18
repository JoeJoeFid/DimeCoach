// The management side of an organization, as its managers see it: what needs attention, every
// game in one schedule, and how the organization is using Dime Coach.
import { useEffect, useState } from 'react';
import { api, GENDER_WORD, type OrgSignup, type OrgGame, type OrgGames, type OrgLeague, type OrgUsage as Usage } from '../api';
import { fmtClock, fmtDateShort, parseClock, todayISO } from '../util';
import { Modal } from '../components/bits';
import { promptDialog } from '../components/dialogs';
import { Alert, Badge, PageHead, Pill, Row, Stat } from '../components/cx';
import { CopyButton, GameModal, type OrgPanelProps } from './OrgPanels';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clock = (t: string) => (t ? fmtClock(parseClock(t)) : 'Time not set');
const longDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** The pictures beside the quick jobs, as the lines of a 24 by 24 drawing. */
const JOB = {
  teams: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.870M16 3.130a4 4 0 0 1 0 7.750',
  season: 'M8 2v4M16 2v4M3 10h18M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8M19 16v6M16 19h6',
  schedule: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M8 14h.010M12 14h.010M16 14h.010M8 18h.010M12 18h.010',
  invite: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6',
  announce: 'm3 11 18-5v12L3 14v-3zM11.600 16.800a3 3 0 1 1-5.800-1.600',
  signup: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 11h8M8 15h5',
};
function JobIcon({ d }: { d: string }) {
  return (
    <span className="cx-job-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** How many games a day shows before the rest are counted. */
const DAY_GAMES = 3;
/**
 * The season's games on a month grid, drawn like the calendar a coach has for their team.
 * Choosing a day lists its games underneath.
 */
function SeasonCalendar({ games, today, picked, onPick }: { games: OrgGame[]; today: string; picked: string; onPick: (date: string) => void }) {
  // Open on the month of the next game, or this month.
  const next = games.find((g) => g.date >= today && g.status === 'scheduled')?.date ?? today;
  const home: [number, number] = [Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1];
  const [[year, month], setMonth] = useState<[number, number]>(home);
  const shift = (by: number) => {
    const d = new Date(year, month + by, 1);
    setMonth([d.getFullYear(), d.getMonth()]);
  };
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Whole weeks: leading days from last month and trailing days from the next fill the grid.
  const cells: { date: string; inMonth: boolean; day: number }[] = [];
  for (let i = -first.getDay(); cells.length % 7 !== 0 || i < daysInMonth; i++) {
    const d = new Date(year, month, 1 + i);
    cells.push({ date: isoOf(d), inMonth: d.getMonth() === month, day: d.getDate() });
  }
  const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shown = games.filter((g) => g.status !== 'cancelled');
  const inMonth = shown.filter((g) => g.date.startsWith(`${year}-${pad(month + 1)}`));
  const atHome = year === home[0] && month === home[1];
  return (
    <div className="cal ov-cal">
      <div className="cal-head">
        <div className="cal-nav">
          <button type="button" className="tl-arrow" aria-label="Previous month" onClick={() => shift(-1)}>
            ‹
          </button>
          <h3 className="cal-title">{title}</h3>
          <button type="button" className="tl-arrow" aria-label="Next month" onClick={() => shift(1)}>
            ›
          </button>
          {!atHome && (
            <button type="button" className="link small" onClick={() => setMonth(home)}>
              Back to next up
            </button>
          )}
        </div>
        <span className="muted small">{inMonth.length ? plural(inMonth.length, 'game') : 'No games this month'}</span>
      </div>
      <div className="cal-grid" role="grid" aria-label={title}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-weekday" role="columnheader">
            {d}
          </div>
        ))}
        {cells.map((c) => {
          const list = shown.filter((g) => g.date === c.date);
          return (
            <div key={c.date} role="gridcell" className={`cal-day ${c.inMonth ? '' : 'out'} ${c.date === today ? 'today' : ''} ${c.date < today ? 'past' : ''} ${picked === c.date ? 'picked' : ''}`}>
              <div className="cal-day-top">
                <span className="cal-num">{c.day}</span>
              </div>
              {list.slice(0, DAY_GAMES).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`cal-chip game ${g.status === 'final' ? 'done' : ''} ${g.status === 'postponed' ? 'unplanned' : ''}`}
                  aria-label={`${g.away} at ${g.home}, ${fmtDateShort(g.date)}, ${clock(g.start_time)}${g.status === 'final' ? '. Played' : g.status === 'postponed' ? '. Postponed' : ''}`}
                  onClick={() => onPick(c.date)}
                >
                  {g.status === 'final' && (
                    <span className="cal-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                  {g.start_time && <span className="cal-time">{clock(g.start_time)}</span>}
                  <span className="cal-name">
                    {g.away} at {g.home}
                  </span>
                </button>
              ))}
              {list.length > DAY_GAMES && (
                <button type="button" className="link small ov-cal-more" onClick={() => onPick(c.date)}>
                  + {list.length - DAY_GAMES} more
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="cal-legend muted small">
        <span className="cal-chip game">Game</span>
        <span className="cal-chip game done">
          <span className="cal-check" aria-hidden="true">
            ✓
          </span>
          Played
        </span>
        <span className="cal-chip game unplanned">Postponed</span>
      </div>
    </div>
  );
}

/** A share of a whole, as a figure with a bar under it. */
function Meter({ label, value, of, note, warn, onClick }: { label: string; value: number; of: number; note: string; warn?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span className="ov-meter-label">{label}</span>
      <strong>
        {value}
        <span className="muted"> of {of}</span>
      </strong>
      <span className="ov-bar" aria-hidden="true">
        <i className={warn ? 'warn' : ''} style={{ width: `${of ? Math.min(100, Math.round((value / of) * 100)) : 0}%` }} />
      </span>
      <small className={warn ? 'ov-warn' : 'muted'}>{note}</small>
    </>
  );
  return onClick ? (
    <button type="button" className="ov-meter" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="ov-meter">{inner}</div>
  );
}
/** The same, small enough for a row of a table. */
function Bar({ value, of, warn }: { value: number; of: number; warn?: boolean }) {
  if (!of) return <span className="muted small">None yet</span>;
  return (
    <span className="ov-cell-bar">
      <span className="ov-bar" aria-hidden="true">
        <i className={warn ? 'warn' : ''} style={{ width: `${Math.min(100, Math.round((value / of) * 100))}%` }} />
      </span>
      <span className="small">
        {value} of {of}
      </span>
    </span>
  );
}

/** Where a manager can be sent from the overview. */
export type ManageGo = (tab: 'seasons' | 'players' | 'schedule' | 'coaches' | 'announcements', focus?: { leagueId?: number; build?: boolean; view?: 'coaches' | 'invites' | 'requirements' | 'waiting' | 'teams' | 'form' }) => void;

/** The first thing a manager sees: what needs fixing, each with the way to fix it, and the common jobs. */
export function ManageOverview({ c, org, act, fail, go }: OrgPanelProps & { go: ManageGo }) {
  const [games, setGames] = useState<OrgGames | null>(null);
  const [picking, setPicking] = useState(false);
  const [signups, setSignups] = useState<OrgSignup[] | null>(null);
  /** Whether the season's sign-up form is open, and the code in its link. */
  const [form, setForm] = useState<{ open: boolean; code: string } | null>(null);
  /** The day picked on the calendar, or none for what comes next. */
  const [day, setDay] = useState('');
  const season = org.seasons.find((s) => !s.archived) ?? null;
  useEffect(() => {
    api.orgGames(c.id).then(setGames).catch(fail);
    // Who signed up is for those who look after divisions.
    if (season && org.can.leagues) api.orgSignups(c.id, season.id).then((r) => (setSignups(r.signups), setForm(r.season))).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, season?.id, org.waiting]);
  const leagues = season ? org.leagues.filter((l) => l.season_id === season.id) : [];
  const teams = org.teams.filter((t) => leagues.some((l) => l.id === t.league_id));
  const today = todayISO();
  const noHead = teams.filter((t) => !t.coaches.some((s) => s.head));
  const clashes = (games?.games ?? []).filter((g) => g.date >= today && g.status === 'scheduled' && g.warnings.length > 0);
  const unchecked = org.people.filter((p) => p.coach && p.compliance.some((x) => x.state === 'missing' || x.state === 'expired'));
  const left = Math.max(0, org.org.seats - org.org.seats_used);
  const issues = (noHead.length ? 1 : 0) + (clashes.length ? 1 : 0) + (unchecked.length ? 1 : 0) + (org.invites.length ? 1 : 0) + (org.waiting ? 1 : 0);
  const leagueName = (id: number | null) => org.leagues.find((l) => l.id === id)?.name ?? '';

  const newSeason = async () => {
    const name = await promptDialog({ title: 'Name the season', body: 'Such as "Winter 2026-27". Divisions and teams go inside it.', confirmLabel: 'Start season' });
    // The new season is the one "Seasons & teams" opens on.
    if (name && (await act(() => api.orgAddSeason(c.id, name), `${name} is ready. Add its divisions next.`))) go('seasons');
  };

  // --- The active season, in figures -------------------------------------------------
  const seasonGames = (games?.games ?? []).filter((g) => leagues.some((l) => l.id === g.league_id));
  const counted = seasonGames.filter((g) => g.status !== 'cancelled');
  const finals = seasonGames.filter((g) => g.status === 'final');
  const upcoming = seasonGames.filter((g) => g.date >= today && g.status === 'scheduled');
  const withHead = teams.length - noHead.length;
  const signed = signups?.length ?? 0;
  const onTeams = signups?.filter((g) => g.team_id).length ?? 0;
  const listed = day ? seasonGames.filter((g) => g.date === day) : upcoming.slice(0, 5);
  const divisions = leagues
    .slice()
    .sort((x, y) => x.sport.localeCompare(y.sport) || x.name.localeCompare(y.name, undefined, { numeric: true }))
    .map((l) => {
      const ts = teams.filter((t) => t.league_id === l.id);
      const gs = counted.filter((g) => g.league_id === l.id);
      const top = (games?.standings[l.id] ?? []).find((r) => r.played > 0);
      return {
        l,
        teams: ts.length,
        heads: ts.filter((t) => t.coaches.some((x) => x.head)).length,
        players: ts.reduce((n, t) => n + t.players, 0),
        waiting: signups?.filter((g) => g.league_id === l.id && !g.team_id).length ?? 0,
        games: gs.length,
        played: gs.filter((g) => g.status === 'final').length,
        top,
      };
    });

  return (
    <>
      <PageHead eyebrow="Management / Overview" title={`Run ${c.name}`} sub={season ? `${season.name} · the season at a glance` : 'Your organization at a glance'} />
      <div className="ov">
        <div className="ov-main">
          {!season && (
            <section className="card cx-card">
              <h2>No season running</h2>
              <p className="muted">A season holds your divisions, teams, players and games. Start one to see it here.</p>
              {org.can.leagues && (
                <button type="button" className="btn primary" onClick={newSeason}>
                  Set up a season
                </button>
              )}
            </section>
          )}
          {season && (
            <section className="card cx-card ov-season" aria-label={`${season.name} so far`}>
              <header>
                <div>
                  <span className="ov-eyebrow">Active season</span>
                  <h2>{season.name}</h2>
                </div>
                <span className="muted small">
                  {plural(leagues.length, 'division')} · {plural(teams.length, 'team')}
                </span>
              </header>
              <div className="ov-meters">
                <Meter label="Players on teams" value={onTeams} of={signed} note={signed ? (signed - onTeams ? `${signed - onTeams} waiting for a team` : 'Everyone is on a team') : 'Nobody has signed up yet'} warn={signed - onTeams > 0} onClick={org.can.leagues ? () => go('players') : undefined} />
                <Meter label="Teams with a head coach" value={withHead} of={teams.length} note={teams.length ? (noHead.length ? `${noHead.length} still ${noHead.length === 1 ? 'needs' : 'need'} one` : 'Every team has one') : 'No teams yet'} warn={noHead.length > 0} onClick={() => go('seasons')} />
                <Meter label="Games played" value={finals.length} of={counted.length} note={counted.length ? `${plural(upcoming.length, 'game')} still to come` : 'No schedule yet'} onClick={() => go('schedule')} />
              </div>
            </section>
          )}
          {issues > 0 && (
            <section className="card cx-card">
              <h2>Needs attention</h2>
              <div className="cx-alerts">
                {org.waiting > 0 && (
                  <Alert title={`${plural(org.waiting, 'player')} ${org.waiting === 1 ? 'is' : 'are'} waiting for a team`} sub="Signed up, and not on a roster yet." action="Put on teams" onAction={() => go('players', { view: 'waiting' })} />
                )}
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
          )}
          {season && (
            <section className="card cx-card" aria-label="Calendar">
              <header className="ov-head">
                <h2>Calendar</h2>
                <button type="button" className="link" onClick={() => go('schedule')}>
                  Full schedule
                </button>
              </header>
              <SeasonCalendar games={seasonGames} today={today} picked={day} onPick={(d) => setDay(d === day ? '' : d)} />
              <h3 className="ov-sub">{day ? `Games on ${fmtDateShort(day)}` : 'Coming up next'}</h3>
              {listed.length === 0 ? (
                <p className="muted small">{day ? 'No games that day.' : counted.length ? 'No games still to come.' : 'No games yet. Build a schedule from the quick jobs.'}</p>
              ) : (
                <ul className="ov-games">
                  {listed.map((g) => (
                    <li key={g.id}>
                      <span className="ov-when">
                        {!day && <b>{fmtDateShort(g.date)}</b>}
                        <span className="muted small">{clock(g.start_time)}</span>
                      </span>
                      <span className="ov-teams">
                        {g.away} <span className="muted">at</span> {g.home}
                        <span className="muted small">
                          {' '}
                          · {leagueName(g.league_id)}
                          {g.venue ? ` · ${g.venue}` : ''}
                        </span>
                      </span>
                      {g.status === 'final' ? (
                        <span className="ov-score">
                          {g.away_score ?? '–'} – {g.home_score ?? '–'}
                        </span>
                      ) : g.status === 'postponed' ? (
                        <Pill tone="warn">Postponed</Pill>
                      ) : (
                        g.warnings.length > 0 && <Pill tone="warn">Booked twice</Pill>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {season && divisions.length > 0 && (
            <section className="card cx-card" aria-label="Divisions">
              <header className="ov-head">
                <h2>Divisions</h2>
                <button type="button" className="link" onClick={() => go('seasons')}>
                  Seasons &amp; teams
                </button>
              </header>
              <div className="table-scroll">
                <table className="table ov-divisions">
                  <thead>
                    <tr>
                      <th>Division</th>
                      <th className="num">Teams</th>
                      <th className="num">Players</th>
                      <th>Head coaches</th>
                      <th>Games played</th>
                      <th>Leading</th>
                    </tr>
                  </thead>
                  <tbody>
                    {divisions.map((x) => (
                      <tr key={x.l.id} onClick={() => go('seasons', { leagueId: x.l.id })}>
                        <td>
                          <button type="button" className="link ov-division" onClick={() => go('seasons', { leagueId: x.l.id })}>
                            {x.l.name}
                          </button>
                          <div className="muted small">{[x.l.sport, GENDER_WORD[x.l.gender]].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="num">{x.teams}</td>
                        <td className="num">
                          {x.players}
                          {x.waiting > 0 && <div className="ov-warn small">{x.waiting} waiting</div>}
                        </td>
                        <td>
                          <Bar value={x.heads} of={x.teams} warn={x.heads < x.teams} />
                        </td>
                        <td>
                          <Bar value={x.played} of={x.games} />
                        </td>
                        <td>
                          {x.top ? (
                            <>
                              {x.top.team}
                              <span className="muted small">
                                {' '}
                                {x.top.won}–{x.top.lost}
                                {x.top.tied ? `–${x.top.tied}` : ''}
                              </span>
                            </>
                          ) : (
                            <span className="muted small">No results yet</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {finals.length > 0 && (
            <section className="card cx-card" aria-label="Latest results">
              <h2>Latest results</h2>
              <ul className="ov-games">
                {finals
                  .slice(-4)
                  .reverse()
                  .map((g) => (
                    <li key={g.id}>
                      <span className="ov-when">
                        <b>{fmtDateShort(g.date)}</b>
                      </span>
                      <span className="ov-teams">
                        <span className={(g.away_score ?? 0) > (g.home_score ?? 0) ? 'ov-won' : ''}>{g.away}</span> <span className="muted">at</span> <span className={(g.home_score ?? 0) > (g.away_score ?? 0) ? 'ov-won' : ''}>{g.home}</span>
                        <span className="muted small"> · {leagueName(g.league_id)}</span>
                      </span>
                      <span className="ov-score">
                        {g.away_score ?? '–'} – {g.home_score ?? '–'}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="ov-side">
          <section className="card ov-glance" aria-label="At a glance">
            <div>
              <strong className={issues ? 'ov-warn' : ''}>{issues}</strong>
              <span>{issues === 1 ? 'Thing to fix' : 'Things to fix'}</span>
              <small className="muted">{issues ? 'Listed under Needs attention' : 'Nothing needs fixing'}</small>
            </div>
            <button type="button" disabled={!org.can.people} onClick={() => go('coaches')}>
              <strong>
                {org.org.seats_used} / {org.org.seats}
              </strong>
              <span>Coach seats used</span>
              <span className="ov-bar" aria-hidden="true">
                <i className={left === 0 ? 'warn' : ''} style={{ width: `${org.org.seats ? Math.min(100, Math.round((org.org.seats_used / org.org.seats) * 100)) : 0}%` }} />
              </span>
              <small className={left === 0 ? 'ov-warn' : 'muted'}>{plural(left, 'seat')} available</small>
            </button>
          </section>
          {season && form && org.can.leagues && (
            <section className={`card ov-signups ${form.open ? 'open' : ''}`} aria-label="Sign-ups">
              <strong>
                Sign-ups for {season.name} are {form.open ? 'open' : 'closed'}.
              </strong>
              <small className="muted">{form.open ? `${plural(signups?.length ?? 0, 'player')} signed up so far. Anyone with the link can sign a player up.` : 'Parents cannot sign players up until the form is opened.'}</small>
              <span className="ov-signups-acts">
                {form.open && form.code && <CopyButton text={`${window.location.origin}/signup/${form.code}`} label="Copy link" />}
                <button type="button" className="link small" onClick={() => go('players', { view: 'form' })}>
                  {form.open ? 'Sign-up form' : 'Open sign-ups'} →
                </button>
              </span>
            </section>
          )}
          <section className="card cx-card">
            <h2>Quick jobs</h2>
            <ul className="cx-rows">
              {org.can.leagues && season && <Row lead={<JobIcon d={JOB.teams} />} title="Add divisions and teams" sub={`In ${season.name}`} onClick={() => go('seasons')} />}
              {org.can.leagues && <Row lead={<JobIcon d={JOB.season} />} title="Set up a new season" sub={season ? `After ${season.name}` : 'Then add its divisions and teams'} onClick={newSeason} />}
              {org.can.leagues && season && <Row lead={<JobIcon d={JOB.signup} />} title="Sign up players" sub="Open the form for parents, or add them yourself" onClick={() => go('players')} />}
              {org.can.leagues && org.leagues.length > 0 && <Row lead={<JobIcon d={JOB.schedule} />} title="Build a game schedule" sub="Pick the season and division first" onClick={() => setPicking(true)} />}
              {org.can.people && <Row lead={<JobIcon d={JOB.invite} />} title="Invite coaches" sub={`${plural(left, 'seat')} available`} onClick={() => go('coaches', { view: 'invites' })} />}
              {org.can.announce && <Row lead={<JobIcon d={JOB.announce} />} title="Send an announcement" sub="To everyone, or to one sport, division or team" onClick={() => go('announcements')} />}
            </ul>
          </section>
        </aside>
      </div>
      {picking && <ScheduleFor org={org} seasonId={season?.id ?? 0} onClose={() => setPicking(false)} onPick={(leagueId, build) => go('seasons', { leagueId, build })} />}
    </>
  );
}

/** Which season, sport and division a schedule is to be built for. Nothing is chosen for the manager. */
function ScheduleFor({ org, seasonId: first, onClose, onPick }: { org: OrgPanelProps['org']; seasonId: number; onClose: () => void; onPick: (leagueId: number, build: boolean) => void }) {
  const seasons = org.seasons.filter((s) => !s.archived);
  const [seasonId, setSeasonId] = useState(seasons.length === 1 ? seasons[0].id : 0);
  const [picked, setPicked] = useState('');
  const [leagueId, setLeagueId] = useState(0);
  const sports = org.sports.filter((s) => s.season_id === seasonId);
  // A season with one sport has nothing to choose.
  const sport = sports.length === 1 ? sports[0].name : picked;
  const leagues = org.leagues.filter((l) => l.season_id === seasonId && l.sport.toLowerCase() === sport.toLowerCase()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const league = leagues.find((l) => l.id === leagueId) ?? null;
  const count = league ? org.teams.filter((t) => t.league_id === league.id).length : 0;
  return (
    <Modal title="Build a game schedule" onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (league) onPick(league.id, count >= 2);
        }}
      >
        <label>
          <span className="field-label">Season</span>
          <select className="input" required autoFocus value={seasonId || ''} onChange={(e) => (setSeasonId(Number(e.target.value)), setPicked(''), setLeagueId(0))}>
            <option value="">Choose a season</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.id === first ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Sport</span>
          <select className="input" required disabled={!seasonId || sports.length === 0} value={sport} onChange={(e) => (setPicked(e.target.value), setLeagueId(0))}>
            <option value="">{!seasonId ? 'Choose the season first' : sports.length ? 'Choose a sport' : 'This season has no sports yet'}</option>
            {sports.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Division</span>
          <select className="input" required disabled={!sport || leagues.length === 0} value={leagueId || ''} onChange={(e) => setLeagueId(Number(e.target.value))}>
            <option value="">{!sport ? 'Choose the sport first' : leagues.length ? 'Choose a division' : `${sport} has no divisions yet`}</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {[l.name, GENDER_WORD[l.gender]].filter(Boolean).join(' · ')}
              </option>
            ))}
          </select>
        </label>
        {league && count < 2 && <p className="muted small">{league.name} has {plural(count, 'team')}. A schedule needs at least two, so this opens the division for you to add teams first.</p>}
        <div className="modal-actions">
          <button className="btn primary" disabled={!league}>
            {league && count < 2 ? 'Open the division' : 'Build the schedule'}
          </button>
        </div>
      </form>
    </Modal>
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
