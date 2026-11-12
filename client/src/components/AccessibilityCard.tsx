import { api, type AdminSettings } from '../api';
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
