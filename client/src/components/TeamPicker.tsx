import type { Bootstrap } from '../api';
import SportIcon from './SportIcon';

/**
 * Shown right after signing in when there is more than one team to work on: pick the team first,
 * then the dashboard opens on it.
 */
export default function TeamPicker({
  name,
  ownTeams,
  sharedTeams,
  onPick,
  onSignOut,
}: {
  name: string;
  ownTeams: Bootstrap['own_teams'];
  sharedTeams: Bootstrap['shared_teams'];
  onPick: (shared: boolean, id: number) => void;
  onSignOut: () => void;
}) {
  const first = name.trim().split(/\s+/)[0];
  return (
    <div className="auth team-pick">
      <div className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark" aria-hidden="true" />
          Dime Coach
        </div>
        <h1>Which team{first ? `, ${first}` : ''}?</h1>
        <p className="muted auth-lead">Pick the team you want to work on. You can switch any time at the top of the menu.</p>
        {ownTeams.length > 0 && (
          <ul className="team-pick-list" aria-label="Your teams">
            {ownTeams.map((t) => (
              <li key={t.id}>
                <button type="button" className="team-pick-card" onClick={() => onPick(false, t.id)}>
                  <SportIcon sport={t.sport} />
                  <span>
                    <strong>{t.name}</strong>
                    <span className="muted small">{[t.sport, t.season].filter(Boolean).join(' · ')}</span>
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
                <li key={t.id}>
                  <button type="button" className="team-pick-card" onClick={() => onPick(true, t.id)}>
                    <SportIcon sport={t.sport} />
                    <span>
                      <strong>{t.name}</strong>
                      <span className="muted small">{[t.sport, t.season, `from ${t.owner_name}`].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted small auth-foot">
          <button type="button" className="link" onClick={onSignOut}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}
