import { api, type AdminSettings } from '../api';

const MODES: { id: AdminSettings['registration_mode']; label: string; text: string }[] = [
  { id: 'closed', label: 'Closed', text: 'Only an administrator creates accounts, under "Add a person".' },
  {
    id: 'open',
    label: 'Open sign-up',
    text: 'Anyone can create an account with an email and a password and start using it straight away. No email is sent, so nothing checks that the address is really theirs.',
  },
  {
    id: 'verify',
    label: 'Sign-up with email confirmation',
    text: 'Anyone can create an account, but they must open a link sent to their email address before they can sign in.',
  },
];

/**
 * How people get an account: not at all by themselves, by signing up, or by signing up and
 * confirming their email address. `run` does the change and reloads the settings.
 */
export default function RegistrationCard({ settings, run }: { settings: AdminSettings; run: (fn: () => Promise<unknown>, done?: string) => void }) {
  const email = settings.mailer.configured;
  return (
    <div className="card">
      <h2>How people sign up</h2>
      <div className="reg-modes" role="radiogroup" aria-label="How people sign up">
        {MODES.map((m) => {
          const blocked = m.id === 'verify' && !email;
          return (
            <label key={m.id} className={`reg-mode ${settings.registration_mode === m.id ? 'on' : ''} ${blocked ? 'blocked' : ''}`}>
              <input
                type="radio"
                name="registration-mode"
                checked={settings.registration_mode === m.id}
                disabled={blocked}
                onChange={() => run(() => api.adminSetSettings({ registration_mode: m.id }), m.id === 'closed' ? 'Sign-up is closed.' : `${m.label} is on.`)}
              />
              <span>
                <strong>{m.label}</strong>
                <span className="muted small">
                  {m.text}
                  {blocked && ' Not available yet: no email service is connected.'}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="muted small reg-status">
        {!email
          ? 'Email: no email service is connected.'
          : settings.mailer.transport === 'log'
            ? 'Email is in test mode: messages are printed in the server console, not sent.'
            : 'Email is connected.'}
        {settings.registration_mode === 'verify' && !settings.registration_open && ' Sign-up is closed until email works again.'}
      </p>
      {email && (
        <button className="btn small" onClick={() => run(() => api.adminTestEmail(), 'Test email sent to your own address. Check your inbox.')}>
          Send me a test email
        </button>
      )}
    </div>
  );
}
