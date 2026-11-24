import { useEffect, useState } from 'react';
import { api, type AdminSettings, type StreamTeam } from '../api';
import { useApp } from '../App';

/** Site-wide choices for people who work without a mouse. `run` makes the change and reloads the settings. */
export default function AccessibilityCard({ settings, run }: { settings: AdminSettings; run: (fn: () => Promise<unknown>, done?: string) => void }) {
  const app = useApp();
  return (
    <div className="card">
      <h2>Accessibility</h2>
      <label className="check setting">
        <input
          type="checkbox"
          checked={settings.keyboard_access}
          onChange={(e) =>
            run(
              async () => {
                await api.adminSetSettings({ keyboard_access: e.target.checked });
                // Everyone picks it up the next time the app loads. This reloads it here straight away.
                await app.reload();
              },
              e.target.checked ? 'Keyboard accessibility is on for everyone.' : 'Keyboard accessibility is off.',
            )
          }
        />
        <span>
          <strong>Keyboard accessibility</strong>
          <span className="muted small">
            {' '}
            Shows "+ Item" and "+ Break" buttons between the items of a practice, so one can be added at any point without dragging. With this
            off, drills are dragged in from the list, or clicked to add them at the end.
          </span>
        </span>
      </label>
    </div>
  );
}

/** Who may bring a play in from another play designer's PDF: only the system administrator, or everyone. */
export function PlayImportCard({ settings, run }: { settings: AdminSettings; run: (fn: () => Promise<unknown>, done?: string) => void }) {
  const app = useApp();
  return (
    <div className="card">
      <h2>Play import</h2>
      <label className="check setting">
        <input
          type="checkbox"
          checked={settings.play_import}
          onChange={(e) =>
            run(
              async () => {
                await api.adminSetSettings({ play_import: e.target.checked });
                await app.reload();
              },
              e.target.checked ? 'Everyone can now bring in a play from a PDF.' : 'Bringing in a play from a PDF is back to you alone.',
            )
          }
        />
        <span>
          <strong>Everyone can import a play from a PDF</strong>
          <span className="muted small">
            {' '}
            Adds "Import a PDF" to the basketball playbook. It reads the sheet another play designer prints, and makes a play with a step for each
            diagram. With this off, only you see it.
          </span>
        </span>
      </label>
    </div>
  );
}

/** What each team may do that is decided team by team: keep video of its games, which is what fills the disk, and bring a game's stats in from a file. */
export function SavedVideoCard({ run }: { run: (fn: () => Promise<unknown>, done?: string) => void }) {
  const [teams, setTeams] = useState<StreamTeam[] | null>(null);
  useEffect(() => {
    api.adminStreamTeams().then(setTeams, () => setTeams([]));
  }, []);
  const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
  return (
    <div className="card">
      <h2>Saved game video and stat import</h2>
      <p className="muted small">Both are turned on team by team. Anyone allowed to can broadcast a game live; keeping the video afterwards takes storage, and saved video is for the team's coaches. Stat import adds "Import stats" to each of the team's games, to bring in the stats another scorekeeping app exports. The shot efficiency chart adds "Volume and efficiency" under Stats, Shooting.</p>
      {teams === null ? (
        <p className="muted small">Loading…</p>
      ) : teams.length === 0 ? (
        <p className="muted small">There are no teams yet.</p>
      ) : (
        <ul className="sv-teams">
          {teams.map((t) => (
            <li key={t.id}>
              <span>
                <strong>{t.name}</strong> <span className="muted small">{[t.owner, t.videos ? `${t.videos} saved, ${mb(t.bytes)}` : ''].filter(Boolean).join(' · ')}</span>
              </span>
              <label className="check">
                <input type="checkbox" checked={t.save} onChange={(e) => run(async () => setTeams(await api.adminSetStreamTeam(t.id, { save: e.target.checked })), e.target.checked ? `${t.name} can now save game video.` : `${t.name} can no longer save game video. What it saved already is kept.`)} />
                <span>Save video</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={t.stats} onChange={(e) => run(async () => setTeams(await api.adminSetStreamTeam(t.id, { stats: e.target.checked })), e.target.checked ? `${t.name} can now import stats.` : `${t.name} can no longer import stats. What it brought in already is kept.`)} />
                <span>Import stats</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={t.shots} onChange={(e) => run(async () => setTeams(await api.adminSetStreamTeam(t.id, { shots: e.target.checked })), e.target.checked ? `${t.name} now has the shot volume and efficiency chart.` : `${t.name} no longer has the shot volume and efficiency chart.`)} />
                <span>Shot efficiency chart</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
