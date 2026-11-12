import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type AdminSettings, type SignIn, type SystemState, type SystemUser, type UserActivity } from '../api';
import { useApp } from '../App';
import { Field, Modal, MoreMenu } from '../components/bits';
import RegistrationCard from '../components/RegistrationCard';
import { confirmDialog, promptDialog } from '../components/dialogs';
import { deleteLater, usePendingDeletes } from '../components/toasts';
import { SpaceMeter, fmtSpace } from '../components/SpaceMeter';

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';
const MB = 1024 * 1024;
const asDate = (iso: string) => new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
const fmtMoment = (iso: string | null) => (iso ? asDate(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never');
/** "3 h 20 min", "45 min", or "under a minute". */
function fmtSpan(seconds: number) {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return seconds > 0 ? 'under a minute' : '0 min';
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return [d > 0 && `${d} d`, h > 0 && `${h} h`, d === 0 && mins % 60 > 0 && `${mins % 60} min`].filter(Boolean).join(' ');
}
/** "just now", "12 min ago", "3 days ago". */
function fmtAgo(iso: string | null) {
  if (!iso) return 'Never';
  const secs = Math.max(0, (Date.now() - asDate(iso).getTime()) / 1000);
  if (secs < 300) return 'Now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  const days = Math.round(secs / 86400);
  return days < 60 ? `${days} day${days === 1 ? '' : 's'} ago` : fmtWhen(iso);
}
const SECTIONS = [
  ['people', 'People'],
  ['signup', 'Sign-up and email'],
  ['storage', 'Upload space'],
  ['backup', 'Backup'],
];

/**
 * For the system administrator only: every account, what each may do, and how much upload
 * space each has. Accounts can be created here too, with their upload space set from the start.
 */
export default function SystemAdmin() {
  const { user: me } = useApp();
  const [state, setState] = useState<SystemState | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  /** The person whose sign-ins and activity are open. */
  const [viewing, setViewing] = useState<SystemUser | null>(null);
  /** The person being given a new password. */
  const [passwordFor, setPasswordFor] = useState<SystemUser | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** Cap boxes being typed in, by user id. Absent means the box shows the saved value. */
  const [caps, setCaps] = useState<Record<number, string>>({});
  const [defaultCap, setDefaultCap] = useState<string | null>(null);
  const blank = { name: '', email: '', password: '', can_import: false, is_admin: false, cap: '' };
  const [draft, setDraft] = useState(blank);

  const load = useCallback(async () => {
    try {
      const [sys, set] = await Promise.all([api.system(), api.adminSettings()]);
      setState(sys);
      setSettings(set);
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
  /** Deletes an account and everything in it. Three separate confirmations, the last one typed. */
  const deleteAccount = async (u: SystemUser) => {
    let what;
    try {
      what = await api.systemDeletion(u.id);
    } catch (e) {
      setNotice('');
      return setError((e as Error).message);
    }
    const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
    const goes = [count(what.teams, 'team'), count(what.plans, 'practice and homework plan', 'practice and homework plans'), count(what.drills, 'drill'), count(what.plays, 'play'), count(what.files, 'uploaded file')].join(', ');
    const also = [
      what.helpers > 0 && `${count(what.helpers, 'person', 'people')} helping on their teams will lose that access.`,
      what.communities_deleted.length > 0 && `Deleted with it: the communit${what.communities_deleted.length === 1 ? 'y' : 'ies'} ${what.communities_deleted.join(', ')}, which ${what.communities_deleted.length === 1 ? 'has' : 'have'} no other members.`,
      what.communities_passed_on.length > 0 && `Handed to another member: ${what.communities_passed_on.join(', ')}.`,
    ].filter(Boolean);
    const first = await confirmDialog({
      title: `Delete ${u.name}'s account?`,
      body: `This removes ${u.email} and everything in their workspace: ${goes}. ${also.join(' ')} To keep their work and only stop them signing in, use "Turn off" instead.`,
      confirmLabel: 'Continue',
      danger: true,
    });
    if (!first) return;
    const second = await confirmDialog({
      title: 'This cannot be undone',
      body: `Once deleted, ${u.name}'s teams, practices, drills, plays and uploads cannot be brought back from inside Dime Coach. If there is any chance you will want them, cancel now and download a backup first.`,
      confirmLabel: 'I understand, go on',
      danger: true,
    });
    if (!second) return;
    const typed = await promptDialog({
      title: `Type ${u.email} to delete the account`,
      body: 'This is the last step. The account is deleted as soon as you confirm.',
      confirmLabel: 'Delete account for good',
    });
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== u.email.toLowerCase()) {
      setNotice('');
      return setError('That did not match the email address, so nothing was deleted.');
    }
    setError('');
    setNotice('');
    // One last way back: the account only really goes when the ten seconds are up.
    deleteLater({
      key: `user:${u.id}`,
      message: `Deleted ${u.name}'s account.`,
      run: () => api.systemDeleteUser(u.id, typed.trim()),
      done: load,
      failed: setError,
    });
  };

  const gone = usePendingDeletes();
  const users = (state?.users ?? []).filter((u) => !gone.has(`user:${u.id}`));
  const over = users.filter((u) => u.used_bytes >= u.cap_mb * MB && u.used_bytes > 0).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>System admin</h1>
          <p className="muted">Only your account can open this page. It covers every account on this system: who is using it, how people sign up, and how much each may upload.</p>
        </div>
      </div>
      <nav className="sys-jump" aria-label="Sections of this page">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
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
              <div className="value">{state.online_now}</div>
              <div className="label">Using it right now</div>
            </div>
            <div className="sys-tile">
              <div className="value">{state.active_people_7d}</div>
              <div className="label">People active this week</div>
            </div>
            <div className="sys-tile">
              <div className="value">{state.sign_ins_7d}</div>
              <div className="label">Sign-ins this week</div>
            </div>
            <div className="sys-tile">
              <div className="value">{state.new_accounts_30d}</div>
              <div className="label">New accounts in 30 days</div>
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

          <h2 className="sys-section" id="people">
            People
          </h2>
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
          <div className="card">
            <div className="card-head">
              <h2>
                Everyone <span className="muted">({users.length})</span>
              </h2>
            </div>
            <div className="table-scroll people-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Status</th>
                    <th>Last active</th>
                    <th className="num">Sign-ins</th>
                    <th className="num">Time in the app</th>
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
                          <button type="button" className="link sys-name" onClick={() => setViewing(u)} title="Sign-ins and activity">
                            {u.name}
                          </button>
                          <span className="muted small">{u.email}</span>
                          <span className="badges">
                            {u.is_system_admin ? <span className="kind system">System admin</span> : u.is_admin && <span className="kind game">Admin</span>}
                            {u.id === me.id && <span className="kind">You</span>}
                          </span>
                        </span>
                      </td>
                      <td>{u.status === 'active' ? 'Active' : u.status === 'pending' ? 'Awaiting email confirmation' : 'Turned off'}</td>
                      <td>
                        {fmtAgo(u.last_seen_at ?? u.last_login_at)}
                        {u.last_seen_at && Date.now() - asDate(u.last_seen_at).getTime() < 300_000 && <span className="online-dot" title="Using Dime Coach right now" />}
                      </td>
                      <td className="num">{u.sign_ins}</td>
                      <td className="num">{fmtSpan(u.active_seconds)}</td>
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
                        <MoreMenu
                          label={`Options for ${u.name}`}
                          items={[
                            { label: 'Details', onSelect: () => setViewing(u) },
                            ...(u.id !== me.id ? [{ label: 'Set password', onSelect: () => setPasswordFor(u) }] : []),
                            ...(!u.is_system_admin ? [{ label: u.is_admin ? 'Remove admin' : 'Make admin', onSelect: () => setRole(u, !u.is_admin) }] : []),
                            ...(!u.is_system_admin && u.status !== 'pending'
                              ? [{ label: u.status === 'active' ? 'Turn off account' : 'Turn on account', onSelect: () => setStatus(u, u.status === 'active' ? 'disabled' : 'active') }]
                              : []),
                            ...(!u.is_system_admin && u.id !== me.id ? [{ label: 'Delete account', onSelect: () => deleteAccount(u), danger: true }] : []),
                          ]}
                        />
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


          <h2 className="sys-section" id="signup">
            Sign-up and email
          </h2>
          {settings && <RegistrationCard settings={settings} run={run} />}

          <h2 className="sys-section" id="storage">
            Upload space
          </h2>
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


          <h2 className="sys-section" id="backup">
            Backup
          </h2>
          <div className="card">
            <h2>Backup</h2>
            <p className="muted small">
              One file with every account, team, practice, drill, play and community. Keep a copy somewhere safe, or use it to move to another
              site: a brand new Dime Coach site offers to restore it on its first visit. Uploaded pictures and videos are not included.
            </p>
            <a className="btn" href="/api/system/backup" download>
              Download a backup
            </a>
          </div>
        </>
      )}
      {viewing && <ActivityModal person={viewing} onClose={() => setViewing(null)} />}
      {passwordFor && (
        <PasswordModal
          person={passwordFor}
          onClose={() => setPasswordFor(null)}
          onSave={(password, mustChange) => {
            const u = passwordFor;
            setPasswordFor(null);
            run(
              () => api.systemUpdateUser(u.id, { password, must_change: mustChange }),
              `${u.name} has a new password and has been signed out everywhere. Pass it to them yourself.${mustChange ? ' They will be asked to choose their own when they sign in.' : ''}`,
            );
          }}
        />
      )}
    </div>
  );
}

/** Gives someone a new password, with the choice of making them replace it themselves. */
function PasswordModal({ person, onClose, onSave }: { person: SystemUser; onClose: () => void; onSave: (password: string, mustChange: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  return (
    <Modal title={`Set a password for ${person.name}`} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(password, mustChange);
        }}
      >
        <p className="muted small">
          {person.email} is signed out everywhere and signs in with this password from now on. Nobody is emailed: pass it to them yourself.
        </p>
        <Field label="New password (at least 10 characters)">
          <input className="input" autoFocus required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
          Ask them to choose their own password when they next sign in
        </label>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={password.length < 10}>
            Set password
          </button>
        </div>
      </form>
    </Modal>
  );
}

const STATES: Record<SignIn['state'], string> = { open: 'Still signed in', signed_out: 'Signed out', expired: 'Ran out' };

/** One person in detail: every sign-in, how long each lasted, and what they have built. */
function ActivityModal({ person, onClose }: { person: SystemUser; onClose: () => void }) {
  const [data, setData] = useState<UserActivity | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .systemUserActivity(person.id)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [person.id]);
  const built = data?.built;
  return (
    <Modal title={`${person.name} · ${person.email}`} onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && built && (
        <div className="activity">
          <div className="activity-tiles">
            {[
              [String(data.sign_ins), 'Sign-ins'],
              [fmtSpan(data.active_seconds), 'Time in the app'],
              [data.sign_ins > 0 ? fmtSpan(data.active_seconds / data.sign_ins) : '0 min', 'Average per sign-in'],
              [fmtSpan(data.longest_seconds), 'Longest sign-in'],
              [String(data.sign_ins_30d), 'Sign-ins in 30 days'],
              [String(data.days_active_30d), 'Days active in 30'],
              [fmtAgo(data.user.last_seen_at ?? data.user.last_login_at), 'Last active'],
              [fmtWhen(data.user.created_at), 'Account created'],
            ].map(([value, label]) => (
              <div className="sys-tile" key={label}>
                <div className="value">{value}</div>
                <div className="label">{label}</div>
              </div>
            ))}
          </div>
          <p className="activity-built">
            <strong>What they have built:</strong> {built.teams} team{built.teams === 1 ? '' : 's'} · {built.practices} practice{built.practices === 1 ? '' : 's'} · {built.homework} homework ·{' '}
            {built.drills} drill{built.drills === 1 ? '' : 's'} · {built.plays} play{built.plays === 1 ? '' : 's'} · {fmtSpace(data.user.used_bytes)} uploaded
            <br />
            <span className="muted small">
              In {built.communities} communit{built.communities === 1 ? 'y' : 'ies'} · helping on {built.shared_teams} shared team{built.shared_teams === 1 ? '' : 's'} · last edited a plan{' '}
              {built.last_plan_edit ? fmtAgo(built.last_plan_edit).toLowerCase() : 'never'}
            </span>
          </p>
          <h3>Sign-ins</h3>
          {data.logins.length === 0 ? (
            <p className="muted">No sign-ins recorded yet. Recording started when this page was added.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Signed in</th>
                    <th>Last active</th>
                    <th className="num">Time in the app</th>
                    <th>Now</th>
                    <th>Device</th>
                    <th>Address</th>
                  </tr>
                </thead>
                <tbody>
                  {data.logins.map((l) => (
                    <tr key={l.id}>
                      <td>{fmtMoment(l.started_at)}</td>
                      <td>{fmtMoment(l.last_seen_at)}</td>
                      <td className="num">{fmtSpan(l.active_seconds)}</td>
                      <td>
                        {STATES[l.state]}
                        {l.state === 'open' && <span className="muted small"> · for {fmtSpan((Date.now() - asDate(l.started_at).getTime()) / 1000)}</span>}
                        {l.state === 'signed_out' && l.ended_at && <span className="muted small"> · {fmtMoment(l.ended_at)}</span>}
                      </td>
                      <td>{l.device}</td>
                      <td className="muted small">{l.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">
            "Time in the app" counts the stretches when they were actually doing something. A gap of more than five minutes is treated as time away.
            {data.logins.length === 100 && ' Showing the latest 100 sign-ins.'}
          </p>
        </div>
      )}
    </Modal>
  );
}
