import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type SystemState, type SystemUser } from '../api';
import { useApp } from '../App';
import { Field } from '../components/bits';
import { confirmDialog, promptDialog } from '../components/dialogs';
import { SpaceMeter, fmtSpace } from '../components/SpaceMeter';

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';
const MB = 1024 * 1024;

/**
 * For the system administrator only: every account, what each may do, and how much upload
 * space each has. Accounts can be created here too, with their upload space set from the start.
 */
export default function SystemAdmin() {
  const { user: me } = useApp();
  const [state, setState] = useState<SystemState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** Cap boxes being typed in, by user id. Absent means the box shows the saved value. */
  const [caps, setCaps] = useState<Record<number, string>>({});
  const [defaultCap, setDefaultCap] = useState<string | null>(null);
  const blank = { name: '', email: '', password: '', can_import: false, is_admin: false, cap: '' };
  const [draft, setDraft] = useState(blank);

  const load = useCallback(async () => {
    try {
      setState(await api.system());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<SystemState | unknown>, done = '') => {
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
    const d = draft;
    run(
      async () => {
        const made = await api.adminCreateUser({ name: d.name, email: d.email, password: d.password, can_import: d.can_import });
        // The account exists from here on, so clear the form even if a follow-up setting fails.
        setDraft(blank);
        const extra: { upload_cap_mb?: number; is_admin?: boolean } = {};
        if (d.cap.trim() !== '') extra.upload_cap_mb = Number(d.cap);
        if (d.is_admin) extra.is_admin = true;
        if (Object.keys(extra).length > 0) await api.systemUpdateUser(made.id, extra);
      },
      `Account created for ${d.email}. Give them the starting password yourself. They will be asked to replace it when they first sign in.`,
    );
  };
  const saveCap = (u: SystemUser) => {
    const typed = caps[u.id];
    if (typed === undefined) return;
    const value = typed.trim() === '' ? null : Number(typed);
    setCaps(({ [u.id]: _dropped, ...rest }) => rest);
    if (value === u.upload_cap_mb) return;
    run(
      () => api.systemUpdateUser(u.id, { upload_cap_mb: value }),
      value === null ? `${u.name} now has the default upload space.` : value === 0 ? `Uploads are turned off for ${u.name}.` : `${u.name} can now upload up to ${fmtSpace(value * MB)}.`,
    );
  };
  const saveDefault = () => {
    if (defaultCap === null || !state) return;
    const value = Number(defaultCap);
    setDefaultCap(null);
    if (defaultCap.trim() === '' || value === state.default_cap_mb) return;
    run(() => api.systemSetDefaults({ default_cap_mb: value }), `The default upload space is now ${fmtSpace(value * MB)}.`);
  };
  const setRole = async (u: SystemUser, admin: boolean) => {
    if (admin) {
      const ok = await confirmDialog({
        title: `Make ${u.name} an administrator?`,
        body: 'Administrators can create accounts, reset passwords, turn accounts off and grant plan import. They cannot open this page, change upload space or change your account.',
        confirmLabel: 'Make administrator',
      });
      if (!ok) return;
    }
    run(() => api.systemUpdateUser(u.id, { is_admin: admin }), admin ? `${u.name} is now an administrator.` : `${u.name} is no longer an administrator.`);
  };
  const setStatus = async (u: SystemUser, status: 'active' | 'disabled') => {
    if (status === 'disabled') {
      const ok = await confirmDialog({
        title: `Turn off ${u.name}'s account?`,
        body: 'They are signed out and cannot sign in. Their teams, practices and uploads are kept, and you can turn the account back on.',
        confirmLabel: 'Turn off account',
        danger: true,
      });
      if (!ok) return;
    }
    run(() => api.adminUpdateUser(u.id, { status }), status === 'disabled' ? `${u.name}'s account is turned off.` : `${u.name}'s account is back on.`);
  };
  const resetPassword = async (u: SystemUser) => {
    const password = await promptDialog({
      title: `New starting password for ${u.name}`,
      body: 'At least 10 characters. They are signed out everywhere and must replace it at next sign-in.',
      confirmLabel: 'Set password',
    });
    if (password) run(() => api.adminUpdateUser(u.id, { password }), `Password reset for ${u.email}. Pass the new one to them yourself.`);
  };

  const users = state?.users ?? [];
  const over = users.filter((u) => u.used_bytes >= u.cap_mb * MB && u.used_bytes > 0).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>System admin</h1>
          <p className="muted">Only your account can open this page. It covers every account on this system and how much each may upload.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {state === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="sys-tiles">
            <div className="sys-tile">
              <div className="value">{users.length}</div>
              <div className="label">Accounts</div>
            </div>
            <div className="sys-tile">
              <div className="value">{users.filter((u) => u.status === 'active').length}</div>
              <div className="label">Active</div>
            </div>
            <div className="sys-tile">
              <div className="value">{fmtSpace(state.total_bytes)}</div>
              <div className="label">Uploaded in total</div>
            </div>
            <div className="sys-tile">
              <div className="value">{over}</div>
              <div className="label">At their cap</div>
            </div>
          </div>

          <div className="card">
            <h2>Default upload space</h2>
            <p className="muted small">
              Applies to everyone who has no cap of their own. It counts uploaded pictures and videos. Links take no space. Set it to 0 to turn
              uploads off by default.
            </p>
            <div className="sys-default">
              <label className="cap-edit">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={state.max_cap_mb}
                  step={50}
                  aria-label="Default upload space in MB"
                  value={defaultCap ?? String(state.default_cap_mb)}
                  onChange={(e) => setDefaultCap(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveDefault()}
                />
                <span className="muted small">MB per person</span>
              </label>
              <button className="btn" disabled={defaultCap === null || defaultCap.trim() === '' || Number(defaultCap) === state.default_cap_mb} onClick={saveDefault}>
                Save default
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>
                People and upload space <span className="muted">({users.length})</span>
              </h2>
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Status</th>
                    <th>Last sign-in</th>
                    <th>Upload space used</th>
                    <th>Cap (MB)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span className="sys-person">
                          <strong>{u.name}</strong>
                          <span className="muted small">{u.email}</span>
                          <span className="badges">
                            {u.is_system_admin ? <span className="kind system">System admin</span> : u.is_admin && <span className="kind game">Admin</span>}
                            {u.id === me.id && <span className="kind">You</span>}
                          </span>
                        </span>
                      </td>
                      <td>{u.status === 'active' ? 'Active' : u.status === 'pending' ? 'Awaiting email confirmation' : 'Turned off'}</td>
                      <td>{fmtWhen(u.last_login_at)}</td>
                      <td>
                        <SpaceMeter used={u.used_bytes} cap={u.cap_mb * MB} files={u.files} />
                      </td>
                      <td>
                        <span className="cap-edit">
                          <input
                            className="input"
                            type="number"
                            min={0}
                            max={state.max_cap_mb}
                            step={50}
                            placeholder={`${state.default_cap_mb}`}
                            aria-label={`Upload space for ${u.name} in MB`}
                            value={caps[u.id] ?? (u.upload_cap_mb === null ? '' : String(u.upload_cap_mb))}
                            onChange={(e) => setCaps({ ...caps, [u.id]: e.target.value })}
                            onBlur={() => saveCap(u)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          />
                          <span className="muted small">{u.upload_cap_mb === null ? 'Default' : 'Own cap'}</span>
                        </span>
                      </td>
                      <td className="num">
                        <span className="row-actions">
                          {!u.is_system_admin && (
                            <button className="btn small" onClick={() => setRole(u, !u.is_admin)}>
                              {u.is_admin ? 'Remove admin' : 'Make admin'}
                            </button>
                          )}
                          <button className="btn small" onClick={() => resetPassword(u)}>
                            Reset password
                          </button>
                          {!u.is_system_admin && u.status !== 'pending' && (
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
            <p className="muted small">
              Leave a cap empty to use the default. A cap below what someone has already uploaded removes nothing. It only stops new uploads
              until they are back under it.
            </p>
          </div>

          <div className="card">
            <h2>Add a person</h2>
            <p className="muted small">
              You pick a starting password and pass it along yourself. They must replace it when they first sign in. Each person gets a
              workspace of their own.
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
              <Field label="Upload space (MB)">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={state.max_cap_mb}
                  step={1}
                  placeholder={`${state.default_cap_mb} (default)`}
                  value={draft.cap}
                  onChange={(e) => setDraft({ ...draft, cap: e.target.value })}
                />
              </Field>
              <label className="check field-check">
                <input type="checkbox" checked={draft.can_import} onChange={(e) => setDraft({ ...draft, can_import: e.target.checked })} />
                Allow plan import
              </label>
              <label className="check field-check">
                <input type="checkbox" checked={draft.is_admin} onChange={(e) => setDraft({ ...draft, is_admin: e.target.checked })} />
                Administrator
              </label>
              <button className="btn primary">Create account</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
