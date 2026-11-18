// A team's page for its parents, family and friends: what is coming up, what the coaches say,
// and whatever else the coach lets their kind of follower see. Nothing here changes the team.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { api, type FamilyDay, type FamilyKind, type FamilyTeam, type FollowedTeam, type TeamPost, type User } from '../api';
import { fmtClock, fmtDateShort, parseClock, todayISO } from '../util';
import { MoreMenu } from '../components/bits';
import { SharedPreview } from '../components/community';
import { DateBlock, PageHead, Row } from '../components/cx';
import SportIcon from '../components/SportIcon';
import { PasswordForm } from './Auth';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const AS: Record<FamilyKind, string> = { parent: 'a parent', family: 'family', friend: 'a friend of the team' };
const ROLE: Record<TeamPost['role'], string> = { coach: 'Coach', parent: 'Parent', family: 'Family', friend: 'Friend' };
const KIND_WORD: Record<FamilyDay['kind'], string> = { practice: 'Practice', game: 'Game', other: 'Event' };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (t: string) => (t ? fmtClock(parseClock(t)) : '');
const when = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** "a parent of Ava and Ben", or how else this person is on the team's list. */
const asWhat = (kind: FamilyKind, players: string[]) => `${AS[kind]}${players.length ? ` of ${players.join(' and ')}` : ''}`;

/** Everything a follower's account sees: a bar across the top, and the teams they follow. */
export function FamilyApp({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [changing, setChanging] = useState(false);
  const signOut = async () => {
    await api.logout().catch(() => {});
    onChanged();
  };
  return (
    <div className="fam-shell">
      <header className="fam-top">
        <Link to="/family" className="brand" onClick={() => setChanging(false)}>
          <span className="brand-mark" aria-hidden="true" />
          Dime Coach
        </Link>
        <span className="fam-who muted small">{user.name}</span>
        <MoreMenu
          label="Your account"
          items={[
            { label: 'Change password', onSelect: () => setChanging(true) },
            { label: 'Sign out', onSelect: signOut },
          ]}
        />
      </header>
      <main className="fam-main">
        {changing ? (
          <section className="card fam-password">
            <h2>Change your password</h2>
            <PasswordForm onDone={() => {}} />
            <button type="button" className="link small" onClick={() => setChanging(false)}>
              Back to your teams
            </button>
          </section>
        ) : (
          <Routes>
            <Route path="/family" element={<FamilyHome name={user.name} />} />
            <Route path="/family/:teamId" element={<FamilyTeamPage />} />
            <Route path="*" element={<Navigate to="/family" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}

/** The teams a person follows. With only one, it opens. */
export function FamilyHome({ name }: { name: string }) {
  const [teams, setTeams] = useState<FollowedTeam[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.followedTeams().then(setTeams, (e) => setError((e as Error).message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!teams) return <p className="muted">Loading…</p>;
  if (teams.length === 1) return <Navigate to={`/family/${teams[0].id}`} replace />;
  return (
    <div className="page cx fam">
      <PageHead eyebrow="Your teams" title={`Hello, ${name.split(' ')[0]}`} sub={teams.length ? 'Choose a team to see its schedule and what its coaches have shared.' : undefined} />
      {teams.length === 0 ? (
        <div className="card">
          <p className="muted">You are not following a team right now. A coach adds you to their team's parents, family and friends, and the team then shows here.</p>
        </div>
      ) : (
        <section className="card cx-card">
          <ul className="cx-rows">
            {teams.map((t) => (
              <li key={t.id}>
                <Link className="cx-row fam-team-row" to={`/family/${t.id}`}>
                  <SportIcon sport={t.sport} size={26} />
                  <span className="cx-row-text">
                    <strong>{t.name}</strong>
                    <span className="muted small">{[t.sport, t.season, `You are ${asWhat(t.kind, t.players)}`].filter(Boolean).join(' · ')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type Tab = 'home' | 'schedule' | 'messages' | 'homework' | 'playbook' | 'resources' | 'roster';

/** One team, as a follower sees it. */
export function FamilyTeamPage() {
  const { teamId = '' } = useParams();
  const id = Number(teamId);
  const [data, setData] = useState<FamilyTeam | null>(null);
  const [error, setError] = useState('');
  const [others, setOthers] = useState(0);
  const [params, setParams] = useSearchParams();
  const load = useCallback(() => api.familyTeam(id).then(setData, (e) => setError((e as Error).message)), [id]);
  useEffect(() => {
    setData(null);
    setError('');
    load();
    api.followedTeams().then((t) => setOthers(t.length - 1), () => {});
  }, [load]);
  if (error)
    return (
      <div className="page cx fam">
        <div className="card">
          <h2>This team's page is not open to you</h2>
          <p className="muted">{error}</p>
          <Link className="btn" to="/family">
            Your teams
          </Link>
        </div>
      </div>
    );
  if (!data) return <p className="muted">Loading…</p>;
  const { team, can } = data;
  const tabs: [Tab, string, number?][] = [
    ['home', 'Home'],
    ...(can.schedule ? [['schedule', 'Schedule'] as [Tab, string]] : []),
    ...(can.news || can.board ? [['messages', 'Messages'] as [Tab, string]] : []),
    ...(can.homework ? [['homework', 'Homework', data.homework.length] as [Tab, string, number]] : []),
    ...(can.playbook ? [['playbook', 'Playbook', data.plays.length] as [Tab, string, number]] : []),
    ...(can.resources ? [['resources', 'Resources', data.resources.length] as [Tab, string, number]] : []),
    ...(can.roster ? [['roster', 'Team'] as [Tab, string]] : []),
  ];
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = tabs.some(([t]) => t === asked) ? asked! : 'home';
  const go = (t: Tab, extra: Record<string, string> = {}) => setParams(t === 'home' ? {} : { tab: t, ...extra }, { replace: true });
  const today = todayISO();
  const coming = data.schedule.filter((d) => d.date >= today);

  return (
    <div className="page cx fam">
      <PageHead
        eyebrow={[team.organization, team.sport, team.season].filter(Boolean).join(' · ') || 'Team'}
        title={team.name}
        sub={`You are here as ${asWhat(data.me.kind, data.me.players)}.`}
      >
        {others > 0 && (
          <Link className="btn" to="/family">
            Your other teams
          </Link>
        )}
      </PageHead>
      {tabs.length > 1 && (
        <nav className="seg team-tabs cx-seg-tabs" aria-label={`Parts of ${team.name}`}>
          {tabs.map(([t, label, count]) => (
            <button key={t} type="button" className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
              {label}
              {!!count && <span className="cm-count">{count}</span>}
            </button>
          ))}
        </nav>
      )}

      {tab === 'home' && (
        <div className="fam-home">
          {can.schedule && (
            <section className="card cx-card">
              <div className="cx-card-head">
                <h2>Next up</h2>
                <button type="button" className="link cx-card-action" onClick={() => go('schedule')}>
                  Full schedule
                </button>
              </div>
              {coming.length === 0 ? <p className="muted">Nothing on the schedule yet.</p> : <DayList days={coming.slice(0, 4)} />}
            </section>
          )}
          {can.news && (
            <section className="card cx-card">
              <div className="cx-card-head">
                <h2>From the coaches</h2>
                {data.news.length > 1 && (
                  <button type="button" className="link cx-card-action" onClick={() => go('messages')}>
                    All {data.news.length} announcements
                  </button>
                )}
              </div>
              {data.news.length === 0 ? <p className="muted">No announcements yet.</p> : <Post post={data.news[0]} />}
            </section>
          )}
          {can.homework && data.homework.length > 0 && (
            <section className="card cx-card">
              <div className="cx-card-head">
                <h2>Homework</h2>
                <button type="button" className="link cx-card-action" onClick={() => go('homework')}>
                  Open
                </button>
              </div>
              <ul className="cx-rows">
                {data.homework.slice(0, 3).map((h) => (
                  <Row key={h.id} title={h.title} sub={[h.for.length ? `For ${h.for.join(' and ')}` : 'For the whole team', h.date && fmtDateShort(h.date)].filter(Boolean).join(' · ')} onClick={() => go('homework')} />
                ))}
              </ul>
            </section>
          )}
          <section className="card cx-card">
            <h2>Coaches</h2>
            {team.coaches.length === 0 ? (
              <p className="muted">No coach is named yet.</p>
            ) : (
              <ul className="cx-rows">
                {team.coaches.map((c, i) => (
                  <Row key={i} title={c.name} sub={c.title} />
                ))}
              </ul>
            )}
          </section>
          {tabs.length === 1 && (
            <section className="card cx-card">
              <p className="muted">The coaches have not opened any other part of the team's page to you. Ask them if you were expecting to see more here.</p>
            </section>
          )}
        </div>
      )}

      {tab === 'schedule' && <Schedule days={data.schedule} today={today} />}
      {tab === 'messages' && <Messages teamId={id} data={data} start={params.get('show') === 'board' || !can.news ? 'board' : 'news'} setBoard={(board) => setData({ ...data, board })} />}

      {tab === 'homework' &&
        (data.homework.length === 0 ? (
          <div className="card">
            <p className="muted">No homework has been set.</p>
          </div>
        ) : (
          data.homework.map((h) => (
            <section key={h.id} className="card fam-sheet">
              <header>
                <h2>{h.title}</h2>
                <span className="muted small">{[h.for.length ? `For ${h.for.join(' and ')}` : 'For the whole team', h.date && fmtDateShort(h.date)].filter(Boolean).join(' · ')}</span>
              </header>
              <SharedPreview detail={{ kind: 'plan', content: h.content }} />
            </section>
          ))
        ))}

      {tab === 'playbook' &&
        (data.plays.length === 0 ? (
          <div className="card">
            <p className="muted">The coaches have not shared any plays yet.</p>
          </div>
        ) : (
          <div className="fam-plays">
            {data.plays.map((p) => (
              <section key={p.id} className="card">
                <SharedPreview detail={{ kind: 'play', content: p }} />
              </section>
            ))}
          </div>
        ))}

      {tab === 'resources' && (
        <section className="card cx-card">
          <h2>Resources</h2>
          {data.resources.length === 0 ? (
            <p className="muted">The coaches have not shared any links, pictures or videos yet.</p>
          ) : (
            <ul className="cx-rows">
              {data.resources.map((r) => {
                const href = r.kind === 'link' ? r.url : `/api/family/teams/${id}/files/${r.file_id}`;
                return (
                  <li key={r.key}>
                    <a className="cx-row fam-res" href={href} target="_blank" rel="noopener noreferrer">
                      {r.kind === 'image' ? <img src={href} alt="" loading="lazy" /> : <span className="fam-res-kind">{r.kind === 'video' ? 'Video' : 'Link'}</span>}
                      <span className="cx-row-text">
                        <strong>{r.title}</strong>
                        {r.kind === 'link' && <span className="muted small">{r.url}</span>}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === 'roster' && (
        <div className="fam-home">
          <section className="card cx-card">
            <h2>
              Players <span className="muted">({data.roster.length})</span>
            </h2>
            {data.roster.length === 0 ? (
              <p className="muted">No players on the roster yet.</p>
            ) : (
              <ul className="cx-rows">
                {data.roster.map((p, i) => (
                  <Row key={i} lead={<span className="fam-num">{p.number || '–'}</span>} title={p.name} sub={p.position || undefined} />
                ))}
              </ul>
            )}
          </section>
          <section className="card cx-card">
            <h2>Coaches</h2>
            <ul className="cx-rows">
              {team.coaches.map((c, i) => (
                <Row key={i} title={c.name} sub={c.title} />
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function DayList({ days }: { days: FamilyDay[] }) {
  return (
    <ul className="cx-rows">
      {days.map((d) => (
        <Row
          key={d.key}
          lead={<DateBlock date={d.date} />}
          title={d.title}
          sub={[KIND_WORD[d.kind], [clock(d.start_time), clock(d.end_time)].filter(Boolean).join(' – '), d.location].filter(Boolean).join(' · ')}
        />
      ))}
    </ul>
  );
}

/** The team's month, in the dress of a coach's calendar, with what is coming listed under it. */
function Schedule({ days, today }: { days: FamilyDay[]; today: string }) {
  const next = days.find((d) => d.date >= today)?.date ?? today;
  const home: [number, number] = [Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1];
  const [[year, month], setMonth] = useState<[number, number]>(home);
  const [picked, setPicked] = useState('');
  const shift = (by: number) => {
    const d = new Date(year, month + by, 1);
    setMonth([d.getFullYear(), d.getMonth()]);
  };
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { date: string; inMonth: boolean; day: number }[] = [];
  for (let i = -first.getDay(); cells.length % 7 !== 0 || i < daysInMonth; i++) {
    const d = new Date(year, month, 1 + i);
    cells.push({ date: isoOf(d), inMonth: d.getMonth() === month, day: d.getDate() });
  }
  const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const inMonth = days.filter((d) => d.date.startsWith(`${year}-${pad(month + 1)}`));
  const atHome = year === home[0] && month === home[1];
  const listed = picked ? days.filter((d) => d.date === picked) : days.filter((d) => d.date >= today).slice(0, 12);
  return (
    <>
      <section className="card cx-card">
        <div className="cal fam-cal">
          <div className="cal-head">
            <div className="cal-nav">
              <button type="button" className="tl-arrow" aria-label="Previous month" onClick={() => shift(-1)}>
                ‹
              </button>
              <h2 className="cal-title">{title}</h2>
              <button type="button" className="tl-arrow" aria-label="Next month" onClick={() => shift(1)}>
                ›
              </button>
              {!atHome && (
                <button type="button" className="link small" onClick={() => setMonth(home)}>
                  Back to next up
                </button>
              )}
            </div>
            <span className="muted small">{inMonth.length ? `${plural(inMonth.length, 'day')} on the schedule` : 'Nothing scheduled this month'}</span>
          </div>
          <div className="cal-grid" role="grid" aria-label={title}>
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal-weekday" role="columnheader">
                {d}
              </div>
            ))}
            {cells.map((c) => (
              <div key={c.date} role="gridcell" className={`cal-day ${c.inMonth ? '' : 'out'} ${c.date === today ? 'today' : ''} ${c.date < today ? 'past' : ''} ${picked === c.date ? 'picked' : ''}`}>
                <div className="cal-day-top">
                  <span className="cal-num">{c.day}</span>
                </div>
                {days
                  .filter((d) => d.date === c.date)
                  .slice(0, 3)
                  .map((d) => (
                    <button key={d.key} type="button" className={`cal-chip ${d.kind}`} aria-label={`${d.title}, ${fmtDateShort(d.date)}${d.start_time ? `, ${clock(d.start_time)}` : ''}`} onClick={() => setPicked(picked === c.date ? '' : c.date)}>
                      {d.start_time && <span className="cal-time">{clock(d.start_time)}</span>}
                      <span className="cal-name">{d.title}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
          <div className="cal-legend muted small">
            <span className="cal-chip practice">Practice</span>
            <span className="cal-chip game">Game</span>
            <span className="cal-chip other">Event</span>
          </div>
        </div>
      </section>
      <section className="card cx-card">
        <div className="cx-card-head">
          <h2>{picked ? fmtDateShort(picked) : 'Coming up'}</h2>
          {picked && (
            <button type="button" className="link cx-card-action" onClick={() => setPicked('')}>
              Show what is coming up
            </button>
          )}
        </div>
        {listed.length === 0 ? <p className="muted">Nothing on the schedule yet.</p> : <DayList days={listed} />}
      </section>
    </>
  );
}

function Post({ post, onDelete }: { post: TeamPost; onDelete?: () => void }) {
  return (
    <article className={`fam-post ${post.role === 'coach' ? 'coach' : ''}`}>
      <header>
        <strong>{post.author}</strong>
        <span className="kind">{ROLE[post.role]}</span>
        <span className="muted small">{when(post.at)}</span>
        {onDelete && (
          <button type="button" className="link small" onClick={onDelete}>
            Delete
          </button>
        )}
      </header>
      {post.title && <h3>{post.title}</h3>}
      <p>{post.body}</p>
    </article>
  );
}

/** What the coaches announced, and the board where the team's people talk. */
function Messages({ teamId, data, start, setBoard }: { teamId: number; data: FamilyTeam; start: 'news' | 'board'; setBoard: (posts: TeamPost[]) => void }) {
  const both = data.can.news && data.can.board;
  const [show, setShow] = useState<'news' | 'board'>(start);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (work: () => Promise<TeamPost[]>) => {
    setBusy(true);
    try {
      setBoard(await work());
      setError('');
      setBusy(false);
      return true;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      return false;
    }
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (await act(() => api.familyPost(teamId, body))) setBody('');
  };
  return (
    <>
      {both && (
        <div className="cx-subtabs" role="tablist" aria-label="Messages">
          <button type="button" role="tab" aria-selected={show === 'news'} className={show === 'news' ? 'on' : ''} onClick={() => setShow('news')}>
            Announcements
            {data.news.length > 0 && <span className="cm-count">{data.news.length}</span>}
          </button>
          <button type="button" role="tab" aria-selected={show === 'board'} className={show === 'board' ? 'on' : ''} onClick={() => setShow('board')}>
            Message board
            {data.board.length > 0 && <span className="cm-count">{data.board.length}</span>}
          </button>
        </div>
      )}
      {show === 'news' && (
        <section className="card cx-card">
          <h2>Announcements from the coaches</h2>
          {data.news.length === 0 ? <p className="muted">No announcements yet.</p> : data.news.map((p) => <Post key={p.id} post={p} />)}
        </section>
      )}
      {show === 'board' && (
        <section className="card cx-card">
          <h2>Message board</h2>
          <p className="muted small">Seen by the coaches and by everyone the board is open to on this team.</p>
          <form className="fam-write" onSubmit={send}>
            <textarea className="input" rows={2} maxLength={4000} aria-label="Your message" placeholder="Write to the team…" value={body} onChange={(e) => setBody(e.target.value)} />
            <button className="btn primary" disabled={busy || !body.trim()}>
              Post
            </button>
          </form>
          {error && <p className="error">{error}</p>}
          {data.board.length === 0 ? <p className="muted">Nobody has written yet.</p> : data.board.map((p) => <Post key={p.id} post={p} onDelete={p.mine ? () => act(() => api.familyDeletePost(teamId, p.id)) : undefined} />)}
        </section>
      )}
    </>
  );
}
