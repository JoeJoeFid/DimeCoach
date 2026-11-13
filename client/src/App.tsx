import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { SIGNED_OUT_EVENT, api, type AuthStatus, type Bootstrap, type User } from './api';
import type { Sport, Tag, Team, TeamPerm } from './types';
import { sportKind } from './sports';
import { DialogHost } from './components/dialogs';
import { ToastHost, flushDeletes, showNews } from './components/toasts';
import { ThemeToggle } from './theme';
import Tour from './components/Tour';
import TeamPicker from './components/TeamPicker';
import { PasswordForm, Setup, SignedOut } from './pages/Auth';
import SystemAdmin from './pages/SystemAdmin';
import Communities from './pages/Communities';
import Messages from './pages/Messages';
import CoachLibraryPage from './pages/CoachLibrary';
import CommunityPage from './pages/Community';
import Dashboard from './pages/Dashboard';
import Plans from './pages/Plans';
import PlanEditor from './pages/PlanEditor';
import PrintView from './pages/PrintView';
import Library from './pages/Library';
import Tags from './pages/Tags';
import Teams from './pages/Teams';
import ImportPlans from './pages/ImportPlans';
import Playbook from './pages/Playbook';
import Resources from './pages/Resources';
import PlayEditor from './pages/PlayEditor';
import PlayPrint from './pages/PlayPrint';

/** Where to go once the team has been switched: set by a message that points at a plan on another team. */
const AFTER_KEY = 'practiceplan.afterSwitch';
/** Set while the team-choosing screen should come up after a reload. */
const PICK_KEY = 'practiceplan.pickTeam';

interface AppState extends Bootstrap {
  user: User;
  team: Team | null;
  sport: Sport | null;
  /** Tags of the current team's sport. */
  sportTags: Tag[];
  setTeamId: (id: number) => void;
  /** Switches to one of your own teams, or to a team shared with you. */
  openTeam: (shared: boolean, id: number) => void;
  /** Goes back to the screen where a team is chosen. The only way to change which team is being worked on. */
  pickTeam: () => void;
  /** True while the welcome tour is on screen, so pages hold back their own pop-ups until it is over. */
  touring: boolean;
  /** Whether you may change this part of the team. Always true for your own teams. */
  can: (perm: TeamPerm) => boolean;
  /** How many messages you have not read yet: from the app itself, and what is new in your communities. */
  communityUnread: number;
  /** Sets that count from a fresh answer, or asks the server for it again. */
  setCommunityUnread: (count?: number) => void;
  reload: () => Promise<void>;
  /** Re-reads the signed-in user, after something about them (such as a preference) changed. */
  refreshUser: () => void;
}
const Ctx = createContext<AppState | null>(null);
export const useApp = () => useContext(Ctx)!;

const icons = {
  dashboard: 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
  practices: 'M9 4h6v3H9zM9 5.5H6v15h12v-15h-3M9 12h6M9 16h4',
  homework: 'M4 6.5c2.5-1.2 5.2-1.2 8 0v13c-2.8-1.2-5.5-1.2-8 0zM12 6.5c2.8-1.2 5.5-1.2 8 0v13c-2.5-1.2-5.2-1.2-8 0',
  playbook: 'M5 4h14v16H5zM9 8.500l2 2M11 8.500l-2 2M15 15a1.500 1.500 0 1 0 0-3 1.500 1.500 0 0 0 0 3ZM9.500 15.500c1.500 0 2.500-1 3-2.500',
  resources: 'M4 6.500h6l2 2.500h8v10H4zM9.500 15.500l2-2.500 2 2 1.500-1.500 2 2',
  library: 'M12 4 3.5 8.5 12 13l8.5-4.5zM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5',
  tags: 'M4 4h7.5l8.5 8.5-7.5 7.5L4 11.5zM8.5 8.5h.01',
  teams: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.900c1.900.700 3.100 2.400 3.500 5.100',
  system: 'M4 6h16v5H4zM4 13h16v5H4zM7 8.500h.01M7 15.500h.01M11 8.500h6M11 15.500h6',
  community: 'M4 5h11v8H9l-3 3v-3H4zM15 9h5v8h-2v3l-3-3h-4v-2',
  messages: 'M4 6h16v12H4zM4 7.500l8 6 8-6',
  coachLibrary: 'M5 4v16M9 4v16M13 5l5 15M5 4h4M5 20h4M3 20h18',
};
interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: string;
}
const HOME: NavItem = { to: '/', label: 'Dashboard', end: true, icon: icons.dashboard };
/** The sidebar, grouped by what the pages are for. */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    // The dated things a coach builds and sends out.
    title: 'Plan',
    items: [
      { to: '/practices', label: 'Practices', icon: icons.practices },
      { to: '/homework', label: 'Homework', icon: icons.homework },
    ],
  },
  {
    // Reusable material to pull from when planning.
    title: 'Library',
    items: [
      { to: '/library', label: 'Drills', icon: icons.library },
      { to: '/playbook', label: 'Playbook', icon: icons.playbook },
      { to: '/resources', label: 'Resources', icon: icons.resources },
    ],
  },
  {
    // Occasional setup: who is on the team, and what gets tracked.
    title: 'Team',
    items: [
      { to: '/teams', label: 'Team & roster', icon: icons.teams },
      { to: '/tags', label: 'Categories', icon: icons.tags },
    ],
  },
  {
    // Other coaches: talking, and trading drills, plays and plans.
    title: 'Community',
    items: [
      { to: '/messages', label: 'Messages', icon: icons.messages },
      { to: '/communities', label: 'Communities', icon: icons.community },
      { to: '/coach-library', label: 'Coach library', icon: icons.coachLibrary },
    ],
  },
];

/** Decides which world the visitor is in: first-run setup, signed out, or the app. */
export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [error, setError] = useState('');
  // Set by signing in, and cleared once a team is picked: coming back to an open session skips the question.
  const [justSignedIn, setJustSignedIn] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAuth(await api.authStatus());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    refresh();
    // Any request that comes back "not signed in" (an expired session, say) lands here.
    window.addEventListener(SIGNED_OUT_EVENT, refresh);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, refresh);
  }, [refresh]);

  if (error && !auth)
    return (
      <div className="page">
        <div className="empty">
          <h2>Dime Coach could not reach its server</h2>
          <p>{error}</p>
          <button className="btn primary" onClick={refresh}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!auth) return <div className="page muted">Loading…</div>;

  let view;
  if (auth.setup_needed) view = <Setup onDone={refresh} />;
  else if (!auth.user)
    view = (
      <SignedOut
        registrationOpen={auth.registration_open}
        confirmEmail={auth.registration_mode === 'verify'}
        onSignedIn={() => {
          setJustSignedIn(true);
          refresh();
        }}
      />
    );
  else if (auth.user.must_change_password) view = <PasswordForm forced onDone={refresh} />;
  else view = <SignedIn key={auth.user.id} user={auth.user} onChanged={refresh} choosingTeam={justSignedIn} onTeamChosen={() => setJustSignedIn(false)} />;
  return (
    <>
      {view}
      <DialogHost />
      <ToastHost />
    </>
  );
}

function SignedIn({ user, onChanged, choosingTeam, onTeamChosen }: { user: User; onChanged: () => void; choosingTeam: boolean; onTeamChosen: () => void }) {
  const teamKey = `practiceplan.teamId.${user.id}`;
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const [teamId, setTeamIdState] = useState<number>(() => Number(localStorage.getItem(teamKey)) || 0);
  const location = useLocation();
  const navigate = useNavigate();
  // Someone new gets the tour once. Finishing or skipping it is remembered with their account.
  const [touring, setTouring] = useState(!user.prefs.tour_done);
  // Whether the "which team?" screen is up. It is the first thing after signing in, and the way
  // to change teams later. The flag in the browser carries the choice across the reload that
  // leaving someone else's shared team needs.
  const [picking, setPicking] = useState(() => choosingTeam || sessionStorage.getItem(PICK_KEY) === '1');
  const donePicking = () => {
    sessionStorage.removeItem(PICK_KEY);
    setPicking(false);
    onTeamChosen();
  };
  // Whether the side menu is folded down to its icons. Everywhere but the editors it is the
  // person's own choice, remembered on this computer. Opening an editor folds it; leaving puts it back.
  const navKey = `practiceplan.navFolded.${user.id}`;
  const inEditor = /^\/(plans|plays)\/\d+$/.test(location.pathname);
  const [navFolded, setNavFolded] = useState(() => inEditor || localStorage.getItem(navKey) === '1');
  useEffect(() => {
    setNavFolded(inEditor || localStorage.getItem(navKey) === '1');
  }, [inEditor, navKey]);
  // On a narrow screen the menu is a panel that slides in from the left. Going anywhere closes it.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  const foldNav = (folded: boolean) => {
    setNavFolded(folded);
    if (!inEditor) localStorage.setItem(navKey, folded ? '1' : '0');
  };
  const endTour = useCallback(() => {
    setTouring(false);
    if (!user.prefs.tour_done)
      api
        .savePrefs({ tour_done: true })
        .then(onChanged)
        .catch(() => {});
  }, [user.prefs.tour_done, onChanged]);

  // Unread messages light up Messages in the menu. The server says the moment there is something new;
  // checking when the page changes and once a minute covers a dropped connection.
  const [communityUnread, setUnread] = useState(0);
  /** Unread messages already known about, so only one that has just arrived gets a notice in the corner. */
  const known = useRef<Set<string> | null>(null);
  const whereNow = useRef(location.pathname);
  whereNow.current = location.pathname;
  const setCommunityUnread = useCallback(
    (count?: number) => {
      if (count !== undefined) return setUnread(count);
      api
        .communityNews()
        .then((n) => {
          setUnread(n.unread);
          const unread = n.items.filter((i) => i.unread);
          const fresh = known.current ? unread.filter((i) => !known.current!.has(i.key)) : [];
          known.current = new Set(unread.map((i) => i.key));
          // Something that arrives in the community being looked at shows up there, so it needs no notice.
          const elsewhere = fresh.filter((i) => whereNow.current !== '/messages' && !(i.community_id && whereNow.current === `/communities/${i.community_id}`));
          if (elsewhere.length === 0) return;
          const one = elsewhere[0];
          const text =
            elsewhere.length > 1
              ? `${elsewhere.length} new messages`
              : one.kind === 'notice'
                ? one.title || 'New message'
                : one.kind === 'invite'
                  ? `${one.by} invited you to join ${one.community}`
                  : one.kind === 'share'
                    ? `${one.by} shared something in ${one.community}`
                    : `New message from ${one.by} in ${one.community}`;
          showNews(text, () => navigate('/messages'));
        })
        .catch(() => {});
    },
    [navigate],
  );
  useEffect(() => {
    setCommunityUnread();
    const timer = window.setInterval(() => setCommunityUnread(), 60_000);
    return () => window.clearInterval(timer);
  }, [setCommunityUnread, location.pathname]);
  useEffect(() => {
    const live = new EventSource('/api/live');
    live.addEventListener('news', () => {
      setCommunityUnread();
      // Pages that list messages read themselves again.
      window.dispatchEvent(new Event('dime:news'));
    });
    return () => live.close();
  }, [setCommunityUnread, user.id]);

  const reload = useCallback(async () => {
    try {
      setData(await api.bootstrap());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const setTeamId = useCallback(
    (id: number) => {
      localStorage.setItem(teamKey, String(id));
      setTeamIdState(id);
    },
    [teamKey],
  );

  const openTeam = useCallback(
    async (shared: boolean, id: number) => {
      if (!shared && !data?.access) return setTeamId(id);
      try {
        await api.setWorkspace(shared ? id : null);
        if (!shared && id) localStorage.setItem(teamKey, String(id));
        // A different workspace has different drills, plays and plans: start clean.
        window.location.assign('/');
      } catch (e) {
        setError((e as Error).message);
        reload();
      }
    },
    [data, setTeamId, teamKey, reload],
  );

  const pickTeam = useCallback(() => setPicking(true), []);
  // The choosing screen always runs from your own workspace: step out of a shared team first.
  const leaving = picking && !!data?.access;
  useEffect(() => {
    if (!leaving) return;
    sessionStorage.setItem(PICK_KEY, '1');
    api
      .setWorkspace(null)
      .then(() => window.location.assign('/'))
      .catch((e) => setError((e as Error).message));
  }, [leaving]);

  const state = useMemo<AppState | null>(() => {
    if (!data) return null;
    // Inside a shared team that team is the only one. Otherwise it is the one that was chosen: never a silent fallback.
    const team = data.access ? data.teams[0] || null : data.teams.find((t) => t.id === teamId) || null;
    const sport = data.sports.find((s) => s.id === team?.sport_id) || null;
    return {
      ...data,
      user,
      team,
      sport,
      sportTags: data.tags.filter((t) => t.sport_id === team?.sport_id),
      setTeamId,
      openTeam,
      pickTeam,
      touring,
      can: (perm) => !data.access || data.access.perms[perm],
      communityUnread,
      setCommunityUnread,
      reload,
      refreshUser: onChanged,
    };
  }, [data, user, teamId, setTeamId, openTeam, pickTeam, touring, reload, onChanged, communityUnread, setCommunityUnread]);
  // After switching teams to follow a message, carry on to what it pointed at.
  const teamNow = state?.team?.id;
  useEffect(() => {
    const after = teamNow ? sessionStorage.getItem(AFTER_KEY) : null;
    if (!after) return;
    sessionStorage.removeItem(AFTER_KEY);
    navigate(after, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamNow]);

  if (error && !state)
    return (
      <div className="page">
        <div className="empty">
          <h2>Could not load your workspace</h2>
          <p>{error}</p>
          <button className="btn primary" onClick={reload}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!state) return <div className="page muted">Loading…</div>;

  const printing = /\/(plans|plays)\/\d+\/print/.test(location.pathname);
  // The practice and play editors want the room, so the menu folds itself away there.

  const needsTeam = !state.team;
  const signOut = async () => {
    // Anything deleted in the last few seconds goes through before the session ends.
    flushDeletes();
    await api.logout().catch(() => {});
    onChanged();
  };

  if (leaving) return <div className="page muted">Loading…</div>;
  // Choosing a team comes first: after signing in, when asked for from the menu, and whenever no team is chosen.
  if (!printing && (picking || !state.team)) {
    const pick = (shared: boolean, id: number) => {
      if (shared) {
        sessionStorage.removeItem(PICK_KEY);
        return openTeam(true, id);
      }
      setTeamId(id);
      donePicking();
      navigate('/');
    };
    return (
      <Ctx.Provider value={state}>
        <TeamPicker
          name={user.name}
          current={picking ? state.team?.id : undefined}
          onPick={pick}
          onCreated={(t) => {
            setTeamId(t.id);
            donePicking();
            navigate('/teams');
          }}
          onBack={picking && state.team ? donePicking : undefined}
          onSignOut={signOut}
        />
      </Ctx.Provider>
    );
  }

  const routes = (
    <Routes>
      <Route path="/teams" element={<Teams />} />
      <Route path="/account" element={<Account onChanged={onChanged} />} />
      {/* The old Administration page was folded into System admin. An old link to it lands there. */}
      {user.is_system_admin && <Route path="/admin" element={<Navigate to="/system" replace />} />}
      {user.is_system_admin && <Route path="/system" element={<SystemAdmin />} />}
      {needsTeam ? (
        <Route path="*" element={<Navigate to="/teams" replace />} />
      ) : (
        <>
          <Route path="/" element={<Dashboard />} />
          <Route path="/practices" element={<Plans kind="practice" />} />
          <Route path="/homework" element={<Plans kind="homework" />} />
          <Route path="/plans/:id" element={<PlanEditor />} />
          <Route path="/go/plan/:teamId/:planId" element={<GoToPlan />} />
          <Route path="/plans/:id/print" element={<PrintView />} />
          {user.can_import && <Route path="/import" element={<ImportPlans />} />}
          <Route path="/library" element={<Library />} />
          <Route path="/playbook" element={<Playbook />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/plays/:id" element={<PlayEditor />} />
          <Route path="/plays/:id/print" element={<PlayPrint />} />
          <Route path="/tags" element={<Tags />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/coach-library" element={<CoachLibraryPage />} />
          <Route path="/communities" element={<Communities />} />
          <Route path="/communities/:id" element={<CommunityPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      )}
    </Routes>
  );
  const navLink = (n: NavItem) => (
    <NavLink key={n.to} to={n.to} end={n.end} title={navFolded ? n.label : undefined}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={n.icon} />
      </svg>
      {n.label}
      {n.to === '/messages' && communityUnread > 0 && (
        <span className="nav-badge" title={`${communityUnread} unread message${communityUnread === 1 ? '' : 's'}`}>
          {communityUnread > 9 ? '9+' : communityUnread}
          <span className="sr-only"> new</span>
        </span>
      )}
    </NavLink>
  );

  return (
    <Ctx.Provider value={state}>
      {printing ? (
        routes
      ) : (
        <div className={`shell ${navFolded ? 'nav-folded' : ''} ${menuOpen ? 'menu-open' : ''}`}>
          {/* Narrow screens only: the team, and the button that opens the menu. */}
          <header className="mobile-bar">
            <button type="button" className="menu-btn" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-label={communityUnread > 0 ? `Menu, ${communityUnread} unread` : 'Menu'}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              {communityUnread > 0 && <span className="menu-dot" aria-hidden="true" />}
            </button>
            <span className="brand-mark" aria-hidden="true" />
            <span className="mobile-team">{state.team!.name}</span>
          </header>
          {menuOpen && <div className="menu-scrim" onClick={() => setMenuOpen(false)} />}
          <aside className="sidebar">
            <div className="side-top">
              <NavLink to="/" className="brand">
                <span className="brand-mark" aria-hidden="true" />
                Dime Coach
              </NavLink>
              <button type="button" className={`nav-fold ${navFolded ? 'open-it' : ''}`} onClick={() => foldNav(!navFolded)} aria-expanded={!navFolded} aria-label={navFolded ? 'Show the menu' : 'Hide the menu'} title={navFolded ? 'Show the menu' : 'Hide the menu'}>
                {navFolded ? '»' : '«'}
              </button>
              <button type="button" className="menu-close" onClick={() => setMenuOpen(false)} aria-label="Close the menu">
                ✕
              </button>
            </div>
            {/* The team being worked on. Changing it means going back to the choosing screen. */}
            <div className="team-now">
              <strong>{state.team!.name}</strong>
              <span className="muted small">{[state.sport?.name, state.team!.season].filter(Boolean).join(' · ')}</span>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setMenuOpen(false);
                  pickTeam();
                }}
              >
                Switch team
              </button>
            </div>
            <nav className="side-nav" aria-label="Main">
              {navLink(HOME)}
              {NAV_GROUPS.map((g) => (
                <div className="nav-group" key={g.title} role="group" aria-label={g.title}>
                  <span className="side-label">{g.title}</span>
                  {g.items.map(navLink)}
                </div>
              ))}
            </nav>
            <div className="side-foot">
              <UserMenu
                user={user}
                onTour={() => {
                  setMenuOpen(false);
                  setTouring(true);
                }}
                onSignOut={signOut}
              />
            </div>
          </aside>
          {/* The sport of the team being worked on: page titles show its ball beside them. */}
          <main className="main" data-sport={state.team ? (sportKind(state.sport?.name) ?? 'other') : undefined}>
            {state.access && <SharedBar />}
            {routes}
          </main>
          {touring && <Tour onClose={endTour} />}
        </div>
      )}
    </Ctx.Provider>
  );
}

/**
 * Opens a plan from a message. When it belongs to a team other than the one being worked on, that
 * team is opened first: the page it lands on then carries on to the plan.
 */
function GoToPlan() {
  const app = useApp();
  const navigate = useNavigate();
  const { teamId, planId } = useParams();
  useEffect(() => {
    const team = Number(teamId);
    const to = `/plans/${planId}`;
    const shared = app.shared_teams.some((t) => t.id === team);
    if (app.team?.id === team) navigate(to, { replace: true });
    // A team that is no longer theirs to open: back to the messages.
    else if (!shared && !app.own_teams.some((t) => t.id === team)) navigate('/messages', { replace: true });
    else {
      sessionStorage.setItem(AFTER_KEY, to);
      app.openTeam(shared, team);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="page muted">Opening…</div>;
}

const MENU_ICONS = {
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.700 1.900 7.500 5.500',
  tour: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.700.400-1 .900-1 1.700M12 16.500h.01',
  signOut: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
};
/**
 * The person signed in, at the foot of the menu. Pressing it opens a list above it with their
 * account, the tour, the color theme and signing out.
 */
function UserMenu({ user, onTour, onSignOut }: { user: User; onTour: () => void; onSignOut: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (e.type === 'keydown' ? (e as KeyboardEvent).key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', away);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', away);
    };
  }, [open]);
  const item = (label: string, icon: string, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={icon} />
      </svg>
      {label}
    </button>
  );
  return (
    <div className="user-menu" ref={root}>
      {open && (
        <div className="user-pop" role="menu" aria-label="Your account">
          <span className="user-pop-email">{user.email}</span>
          {item('Account', MENU_ICONS.account, () => navigate('/account'))}
          {user.is_system_admin && item('System admin', icons.system, () => navigate('/system'))}
          {item('Take the tour', MENU_ICONS.tour, onTour)}
          <div className="user-pop-row">
            <span>Appearance</span>
            <ThemeToggle />
          </div>
          <div className="user-pop-end">{item('Sign out', MENU_ICONS.signOut, onSignOut)}</div>
        </div>
      )}
      <button type="button" className="user-chip" aria-haspopup="menu" aria-expanded={open} title={user.name} onClick={() => setOpen(!open)}>
        <span className="user-avatar" aria-hidden="true">
          {(user.name.trim()[0] || '?').toUpperCase()}
        </span>
        <span className="user-chip-name">{user.name}</span>
        <svg className="user-chip-caret" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9.500l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

/** Which permission each part of the app needs before anything on it can be changed. */
const PAGE_PERMS: [RegExp, TeamPerm, string][] = [
  [/^\/(practices|homework|plans|import)\b/, 'plans', 'practices and homework'],
  [/^\/(library|tags)\b/, 'drills', 'drills and categories'],
  [/^\/(playbook|plays)\b/, 'plays', 'the playbook'],
  [/^\/resources\b/, 'resources', 'resources'],
];

/** Shown across the top while working in a team someone else owns. */
function SharedBar() {
  const app = useApp();
  const { pathname } = useLocation();
  const access = app.access!;
  const page = PAGE_PERMS.find(([re]) => re.test(pathname));
  const viewOnly = page && !app.can(page[1]);
  return (
    <div className={`shared-bar ${viewOnly ? 'view-only' : ''}`} role="status">
      <span>
        {access.system ? (
          <>
            You are looking at <strong>{app.team?.name}</strong>, {access.owner_name}'s team, as the system administrator
          </>
        ) : (
          <>
            <strong>{app.team?.name}</strong> is shared with you by {access.owner_name}
            {access.title ? ` · ${access.title}` : ''}
          </>
        )}
        {viewOnly && (
          <>
            {' '}
            · <strong>View only:</strong> you can look at {page[2]} here, but changes will not be saved.
          </>
        )}
      </span>
      <button className="btn small" onClick={app.pickTeam}>
        Switch team
      </button>
    </div>
  );
}

function Account({ onChanged }: { onChanged: () => void }) {
  const { user } = useApp();
  return (
    <div className="page editor">
      <div className="page-head">
        <div>
          <h1>Your account</h1>
          <p className="muted">
            {user.name} · {user.email}
          </p>
        </div>
      </div>
      <div className="card account-card">
        <h2>Change password</h2>
        <PasswordForm onDone={onChanged} />
      </div>
    </div>
  );
}
