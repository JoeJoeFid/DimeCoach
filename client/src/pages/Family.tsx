// A team's page for its parents, family and friends: what is coming up, what the coaches say,
// and whatever else the coach lets their kind of follower see. Nothing here changes the team.
import NextUpBoard from '../components/NextUpBoard';
import MonthGrid from '../components/MonthGrid';
import { SCHEDULE_ICONS, ScheduleIcon, ScheduleShell, type ScheduleViewMode } from '../components/ScheduleShell';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SharedPlay } from '../api';
import Chat, { useChatUnread } from '../components/Chat';
import { api, listenLive, type FamilyDay, type FamilyKind, type FamilyResource, type FamilyTeam, type FollowedTeam, type TeamPost, type User } from '../api';
import { fmtClock, fmtDateShort, parseClock, todayISO } from '../util';
import { Modal } from '../components/bits';
import { SharedPreview } from '../components/community';
import { PageHead, Row } from '../components/cx';
import { DrillBrowser, HomeworkCards, PlayBrowser, ResourceBrowser } from '../components/Browsers';
import { TopTabs } from '../components/TopTabs';
import SportIcon from '../components/SportIcon';
import { PasswordForm } from './Auth';
import { FollowedTeams, NEW_TEAM_KEY } from '../components/TeamPicker';
import { NAV_ICONS, UserActions, UserMenu, OldAddress } from '../App';
import BottomNav, { BottomRow, type BottomItem } from '../components/BottomNav';
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
    if (!user.paid) return navigate('/portal/coach');
    try {
      await api.startCoaching();
      sessionStorage.setItem(NEW_TEAM_KEY, '1');
      navigate('/');
      onChanged();
    } catch {
      navigate('/portal/coach');
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
  // An address from before the page moved from /family to /portal is sent on to the new one.
  if (/^\/family(\/|$)/.test(pathname)) return <OldAddress />;
  if (pathname === '/portal/coach') return <StartCoaching user={user} onBack={() => navigate('/portal')} onSignOut={signOut} />;
  // Choosing a team comes first, as it does for a coach: after signing in, and whenever "Switch team" is pressed.
  if (!/^\/portal\/[^/]+/.test(pathname)) return <FamilyPicker name={user.name} onPick={(slug) => navigate(`/portal/${slug}`)} onNewTeam={newTeam} onPassword={() => setChanging(true)} onSignOut={signOut} />;
  return (
    <Routes>
      <Route path="/portal/:teamId" element={<FamilyTeamPage frame={frame} />} />
      <Route path="*" element={<Navigate to="/portal" replace />} />
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
const sideGroups = (): { title: string; /** For its button in the bar across the bottom of a small screen. */ icon: string; items: [Tab, string][] }[] => [
  { title: 'Plan', icon: NAV_ICONS.practices, items: [['schedule', NAV_ICONS.practices], ['homework', NAV_ICONS.homework], ['video', NAV_ICONS.video]] },
  { title: 'Library', icon: NAV_ICONS.library, items: [['drills', NAV_ICONS.library], ['playbook', NAV_ICONS.playbook], ['resources', NAV_ICONS.resources], ['film', NAV_ICONS.filmroom]] },
  { title: 'Team', icon: NAV_ICONS.teams, items: [['roster', NAV_ICONS.teams], ['stats', NAV_ICONS.stats]] },
  { title: 'Community', icon: NAV_ICONS.community, items: [['chat', NAV_ICONS.chat], ['inbox', NAV_ICONS.messages], ['messages', NAV_ICONS.community]] },
];

/**
 * The frame around a follower's team: the same menu down the side that a coach has, with only
 * the parts of the team's page the coaches have opened to them.
 */
function FamilyFrame({ frame, team, tabs, tab, go, children }: { frame: Frame; team?: FamilyTeam['team']; tabs: [Tab, string, number?][]; tab: Tab; go: (t: Tab) => void; children: ReactNode }) {
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
    <div className="shell fam-frame">
      <aside className="sidebar">
        <div className="side-top">
          <Link to="/portal" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Dime Coach
          </Link>
        </div>
        <div className="team-now">
          <strong>{team?.name ?? 'Your teams'}</strong>
          {team && <span className="muted small">{[team.sport, team.season].filter(Boolean).join(' · ')}</span>}
          <button type="button" className="btn small" onClick={() => navigate('/portal')}>
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
      {/* The same menu for a tablet or phone, drawn by what draws a coach's. */}
      <BottomNav
        where={tab}
        home={{ key: 'home', label: 'Dashboard', icon: NAV_ICONS.dashboard, active: tab === 'home' && !!has('home'), go: () => (has('home') ? go('home') : navigate('/portal')) }}
        groups={sideGroups().map((g) => ({
          title: g.title,
          icon: g.icon,
          items: g.items.flatMap(([t, icon]): BottomItem[] => {
            const found = has(t);
            return found ? [{ key: t, label: found[1], icon, active: tab === t, go: () => go(t), badge: t === 'inbox' ? unread : t === 'chat' ? chatUnread : 0 }] : [];
          }),
        }))}
        profile={(close, install) => (
          <>
            <div className="bn-team">
              <div>
                <strong>{team?.name ?? 'Your teams'}</strong>
                {team && <span className="muted small">{[team.sport, team.season].filter(Boolean).join(' · ')}</span>}
              </div>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  close();
                  navigate('/portal');
                }}
              >
                Switch team
              </button>
            </div>
            <BottomRow
              icon="M12 5v14M5 12h14"
              label="New team"
              onClick={() => {
                close();
                frame.onNewTeam();
              }}
            />
            <div className="user-pop">
              <UserActions user={frame.user} onPassword={frame.onPassword} onSignOut={frame.onSignOut} onDone={close} onInstall={install} />
            </div>
          </>
        )}
      />
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
  if (teams.length === 1) return <Navigate to={`/portal/${teams[0].slug}`} replace />;
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
                <Link className="cx-row fam-team-row" to={`/portal/${t.slug}`}>
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
    if (slug && slug !== id) navigate({ pathname: `/portal/${slug}`, search: window.location.search }, { replace: true });
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
          <Link className="btn" to="/portal">
            Your teams
          </Link>
        </div>
      </div>,
    );
  if (!data) return framed(<p className="page muted">Loading…</p>);
  const { team, can } = data;
  const hasVideo = data.video.watch || data.video.broadcast;
  const hasPlays = can.schedule && can.games && can.pbp;
  const tabs: [Tab, string, number?][] = [
    ['home', 'Dashboard'],
    ...(can.schedule ? [['schedule', 'Schedule'] as [Tab, string]] : []),
    // Chat is the person's own, like their inbox: the team's chat and any they started with other people.
    ...(frame ? [['chat', 'Chat'] as [Tab, string]] : []),
    ...(can.news || can.board ? [['messages', 'Team news'] as [Tab, string]] : []),
    // Their own inbox, which is not about this team alone. A coach who also follows the team has theirs in the coach's menu.
    ...(frame ? [['inbox', 'Messages'] as [Tab, string], ['stats', 'Stats'] as [Tab, string]] : []),
    // A part shut to their kind is not in the menu at all, unless something in it was given to them by name.
    ...(can.homework || data.homework.length > 0 ? [['homework', 'Homework', data.homework.length] as [Tab, string, number]] : []),
    // Live game: its video for those allowed to watch or broadcast, and its play by play for those told about games.
    ...(hasVideo || hasPlays ? [['video', 'Live game'] as [Tab, string]] : []),
    ...(can.playbook ? [['playbook', 'Playbook', data.plays.length] as [Tab, string, number]] : []),
    ...(can.drills ? [['drills', 'Drills', data.drills.length] as [Tab, string, number]] : []),
    ...(can.resources ? [['resources', 'Resources', data.resources.length] as [Tab, string, number]] : []),
    // Video from the Filmroom that a coach shared with this person. All a guest is here for.
    ...(can.film || data.film > 0 || data.me.kind === 'guest' ? [['film', 'Filmroom', data.film] as [Tab, string, number]] : []),
    ...(can.roster ? [['roster', 'Team'] as [Tab, string]] : []),
  ];
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = tabs.some(([t]) => t === asked) ? asked! : data.me.kind === 'guest' ? 'film' : 'home';
  const go = (t: Tab, extra: Record<string, string> = {}) => setParams(t === 'home' ? {} : { tab: t, ...extra }, { replace: true });
  const openChat = (chatId: number) => go('chat', chatId ? { chat: String(chatId) } : {});
  const today = todayISO();

  return framed(
    <div className="page cx fam">
      <PageHead
        eyebrow={[team.organization, team.sport, team.season].filter(Boolean).join(' · ') || 'Team'}
        title={team.name}
        sub={`You are here as ${asWhat(data.me.kind, data.me.players)}.`}
      >
        {others > 0 && !frame && (
          <Link className="btn" to="/portal">
            Switch team
          </Link>
        )}
      </PageHead>
      {/* In the frame, the parts of the page are in the menu at the side. */}
      {tabs.length > 1 && !frame && (
        <TopTabs nav tabs={tabs} value={tab} onChange={go} label={`Parts of ${team.name}`} />
      )}

      {tab === 'home' && (
        <>
        {/* The board a coach has at the top of their dashboard: what is next, large, and the schedule as a list beside it. Here a line opens to be read. */}
        {can.schedule && (
          <section className="card fam-board" aria-label="What is next, and the schedule">
            {data.schedule.length === 0 ? <p className="muted">Nothing on the schedule yet.</p> : <HomeBoard days={data.schedule} today={today} sport={team.sport} onFull={() => go('schedule')} />}
          </section>
        )}
        <div className="fam-home">
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
                <div className="fam-quiet">
                  {/* A screen with nothing on it yet, between two clouds. */}
                  <svg viewBox="0 0 220 76" width="220" height="76" fill="none" aria-hidden="true">
                    <path className="fam-quiet-cloud" d="M12 62a14 14 0 0 1 14-14 18 18 0 0 1 34-3 12 12 0 0 1 14 17Z" />
                    <path className="fam-quiet-cloud" d="M150 62a11 11 0 0 1 11-11 15 15 0 0 1 28-2 10 10 0 0 1 12 13Z" />
                    <rect className="fam-quiet-screen" x="80" y="16" width="62" height="44" rx="9" />
                    <path className="fam-quiet-play" d="M105 29v18l15-9Z" />
                    <path className="fam-quiet-spark" d="M148 14l8-8M153 21l11-4M150 28h9" />
                  </svg>
                  <strong>Nothing is live right now.</strong>
                  <span className="muted small">A game's video or play by play shows here the moment it starts.</span>
                </div>
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
                  Coach announcements
                </h2>
                {data.news.length > 1 && (
                  <button type="button" className="link cx-card-action" onClick={() => go('messages')}>
                    All {data.news.length} announcements
                  </button>
                )}
              </div>
              {data.news.length === 0 ? (
                <p className="muted">No announcements yet.</p>
              ) : (
                // The newest one, set apart in a card of its own with the lime down its side.
                <div className="fam-latest">
                  <Post post={data.news[0]} />
                </div>
              )}
            </section>
          )}
          {data.homework.length > 0 && (
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
                  <Row key={h.id} title={h.title} sub={[h.for.length ? `For ${h.for.join(' and ')}` : 'For the whole team', h.due ? `Due ${fmtDateShort(h.due)}` : h.date && fmtDateShort(h.date)].filter(Boolean).join(' · ')} onClick={() => go('homework')} />
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
        </>
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

      {tab === 'homework' && <FamilyHomework sheets={data.homework} today={today} />}

      {tab === 'playbook' && <FamilyPlaybook plays={data.plays} />}

      {tab === 'drills' && <FamilyDrills drills={data.drills} />}

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

/** Homework as the cards a coach sees it on. A card opens the sheet to read. */
function FamilyHomework({ sheets, today }: { sheets: FamilyTeam['homework']; today: string }) {
  const [open, setOpen] = useState<FamilyTeam['homework'][number] | null>(null);
  if (sheets.length === 0)
    return (
      <div className="empty">
        <h2>No homework yet</h2>
        <p>No homework has been set.</p>
      </div>
    );
  return (
    <>
      <HomeworkCards
        sheets={sheets.map((h) => ({ src: h, id: h.id, title: h.title, date: h.date, due: h.due || '', who: h.for.length ? h.for.join(' and ') : 'Whole team', items: h.content.items.filter((it) => it.kind === 'item').map((it) => it.title.trim() || 'Untitled') }))}
        today={today}
        onOpen={(h) => setOpen(h.src)}
      />
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)} wide>
          <p className="muted small">{[open.for.length ? `For ${open.for.join(' and ')}` : 'For the whole team', open.date && fmtDateShort(open.date), open.due && `Due ${fmtDateShort(open.due)}`].filter(Boolean).join(' · ')}</p>
          <SharedPreview detail={{ kind: 'plan', content: open.content }} />
        </Modal>
      )}
    </>
  );
}

/** The plays the coaches shared, in the list a coach's own playbook is in. A card opens the play to read and watch. */
function FamilyPlaybook({ plays }: { plays: SharedPlay[] }) {
  const [open, setOpen] = useState<SharedPlay | null>(null);
  return (
    <>
      <PlayBrowser
        plays={plays}
        compactKey="practiceplan.familyPlaybookCompact"
        onOpen={setOpen}
        empty={
          <div className="empty">
            <h2>No plays yet</h2>
            <p>The coaches have not shared any plays yet.</p>
          </div>
        }
      />
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)} wide>
          <SharedPreview detail={{ kind: 'play', content: open }} />
        </Modal>
      )}
    </>
  );
}

/** The drills the coaches shared, in the list a coach's own drills are in. A card opens the drill to read. */
function FamilyDrills({ drills }: { drills: FamilyTeam['drills'] }) {
  const [open, setOpen] = useState<FamilyTeam['drills'][number] | null>(null);
  return (
    <>
      <DrillBrowser
        drills={drills.map((d) => ({ src: d, id: d.id, name: d.name, duration_min: d.duration_min, notes_html: d.notes_html, tags: d.tags, meta: [d.links.length > 0 && `${d.links.length} link${d.links.length === 1 ? '' : 's'}`, d.plays.length > 0 && `${d.plays.length} play${d.plays.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') }))}
        compactKey="practiceplan.familyDrillsCompact"
        onOpen={(x) => setOpen(x.src)}
        empty={
          <div className="empty">
            <h2>No drills yet</h2>
            <p>The coaches have not shared any drills yet.</p>
          </div>
        }
      />
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)} wide>
          {open.duration_min > 0 && <p className="muted small">{open.duration_min} minutes</p>}
          <SharedPreview detail={{ kind: 'drill', content: open }} />
        </Modal>
      )}
    </>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
/** What the coaches shared, in the list a coach's own resources are in. Nothing here can be changed. */
function FamilyResources({ slug, resources }: { slug: string; resources: FamilyResource[] }) {
  const [viewing, setViewing] = useState<FamilyResource | null>(null);
  const fileOf = (r: FamilyResource) => `/api/family/teams/${slug}/files/${r.file_id}`;
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
  return (
    <>
      <ResourceBrowser
        resources={resources.map((r) => ({ src: r, key: r.key, kind: r.kind, title: r.title, url: r.url, tags: r.tags, text: `${r.title} ${r.url}`.toLowerCase(), sub: r.kind === 'link' ? hostOf(r.url) : undefined }))}
        compactKey="practiceplan.familyResourcesCompact"
        thumb={(x) => thumb(x.src)}
        onView={(x) => setViewing(x.src)}
        empty={
          <div className="empty">
            <h2>No resources yet</h2>
            <p>The coaches have not shared any links, pictures or videos yet.</p>
          </div>
        }
      />
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)} wide>
          {viewing.kind === 'image' ? <img className="res-full" src={fileOf(viewing)} alt={viewing.title} /> : <video className="res-full" src={fileOf(viewing)} controls autoPlay />}
        </Modal>
      )}
    </>
  );
}

const timesOf = (d: FamilyDay) => [clock(d.start_time), clock(d.end_time)].filter(Boolean).join(' – ');

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

/** The top of the page: what is next and the schedule beside it, as on a coach's dashboard, with each thing opened to be read. */
function HomeBoard({ days, today, sport, onFull }: { days: FamilyDay[]; today: string; sport: string; onFull: () => void }) {
  const { on, drawn } = useDayPeek();
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''));
  return (
    <>
      <NextUpBoard
        entries={sorted.map((d) => ({ key: d.key, date: d.date, kind: d.kind, title: d.title, time: timesOf(d) || (d.kind === 'game' && !d.location ? '' : 'All day'), location: d.location, src: d }))}
        today={today}
        sport={sport}
        // A game that is being scored, or was, says how it stands. Nothing else has a state a parent needs.
        state={(e) => (e.src.score ? <span className={`fam-score-pill ${e.src.score.status}`}>{scoreText(e.src)}</span> : null)}
        note={(e) => e.src.summary && <div className="muted small">{e.src.summary.minutes} minutes planned, in {plural(e.src.summary.items.length, 'part')}</div>}
        actions={(e) => (
          <button type="button" className="btn primary" onClick={on(e.src).onClick}>
            View details
          </button>
        )}
        way={(e) => ({ onClick: on(e.src).onClick, title: 'See the details' })}
        fullSchedule={{ onClick: onFull }}
      />
      {drawn}
    </>
  );
}

const SCHEDULE_VIEW_KEY = 'pp.familyScheduleView';
/**
 * The team's schedule as its parents, family and friends see it: on the backbone a coach's schedule
 * is on, with the same box of view and filters down the left and the same lines, month by month.
 * Nothing here can be changed: a line opens to be read.
 */
function Schedule({ days, today }: { days: FamilyDay[]; today: string }) {
  const [view, setView] = useState<ScheduleViewMode>(() => {
    try {
      return localStorage.getItem(SCHEDULE_VIEW_KEY) === 'calendar' ? 'calendar' : 'list';
    } catch {
      return 'list';
    }
  });
  const chooseView = (v: ScheduleViewMode) => {
    setView(v);
    try {
      localStorage.setItem(SCHEDULE_VIEW_KEY, v);
    } catch {
      // Not being able to remember the choice is no reason to refuse it.
    }
  };
  const { on, drawn } = useDayPeek();
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''));
  const nextKey = sorted.find((d) => d.date >= today)?.key;
  // The list opens at what is next, as a coach's does.
  const nextRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (view === 'list') nextRow.current?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const row = (d: FamilyDay) => {
    const day = new Date(`${d.date}T12:00:00`);
    const isNext = d.key === nextKey;
    const pill = d.kind === 'game' ? { cls: 'game', icon: SCHEDULE_ICONS.trophy, text: 'Game' } : d.kind === 'other' ? { cls: 'event', icon: SCHEDULE_ICONS.flag, text: 'Event' } : { cls: 'planned', icon: SCHEDULE_ICONS.check, text: 'Practice' };
    const final = d.score?.status === 'final' ? d.score : null;
    const { onClick } = on(d);
    return (
      <li key={d.key} ref={isNext ? nextRow : undefined} className={`plan-row ps-row ${d.date < today ? 'done' : ''} ${isNext ? 'next' : ''}`} aria-current={isNext ? 'true' : undefined}>
        <span className="ps-date">
          <span className="ps-dow">{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
          <strong>{day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</strong>
          {isNext && <span className="tl-flag">{d.date === today ? 'Today' : 'Next up'}</span>}
        </span>
        <span className="ps-main">
          <button type="button" className="ps-title plan-main fam-row-title" onClick={onClick}>
            {d.title}
          </button>
          <span className="ps-meta">
            {timesOf(d) && (
              <span>
                <ScheduleIcon d={SCHEDULE_ICONS.clock} />
                {timesOf(d)}
              </span>
            )}
            {d.summary && <span className="ps-dot">{d.summary.minutes} min</span>}
            {d.location && (
              <span className="ps-place">
                <ScheduleIcon d={SCHEDULE_ICONS.pin} />
                {d.location.split('\n')[0]}
              </span>
            )}
            {d.summary && (
              <span className="ps-dot">
                {d.summary.items.length} part{d.summary.items.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </span>
        <span className="ps-pills">
          {/* A game scored to the end: won or lost, and the score. One still being scored says so. */}
          {final && (
            <span className={`tl-result ${final.us > final.them ? 'w' : final.us < final.them ? 'l' : ''}`} role="img" aria-label={`${final.us > final.them ? 'Won' : final.us < final.them ? 'Lost' : 'Tied'} ${final.us} to ${final.them}`}>
              <b>{final.us > final.them ? 'W' : final.us < final.them ? 'L' : 'T'}</b> {final.us}–{final.them}
            </span>
          )}
          {d.score?.status === 'live' && <span className="fam-score-pill live">{scoreText(d)}</span>}
          <span className={`ps-pill ${pill.cls}`}>
            <ScheduleIcon d={pill.icon} />
            {pill.text}
          </span>
        </span>
        <span className="ps-actions">
          <button type="button" className="btn primary ps-view" onClick={onClick}>
            View
          </button>
        </span>
      </li>
    );
  };
  return (
    <>
      <ScheduleShell
        entries={sorted}
        view={view}
        onView={chooseView}
        row={row}
        calendar={(list) => <FamilyCalendar days={list} today={today} />}
        empty={
          <div className="empty">
            <h2>Nothing on the schedule yet</h2>
            <p>Games and practices show here once the coaches add them.</p>
          </div>
        }
      />
      {drawn}
    </>
  );
}

/** The team's month on the grid a coach's calendar is on. A day's chip opens it to be read, and nothing can be added. */
function FamilyCalendar({ days, today }: { days: FamilyDay[]; today: string }) {
  const { on, drawn } = useDayPeek();
  const nextKey = days.find((d) => d.date >= today)?.key ?? null;
  return (
    <MonthGrid
      entries={days}
      today={today}
      nextKey={nextKey}
      chip={(d) => {
        const done = d.date < today;
        return (
          <button key={d.key} type="button" className={`cal-chip ${d.kind} ${done ? 'done' : ''} ${d.key === nextKey ? 'next' : ''}`} aria-label={`${d.key === nextKey ? 'Next up: ' : ''}${d.title}, ${fmtDateShort(d.date)}${d.start_time ? `, ${clock(d.start_time)}` : ''}. Open it.`} {...on(d)}>
            {done && (
              <span className="cal-check" aria-hidden="true">
                ✓
              </span>
            )}
            {d.start_time && <span className="cal-time">{clock(d.start_time)}</span>}
            <span className="cal-name">{d.title}</span>
          </button>
        );
      }}
    >
      {drawn}
    </MonthGrid>
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
