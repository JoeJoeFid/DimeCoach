import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SIGNED_OUT_EVENT, api, type AuthStatus, type Bootstrap, type User } from './api';
import type { Sport, Tag, Team, TeamPerm } from './types';
import { sportKind } from './sports';
import { DialogHost } from './components/dialogs';
import { ThemeToggle } from './theme';
import Tour from './components/Tour';
import TeamPicker from './components/TeamPicker';
import { PasswordForm, Setup, SignedOut } from './pages/Auth';
import Admin from './pages/Admin';
import SystemAdmin from './pages/SystemAdmin';
import Communities from './pages/Communities';
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

interface AppState extends Bootstrap {
  user: User;
  team: Team | null;
  sport: Sport | null;
  /** Tags of the current team's sport. */
  sportTags: Tag[];
  setTeamId: (id: number) => void;
  /** Switches to one of your own teams, or to a team shared with you. */
  openTeam: (shared: boolean, id: number) => void;
  /** True while the welcome tour is on screen, so pages hold back their own pop-ups until it is over. */
  touring: boolean;
  /** Whether you may change this part of the team. Always true for your own teams. */
  can: (perm: TeamPerm) => boolean;
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
  admin: 'M12 3 5 6v5.500c0 4.300 2.900 7.600 7 9.500 4.100-1.900 7-5.200 7-9.500V6zM9.500 12l2 2 3.500-4',
  system: 'M4 6h16v5H4zM4 13h16v5H4zM7 8.500h.01M7 15.500h.01M11 8.500h6M11 15.500h6',
  community: 'M4 5h11v8H9l-3 3v-3H4zM15 9h5v8h-2v3l-3-3h-4v-2',
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
      { to: '/teams', label: 'Teams & rosters', icon: icons.teams },
      { to: '/tags', label: 'Categories', icon: icons.tags },
    ],
  },
  {
    // Other coaches: talking, and trading drills, plays and plans.
    title: 'Community',
    items: [{ to: '/communities', label: 'Communities', icon: icons.community }],
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
  const endTour = useCallback(() => {
    setTouring(false);
    if (!user.prefs.tour_done)
      api
        .savePrefs({ tour_done: true })
        .then(onChanged)
        .catch(() => {});
  }, [user.prefs.tour_done, onChanged]);

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

  const state = useMemo<AppState | null>(() => {
    if (!data) return null;
    const team = data.teams.find((t) => t.id === teamId) || data.teams[0] || null;
    const sport = data.sports.find((s) => s.id === team?.sport_id) || null;
    return {
      ...data,
      user,
      team,
      sport,
      sportTags: data.tags.filter((t) => t.sport_id === team?.sport_id),
      setTeamId,
      openTeam,
      touring,
      can: (perm) => !data.access || data.access.perms[perm],
      reload,
      refreshUser: onChanged,
    };
  }, [data, user, teamId, setTeamId, openTeam, touring, reload, onChanged]);

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
  const needsTeam = !state.team;
  const signOut = async () => {
    await api.logout().catch(() => {});
    onChanged();
  };

  // Straight after signing in, with more than one team to work on, the first thing is to say which.
  if (choosingTeam && !printing && state.own_teams.length + state.shared_teams.length > 1) {
    const pick = (shared: boolean, id: number) => {
      const here = state.access ? shared && state.access.team_id === id : !shared;
      // Staying in the same workspace only changes the team. Anything else reloads into the other workspace.
      if (!here) return openTeam(shared, id);
      if (!shared) setTeamId(id);
      onTeamChosen();
      navigate('/');
    };
    return <TeamPicker name={user.name} ownTeams={state.own_teams} sharedTeams={state.shared_teams} onPick={pick} onSignOut={signOut} />;
  }

  const routes = (
    <Routes>
      <Route path="/teams" element={<Teams />} />
      <Route path="/account" element={<Account onChanged={onChanged} />} />
      {user.is_admin && <Route path="/admin" element={<Admin />} />}
      {user.is_system_admin && <Route path="/system" element={<SystemAdmin />} />}
      {needsTeam ? (
        <Route path="*" element={<Navigate to="/teams" replace />} />
      ) : (
        <>
          <Route path="/" element={<Dashboard />} />
          <Route path="/practices" element={<Plans kind="practice" />} />
          <Route path="/homework" element={<Plans kind="homework" />} />
          <Route path="/plans/:id" element={<PlanEditor />} />
          <Route path="/plans/:id/print" element={<PrintView />} />
          {user.can_import && <Route path="/import" element={<ImportPlans />} />}
          <Route path="/library" element={<Library />} />
          <Route path="/playbook" element={<Playbook />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/plays/:id" element={<PlayEditor />} />
          <Route path="/plays/:id/print" element={<PlayPrint />} />
          <Route path="/tags" element={<Tags />} />
          <Route path="/communities" element={<Communities />} />
          <Route path="/communities/:id" element={<CommunityPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      )}
    </Routes>
  );
  const navLink = (n: NavItem) => (
    <NavLink key={n.to} to={n.to} end={n.end}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={n.icon} />
      </svg>
      {n.label}
    </NavLink>
  );

  return (
    <Ctx.Provider value={state}>
      {printing ? (
        routes
      ) : (
        <div className="shell">
          <aside className="sidebar">
            <NavLink to="/" className="brand">
              <span className="brand-mark" aria-hidden="true" />
              Dime Coach
            </NavLink>
            {(state.team || state.shared_teams.length > 0) && (
              <label className="team-select">
                <span className="side-label">Team</span>
                <select
                  value={state.access ? `s${state.access.team_id}` : state.team ? `o${state.team.id}` : ''}
                  onChange={(e) => e.target.value && openTeam(e.target.value[0] === 's', Number(e.target.value.slice(1)))}
                >
                  {!state.team && <option value="">Choose a team</option>}
                  {state.own_teams.map((t) => (
                    <option key={t.id} value={`o${t.id}`}>
                      {t.name}
                      {t.season ? ` · ${t.season}` : ''}
                    </option>
                  ))}
                  {state.shared_teams.length > 0 && (
                    <optgroup label="Shared with you">
                      {state.shared_teams.map((t) => (
                        <option key={t.id} value={`s${t.id}`}>
                          {t.name} · {t.owner_name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            )}
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
              {(user.is_admin || user.is_system_admin) && (
                <nav className="side-nav admin-nav">
                  {user.is_system_admin && navLink({ to: '/system', label: 'System admin', icon: icons.system })}
                  {user.is_admin && navLink({ to: '/admin', label: 'Administration', icon: icons.admin })}
                </nav>
              )}
              <div className="side-user">
                <NavLink to="/account" className="side-user-name" title="Your account">
                  {user.name}
                </NavLink>
                <button className="link small" onClick={signOut}>
                  Sign out
                </button>
                <button className="link small" onClick={() => setTouring(true)}>
                  Take the tour
                </button>
              </div>
              <ThemeToggle />
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
        <strong>{app.team?.name}</strong> is shared with you by {access.owner_name}
        {access.title ? ` · ${access.title}` : ''}
        {viewOnly && (
          <>
            {' '}
            · <strong>View only:</strong> you can look at {page[2]} here, but changes will not be saved.
          </>
        )}
      </span>
      <button className="btn small" onClick={() => app.openTeam(false, app.own_teams[0]?.id || 0)}>
        Back to my teams
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
