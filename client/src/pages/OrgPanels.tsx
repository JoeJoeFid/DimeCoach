// The organization side of a community: coach seats, leagues and teams, the schedule,
// announcements, requirements, the record of what admins did, and the public page.
// Each panel is one tab (or part of one) on the community page.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, type CommunityDetail, type Org, type OrgAnnouncement, type OrgAudience, type OrgCheck, type OrgGame, type OrgGames, type OrgLeague, type OrgPerson, type OrgTeam } from '../api';
import { useApp } from '../App';
import { SPORT_CHOICES } from '../sports';
import { fmtClock, fmtDateShort, parseClock, todayISO } from '../util';
import { Field, Modal, MoreMenu, type MenuItem } from '../components/bits';
import { confirmDialog, promptDialog } from '../components/dialogs';
import SportIcon from '../components/SportIcon';

export interface OrgPanelProps {
  c: CommunityDetail;
  org: Org;
  /** Runs something that answers with the organization again, and shows what it says. */
  act: (fn: () => Promise<Org>, done?: string) => Promise<boolean>;
  fail: (e: unknown) => void;
  say: (message: string) => void;
}

const HEAD = 'Head coach';
const ASSISTANT = 'Assistant coach';
const stamp = (at: string) => new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`).getTime();
function ago(at: string) {
  const secs = Math.max(0, (Date.now() - stamp(at)) / 1000);
  if (secs < 90) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  const days = Math.round(secs / 86400);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(stamp(at)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const clock = (t: string) => (t ? fmtClock(parseClock(t)) : 'Time not set');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS = {
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  warn: 'M12 4 2.500 20h19zM12 10v4.500M12 17.500h.01',
  open: 'M14 5h5v5M19 5l-8 8M11 6H5v13h13v-6',
  plus: 'M12 5v14M5 12h14',
  cal: 'M5 6h14v14H5zM5 10h14M9 3.500V7M15 3.500V7',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.500 2.700 2.500 15.300 0 18M12 3c-2.500 2.700-2.500 15.300 0 18',
};

/** How many coach seats are taken, as a bar and a sentence. */
export function SeatMeter({ org }: { org: Org | CommunityDetail }) {
  const s = org.org!;
  const full = s.seats_used >= s.seats;
  return (
    <div className={`org-seats ${full ? 'full' : ''}`}>
      <div className="org-seats-text">
        <strong>
          {s.seats_used} of {s.seats}
        </strong>{' '}
        coach seats used
        {s.expires && <span className="muted"> · plan {s.lapsed ? 'ended' : 'runs to'} {fmtDateShort(s.expires)}</span>}
      </div>
      <div className="org-seats-bar" role="img" aria-label={`${s.seats_used} of ${s.seats} coach seats used`}>
        <span style={{ width: `${s.seats ? Math.min(100, (s.seats_used / s.seats) * 100) : 100}%` }} />
      </div>
    </div>
  );
}

/** Shown on every tab once the plan has run out. */
export function LapsedBanner({ c }: { c: CommunityDetail }) {
  if (!c.org?.lapsed) return null;
  return (
    <p className="banner warn" role="status">
      <strong>The organization plan ended on {fmtDateShort(c.org.expires)}.</strong> Teams, rosters, practices and schedules are all still here to read, but nothing can be changed until the plan is renewed.
    </p>
  );
}

// --- People, seats and requirements ---------------------------------------------------
const CHECK_WORD: Record<OrgCheck['state'], string> = { ok: 'Done', due: 'Runs out soon', expired: 'Run out', missing: 'Missing' };

export function OrgPeople({ c, org, act, say }: OrgPanelProps) {
  const app = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [coach, setCoach] = useState(true);
  const [teamId, setTeamId] = useState(0);
  const [title, setTitle] = useState(ASSISTANT);
  const [many, setMany] = useState(false);
  const [lines, setLines] = useState('');
  const [results, setResults] = useState<{ line: string; ok: boolean; error: string; invited: boolean }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ person: OrgPerson; check: OrgCheck; name: string } | null>(null);
  const seats = org.org;
  const left = Math.max(0, seats.seats - seats.seats_used);
  const liveTeams = useMemo(() => {
    const open = new Set(org.seasons.filter((s) => !s.archived).map((s) => s.id));
    const leagues = new Set(org.leagues.filter((l) => open.has(l.season_id)).map((l) => l.id));
    return org.teams.filter((t) => t.league_id && leagues.has(t.league_id));
  }, [org]);

  const addOne = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    let said = '';
    const ok = await act(async () => {
      const r = await api.orgAddPerson(c.id, { email, name, coach, team_id: coach && teamId ? teamId : undefined, title });
      said = r.result.invited ? `An invitation was emailed to ${email}. ${coach ? 'It holds a coach seat until they join or you cancel it.' : ''}` : `${r.result.name} was added.`;
      return r;
    });
    setBusy(false);
    if (ok) {
      setName('');
      setEmail('');
      setTeamId(0);
      say(said);
    }
  };
  const addMany = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act(async () => {
      const r = await api.orgAddPeople(c.id, lines, coach);
      setResults(r.results);
      if (r.results.every((x) => x.ok)) setLines('');
      return r;
    });
    setBusy(false);
  };

  return (
    <>
      <div className="card org-card">
        <div className="org-card-head">
          <h2>Coaches and seats</h2>
          <SeatMeter org={org} />
        </div>
        <p className="muted small">
          Every coach and assistant you add uses one seat, whether they have joined yet or not. Members who only read and take part in the discussion need no seat. Someone with no Dime Coach account is
          sent an email to create one, and lands in {c.name} when they do.
        </p>
        <div className="seg org-how" role="tablist" aria-label="How to add people">
          <button type="button" role="tab" aria-selected={!many} className={!many ? 'on' : ''} onClick={() => setMany(false)}>
            One person
          </button>
          <button type="button" role="tab" aria-selected={many} className={many ? 'on' : ''} onClick={() => setMany(true)}>
            Several at once
          </button>
        </div>
        {!many ? (
          <form className="org-add" onSubmit={addOne}>
            <Field label="Name">
              <input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" />
            </Field>
            <Field label="Email address" grow>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="coach@example.com" />
            </Field>
            <Field label="Joins as">
              <select className="input" value={coach ? 'coach' : 'member'} onChange={(e) => setCoach(e.target.value === 'coach')}>
                <option value="coach">Coach (uses a seat)</option>
                <option value="member">Member (no seat)</option>
              </select>
            </Field>
            {coach && liveTeams.length > 0 && (
              <>
                <Field label="Team (optional)">
                  <select className="input" value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>
                    <option value={0}>Decide later</option>
                    {liveTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {teamId > 0 && (
                  <Field label="As">
                    <select className="input" value={title} onChange={(e) => setTitle(e.target.value)}>
                      <option>{HEAD}</option>
                      <option>{ASSISTANT}</option>
                    </select>
                  </Field>
                )}
              </>
            )}
            <button className="btn primary" disabled={busy || (coach && left === 0)}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </form>
        ) : (
          <form className="org-add-many" onSubmit={addMany}>
            <Field label="One person to a line: a name, then their email address">
              <textarea className="input" rows={6} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'Dana Reyes, dana@example.com\nSam Okafor, sam@example.com'} />
            </Field>
            <div className="org-add-many-foot">
              <select className="input" aria-label="They join as" value={coach ? 'coach' : 'member'} onChange={(e) => setCoach(e.target.value === 'coach')}>
                <option value="coach">Coaches (a seat each)</option>
                <option value="member">Members (no seats)</option>
              </select>
              <button className="btn primary" disabled={busy || !lines.trim()}>
                {busy ? 'Adding…' : 'Add them all'}
              </button>
            </div>
            {results && (
              <ul className="org-results">
                {results.map((r, i) => (
                  <li key={i} className={r.ok ? 'ok' : 'bad'}>
                    <span aria-hidden="true">{r.ok ? '✓' : '✕'}</span> {r.line} <span className="muted">{r.ok ? (r.invited ? 'invitation emailed' : 'added') : r.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </form>
        )}
        {coach && left === 0 && <p className="org-note warn">Every coach seat is in use. Take a seat back from someone below, cancel an invitation, or ask for more seats.</p>}
      </div>

      {org.invites.length > 0 && (
        <div className="card org-card">
          <h2>
            Invited, not joined yet <span className="muted">({org.invites.length})</span>
          </h2>
          <ul className="org-rows">
            {org.invites.map((i) => (
              <li key={i.id}>
                <div className="org-row-main">
                  <strong>{i.name || i.email}</strong>
                  {i.name && <span className="muted small">{i.email}</span>}
                  <span className="muted small">
                    {i.coach ? (i.team ? `${i.title} of ${i.team}` : 'Coach') : 'Member'} · invited {ago(i.invited_at)}
                    {i.invited_by && ` by ${i.invited_by}`}
                  </span>
                </div>
                {i.coach && <span className="kind">Holds a seat</span>}
                {i.expired && <span className="kind warn">Link ran out</span>}
                <span className="row-actions">
                  <button type="button" className="btn small" onClick={() => act(() => api.orgResendInvite(c.id, i.id), `The invitation was sent to ${i.email} again.`)}>
                    Send again
                  </button>
                  <button type="button" className="btn small danger" onClick={() => act(() => api.orgCancelInvite(c.id, i.id), 'The invitation was cancelled.')}>
                    Cancel
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card org-card">
        <h2>
          Who coaches what <span className="muted">({org.people.filter((p) => p.coach).length} coaches)</span>
        </h2>
        <div className="table-scroll">
          <table className="table org-people">
            <thead>
              <tr>
                <th>Person</th>
                <th>Seat</th>
                <th>Teams</th>
                <th>Last active</th>
                {org.requirements.map((r) => (
                  <th key={r.id}>{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {org.people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.id === app.user.id && <span className="kind">You</span>}
                    {p.role !== 'member' && <span className="kind">{p.role === 'creator' ? 'Creator' : 'Admin'}</span>}
                    {p.email && <div className="muted small">{p.email}</div>}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`chip toggle perm-chip ${p.coach ? 'on' : ''}`}
                      aria-pressed={p.coach}
                      title={p.coach ? 'Take the seat back. They stay a member and come off their teams.' : 'Give them a coach seat'}
                      onClick={async () => {
                        if (
                          p.coach &&
                          p.teams.length > 0 &&
                          !(await confirmDialog({ title: `Take the coach seat back from ${p.name}?`, body: `They come off ${p.teams.map((t) => t.name).join(', ')}. What they wrote there is copied to their own account, so they keep it.`, confirmLabel: 'Take the seat back', danger: true }))
                        )
                          return;
                        act(() => api.orgSetCoach(c.id, p.id, !p.coach));
                      }}
                    >
                      <span aria-hidden="true">{p.coach ? '✓' : '–'}</span>
                      Coach
                    </button>
                  </td>
                  <td>{p.teams.length ? p.teams.map((t) => `${t.name}${t.title === HEAD ? ' (head)' : ''}`).join(', ') : <span className="muted">None yet</span>}</td>
                  <td className="muted">{p.last_active_at ? ago(p.last_active_at) : 'Not yet'}</td>
                  {p.compliance.map((k) => (
                    <td key={k.requirement_id}>
                      {p.coach ? (
                        <button type="button" className={`org-check ${k.state}`} onClick={() => setCheck({ person: p, check: k, name: org.requirements.find((r) => r.id === k.requirement_id)?.name ?? '' })}>
                          {CHECK_WORD[k.state]}
                          {k.expires_on && k.state !== 'missing' && <span className="muted small"> to {fmtDateShort(k.expires_on)}</span>}
                        </button>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Requirements c={c} org={org} act={act} />
      {check && (
        <CheckModal
          c={c}
          entry={check}
          onClose={() => setCheck(null)}
          save={async (b) => {
            if (await act(() => api.orgSetCheck(c.id, check.person.id, check.check.requirement_id, b), 'Saved.')) setCheck(null);
          }}
        />
      )}
    </>
  );
}

function Requirements({ c, org, act }: Pick<OrgPanelProps, 'c' | 'org' | 'act'>) {
  const [name, setName] = useState('');
  return (
    <div className="card org-card">
      <h2>What every coach needs</h2>
      <p className="muted small">
        Things your coaches must have before they take the floor, such as a background check or a safety course. Each one becomes a column above, where you record the date it was done and when it runs
        out. Dime Coach flags it 30 days before.
      </p>
      {org.requirements.length > 0 && (
        <ul className="org-chips">
          {org.requirements.map((r) => (
            <li key={r.id} className="chip">
              {r.name}
              <button
                type="button"
                aria-label={`Remove ${r.name}`}
                onClick={async () => {
                  if (await confirmDialog({ title: `Stop tracking "${r.name}"?`, body: 'The dates recorded for it are removed for every coach.', confirmLabel: 'Remove', danger: true })) act(() => api.orgRemoveRequirement(c.id, r.id));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="join-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act(() => api.orgAddRequirement(c.id, name))) setName('');
        }}
      >
        <input className="input" required maxLength={60} aria-label="A new requirement" placeholder="Background check" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn">Add requirement</button>
      </form>
    </div>
  );
}

function CheckModal({ entry, onClose, save }: { c: CommunityDetail; entry: { person: OrgPerson; check: OrgCheck; name: string }; onClose: () => void; save: (b: { done_on: string; expires_on: string; note: string }) => void }) {
  const [done, setDone] = useState(entry.check.done_on);
  const [expires, setExpires] = useState(entry.check.expires_on);
  const [note, setNote] = useState(entry.check.note);
  return (
    <Modal title={`${entry.name}: ${entry.person.name}`} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={(e) => {
          e.preventDefault();
          save({ done_on: done, expires_on: expires, note });
        }}
      >
        <Field label="Done on">
          <input className="input" type="date" value={done} onChange={(e) => setDone(e.target.value)} />
        </Field>
        <Field label="Runs out on (leave empty if it never does)">
          <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <Field label="Note">
          <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Certificate number, who checked it" />
        </Field>
        <div className="modal-actions">
          {entry.check.done_on && (
            <button type="button" className="btn" onClick={() => save({ done_on: '', expires_on: '', note: '' })}>
              Clear
            </button>
          )}
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

// --- Leagues, teams and the schedule --------------------------------------------------
const STATUS_WORD: Record<OrgGame['status'], string> = { scheduled: '', final: 'Final', postponed: 'Postponed', cancelled: 'Cancelled' };

export function OrgTeams({ c, org, act, fail, say }: OrgPanelProps) {
  const app = useApp();
  const manage = org.can.leagues && !org.org.lapsed;
  const [seasonId, setSeasonId] = useState(0);
  const [games, setGames] = useState<OrgGames | null>(null);
  const [coachFor, setCoachFor] = useState<OrgTeam | null>(null);
  const [editing, setEditing] = useState<{ league: OrgLeague; game: OrgGame | null } | null>(null);
  const [building, setBuilding] = useState<OrgLeague | null>(null);
  const [addLeague, setAddLeague] = useState(false);
  const [rolling, setRolling] = useState(false);
  /** The league being looked at in full. With none, the page is the overview of all of them. */
  const [openId, setOpenId] = useState(0);
  const season = org.seasons.find((s) => s.id === seasonId) ?? org.seasons[0] ?? null;
  const leagues = season
    ? org.leagues.filter((l) => l.season_id === season.id).sort((a, b) => a.sport.localeCompare(b.sport) || a.name.localeCompare(b.name, undefined, { numeric: true }))
    : [];
  const open = leagues.find((l) => l.id === openId) ?? null;
  const sports = [...new Set(leagues.map((l) => l.sport))];

  useEffect(() => {
    api.orgGames(c.id).then(setGames).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, org.teams.length]);
  const actGames = async (fn: () => Promise<OrgGames>, done = '') => {
    try {
      setGames(await fn());
      say(done);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const newSeason = async () => {
    const name = await promptDialog({ title: 'Name the season', body: 'Such as "Winter 2026-27". Leagues and teams go inside it.', confirmLabel: 'Start season' });
    if (name) act(() => api.orgAddSeason(c.id, name), `${name} is ready. Add its leagues next.`);
  };
  const seasonMenu: MenuItem[] = season
    ? [
        {
          label: 'Rename',
          onSelect: async () => {
            const name = await promptDialog({ title: 'Rename the season', initial: season.name, confirmLabel: 'Rename' });
            if (name) act(() => api.orgUpdateSeason(c.id, season.id, { name }));
          },
        },
        { label: 'Start the next season from this one', onSelect: () => setRolling(true) },
        { label: season.archived ? 'Reopen this season' : 'Archive this season', onSelect: () => act(() => api.orgUpdateSeason(c.id, season.id, { archived: !season.archived }), season.archived ? 'The season is open again.' : 'The season was archived. Its teams and results are kept.') },
        ...(leagues.length === 0 ? [{ label: 'Delete this empty season', danger: true, onSelect: () => act(() => api.orgDeleteSeason(c.id, season.id)) }] : []),
      ]
    : [];

  if (!org.seasons.length)
    return (
      <div className="card org-empty">
        <h2>Leagues and teams</h2>
        {manage ? (
          <>
            <p>
              Start with a <strong>season</strong>, such as "Winter 2026-27". Inside it go your <strong>leagues</strong> (one for each sport and age group), and inside each league its <strong>teams</strong>. Then
              assign coaches and build the schedule.
            </p>
            <button type="button" className="btn primary" onClick={newSeason}>
              <Icon d={ICONS.plus} size={15} /> Start a season
            </button>
          </>
        ) : (
          <p className="muted">{c.name} has not set up its leagues yet.</p>
        )}
      </div>
    );

  return (
    <>
      <div className="org-season-bar">
        <label className="org-season-pick">
          <span className="field-label">Season</span>
          <select className="input" value={season?.id ?? 0} onChange={(e) => setSeasonId(Number(e.target.value))}>
            {org.seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.archived ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
        {manage && (
          <span className="org-season-actions">
            <button type="button" className="btn" onClick={() => setAddLeague(true)}>
              <Icon d={ICONS.plus} size={15} /> Add a league
            </button>
            <button type="button" className="btn" onClick={newSeason}>
              New season
            </button>
            <MoreMenu items={seasonMenu} label="More for this season" />
          </span>
        )}
      </div>

      {leagues.length === 0 && (
        <div className="card org-empty">
          <p className="muted">{manage ? 'No leagues in this season yet. Add one for each sport and age group, such as "Boys 12 and under".' : 'No leagues in this season yet.'}</p>
        </div>
      )}
      {/* The overview: every league of the season as a small card, grouped by sport. Choosing one opens it in full. */}
      {!open &&
        sports.map((sport) => (
          <section key={sport} className="org-sport" aria-label={sport}>
            {sports.length > 1 && (
              <h2 className="org-sport-head">
                <SportIcon sport={sport} size={20} /> {sport}
                <span className="muted small">
                  {plural(leagues.filter((l) => l.sport === sport).length, 'league')} · {plural(org.teams.filter((t) => leagues.some((l) => l.sport === sport && l.id === t.league_id)).length, 'team')}
                </span>
              </h2>
            )}
            <ul className="org-league-grid">
              {leagues
                .filter((l) => l.sport === sport)
                .map((l) => (
                  <li key={l.id}>
                    <LeagueSummary league={l} manage={manage} showSport={sports.length === 1} teams={org.teams.filter((t) => t.league_id === l.id)} games={(games?.games ?? []).filter((g) => g.league_id === l.id)} onOpen={() => setOpenId(l.id)} />
                  </li>
                ))}
            </ul>
          </section>
        ))}
      {open && (
        <>
          <button type="button" className="back-link org-back" onClick={() => setOpenId(0)}>
            ← All leagues in {season?.name}
          </button>
          <LeagueCard
            key={open.id}
            c={c}
            org={org}
            league={open}
            manage={manage}
            teams={org.teams.filter((t) => t.league_id === open.id)}
            games={(games?.games ?? []).filter((g) => g.league_id === open.id)}
            standings={games?.standings[open.id] ?? []}
            act={act}
            actGames={actGames}
            onCoach={setCoachFor}
            onGame={(game) => setEditing({ league: open, game })}
            onBuild={() => setBuilding(open)}
            openTeam={(t) => app.openTeam(true, t.id)}
          />
        </>
      )}

      {addLeague && season && <LeagueModal c={c} seasonId={season.id} act={act} onClose={() => setAddLeague(false)} />}
      {rolling && season && <RolloverModal c={c} season={season} act={act} onClose={() => setRolling(false)} />}
      {coachFor && <CoachModal c={c} org={org} team={org.teams.find((t) => t.id === coachFor.id) ?? coachFor} act={act} onClose={() => setCoachFor(null)} />}
      {editing && (
        <GameModal
          org={org}
          league={editing.league}
          game={editing.game}
          onClose={() => setEditing(null)}
          save={async (b) => {
            const ok = editing.game ? await actGames(() => api.orgUpdateGame(c.id, editing.game!.id, b), 'The game was saved. Both teams have it on their calendars.') : await actGames(() => api.orgAddGame(c.id, { ...b, league_id: editing.league.id }), 'The game was added to both teams’ calendars.');
            if (ok) setEditing(null);
          }}
        />
      )}
      {building && (
        <BuildModal
          org={org}
          league={building}
          teams={org.teams.filter((t) => t.league_id === building.id).length}
          hasGames={(games?.games ?? []).some((g) => g.league_id === building.id)}
          onClose={() => setBuilding(null)}
          build={async (b) => {
            if (await actGames(() => api.orgBuildSchedule(c.id, building.id, b), `The ${building.name} schedule is built and on every team’s calendar.`)) setBuilding(null);
          }}
        />
      )}
    </>
  );
}

/** One league on the overview: what it is, how many teams and games, its teams with their head coaches, and what needs attention. */
function LeagueSummary({ league, teams, games, manage, showSport, onOpen }: { league: OrgLeague; teams: OrgTeam[]; games: OrgGame[]; manage: boolean; showSport: boolean; onOpen: () => void }) {
  const today = todayISO();
  const next = games.find((g) => g.date >= today && g.status === 'scheduled');
  const uncoached = teams.filter((t) => t.coaches.length === 0).length;
  const clashes = games.filter((g) => g.warnings.length > 0).length;
  const mine = teams.some((t) => t.mine);
  return (
    <button type="button" className={`org-league-tile ${mine ? 'mine' : ''}`} onClick={onOpen}>
      <span className="org-tile-head">
        <strong>{league.name}</strong>
        {mine && <span className="kind">Your team</span>}
      </span>
      <span className="muted small">{[showSport && league.sport, league.age_group, plural(teams.length, 'team'), games.length ? plural(games.length, 'game') : 'no schedule yet'].filter(Boolean).join(' · ')}</span>
      {teams.length > 0 && (
        <span className="org-tile-teams">
          {teams.map((t) => {
            const head = t.coaches.find((s) => s.head) ?? t.coaches[0];
            return (
              <span key={t.id} className={t.mine ? 'mine' : ''}>
                <span>{t.name}</span>
                <span className={head ? 'muted' : 'org-tile-none'}>{head ? head.name : 'No coach'}</span>
              </span>
            );
          })}
        </span>
      )}
      <span className="org-tile-foot">
        {next ? (
          <span className="muted small">
            Next: {fmtDateShort(next.date)}
            {next.start_time ? `, ${clock(next.start_time)}` : ''}
          </span>
        ) : (
          <span />
        )}
        {manage && uncoached > 0 && <span className="org-note warn">{plural(uncoached, 'team')} without a coach</span>}
        {manage && clashes > 0 && <span className="org-note warn">{plural(clashes, 'double booking')}</span>}
        <span className="org-tile-go">Open →</span>
      </span>
    </button>
  );
}

function LeagueCard({
  c,
  league,
  manage,
  teams,
  games,
  standings,
  act,
  actGames,
  onCoach,
  onGame,
  onBuild,
  openTeam,
}: {
  c: CommunityDetail;
  org: Org;
  league: OrgLeague;
  manage: boolean;
  teams: OrgTeam[];
  games: OrgGame[];
  standings: OrgGames['standings'][number];
  act: OrgPanelProps['act'];
  actGames: (fn: () => Promise<OrgGames>, done?: string) => Promise<boolean>;
  onCoach: (t: OrgTeam) => void;
  onGame: (g: OrgGame | null) => void;
  onBuild: () => void;
  openTeam: (t: OrgTeam) => void;
}) {
  const [view, setView] = useState<'teams' | 'schedule' | 'standings'>('teams');
  const [names, setNames] = useState('');
  const [past, setPast] = useState(false);
  const today = todayISO();
  const upcoming = games.filter((g) => g.date >= today);
  const shown = past ? games : upcoming;
  const clashes = games.filter((g) => g.warnings.length > 0).length;
  const played = standings.some((s) => s.played > 0);
  const byDate = new Map<string, OrgGame[]>();
  for (const g of shown) byDate.set(g.date, [...(byDate.get(g.date) ?? []), g]);

  const leagueMenu: MenuItem[] = [
    {
      label: 'Rename',
      onSelect: async () => {
        const name = await promptDialog({ title: 'Rename the league', initial: league.name, confirmLabel: 'Rename' });
        if (name) act(() => api.orgUpdateLeague(c.id, league.id, { name, age_group: league.age_group }));
      },
    },
    {
      label: 'Change the age group',
      onSelect: async () => {
        const age = await promptDialog({ title: 'Age group', body: 'Such as "U12" or "5th and 6th grade". Announcements can be sent to one age group.', initial: league.age_group, confirmLabel: 'Save' });
        if (age !== null) act(() => api.orgUpdateLeague(c.id, league.id, { name: league.name, age_group: age }));
      },
    },
    ...(teams.length === 0 ? [{ label: 'Delete this league', danger: true, onSelect: () => act(() => api.orgDeleteLeague(c.id, league.id), 'The league was deleted.') }] : []),
  ];
  const teamMenu = (t: OrgTeam): MenuItem[] => [
    {
      label: 'Rename',
      onSelect: async () => {
        const name = await promptDialog({ title: 'Rename the team', initial: t.name, confirmLabel: 'Rename' });
        if (name) act(() => api.orgRenameTeam(c.id, t.id, name));
      },
    },
    {
      label: 'Delete this team',
      danger: true,
      onSelect: async () => {
        const typed = await promptDialog({
          title: `Delete ${t.name}?`,
          body: `Its roster, practices and games are deleted for good. Its coaches keep a copy of what they wrote, in their own accounts. Type the team's name to confirm.`,
          confirmLabel: 'Delete the team',
        });
        if (typed) act(() => api.orgDeleteTeam(c.id, t.id, typed), `${t.name} was deleted.`);
      },
    },
  ];
  const gameMenu = (g: OrgGame): MenuItem[] => [
    { label: 'Change the date, time or place', onSelect: () => onGame(g) },
    ...(g.status !== 'postponed' && g.status !== 'final' ? [{ label: 'Mark as postponed', onSelect: () => actGames(() => api.orgUpdateGame(c.id, g.id, { status: 'postponed' }), 'Marked as postponed. Both coaches were told.') }] : []),
    ...(g.status !== 'cancelled' && g.status !== 'final' ? [{ label: 'Cancel the game', onSelect: () => actGames(() => api.orgUpdateGame(c.id, g.id, { status: 'cancelled' }), 'The game was cancelled. Both coaches were told.') }] : []),
    ...(g.status !== 'scheduled' ? [{ label: 'Put it back on the schedule', onSelect: () => actGames(() => api.orgUpdateGame(c.id, g.id, { status: 'scheduled', home_score: null, away_score: null })) }] : []),
    {
      label: 'Delete',
      danger: true,
      onSelect: async () => {
        if (await confirmDialog({ title: `Delete ${g.away} at ${g.home}?`, body: 'It comes off both teams’ calendars.', confirmLabel: 'Delete', danger: true })) actGames(() => api.orgDeleteGame(c.id, g.id));
      },
    },
  ];

  return (
    <section className="card org-league" aria-label={league.name}>
      <header className="org-league-head">
        <div>
          <h2>{league.name}</h2>
          <span className="muted small">
            {[league.sport, league.age_group, plural(teams.length, 'team'), games.length ? plural(games.length, 'game') : ''].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="seg" role="tablist" aria-label={`${league.name} sections`}>
          {(['teams', 'schedule', 'standings'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'teams' ? 'Teams' : v === 'schedule' ? 'Schedule' : 'Standings'}
              {v === 'schedule' && manage && clashes > 0 && <span className="org-dot" title={`${plural(clashes, 'game')} with a double booking`} />}
            </button>
          ))}
        </div>
        {manage && <MoreMenu items={leagueMenu} label={`More for ${league.name}`} />}
      </header>

      {view === 'teams' && (
        <>
          {teams.length === 0 && <p className="muted">No teams yet.</p>}
          <ul className="org-team-grid">
            {teams.map((t) => {
              const row = standings.find((r) => r.team_id === t.id);
              return (
                <li key={t.id} className={`org-team-tile ${t.mine ? 'mine' : ''}`}>
                  <div className="org-team-head">
                    <strong>{t.name}</strong>
                    {t.mine && <span className="kind">Your team</span>}
                    {manage && <MoreMenu items={teamMenu(t)} label={`More for ${t.name}`} />}
                  </div>
                  <span className="muted small">
                    {[manage && plural(t.players, 'player'), row && row.played > 0 && `${row.won} won, ${row.lost} lost${row.tied ? `, ${row.tied} tied` : ''}`].filter(Boolean).join(' · ') || (manage ? '' : 'No games played yet')}
                  </span>
                    <span className="org-coaches">
                      {t.coaches.length === 0 && <span className="org-note warn">No coach yet</span>}
                      {t.coaches.map((s) => (
                        <span key={s.user_id} className={`chip ${s.head ? 'head' : ''}`}>
                          {s.name}
                          <span className="muted"> {s.head ? 'head coach' : 'assistant'}</span>
                          {manage && (
                            <button
                              type="button"
                              aria-label={`Take ${s.name} off ${t.name}`}
                              onClick={async () => {
                                if (await confirmDialog({ title: `Take ${s.name} off ${t.name}?`, body: 'They lose access to the team. What they wrote for it is copied to their own account, so they keep it. Their coach seat stays theirs until you take it back under People.', confirmLabel: 'Take off the team', danger: true }))
                                  act(() => api.orgUnassignCoach(c.id, t.id, s.user_id), `${s.name} is off ${t.name}.`);
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                    </span>
                  <div className="org-team-foot">
                    {manage && (
                      <button type="button" className="btn small" onClick={() => onCoach(t)}>
                        Assign a coach
                      </button>
                    )}
                    {t.can_open && (
                      <button type="button" className="btn small" onClick={() => openTeam(t)} title="Opens the team: its practices, roster and calendar">
                        <Icon d={ICONS.open} size={14} /> Open
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {manage && (
            <form
              className="org-add-teams"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act(() => api.orgAddTeams(c.id, league.id, names))) setNames('');
              }}
            >
              <textarea className="input" rows={names.includes('\n') ? 4 : 1} aria-label={`New teams for ${league.name}`} placeholder="Team name. For several, put one on each line" value={names} onChange={(e) => setNames(e.target.value)} />
              <button className="btn" disabled={!names.trim()}>
                Add {names.trim().includes('\n') ? 'teams' : 'team'}
              </button>
            </form>
          )}
        </>
      )}

      {view === 'schedule' && (
        <>
          <div className="org-schedule-bar">
            {manage && (
              <>
                <button type="button" className="btn" onClick={onBuild} disabled={teams.length < 2} title={teams.length < 2 ? 'Add at least two teams first' : undefined}>
                  <Icon d={ICONS.cal} size={15} /> Build the schedule
                </button>
                <button type="button" className="btn" onClick={() => onGame(null)} disabled={teams.length < 2}>
                  <Icon d={ICONS.plus} size={15} /> Add one game
                </button>
              </>
            )}
            {games.length > upcoming.length && (
              <label className="check org-past">
                <input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} /> Show games already played
              </label>
            )}
          </div>
          {shown.length === 0 && <p className="muted">{games.length ? 'No games still to come.' : manage ? 'No games yet. "Build the schedule" has every team play every other.' : 'The schedule has not been set yet.'}</p>}
          {[...byDate.entries()].map(([date, list]) => (
            <div key={date} className="org-day">
              <h3>{fmtDateShort(date)}</h3>
              <ul className="org-games">
                {list.map((g) => (
                  <li key={g.id} className={g.status}>
                    <span className="org-game-time">{clock(g.start_time)}</span>
                    <span className="org-game-teams">
                      <span className={g.status === 'final' && (g.away_score ?? 0) > (g.home_score ?? 0) ? 'won' : ''}>{g.away}</span>
                      <span className="muted"> at </span>
                      <span className={g.status === 'final' && (g.home_score ?? 0) > (g.away_score ?? 0) ? 'won' : ''}>{g.home}</span>
                      {g.venue && <span className="muted small"> · {g.venue}</span>}
                      {g.notes && <span className="muted small"> · {g.notes}</span>}
                    </span>
                    {g.status === 'final' ? (
                      <span className="org-score">
                        {g.away_score ?? '–'} – {g.home_score ?? '–'}
                      </span>
                    ) : (
                      STATUS_WORD[g.status] && <span className="kind warn">{STATUS_WORD[g.status]}</span>
                    )}
                    {manage && g.warnings.length > 0 && (
                      <span className="org-clash" title={g.warnings.join(' ')}>
                        <Icon d={ICONS.warn} size={15} /> <span className="small">{g.warnings[0]}</span>
                      </span>
                    )}
                    {manage && (
                      <span className="row-actions">
                        {g.status !== 'cancelled' && (
                          <ScoreButton
                            game={g}
                            save={(home, away) => actGames(() => api.orgUpdateGame(c.id, g.id, { status: 'final', home_score: home, away_score: away }), 'The result was recorded.')}
                          />
                        )}
                        <MoreMenu items={gameMenu(g)} label={`More for ${g.away} at ${g.home}`} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {view === 'standings' &&
        (teams.length === 0 ? (
          <p className="muted">No teams yet.</p>
        ) : (
          <>
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
                  {standings.map((s) => (
                    <tr key={s.team_id}>
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
            {!played && <p className="muted small">Standings fill in as results are recorded on the schedule.</p>}
          </>
        ))}
    </section>
  );
}

/** "Score" beside a game: two small boxes and a save, opened in place. */
function ScoreButton({ game, save }: { game: OrgGame; save: (home: number, away: number) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState(String(game.home_score ?? ''));
  const [away, setAway] = useState(String(game.away_score ?? ''));
  if (!open)
    return (
      <button type="button" className="btn small" onClick={() => setOpen(true)}>
        {game.status === 'final' ? 'Change score' : 'Record score'}
      </button>
    );
  return (
    <form
      className="org-score-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await save(Number(home), Number(away))) setOpen(false);
      }}
    >
      <input className="input" type="number" min={0} max={999} required autoFocus aria-label={`${game.away} score`} placeholder={game.away} value={away} onChange={(e) => setAway(e.target.value)} />
      <span aria-hidden="true">–</span>
      <input className="input" type="number" min={0} max={999} required aria-label={`${game.home} score`} placeholder={game.home} value={home} onChange={(e) => setHome(e.target.value)} />
      <button className="btn small primary">Save</button>
      <button type="button" className="btn small" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

/** The "Fields & gyms" tab: the places games are played. */
export function OrgVenues({ c, org, act }: OrgPanelProps) {
  const manage = org.can.leagues && !org.org.lapsed;
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  return (
    <div className="card org-card">
      <h2>Fields and gyms</h2>
      <p className="muted small">Where games are played. Putting games in a named place lets Dime Coach point out when two are booked there at the same time.</p>
      {org.venues.length === 0 && !manage && <p className="muted">{c.name} has not listed its fields and gyms yet.</p>}
      {org.venues.length > 0 && (
        <ul className="org-rows">
          {org.venues.map((v) => (
            <li key={v.id}>
              <div className="org-row-main">
                <strong>{v.name}</strong>
                {v.address && <span className="muted small">{v.address}</span>}
              </div>
              {manage && (
                <span className="row-actions">
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={async () => {
                      if (await confirmDialog({ title: `Remove ${v.name}?`, body: 'Games set there stay on the schedule, with no place named.', confirmLabel: 'Remove', danger: true })) act(() => api.orgDeleteVenue(c.id, v.id));
                    }}
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {manage && (
        <form
          className="org-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(() => api.orgAddVenue(c.id, { name, address }))) {
              setName('');
              setAddress('');
            }
          }}
        >
          <Field label="Name">
            <input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lincoln Park, Field 2" />
          </Field>
          <Field label="Address (optional)" grow>
            <input className="input" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <button className="btn">Add</button>
        </form>
      )}
    </div>
  );
}

function LeagueModal({ c, seasonId, act, onClose }: { c: CommunityDetail; seasonId: number; act: OrgPanelProps['act']; onClose: () => void }) {
  const [name, setName] = useState('');
  const [sport, setSport] = useState(SPORT_CHOICES[0]);
  const [other, setOther] = useState('');
  const [age, setAge] = useState('');
  return (
    <Modal title="Add a league" onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act(() => api.orgAddLeague(c.id, { season_id: seasonId, name, sport: sport === 'Other' ? other : sport, age_group: age }), `${name} was added. Add its teams next.`)) onClose();
        }}
      >
        <Field label="Name">
          <input className="input" required autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Boys 12 and under" />
        </Field>
        <Field label="Sport">
          <select className="input" value={sport} onChange={(e) => setSport(e.target.value)}>
            {SPORT_CHOICES.map((s) => (
              <option key={s}>{s}</option>
            ))}
            <option>Other</option>
          </select>
        </Field>
        {sport === 'Other' && (
          <Field label="Which sport">
            <input className="input" required maxLength={40} value={other} onChange={(e) => setOther(e.target.value)} />
          </Field>
        )}
        <Field label="Age group (optional)">
          <input className="input" maxLength={40} value={age} onChange={(e) => setAge(e.target.value)} placeholder="U12" />
        </Field>
        <p className="muted small">The sport decides which drills and categories the league's teams start with, and cannot be changed later.</p>
        <div className="modal-actions">
          <button className="btn primary">Add league</button>
        </div>
      </form>
    </Modal>
  );
}

function RolloverModal({ c, season, act, onClose }: { c: CommunityDetail; season: Org['seasons'][number]; act: OrgPanelProps['act']; onClose: () => void }) {
  const [name, setName] = useState('');
  const [keep, setKeep] = useState(true);
  const [archive, setArchive] = useState(true);
  return (
    <Modal title={`Start the next season from ${season.name}`} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act(() => api.orgRollover(c.id, season.id, { name, keep_coaches: keep, archive }), `${name} is ready, with the same leagues and teams.`)) onClose();
        }}
      >
        <p className="muted small">
          The new season gets the same leagues and the same teams, new and empty. Rosters, practices and games are not carried over, since players move up: the old teams keep theirs.
        </p>
        <Field label="Name of the new season">
          <input className="input" required autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring 2027" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep each team's coaches
        </label>
        <label className="check">
          <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} /> Archive {season.name}
        </label>
        <div className="modal-actions">
          <button className="btn primary">Start the season</button>
        </div>
      </form>
    </Modal>
  );
}

function CoachModal({ c, org, team, act, onClose }: { c: CommunityDetail; org: Org; team: OrgTeam; act: OrgPanelProps['act']; onClose: () => void }) {
  const on = new Set(team.coaches.map((s) => s.user_id));
  const choices = org.people.filter((p) => !on.has(p.id));
  const [userId, setUserId] = useState(0);
  const [title, setTitle] = useState(team.coaches.some((s) => s.head) ? ASSISTANT : HEAD);
  const person = choices.find((p) => p.id === userId);
  const left = org.org.seats - org.org.seats_used;
  return (
    <Modal title={`Assign a coach to ${team.name}`} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (person && (await act(() => api.orgAssignCoach(c.id, team.id, person.id, title), `${person.name} is now ${title.toLowerCase()} of ${team.name}. They have been told.`))) onClose();
        }}
      >
        <Field label="Who">
          <select className="input" required value={userId} onChange={(e) => setUserId(Number(e.target.value))}>
            <option value={0}>Choose someone in {c.name}</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.coach ? '' : ' (will use a seat)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="As">
          <select className="input" value={title} onChange={(e) => setTitle(e.target.value)}>
            <option>{HEAD}</option>
            <option>{ASSISTANT}</option>
          </select>
        </Field>
        <p className="muted small">
          {title === HEAD
            ? 'A head coach plans practices, keeps the roster and can link the team’s calendar.'
            : 'An assistant plans practices and adds drills and plays, and sees the roster without changing it.'}
        </p>
        {person && !person.coach && <p className={`org-note ${left > 0 ? '' : 'warn'}`}>{left > 0 ? `${person.name} has no coach seat yet. Assigning them uses one of the ${left} left.` : `${person.name} has no coach seat, and none are left.`}</p>}
        <p className="muted small">Not in the list? Add them under People first. If they have no account yet, the invitation there can name this team.</p>
        <div className="modal-actions">
          <button className="btn primary" disabled={!person}>
            Assign
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GameModal({ org, league, game, onClose, save }: { org: Org; league: OrgLeague; game: OrgGame | null; onClose: () => void; save: (b: Partial<OrgGame>) => void }) {
  const teams = org.teams.filter((t) => t.league_id === league.id);
  const [date, setDate] = useState(game?.date ?? todayISO());
  const [time, setTime] = useState(game?.start_time ?? '09:00');
  const [duration, setDuration] = useState(game?.duration_min ?? 60);
  const [home, setHome] = useState(game?.home_team_id ?? teams[0]?.id ?? 0);
  const [away, setAway] = useState(game?.away_team_id ?? teams[1]?.id ?? 0);
  const [venue, setVenue] = useState(game?.venue_id ?? 0);
  const [notes, setNotes] = useState(game?.notes ?? '');
  return (
    <Modal title={game ? `${game.away} at ${game.home}` : `Add a game to ${league.name}`} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={(e) => {
          e.preventDefault();
          save({ date, start_time: time, duration_min: duration, home_team_id: home, away_team_id: away, venue_id: venue || null, notes });
        }}
      >
        <div className="org-pair">
          <Field label="Away team">
            <select className="input" value={away} onChange={(e) => setAway(Number(e.target.value))}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Home team">
            <select className="input" value={home} onChange={(e) => setHome(Number(e.target.value))}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="org-pair three">
          <Field label="Date">
            <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Starts">
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Minutes">
            <input className="input" type="number" min={10} max={600} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Where">
          <select className="input" value={venue} onChange={(e) => setVenue(Number(e.target.value))}>
            <option value={0}>Not set</option>
            {org.venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note for the coaches (optional)">
          <input className="input" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bring both jerseys" />
        </Field>
        <div className="modal-actions">
          <button className="btn primary" disabled={!home || !away || home === away}>
            {game ? 'Save' : 'Add game'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BuildModal({
  org,
  league,
  teams,
  hasGames,
  onClose,
  build,
}: {
  org: Org;
  league: OrgLeague;
  teams: number;
  hasGames: boolean;
  onClose: () => void;
  build: (b: { start_date: string; every_days: number; times: string[]; venue_ids: number[]; duration_min: number; rounds: number; replace: boolean }) => void;
}) {
  const [start, setStart] = useState(todayISO());
  const [every, setEvery] = useState(7);
  const [times, setTimes] = useState(['09:00']);
  const [venues, setVenues] = useState<number[]>(org.venues.map((v) => v.id));
  const [duration, setDuration] = useState(60);
  const [rounds, setRounds] = useState(1);
  const [replace, setReplace] = useState(hasGames);
  const days = (teams % 2 ? teams : teams - 1) * rounds;
  const perDay = Math.floor(teams / 2);
  const total = ((teams * (teams - 1)) / 2) * rounds;
  return (
    <Modal title={`Build the ${league.name} schedule`} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={(e) => {
          e.preventDefault();
          build({ start_date: start, every_days: every, times: times.filter(Boolean), venue_ids: venues, duration_min: duration, rounds, replace });
        }}
      >
        <p className="muted small">Every team plays every other team. You can change or move any game afterwards.</p>
        <Field label="Each team plays every other">
          <select className="input" value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
            <option value={1}>Once</option>
            <option value={2}>Twice, home and away</option>
          </select>
        </Field>
        <div className="org-pair three">
          <Field label="First game day">
            <input className="input" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Days between">
            <input className="input" type="number" min={1} max={60} value={every} onChange={(e) => setEvery(Number(e.target.value))} />
          </Field>
          <Field label="Minutes a game">
            <input className="input" type="number" min={10} max={600} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
        </div>
        <div className="field">
          <span className="field-label">Start times on a game day</span>
          <div className="org-times">
            {times.map((t, i) => (
              <span key={i}>
                <input className="input" type="time" required aria-label={`Start time ${i + 1}`} value={t} onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} />
                {times.length > 1 && (
                  <button type="button" className="btn ghost" aria-label={`Remove start time ${i + 1}`} onClick={() => setTimes(times.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </span>
            ))}
            <button type="button" className="btn small" onClick={() => setTimes([...times, ''])}>
              Add a time
            </button>
          </div>
        </div>
        {org.venues.length > 0 ? (
          <div className="field">
            <span className="field-label">Played at</span>
            <div className="org-times">
              {org.venues.map((v) => (
                <label key={v.id} className="check">
                  <input type="checkbox" checked={venues.includes(v.id)} onChange={(e) => setVenues(e.target.checked ? [...venues, v.id] : venues.filter((x) => x !== v.id))} /> {v.name}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted small">No fields or gyms have been added, so the games will have no place named. You can add them on the "Fields & gyms" tab and set each game's place later.</p>
        )}
        {hasGames && (
          <label className="check">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace the games not played yet. Results already recorded are kept.
          </label>
        )}
        <p className="org-note">
          {plural(total, 'game')} over {plural(days, 'game day')}, {plural(perDay, 'game')} a day{teams % 2 ? ', with one team resting each day' : ''}. Each lands on both teams' calendars, and their coaches are told.
        </p>
        <div className="modal-actions">
          <button className="btn primary">Build the schedule</button>
        </div>
      </form>
    </Modal>
  );
}

// --- Announcements ------------------------------------------------------------------
const AUDIENCES: [OrgAudience['kind'], string][] = [
  ['all', 'Everyone'],
  ['coaches', 'All coaches'],
  ['head', 'Head coaches only'],
  ['leagues', 'Coaches in certain leagues'],
  ['sport', 'Coaches of one sport'],
  ['age', 'Coaches of one age group'],
  ['admins', 'Admins only'],
  ['people', 'People I choose'],
];

export function OrgAnnouncements({ c, org, fail, say }: OrgPanelProps) {
  const app = useApp();
  const [list, setList] = useState<OrgAnnouncement[] | null>(null);
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    api
      .orgAnnouncements(c.id)
      .then((first) => {
        // What was unread is shown as new this once, and counts as read from here on.
        setList(first);
        if (first.some((a) => a.unread)) api.orgAnnouncementsRead(c.id).then(() => app.setCommunityUnread()).catch(() => {});
      })
      .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const actList = async (fn: () => Promise<OrgAnnouncement[]>, done = '') => {
    try {
      setList(await fn());
      say(done);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };
  const canSend = org.can.announce && !org.org.lapsed;
  return (
    <>
      {canSend && !writing && (
        <div className="org-announce-start">
          <button type="button" className="btn primary" onClick={() => setWriting(true)}>
            <Icon d={ICONS.plus} size={15} /> New announcement
          </button>
          <span className="muted small">Goes to people's Messages in Dime Coach. You choose who gets it, and whether it is emailed too.</span>
        </div>
      )}
      {canSend && writing && <Compose c={c} org={org} onClose={() => setWriting(false)} send={async (b) => (await actList(() => api.orgAnnounce(c.id, b), 'The announcement was sent.')) && setWriting(false)} />}
      {list === null && <p className="muted">Loading…</p>}
      {list?.length === 0 && (
        <div className="card org-empty">
          <p className="muted">{canSend ? 'Nothing has been announced yet.' : `No announcements from ${c.name} yet. When there are, they show here and in your Messages.`}</p>
        </div>
      )}
      {list?.map((a) => (
        <article key={a.id} className={`card org-announcement ${a.unread ? 'unread' : ''} ${a.pinned ? 'pinned' : ''}`}>
          <header>
            <h2>
              {a.pinned && (
                <span className="org-pin" title="Pinned">
                  <Icon d={ICONS.pin} size={15} />
                </span>
              )}
              {a.title}
              {a.unread && <span className="kind new">New</span>}
            </h2>
            {a.can_manage && canSend && (
              <MoreMenu
                label={`More for ${a.title}`}
                items={[
                  { label: a.pinned ? 'Unpin' : 'Pin to the top', onSelect: () => actList(() => api.orgPinAnnouncement(c.id, a.id, !a.pinned)) },
                  {
                    label: 'Delete',
                    danger: true,
                    onSelect: async () => {
                      if (await confirmDialog({ title: `Delete "${a.title}"?`, body: 'It disappears for everyone it was sent to.', confirmLabel: 'Delete', danger: true })) actList(() => api.orgDeleteAnnouncement(c.id, a.id));
                    },
                  },
                ]}
              />
            )}
          </header>
          <p className="org-announcement-body">{a.body}</p>
          <footer className="muted small">
            {a.by} · {ago(a.at)} · to {a.audience.toLowerCase()}
            {a.emailed && (
              <span title="Also sent by email">
                {' '}
                · <Icon d={ICONS.mail} size={13} /> emailed
              </span>
            )}
            {a.sent_to !== undefined && (
              <span className="org-seen">
                Seen by {a.seen_by} of {a.sent_to}
              </span>
            )}
          </footer>
        </article>
      ))}
    </>
  );
}

function Compose({ c, org, onClose, send }: { c: CommunityDetail; org: Org; onClose: () => void; send: (b: { title: string; body: string; audience: OrgAudience; pinned: boolean; email: boolean }) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<OrgAudience['kind']>('all');
  const [ids, setIds] = useState<number[]>([]);
  const [value, setValue] = useState('');
  const [pinned, setPinned] = useState(false);
  const [email, setEmail] = useState(false);
  const [reach, setReach] = useState<{ count: number; text: string } | null>(null);
  const open = new Set(org.seasons.filter((s) => !s.archived).map((s) => s.id));
  const leagues = org.leagues.filter((l) => open.has(l.season_id));
  const sports = [...new Set(leagues.map((l) => l.sport))];
  const ages = [...new Set(leagues.map((l) => l.age_group).filter(Boolean))];
  const audience: OrgAudience = useMemo(() => ({ kind, ids, value }), [kind, ids, value]);
  const kinds = AUDIENCES.filter(([k]) => (k === 'leagues' ? leagues.length > 0 : k === 'sport' ? sports.length > 1 : k === 'age' ? ages.length > 0 : k === 'people' ? org.people.length > 0 : true));
  useEffect(() => {
    let live = true;
    api
      .orgAudience(c.id, audience)
      .then((r) => live && setReach(r))
      .catch(() => live && setReach(null));
    return () => {
      live = false;
    };
  }, [c.id, audience]);
  const toggle = (id: number) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const pickKind = (k: OrgAudience['kind']) => {
    setKind(k);
    setIds([]);
    setValue(k === 'sport' ? sports[0] ?? '' : k === 'age' ? ages[0] ?? '' : '');
  };
  return (
    <form
      className="card org-compose"
      onSubmit={(e) => {
        e.preventDefault();
        send({ title, body, audience, pinned, email });
      }}
    >
      <h2>New announcement</h2>
      <Field label="Title">
        <input className="input" required autoFocus maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Gym closed this Friday" />
      </Field>
      <Field label="Message">
        <textarea className="input" required rows={5} maxLength={6000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="org-pair">
        <Field label="Send to">
          <select className="input" value={kind} onChange={(e) => pickKind(e.target.value as OrgAudience['kind'])}>
            {kinds.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {kind === 'sport' && (
          <Field label="Sport">
            <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
              {sports.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
        {kind === 'age' && (
          <Field label="Age group">
            <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
              {ages.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {kind === 'leagues' && (
        <div className="org-times" role="group" aria-label="Leagues">
          {leagues.map((l) => (
            <label key={l.id} className="check">
              <input type="checkbox" checked={ids.includes(l.id)} onChange={() => toggle(l.id)} /> {l.name}
            </label>
          ))}
        </div>
      )}
      {kind === 'people' && (
        <div className="org-times org-pick-people" role="group" aria-label="People">
          {org.people.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} /> {p.name}
            </label>
          ))}
        </div>
      )}
      <p className={`org-note ${reach && reach.count === 0 ? 'warn' : ''}`} role="status">
        {reach ? (reach.count === 0 ? 'Nobody matches that yet.' : `Goes to ${plural(reach.count, 'person', 'people')}: ${reach.text.toLowerCase()}.`) : 'Working out who gets it…'}
      </p>
      <label className="check">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin it to the top of the announcements
      </label>
      <label className="check">
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also send it by email{reach && reach.count > 1 ? ` (${reach.count} emails)` : ''}
      </label>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!reach || reach.count === 0}>
          Send
        </button>
      </div>
    </form>
  );
}

/** Pinned announcements for the caller, shown above the discussion. */
export function PinnedAnnouncements({ c, onOpen }: { c: CommunityDetail; onOpen: () => void }) {
  const [list, setList] = useState<OrgAnnouncement[]>([]);
  useEffect(() => {
    api
      .orgAnnouncements(c.id)
      .then((all) => setList(all.filter((a) => a.pinned || a.unread).slice(0, 3)))
      .catch(() => {});
  }, [c.id]);
  if (!list.length) return null;
  return (
    <ul className="org-pinned">
      {list.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={onOpen}>
            <span className="org-pin">
              <Icon d={ICONS.pin} size={15} />
            </span>
            <span>
              <strong>{a.title}</strong>
              {a.unread && <span className="kind new">New</span>}
              <span className="muted small">
                {' '}
                {a.by} · {ago(a.at)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- The record of what admins did -----------------------------------------------------
export function OrgLog({ c, fail }: Pick<OrgPanelProps, 'c' | 'fail'>) {
  const [rows, setRows] = useState<{ id: number; by: string; text: string; at: string }[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api.orgAudit(c.id).then(setRows).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const shown = (rows ?? []).filter((r) => !q.trim() || `${r.by} ${r.text}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="card org-card">
      <div className="org-card-head">
        <h2>What admins did</h2>
        <input className="input org-log-search" type="search" placeholder="Search the log" aria-label="Search the log" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="muted small">Invitations, seats, teams, coaches, games and announcements, newest first. Only admins of {c.name} see this.</p>
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{rows.length ? 'Nothing matches.' : 'Nothing yet.'}</p>
      ) : (
        <ul className="org-log">
          {shown.map((r) => (
            <li key={r.id}>
              <span className="org-log-when muted small">{new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              <span>
                <strong>{r.by}</strong> {r.text[0].toLowerCase() + r.text.slice(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Who sees which sport, in Settings ---------------------------------------------------
export function OrgLibrarySettings({ c, org, act }: Pick<OrgPanelProps, 'c' | 'org' | 'act'>) {
  const scope = org.org.library_scope;
  const sports = [...new Set(org.leagues.map((l) => l.sport))];
  const choice = (value: 'all' | 'sport', title: string, hint: string) => (
    <label className={`org-choice ${scope === value ? 'on' : ''}`}>
      <input type="radio" name="library-scope" checked={scope === value} onChange={() => act(() => api.orgSetLibrary(c.id, value), value === 'sport' ? 'Coaches now see only the sports they coach.' : 'Everyone now sees every sport.')} />
      <span>
        <strong>{title}</strong>
        <span className="muted small">{hint}</span>
      </span>
    </label>
  );
  return (
    <div className="card org-card">
      <h2>Drills, plays and practices by sport</h2>
      <p className="muted small">
        {c.name} runs {sports.length > 1 ? sports.join(', ').replace(/, ([^,]*)$/, ' and $1') : 'more than one sport over time'}. Choose whether a coach sees the shared material for every sport, or only for the sports
        of the teams they coach.
      </p>
      <div className="org-choices" role="radiogroup" aria-label="Who sees which sport">
        {choice('all', 'Every sport, for everyone', 'A basketball coach also sees what was shared for baseball, football and the rest.')}
        {choice('sport', 'Only the sports each coach coaches', 'Someone who coaches basketball and baseball sees those two and nothing else. Admins, and members who coach no team, still see everything.')}
      </div>
      <p className="muted small">This covers the Shared library here, the "From a community" pickers, and the drills, plays and categories a coach sees when working in one of your teams.</p>
    </div>
  );
}

// --- The public page, in Settings ------------------------------------------------------
export function OrgPublicSettings({ c, org, act }: Pick<OrgPanelProps, 'c' | 'org' | 'act'>) {
  const [slug, setSlug] = useState(org.org.public_slug);
  const [color, setColor] = useState(org.org.brand_color || '#1c5cab');
  const address = `${window.location.origin}/o/${org.org.public_slug}`;
  const feed = `${window.location.origin}/api/public/orgs/${org.org.public_slug}/calendar.ics`;
  return (
    <div className="card org-card">
      <h2>
        <Icon d={ICONS.globe} size={18} /> Public schedule page
      </h2>
      <p className="muted small">
        A page anyone can open without an account, for parents and players: your leagues, teams, game times, results and standings, under your name, picture and color. It never shows coaches' names,
        rosters or anything about players.
      </p>
      <form
        className="org-add"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => api.orgSetPublic(c.id, { public_slug: slug, brand_color: color }), 'Saved.');
        }}
      >
        <Field label="Web address" grow>
          <span className="org-slug">
            <span className="muted">{window.location.host}/o/</span>
            <input className="input" maxLength={40} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="eastside-youth" />
          </span>
        </Field>
        <Field label="Your color">
          <input className="input org-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </Field>
        <button className="btn" disabled={slug === org.org.public_slug && color === (org.org.brand_color || '#1c5cab')}>
          Save
        </button>
      </form>
      <label className="check setting">
        <input type="checkbox" checked={org.org.public_on} disabled={!org.org.public_slug} onChange={(e) => act(() => api.orgSetPublic(c.id, { public_on: e.target.checked }), e.target.checked ? 'The public page is on.' : 'The public page is off.')} />
        <span>
          <strong>Show the page to anyone with the link</strong>
          <span className="muted small"> {org.org.public_slug ? '' : 'Save a web address first.'}</span>
        </span>
      </label>
      {org.org.public_on && (
        <dl className="org-links">
          <div>
            <dt>The page</dt>
            <dd>
              <a href={address} target="_blank" rel="noreferrer">
                {address}
              </a>
              <CopyButton text={address} />
            </dd>
          </div>
          <div>
            <dt>Calendar feed</dt>
            <dd>
              <code>{feed}</code>
              <CopyButton text={feed} />
              <span className="muted small">Subscribing to this in Google Calendar, Apple Calendar or Outlook shows every game. The public page has a feed for each team too.</span>
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: ReactNode }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn small"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}
