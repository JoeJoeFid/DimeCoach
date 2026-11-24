// A team's page for its parents, family and friends: what is coming up, what the coaches say,
// and whatever else the coach lets their kind of follower see. Nothing here changes the team.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SharedPlay } from '../api';
import Chat, { useChatUnread } from '../components/Chat';
import { api, listenLive, type FamilyDay, type FamilyKind, type FamilyResource, type FamilyTeam, type FollowedTeam, type TeamPost, type User } from '../api';
import { fmtClock, fmtDateShort, parseClock, todayISO } from '../util';
import { Modal } from '../components/bits';
import { SharedPreview } from '../components/community';
import { PlayDiagram } from '../components/PlayDiagram';
import { CategoryChips, DateBlock, LayoutToggle, PageHead, Row, useCompact } from '../components/cx';
import SportIcon from '../components/SportIcon';
import { PasswordForm } from './Auth';
import { FollowedTeams, NEW_TEAM_KEY } from '../components/TeamPicker';
import { NAV_ICONS, UserMenu } from '../App';
import Inbox from '../components/Inbox';
import { MyStats } from './Stats';
import GameVideo from '../components/GameVideo';
import LivePlays from '../components/LivePlays';
import { SharedFilms } from '../components/Film';
import { useAppBadge } from '../push';
import { partName, scoringFor, scoringOfCode } from '../sportOf';
import { MentionArea, MentionText, useFocusPost } from '../components/Mentions';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const AS: Record<FamilyKind | 'guest', string> = { parent: 'a parent', family: 'family', friend: 'a friend of the team', guest: 'a guest, to watch video shared with you' };
const ROLE: Record<TeamPost['role'], string> = { coach: 'Coach', parent: 'Parent', family: 'Family', friend: 'Friend' };
const KIND_WORD: Record<FamilyDay['kind'], string> = { practice: 'Practice', game: 'Game', other: 'Event' };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (t: string) => (t ? fmtClock(parseClock(t)) : '');
const when = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** "a parent of Ava and Ben", or how else this person is on the team's list. */
const asWhat = (kind: FamilyKind | 'guest', players: string[]) => `${AS[kind]}${players.length ? ` of ${players.join(' and ')}` : ''}`;

/** What the frame around a follower's pages needs: who they are, and what its buttons do. */
interface Frame {
  user: User;
  onNewTeam: () => void;
  onPassword: () => void;
  onSignOut: () => void;
  /** Something about the account changed, and it should be read again. */
  onChanged: () => void;
}

/** Everything a follower's account sees: choosing a team, the team's pages, and the way into coaching. */
export function FamilyApp({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [changing, setChanging] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const signOut = async () => {
    await api.logout().catch(() => {});
    onChanged();
  };
  // A team of their own is for someone who coaches. An account marked as paid becomes a coach's
  // account on the spot. Anyone else is shown how to get started.
  const newTeam = async () => {
    if (!user.paid) return navigate('/family/coach');
    try {
      await api.startCoaching();
      sessionStorage.setItem(NEW_TEAM_KEY, '1');
      navigate('/');
      onChanged();
    } catch {
      navigate('/family/coach');
    }
  };
  const frame: Frame = { user, onNewTeam: newTeam, onPassword: () => setChanging(true), onSignOut: signOut, onChanged };
  if (changing)
    return (
      <div className="auth team-pick">
        <div className="auth-card">
          <h1>Change your password</h1>
          <PasswordForm onDone={() => {}} />
          <p className="muted small auth-foot team-pick-foot">
            <button type="button" className="link" onClick={() => setChanging(false)}>
              Back
            </button>
          </p>
        </div>
      </div>
    );
  if (pathname === '/family/coach') return <StartCoaching user={user} onBack={() => navigate('/family')} onSignOut={signOut} />;
  // Choosing a team comes first, as it does for a coach: after signing in, and whenever "Switch team" is pressed.
  if (!/^\/family\/[^/]+/.test(pathname)) return <FamilyPicker name={user.name} onPick={(slug) => navigate(`/family/${slug}`)} onNewTeam={newTeam} onPassword={() => setChanging(true)} onSignOut={signOut} />;
  return (
    <Routes>
      <Route path="/family/:teamId" element={<FamilyTeamPage frame={frame} />} />
      <Route path="*" element={<Navigate to="/family" replace />} />
    </Routes>
  );
}

/**
 * Where someone who follows teams finds out about coaching one. For now it says what a coach gets
 * and who turns it on. Paying for it will go here.
 */
function StartCoaching({ user, onBack, onSignOut }: { user: User; onBack: () => void; onSignOut: () => void }) {
  return (
    <div className="auth team-pick start-coach">
      <div className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark" aria-hidden="true" />
          Dime Coach
        </div>
        <h1>Get started as a coach</h1>
        <p className="muted auth-lead">Your account follows teams as a parent, family or a friend. A team of your own needs a coach's account.</p>
        <ul className="start-coach-list">
          <li>
            <strong>Plan practices and games</strong>
            <span className="muted small">Build each practice from your own drills, minute by minute.</span>
          </li>
          <li>
            <strong>Draw and animate plays</strong>
            <span className="muted small">A playbook your team can watch, step by step.</span>
          </li>
          <li>
            <strong>Keep your team in the loop</strong>
            <span className="muted small">A page for parents, family and friends, like the ones you already follow.</span>
          </li>
        </ul>
        <div className="start-coach-how">
          <strong>Coaching is not turned on for your account yet.</strong>
          <p className="muted small">Ask the person who runs this site to turn it on for {user.email}. Once they have, "+ New team" will start your first team.</p>
        </div>
        <p className="muted small auth-foot team-pick-foot">
          <button type="button" className="link" onClick={onBack}>
            Back to your teams
          </button>
          <button type="button" className="link" onClick={onSignOut}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

/** The parts of a team's page in the menu at the side, grouped as a coach's menu is. */
// Worked out when it is drawn: the icons belong to the app's own file, which is still loading when this one is read.
const sideGroups = (): { title: string; items: [Tab, string][] }[] => [
  { title: 'Plan', items: [['schedule', NAV_ICONS.practices], ['homework', NAV_ICONS.homework], ['video', NAV_ICONS.video]] },
  { title: 'Library', items: [['drills', NAV_ICONS.library], ['playbook', NAV_ICONS.playbook], ['resources', NAV_ICONS.resources], ['film', NAV_ICONS.filmroom]] },
  { title: 'Team', items: [['roster', NAV_ICONS.teams], ['stats', NAV_ICONS.stats]] },
  { title: 'Community', items: [['chat', NAV_ICONS.chat], ['inbox', NAV_ICONS.messages], ['messages', NAV_ICONS.community]] },
];

/**
 * The frame around a follower's team: the same menu down the side that a coach has, with only
 * the parts of the team's page the coaches have opened to them.
 */
function FamilyFrame({ frame, team, tabs, tab, go, children }: { frame: Frame; team?: FamilyTeam['team']; tabs: [Tab, string, number?][]; tab: Tab; go: (t: Tab) => void; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  // Unread messages light up Messages in the menu, as they do for a coach.
  const chatUnread = useChatUnread();
  const [unread, setUnread] = useState(0);
  // The same count goes on the app's icon, where it has one.
  useAppBadge(unread + chatUnread);
  useEffect(() => {
    const look = () => api.messages().then((n) => setUnread(n.unread), () => {});
    look();
    const timer = window.setInterval(look, 60_000);
    const told = (e: Event) => setUnread((e as CustomEvent<number>).detail);
    window.addEventListener('dime:unread', told);
    const stop = listenLive(() => {
      look();
      window.dispatchEvent(new Event('dime:news'));
    });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('dime:unread', told);
      stop();
    };
  }, []);
  const has = (t: Tab) => tabs.find(([id]) => id === t);
  const item = (t: Tab, icon: string) => {
    const found = has(t);
    if (!found) return null;
    return (
      <a
        key={t}
        href={t === 'home' ? '?' : `?tab=${t}`}
        className={tab === t ? 'active' : ''}
        aria-current={tab === t ? 'page' : undefined}
        onClick={(e) => {
          e.preventDefault();
          setMenuOpen(false);
          go(t);
        }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={icon} />
        </svg>
        {found[1]}
        {t === 'inbox' && unread > 0 && (
          <span className="nav-badge" title={`${unread} unread message${unread === 1 ? '' : 's'}`}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        {t === 'chat' && chatUnread > 0 && (
          <span className="nav-badge" title={`${chatUnread} unread in your chats`}>
            {chatUnread > 9 ? '9+' : chatUnread}
          </span>
        )}
      </a>
    );
  };
  return (
    <div className={`shell fam-frame ${menuOpen ? 'menu-open' : ''}`}>
      <header className="mobile-bar">
        <button type="button" className="menu-btn" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-label="Menu">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        {/* The mark and the team's name lead back to the team's first page. */}
        <a
          href="?"
          className="mobile-home"
          aria-label={`${team?.name ?? 'Dime Coach'}: home`}
          onClick={(e) => {
            e.preventDefault();
            go('home');
          }}
        >
          <span className="brand-mark" aria-hidden="true" />
          <span className="mobile-team">{team?.name ?? 'Dime Coach'}</span>
        </a>
      </header>
      {menuOpen && <div className="menu-scrim" onClick={() => setMenuOpen(false)} />}
      <aside className="sidebar">
        <div className="side-top">
          <Link to="/family" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Dime Coach
          </Link>
          <button type="button" className="menu-close" onClick={() => setMenuOpen(false)} aria-label="Close the menu">
            ✕
          </button>
        </div>
        <div className="team-now">
          <strong>{team?.name ?? 'Your teams'}</strong>
          {team && <span className="muted small">{[team.sport, team.season].filter(Boolean).join(' · ')}</span>}
          <button type="button" className="btn small" onClick={() => navigate('/family')}>
            Switch team
          </button>
        </div>
        <nav className="side-nav" aria-label="Main">
          {item('home', NAV_ICONS.dashboard)}
          {sideGroups().map((g) => {
            const links = g.items.map(([t, icon]) => item(t, icon)).filter(Boolean);
            return links.length ? (
              <div className="nav-group" key={g.title} role="group" aria-label={g.title}>
                <span className="side-label">{g.title}</span>
                {links}
              </div>
            ) : null;
          })}
        </nav>
        <div className="side-foot fam-foot">
          <button type="button" className="btn small" onClick={frame.onNewTeam}>
            + New team
          </button>
          <UserMenu user={frame.user} onPassword={frame.onPassword} onSignOut={frame.onSignOut} />
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

/** Choosing which team to open, for someone who only follows teams. It looks and works as a coach's does. */
function FamilyPicker({ name, onPick, onNewTeam, onPassword, onSignOut }: { name: string; onPick: (slug: string) => void; onNewTeam: () => void; onPassword: () => void; onSignOut: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  const first = name.trim().split(/\s+/)[0];
  return (
    <div className="auth team-pick">
      <div className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark" aria-hidden="true" />
          Dime Coach
        </div>
        <h1>{count === 0 ? `Hello${first ? `, ${first}` : ''}` : `Which team${first ? `, ${first}` : ''}?`}</h1>
        {count === 0 && <p className="muted auth-lead">You are not following a team right now. A coach adds you to their team's parents, family and friends, and the team then shows here.</p>}
        <FollowedTeams onPick={onPick} onCount={setCount} />
        <button type="button" className="btn team-pick-new" onClick={onNewTeam}>
          + New team
        </button>
        <p className="muted small auth-foot team-pick-foot">
          <button type="button" className="link" onClick={onPassword}>
            Change password
          </button>
          <button type="button" className="link" onClick={onSignOut}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

/** The teams a person follows, inside a coach's app. With only one, it opens. */
export function FamilyHome({ name }: { name: string }) {
  const [teams, setTeams] = useState<FollowedTeam[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.followedTeams().then(setTeams, (e) => setError((e as Error).message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!teams) return <p className="muted">Loading…</p>;
  if (teams.length === 1) return <Navigate to={`/family/${teams[0].slug}`} replace />;
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
                <Link className="cx-row fam-team-row" to={`/family/${t.slug}`}>
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

/** The little picture at the head of each box on the dashboard: a calendar, a broadcast, a megaphone, a book. Each on a tile of its own color. */
function BoxIcon({ kind }: { kind: 'schedule' | 'live' | 'news' | 'homework' }) {
  const art = {
    schedule: 'M5 6h14v14H5ZM5 10h14M9 3.500V7M15 3.500V7M8.500 14.500l2.300 2.300 4.700-4.700',
    live: 'M12 13.500a1.500 1.500 0 1 0 0-3 1.500 1.500 0 0 0 0 3ZM8.500 15.500a5 5 0 0 1 0-7M15.500 8.500a5 5 0 0 1 0 7M5.800 18.200a9 9 0 0 1 0-12.400M18.200 5.800a9 9 0 0 1 0 12.400',
    news: 'M4 10v4h3l7 4V6l-7 4H4ZM17.500 9.500a3.500 3.500 0 0 1 0 5M8 14.500l1 4.500h2.500',
    homework: 'M5 5.500A1.500 1.500 0 0 1 6.500 4H19v13H6.500A1.500 1.500 0 0 0 5 18.500v-13ZM5 18.500A1.500 1.500 0 0 0 6.500 20H19M9 8.500h6M9 12h4',
  }[kind];
  return (
    <span className={`fam-ico ${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={art} />
      </svg>
    </span>
  );
}

type Tab = 'home' | 'schedule' | 'chat' | 'messages' | 'inbox' | 'stats' | 'video' | 'homework' | 'playbook' | 'drills' | 'resources' | 'film' | 'roster';

/** One team, as a follower sees it. */
export function FamilyTeamPage({ frame }: { /** Present for an account that only follows teams: the page then wears the menu at the side. */ frame?: Frame } = {}) {
  const { teamId: id = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<FamilyTeam | null>(null);
  const [error, setError] = useState('');
  const [others, setOthers] = useState(0);
  const [params, setParams] = useSearchParams();
  const load = useCallback(() => api.familyTeam(id).then(setData, (e) => setError((e as Error).message)), [id]);
  // An address written the old way, or with the team's old name, is put right once the team is known.
  const slug = data?.team.slug;
  useEffect(() => {
    if (slug && slug !== id) navigate({ pathname: `/family/${slug}`, search: window.location.search }, { replace: true });
  }, [slug, id, navigate]);
  useEffect(() => {
    setData(null);
    setError('');
    load();
    api.followedTeams().then((t) => setOthers(t.length - 1), () => {});
    // A score that moves while the page is open shows without loading it again.
    window.addEventListener('dime:news', load);
    return () => window.removeEventListener('dime:news', load);
  }, [load]);
  const framed = (inner: ReactNode, team?: FamilyTeam['team'], tabs: [Tab, string, number?][] = [], tab: Tab = 'home', go: (t: Tab) => void = () => {}) =>
    frame ? (
      <FamilyFrame frame={frame} team={team} tabs={tabs} tab={tab} go={go}>
        {inner}
      </FamilyFrame>
    ) : (
      <>{inner}</>
    );
  if (error)
    return framed(
      <div className="page cx fam">
        <div className="card">
          <h2>This team's page is not open to you</h2>
          <p className="muted">{error}</p>
          <Link className="btn" to="/family">
            Your teams
          </Link>
        </div>
      </div>,
    );
  if (!data) return framed(<p className="page muted">Loading…</p>);
  const { team, can } = data;
  const hasVideo = data.video.watch || data.video.broadcast;
  const hasPlays = can.schedule && can.games;
  const tabs: [Tab, string, number?][] = [
    ['home', 'Dashboard'],
    ...(can.schedule ? [['schedule', 'Schedule'] as [Tab, string]] : []),
    // Chat is the person's own, like their inbox: the team's chat and any they started with other people.
    ...(frame ? [['chat', 'Chat'] as [Tab, string]] : []),
    ...(can.news || can.board ? [['messages', 'Team news'] as [Tab, string]] : []),
    // Their own inbox, which is not about this team alone. A coach who also follows the team has theirs in the coach's menu.
    ...(frame ? [['inbox', 'Messages'] as [Tab, string], ['stats', 'Stats'] as [Tab, string]] : []),
    ...(can.homework ? [['homework', 'Homework', data.homework.length] as [Tab, string, number]] : []),
    // Live game: its video for those allowed to watch or broadcast, and its play by play for those told about games.
    ...(hasVideo || hasPlays ? [['video', 'Live game'] as [Tab, string]] : []),
    ...(can.playbook ? [['playbook', 'Playbook', data.plays.length] as [Tab, string, number]] : []),
    ...(can.drills ? [['drills', 'Drills', data.drills.length] as [Tab, string, number]] : []),
    ...(can.resources ? [['resources', 'Resources', data.resources.length] as [Tab, string, number]] : []),
    // Video from the Filmroom that a coach shared with this person. All a guest is here for.
    ...(data.film > 0 || data.me.kind === 'guest' ? [['film', 'Filmroom', data.film] as [Tab, string, number]] : []),
    ...(can.roster ? [['roster', 'Team'] as [Tab, string]] : []),
  ];
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = tabs.some(([t]) => t === asked) ? asked! : data.me.kind === 'guest' ? 'film' : 'home';
  const go = (t: Tab, extra: Record<string, string> = {}) => setParams(t === 'home' ? {} : { tab: t, ...extra }, { replace: true });
  const openChat = (chatId: number) => go('chat', chatId ? { chat: String(chatId) } : {});
  const today = todayISO();
  const coming = data.schedule.filter((d) => d.date >= today);
  const next = coming[0];

  return framed(
    <div className="page cx fam">
      <PageHead
        eyebrow={[team.organization, team.sport, team.season].filter(Boolean).join(' · ') || 'Team'}
        title={team.name}
        sub={`You are here as ${asWhat(data.me.kind, data.me.players)}.`}
      >
        {others > 0 && !frame && (
          <Link className="btn" to="/family">
            Switch team
          </Link>
        )}
      </PageHead>
      {/* In the frame, the parts of the page are in the menu at the side. */}
      {tabs.length > 1 && !frame && (
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
        <div className={`fam-home ${can.schedule ? 'with-schedule' : ''}`}>
          {can.schedule && (
            <section className="card cx-card fam-home-schedule">
              <div className="cx-card-head">
                <h2 className="fam-h">
                  <BoxIcon kind="schedule" />
                  Schedule
                </h2>
                <button type="button" className="link cx-card-action" onClick={() => go('schedule')}>
                  Full schedule
                </button>
              </div>
              {!next ? (
                <p className="muted">Nothing on the schedule yet.</p>
              ) : (
                <>
                  <NextUp day={next} today={today} />
                  {coming.length > 1 && (
                    <>
                      <h3 className="fam-then">After that</h3>
                      <DayList days={coming.slice(1, 8)} />
                    </>
                  )}
                </>
              )}
            </section>
          )}
          {/* What is going on this minute: video going out, or a game being scored. First on the right, above the coaches. */}
          {(hasVideo || hasPlays) && (
            <section className={`card cx-card fam-now ${data.video.live || data.live_game ? 'on' : ''}`} aria-label="Live now">
              <div className="cx-card-head">
                <h2 className="fam-h">
                  <BoxIcon kind="live" />
                  Live now
                </h2>
              </div>
              {!data.video.live && !data.live_game ? (
                <p className="muted">Nothing is live right now. A game's video or play by play shows here the moment it starts.</p>
              ) : (
                <ul className="fam-now-list">
                  {data.live_game && (
                    <li>
                      <button type="button" className="fam-now-row" onClick={() => go('video', { mode: 'plays' })}>
                        <span className="gv-badge">LIVE</span>
                        <span className="fam-now-text">
                          <strong>
                            {team.name} {data.live_game.us} · {data.live_game.opponent} {data.live_game.them}
                          </strong>
                          <span className="muted small">Play by play · {partName(scoringFor(team.sport), data.live_game.period, data.live_game.halves)}</span>
                        </span>
                        <span className="fam-now-go">Follow</span>
                      </button>
                    </li>
                  )}
                  {data.video.live && (
                    <li>
                      <button type="button" className="fam-now-row" onClick={() => go('video', { mode: 'video' })}>
                        <span className="gv-badge">LIVE</span>
                        <span className="fam-now-text">
                          <strong>Game video</strong>
                          <span className="muted small">A game is being broadcast now</span>
                        </span>
                        <span className="fam-now-go">Watch</span>
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </section>
          )}
          {can.news && (
            <section className="card cx-card">
              <div className="cx-card-head">
                <h2 className="fam-h">
                  <BoxIcon kind="news" />
                  From the coaches
                </h2>
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
                <h2 className="fam-h">
                  <BoxIcon kind="homework" />
                  Homework
                </h2>
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
          {tabs.length === 1 && (
            <section className="card cx-card">
              <p className="muted">The coaches have not opened any other part of the team's page to you. Ask them if you were expecting to see more here.</p>
            </section>
          )}
        </div>
      )}

      {tab === 'schedule' && <Schedule days={data.schedule} today={today} />}
      {tab === 'film' && <SharedFilms teamId={team.id} openId={Number(params.get('share')) || undefined} />}
      {tab === 'messages' && <Messages teamId={id} data={data} me={frame?.user.name} start={params.get('show') === 'board' || !can.news ? 'board' : 'news'} setBoard={(board) => setData({ ...data, board })} />}
      {tab === 'chat' && frame && <Chat me={frame.user} openId={Number(params.get('chat')) || 0} onOpen={openChat} />}
      {tab === 'stats' && frame && <MyStats />}
      {tab === 'video' &&
        (() => {
          // Two ways to follow a game. Whichever this person has; play by play first when a game is being scored and no video is out.
          const asked = params.get('mode');
          const mode = hasVideo && hasPlays ? (asked === 'plays' || asked === 'video' ? asked : data.live_game && !data.video.live ? 'plays' : 'video') : hasPlays ? 'plays' : 'video';
          return (
            <>
              {hasVideo && hasPlays && (
                <div className="seg lp-modes" role="group" aria-label="How to follow the game">
                  <button type="button" className={mode === 'video' ? 'on' : ''} aria-pressed={mode === 'video'} onClick={() => go('video', { mode: 'video' })}>
                    Video {data.video.live && <span className="lp-dot" aria-label="live" />}
                  </button>
                  <button type="button" className={mode === 'plays' ? 'on' : ''} aria-pressed={mode === 'plays'} onClick={() => go('video', { mode: 'plays' })}>
                    Play by play {data.live_game && <span className="lp-dot" aria-label="live" />}
                  </button>
                </div>
              )}
              {mode === 'plays' ? <LivePlays teamId={id} teamName={team.name} /> : <GameVideo teamId={team.id} />}
            </>
          );
        })()}
      {tab === 'inbox' && frame && (
        <Inbox
          user={frame.user}
          onUserChanged={frame.onChanged}
          onUnread={(n) => window.dispatchEvent(new CustomEvent('dime:unread', { detail: n }))}
        />
      )}

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

      {tab === 'playbook' && <FamilyPlaybook plays={data.plays} />}

      {tab === 'drills' &&
        (data.drills.length === 0 ? (
          <section className="card cx-card">
            <p className="muted">The coaches have not shared any drills yet.</p>
          </section>
        ) : (
          <div className="fam-plays">
            {data.drills.map((d) => (
              <section key={d.id} className="card fam-sheet">
                <header>
                  <h2>{d.name}</h2>
                  {d.duration_min > 0 && <span className="muted small">{d.duration_min} minutes</span>}
                </header>
                <SharedPreview detail={{ kind: 'drill', content: d }} />
              </section>
            ))}
          </div>
        ))}

      {tab === 'resources' && <FamilyResources slug={id} resources={data.resources} />}

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
                  <Row key={i} lead={<span className="fam-num">{p.number || '–'}</span>} title={p.name} />
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
    </div>,
    team,
    tabs,
    tab,
    (t) => go(t),
  );
}

/**
 * The plays the coaches shared, laid out as a coach's own playbook is: a card for each, a search
 * box, the layout choice, and the categories underneath. A card opens the play to read and watch.
 */
function FamilyPlaybook({ plays }: { plays: SharedPlay[] }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [compact, setCompact] = useCompact('practiceplan.familyPlaybookCompact');
  const [open, setOpen] = useState<SharedPlay | null>(null);
  if (plays.length === 0)
    return (
      <div className="empty">
        <h2>No plays yet</h2>
        <p>The coaches have not shared any plays yet.</p>
      </div>
    );
  const term = q.trim().toLowerCase();
  const found = plays.filter((p) => !term || `${p.name} ${p.category} ${p.labels.join(' ')} ${p.notes}`.toLowerCase().includes(term));
  const shown = found.filter((p) => !category || p.category === category);
  const categories = [...new Set(plays.map((p) => p.category).filter(Boolean))].sort();
  return (
    <>
      <div className="playbook-filters">
        <input className="input grow" type="search" placeholder="Search plays" aria-label="Search plays" value={q} onChange={(e) => setQ(e.target.value)} />
        <LayoutToggle compact={compact} onChange={setCompact} />
      </div>
      <CategoryChips all="" total={found.length} value={category} onChange={setCategory} items={categories.map((c) => ({ id: c, label: c, count: found.filter((p) => p.category === c).length }))} />
      {shown.length === 0 ? (
        <p className="muted">No plays match.</p>
      ) : (
        <div className={`play-grid ${compact ? 'compact' : ''}`}>
          {shown.map((p) => (
            <div key={p.id} className="play-card-wrap">
              <button type="button" className="play-card" onClick={() => setOpen(p)}>
                <div className="paper">
                  <PlayDiagram play={p} frame={p.frames[0]} />
                </div>
                <div className="play-card-info">
                  <strong>{p.name}</strong>
                  <span className="muted small">{[p.category || 'No category', `${p.frames.length} step${p.frames.length === 1 ? '' : 's'}`].join(' · ')}</span>
                </div>
              </button>
            </div>
          ))}
        </div>
      )}
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)} wide>
          <SharedPreview detail={{ kind: 'play', content: open }} />
        </Modal>
      )}
    </>
  );
}

const RES_KINDS: ['all' | FamilyResource['kind'], string][] = [
  ['all', 'All'],
  ['link', 'Links'],
  ['image', 'Pictures'],
  ['video', 'Videos'],
];
const RES_COMPACT_KEY = 'practiceplan.familyResourcesCompact';
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
/**
 * What the coaches shared, laid out as a coach's own resources are: a tile for each, a search box,
 * a filter by kind, and a choice of large or small tiles. Nothing here can be changed.
 */
function FamilyResources({ slug, resources }: { slug: string; resources: FamilyResource[] }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | FamilyResource['kind']>('all');
  const [compact, chooseCompact] = useCompact(RES_COMPACT_KEY);
  const [viewing, setViewing] = useState<FamilyResource | null>(null);
  const [tag, setTag] = useState('');
  const fileOf = (r: FamilyResource) => `/api/family/teams/${slug}/files/${r.file_id}`;
  const term = q.trim().toLowerCase();
  const found = resources.filter((r) => !term || `${r.title} ${r.url}`.toLowerCase().includes(term));
  const inKind = found.filter((r) => kind === 'all' || r.kind === kind);
  const shown = inKind.filter((r) => !tag || r.tags.some((t) => t.name === tag));
  // Every category any shared resource is filed under, in the order they are first met.
  const tags = [...new Map(resources.flatMap((r) => r.tags).map((t) => [t.name, t])).values()].sort((x, y) => x.name.localeCompare(y.name));
  const count = (k: 'all' | FamilyResource['kind']) => found.filter((r) => k === 'all' || r.kind === k).length;
  const thumb = (r: FamilyResource) =>
    r.kind === 'image' ? (
      <img className="res-thumb" src={fileOf(r)} alt="" loading="lazy" />
    ) : r.kind === 'video' ? (
      <video className="res-thumb" src={fileOf(r)} preload="metadata" muted />
    ) : r.thumb ? (
      <img className="res-thumb link-shot" src={`/api/family/teams/${slug}/thumb?url=${encodeURIComponent(r.url)}`} alt="" loading="lazy" />
    ) : (
      <span className="res-thumb site">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" />
        </svg>
        {hostOf(r.url)}
      </span>
    );
  if (resources.length === 0)
    return (
      <div className="empty">
        <h2>No resources yet</h2>
        <p>The coaches have not shared any links, pictures or videos yet.</p>
      </div>
    );
  return (
    <>
      <div className="playbook-filters">
        <input className="input grow" type="search" placeholder="Search by name or address" aria-label="Search resources" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Kind of resource">
          {RES_KINDS.map(([id, label]) => (
            <button key={id} type="button" className={kind === id ? 'on' : ''} aria-pressed={kind === id} onClick={() => setKind(id)}>
              {label} <span className="chip-num">{count(id)}</span>
            </button>
          ))}
        </div>
        <LayoutToggle compact={compact} onChange={chooseCompact} />
      </div>
      <CategoryChips all="" total={inKind.length} value={tag} onChange={setTag} items={tags.map((t) => ({ id: t.name, label: t.name, color: t.color, count: inKind.filter((r) => r.tags.some((x) => x.name === t.name)).length }))} />
      {shown.length === 0 ? (
        <p className="muted">Nothing matches.</p>
      ) : (
        <div className={`res-grid ${compact ? 'compact' : ''}`}>
          {shown.map((r) => (
            <div key={r.key} className={`res-card kind-${r.kind}`}>
              {r.kind === 'link' ? (
                <a className="res-preview" href={r.url} target="_blank" rel="noopener noreferrer" title="Open in a new tab">
                  {thumb(r)}
                </a>
              ) : (
                <button type="button" className="res-preview" onClick={() => setViewing(r)} title={r.kind === 'video' ? 'Play' : 'View larger'}>
                  {thumb(r)}
                  {r.kind === 'video' && (
                    <span className="res-play" aria-hidden="true">
                      ▶
                    </span>
                  )}
                </button>
              )}
              <div className="res-info">
                <strong className="res-title">{r.title}</strong>
                {r.tags.length > 0 && (
                  <div className="res-tags">
                    {r.tags.map((t) => (
                      <span key={t.name} className="chip">
                        <span className="dot" style={{ background: t.color }} />
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
                {r.kind === 'link' && <span className="muted small">{hostOf(r.url)}</span>}
                <div className="res-actions">
                  {r.kind === 'link' ? (
                    <a className="btn small" href={r.url} target="_blank" rel="noopener noreferrer" title={r.url}>
                      Open
                    </a>
                  ) : (
                    <button type="button" className="btn small" onClick={() => setViewing(r)}>
                      {r.kind === 'video' ? 'Play' : 'View'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)} wide>
          {viewing.kind === 'image' ? <img className="res-full" src={fileOf(viewing)} alt={viewing.title} /> : <video className="res-full" src={fileOf(viewing)} controls autoPlay />}
        </Modal>
      )}
    </>
  );
}

/** "Today", "Tomorrow" or "In 4 days". */
function howSoon(date: string, today: string) {
  const days = Math.round((new Date(`${date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
}
const timesOf = (d: FamilyDay) => [clock(d.start_time), clock(d.end_time)].filter(Boolean).join(' – ');
const dayLine = (d: FamilyDay) => [KIND_WORD[d.kind], timesOf(d), d.location].filter(Boolean).join(' · ');
/** Whether there is more to a day than its line already says. */
const hasMore = (d: FamilyDay) => !!d.summary;

/** What a practice covers, part by part. `most` cuts a long one short. */
function Parts({ day, most }: { day: FamilyDay; most?: number }) {
  if (!day.summary) return null;
  const items = most ? day.summary.items.slice(0, most) : day.summary.items;
  return (
    <>
      <ol className="cal-peek-items fam-parts">
        {items.map((it, i) => (
          <li key={i} className={it.rest ? 'rest' : ''}>
            <span>{it.title}</span>
            <small>{it.minutes} min</small>
          </li>
        ))}
      </ol>
      {items.length < day.summary.items.length && <p className="cal-peek-more">and {day.summary.items.length - items.length} more</p>}
    </>
  );
}

const PEEK_WIDTH = 300;
/** A small card beside a practice or game while the pointer is on it, as coaches have on their calendar. */
function DayPeek({ day, at }: { day: FamilyDay; at: { left: number; right: number; top: number } }) {
  const width = Math.min(PEEK_WIDTH, window.innerWidth - 16);
  // Beside it on the right when there is room, else on the left, else under it.
  const left = at.right + 8 + width <= window.innerWidth - 8 ? at.right + 8 : at.left - 8 - width >= 8 ? at.left - 8 - width : Math.max(8, Math.min(at.left, window.innerWidth - width - 8));
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(at.top);
  useLayoutEffect(() => {
    const height = box.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(at.top, window.innerHeight - height - 8)));
  }, [at.top, day.key]);
  return (
    <div className="cal-peek fam-peek" role="tooltip" ref={box} style={{ left, top, width }}>
      <div className="cal-peek-top">
        <span className={`kind ${day.kind === 'other' ? '' : day.kind}`}>{KIND_WORD[day.kind]}</span>
        {day.summary && <span className="cal-peek-state">{day.summary.minutes} minutes planned</span>}
      </div>
      <strong className="cal-peek-title">{day.title}</strong>
      <p className="cal-peek-when">{[fmtDateShort(day.date), timesOf(day)].filter(Boolean).join(' · ')}</p>
      {day.location && <p className="cal-peek-where">{day.location}</p>}
      <Parts day={day} most={8} />
      <p className="cal-peek-more">Click to open it.</p>
    </div>
  );
}

/** A practice or game opened: everything the coach lets this person see about it. */
/** "Final 42–38", or "Live · Q2 · 20–18" while a game is being scored. '' for anything without a score. */
const scoreText = (d: FamilyDay) => (d.score ? `${d.score.status === 'final' ? 'Final' : `Live · ${partName(scoringOfCode(d.score.sport), d.score.period, d.score.halves)}`} · ${d.score.us}–${d.score.them}` : '');
function DayDetails({ day, onClose }: { day: FamilyDay; onClose: () => void }) {
  return (
    <Modal title={day.title} onClose={onClose}>
      <div className="fam-details">
        <p className="fam-details-kind">
          <span className={`kind ${day.kind === 'other' ? '' : day.kind}`}>{KIND_WORD[day.kind]}</span>
          <strong>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
        </p>
        <dl>
          {timesOf(day) && (
            <>
              <dt>Time</dt>
              <dd>{timesOf(day)}</dd>
            </>
          )}
          {day.location && (
            <>
              <dt>Place</dt>
              <dd>{day.location}</dd>
            </>
          )}
          {day.score && (
            <>
              <dt>Score</dt>
              <dd className="fam-score">{scoreText(day)}</dd>
            </>
          )}
          {day.summary && (
            <>
              <dt>Planned</dt>
              <dd>{day.summary.minutes} minutes</dd>
            </>
          )}
        </dl>
        {day.summary ? (
          <>
            <h3>What it covers</h3>
            <Parts day={day} />
          </>
        ) : (
          !timesOf(day) && !day.location && <p className="muted small">The coaches have not shared more about this {KIND_WORD[day.kind].toLowerCase()}.</p>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

/**
 * What it takes to show a day's card while the pointer is on it, and to open it on a click.
 * Returns what to put on whatever stands for the day, and the card and box to draw.
 */
function useDayPeek() {
  const [peek, setPeek] = useState<{ day: FamilyDay; left: number; right: number; top: number } | null>(null);
  const [open, setOpen] = useState<FamilyDay | null>(null);
  const hide = () => setPeek(null);
  const on = (day: FamilyDay) => {
    const show = (e: { currentTarget: Element }) => {
      const r = e.currentTarget.getBoundingClientRect();
      setPeek({ day, left: r.left, right: r.right, top: r.top });
    };
    return {
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
      onClick: () => {
        hide();
        setOpen(day);
      },
    };
  };
  const drawn = (
    <>
      {peek && !open && <DayPeek day={peek.day} at={peek} />}
      {open && <DayDetails day={open} onClose={() => setOpen(null)} />}
    </>
  );
  return { on, drawn };
}

/** The very next thing on the schedule, made plain to see. */
function NextUp({ day, today }: { day: FamilyDay; today: string }) {
  const { on, drawn } = useDayPeek();
  return (
    <>
      <button type="button" className={`fam-next ${day.kind}`} aria-label={`Next up: ${day.title}, ${fmtDateShort(day.date)}. Open it.`} {...on(day)}>
        <DateBlock date={day.date} />
        <span className="fam-next-text">
          <span className="fam-next-tag">
            Next up <i>{howSoon(day.date, today)}</i>
          </span>
          <strong>{day.title}</strong>
          {day.score && <span className="fam-next-line fam-score">{scoreText(day)}</span>}
          <span className="fam-next-line">{dayLine(day)}</span>
          {day.summary && <span className="fam-next-line">{day.summary.minutes} minutes planned, in {plural(day.summary.items.length, 'part')}</span>}
        </span>
      </button>
      {drawn}
    </>
  );
}

function DayList({ days, nextKey }: { days: FamilyDay[]; /** The next thing on the schedule, which is marked. */ nextKey?: string }) {
  const { on, drawn } = useDayPeek();
  return (
    <>
      <ul className="cx-rows">
        {days.map((d) => (
          <li key={d.key}>
            <button type="button" className={`cx-row fam-day ${d.key === nextKey ? 'next' : ''}`} {...on(d)}>
              <DateBlock date={d.date} />
              <span className="cx-row-text">
                <strong>
                  {d.title}
                  {d.key === nextKey && <span className="fam-next-pill">Next up</span>}
                  {d.score && <span className={`fam-score-pill ${d.score.status}`}>{scoreText(d)}</span>}
                </strong>
                <span className="muted small">
                  {dayLine(d)}
                  {hasMore(d) && ` · ${d.summary!.minutes} minutes planned`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {drawn}
    </>
  );
}

/** The team's month, in the dress of a coach's calendar, with what is coming listed under it. */
function Schedule({ days, today }: { days: FamilyDay[]; today: string }) {
  const next = days.find((d) => d.date >= today)?.date ?? today;
  const home: [number, number] = [Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1];
  const [[year, month], setMonth] = useState<[number, number]>(home);
  const [picked, setPicked] = useState('');
  const { on, drawn } = useDayPeek();
  const nextKey = days.find((d) => d.date >= today)?.key;
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
                <button type="button" className="cal-day-top fam-pick" aria-label={`${fmtDateShort(c.date)}${c.date === today ? ', today' : ''}. Show this day.`} aria-pressed={picked === c.date} onClick={() => setPicked(picked === c.date ? '' : c.date)}>
                  <span className="cal-num">{c.day}</span>
                  {c.date === today && <span className="fam-today">Today</span>}
                </button>
                {days
                  .filter((d) => d.date === c.date)
                  .slice(0, 3)
                  .map((d) => (
                    <button key={d.key} type="button" className={`cal-chip ${d.kind} ${d.key === nextKey ? 'next' : ''}`} aria-label={`${d.key === nextKey ? 'Next up: ' : ''}${d.title}, ${fmtDateShort(d.date)}${d.start_time ? `, ${clock(d.start_time)}` : ''}. Open it.`} {...on(d)}>
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
            <span className="cal-chip practice next">Next up</span>
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
        {listed.length === 0 ? <p className="muted">{picked ? 'Nothing on this day.' : 'Nothing on the schedule yet.'}</p> : <DayList days={listed} nextKey={nextKey} />}
      </section>
      {drawn}
    </>
  );
}

function Post({ post, onDelete, people, me }: { post: TeamPost; onDelete?: () => void; /** On the board: the names that stand out when written with "@". */ people?: string[]; me?: string }) {
  return (
    <article className={`fam-post ${post.role === 'coach' ? 'coach' : ''}`} data-post={post.id}>
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
      <p>{people ? <MentionText text={post.body} people={people} me={me} /> : post.body}</p>
    </article>
  );
}

/** What the coaches announced, and the board where the team's people talk. */
function Messages({ teamId, data, me, start, setBoard }: { teamId: string; data: FamilyTeam; me?: string; start: 'news' | 'board'; setBoard: (posts: TeamPost[]) => void }) {
  const both = data.can.news && data.can.board;
  const [show, setShow] = useState<'news' | 'board'>(start);
  useFocusPost(show === 'board');
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
            <MentionArea people={data.board_people.filter((n) => n !== me)} className="input" rows={2} maxLength={4000} aria-label="Your message" placeholder="Write to the team… Type @ to name someone." value={body} onChange={setBody} />
            <button className="btn primary" disabled={busy || !body.trim()}>
              Post
            </button>
          </form>
          {error && <p className="error">{error}</p>}
          {data.board.length === 0 ? <p className="muted">Nobody has written yet.</p> : data.board.map((p) => <Post key={p.id} post={p} people={data.board_people} me={me} onDelete={p.mine ? () => act(() => api.familyDeletePost(teamId, p.id)) : undefined} />)}
        </section>
      )}
    </>
  );
}
