import { useEffect, useState } from 'react';
import { api, type FamilyKind, type FollowedTeam } from '../api';
import { useApp } from '../App';
import type { Team } from '../types';
import { NewTeam } from '../pages/Teams';
import { confirmDialog } from './dialogs';
import SportIcon from './SportIcon';

/** Set just before the app reloads for someone who has started coaching, so the form for a new team opens. */
export const NEW_TEAM_KEY = 'practiceplan.newTeam';
const AS: Record<FamilyKind, string> = { parent: 'a parent', family: 'family', friend: 'a friend of the team' };
/**
 * The teams someone follows as a parent, family or a friend, to choose from. They sit in the same
 * list as the teams a coach runs, since one person can coach one team and have a child on another.
 */
export function FollowedTeams({ label, onPick, onCount }: { /** A heading, when these come after other teams. */ label?: string; onPick: (slug: string) => void; onCount?: (n: number) => void }) {
  const [teams, setTeams] = useState<FollowedTeam[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.followedTeams().then(
      (t) => {
        setTeams(t);
        onCount?.(t.length);
      },
      (e) => setError((e as Error).message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!teams) return <p className="muted">Loading…</p>;
  if (!teams.length) return null;
  return (
    <>
      {label && <h2 className="side-label team-pick-label">{label}</h2>}
      <ul className="team-pick-list" aria-label="Teams you follow">
        {teams.map((t) => (
          <li key={t.id}>
            <button type="button" className="team-pick-card followed" onClick={() => onPick(t.slug)}>
              <SportIcon sport={t.sport} />
              <span>
                <strong>{t.name}</strong>
                <span className="muted small">{[t.sport, t.season, `You are ${AS[t.kind]}${t.players.length ? ` of ${t.players.join(' and ')}` : ''}`].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Where a team is chosen: after signing in, and whenever "Switch team" is pressed. It is the only
 * place teams are changed, added, or (for one shared with you) left.
 */
export default function TeamPicker({
  name,
  current,
  onPick,
  onFollow,
  onCreated,
  onBack,
  onSignOut,
}: {
  name: string;
  /** The team being worked on when this was opened from inside the app. */
  current?: number;
  onPick: (shared: boolean, id: number) => void;
  /** A team this person follows as a parent, family or a friend was chosen. */
  onFollow: (slug: string) => void;
  onCreated: (t: Team) => void;
  /** Present when there is a team to go back to without choosing again. */
  onBack?: () => void;
  onSignOut: () => void;
}) {
  const app = useApp();
  const { own_teams: ownTeams, shared_teams: sharedTeams } = app;
  // Someone who only follows teams has teams to choose from, though none to run.
  const none = ownTeams.length + sharedTeams.length === 0 && !app.following;
  // With no team at all, the form for making the first one opens by itself.
  // Someone who has just started coaching came here to make a team, so its form is open for them.
  const [adding, setAdding] = useState(() => {
    const asked = sessionStorage.getItem(NEW_TEAM_KEY) === '1';
    sessionStorage.removeItem(NEW_TEAM_KEY);
    return none || asked;
  });
  const [error, setError] = useState('');
  const first = name.trim().split(/\s+/)[0];
  const leave = async (id: number, teamName: string) => {
    const ok = await confirmDialog({ title: `Leave "${teamName}"?`, body: 'You will no longer see this team. Its owner can share it with you again.', confirmLabel: 'Leave team', danger: true });
    if (!ok) return;
    try {
      await api.leaveSharedTeam(id);
      await app.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="auth team-pick">
      <div className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark" aria-hidden="true" />
          Dime Coach
        </div>
        <h1>{none ? `Welcome${first ? `, ${first}` : ''}` : `Which team${first ? `, ${first}` : ''}?`}</h1>
        {none && <p className="muted auth-lead">Everything in Dime Coach belongs to a team, so start by making yours.</p>}
        {error && <p className="error">{error}</p>}
        {ownTeams.length > 0 && (
          <ul className="team-pick-list" aria-label="Your teams">
            {ownTeams.map((t) => (
              <li key={t.id}>
                <button type="button" className={`team-pick-card ${t.id === current ? 'current' : ''}`} onClick={() => onPick(false, t.id)}>
                  <SportIcon sport={t.sport} />
                  <span>
                    <strong>{t.name}</strong>
                    <span className="muted small">{[t.sport, t.season, t.id === current && 'open now'].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {sharedTeams.length > 0 && (
          <>
            <h2 className="side-label team-pick-label">Shared with you</h2>
            <ul className="team-pick-list" aria-label="Teams shared with you">
              {sharedTeams.map((t) => (
                <li key={t.id} className="team-pick-shared">
                  <button type="button" className="team-pick-card" onClick={() => onPick(true, t.id)}>
                    <SportIcon sport={t.sport} />
                    <span>
                      <strong>{t.name}</strong>
                      <span className="muted small">{[t.sport, t.season, `from ${t.owner_name}`].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                  <button type="button" className="link small" onClick={() => leave(t.id, t.name)}>
                    Leave
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {app.following > 0 && <FollowedTeams label={ownTeams.length + sharedTeams.length ? 'Teams you follow' : undefined} onPick={onFollow} />}
        <button type="button" className="btn team-pick-new" onClick={() => setAdding(true)}>
          + New team
        </button>
        <p className="muted small auth-foot team-pick-foot">
          {onBack && (
            <button type="button" className="link" onClick={onBack}>
              Back to {ownTeams.find((t) => t.id === current)?.name ?? 'the team'}
            </button>
          )}
          <button type="button" className="link" onClick={onSignOut}>
            Sign out
          </button>
        </p>
      </div>
      {adding && <NewTeam onClose={() => setAdding(false)} onCreated={onCreated} />}
    </div>
  );
}
