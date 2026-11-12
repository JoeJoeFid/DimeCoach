import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type AdminSettings, type AdminUser } from '../api';
import { useApp } from '../App';
import { Field } from '../components/bits';
import { confirmDialog, promptDialog } from '../components/dialogs';

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';

/** System administration: who has an account, who may import plans, and whether signup is open. */
export default function Admin() {
  const { user: me } = useApp();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState({ name: '', email: '', password: '', can_import: false });

  const load = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([api.adminUsers(), api.adminSettings()]);
      setUsers(u);
      setSettings(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, done = '') => {
    try {
      await fn();
      setError('');
      setNotice(done);
      await load();
    } catch (e) {
      setNotice('');
      setError((e as Error).message);
    }
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    run(
      async () => {
        await api.adminCreateUser(draft);
        setDraft({ name: '', email: '', password: '', can_import: false });
      },
      `Account created for ${draft.email}. Give them the starting password yourself. They will be asked to replace it when they first sign in.`,
    );
  };
  const resetPassword = async (u: AdminUser) => {
    const password = await promptDialog({
      title: `New starting password for ${u.name}`,
      body: 'At least 10 characters. They are signed out everywhere and must replace it at next sign-in.',
      confirmLabel: 'Set password',
    });
    if (password) run(() => api.adminUpdateUser(u.id, { password }), `Password reset for ${u.email}. Pass the new one to them yourself.`);
  };
  const setStatus = async (u: AdminUser, status: 'active' | 'disabled') => {
    if (status === 'disabled') {
      const ok = await confirmDialog({
        title: `Turn off ${u.name}'s account?`,
        body: 'They are signed out and cannot sign in. Their teams and practices are kept, and you can turn the account back on.',
        confirmLabel: 'Turn off account',
        danger: true,
      });
      if (!ok) return;
    }
    run(() => api.adminUpdateUser(u.id, { status }));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Administration</h1>
          <p className="muted">Accounts for the whole system. Each person gets a workspace of their own with their own teams, drills and categories.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      <div className="card">
        <div className="card-head">
          <h2>People {users && <span className="muted">({users.length})</span>}</h2>
        </div>
        {users === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th className="num">Teams</th>
                  <th>Last sign-in</th>
                  <th>Plan import</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong> {u.is_admin && <span className="kind game">Admin</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      {u.status === 'active' ? 'Active' : u.status === 'pending' ? 'Awaiting email confirmation' : 'Turned off'}
                      {u.must_change_password && u.status === 'active' && <span className="muted small"> · has not set own password</span>}
                    </td>
                    <td className="num">{u.teams}</td>
                    <td>{fmtWhen(u.last_login_at)}</td>
                    <td>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={u.can_import}
                          aria-label={`Allow plan import for ${u.name}`}
                          onChange={(e) => run(() => api.adminUpdateUser(u.id, { can_import: e.target.checked }))}
                        />
                        {u.can_import ? 'Allowed' : 'Off'}
                      </label>
                    </td>
                    <td className="num">
                      <span className="row-actions">
                        <button className="btn small" onClick={() => resetPassword(u)}>
                          Reset password
                        </button>
                        {u.id !== me.id && u.status !== 'pending' && (
                          <button className={`btn small ${u.status === 'active' ? 'danger' : ''}`} onClick={() => setStatus(u, u.status === 'active' ? 'disabled' : 'active')}>
                            {u.status === 'active' ? 'Turn off' : 'Turn on'}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Add a person</h2>
        <p className="muted small">
          Until email is connected, you create accounts here and pass the starting password along yourself. Plan import runs Claude on the
          computer hosting Dime Coach, so grant it only to people you want using that.
        </p>
        <form className="fields" onSubmit={create}>
          <Field label="Name" grow>
            <input className="input" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Email" grow>
            <input className="input" type="email" required value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          </Field>
          <Field label="Starting password" grow>
            <input className="input" required minLength={10} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="off" />
          </Field>
          <label className="check field-check">
            <input type="checkbox" checked={draft.can_import} onChange={(e) => setDraft({ ...draft, can_import: e.target.checked })} />
            Allow plan import
          </label>
          <button className="btn primary">Create account</button>
        </form>
      </div>

      {settings && (
        <div className="card">
          <h2>Self-service registration</h2>
          <p className="muted small">
            When this is on, anyone can create an account from the sign-in page and must confirm their email address before signing in. The
            flow is built, but it needs an email service to send the confirmation link.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.registration_enabled}
              disabled={!settings.mailer.configured}
              onChange={(e) => run(() => api.adminSetSettings({ registration_enabled: e.target.checked }))}
            />
            Let people register themselves
          </label>
          <p className="muted small reg-status">
            {!settings.mailer.configured
              ? 'Not available yet: no email service is connected.'
              : settings.mailer.transport === 'log'
                ? 'Email is in test mode: confirmation links are printed in the server console, not sent.'
                : settings.registration_open
                  ? 'Registration is open.'
                  : 'Registration is closed.'}
          </p>
          {settings.mailer.configured && (
            <button className="btn small" onClick={() => run(() => api.adminTestEmail(), 'Test email sent to your own address. Check your inbox.')}>
              Send me a test email
            </button>
          )}
        </div>
      )}
    </div>
  );
}
