import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type AdminSettings, type SignIn, type SystemState, type SystemUser, type UserActivity } from '../api';
import { useApp } from '../App';
import { Field, Modal, MoreMenu, NameFields } from '../components/bits';
import { TopTabs } from '../components/TopTabs';
import RegistrationCard from '../components/RegistrationCard';
import SportIcon from '../components/SportIcon';
import AccessibilityCard, { PlayImportCard, SavedVideoCard } from '../components/AccessibilityCard';
import CommunityPlans from '../components/CommunityPlans';
import EmailLog from '../components/EmailLog';
import EmailRules from '../components/EmailRules';
import EmailSamples from '../components/EmailSamples';
import { confirmDialog, promptDialog } from '../components/dialogs';
import { deleteLater, usePendingDeletes } from '../components/toasts';
import { SpaceMeter, fmtSpace } from '../components/SpaceMeter';
import { roomyScreen } from '../util';

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
/**
 * "Now" only for someone who is active this minute. An open page that nobody is touching keeps
 * in contact with the server, and that does not count.
 */
function lastActive(u: SystemUser) {
  if (u.status === 'invited' || u.status === 'pending') return 'Never';
  if (u.presence === 'active') return 'Now';
  const ago = fmtAgo(u.last_active_at ?? u.last_login_at);
  return ago === 'Now' ? 'A few minutes ago' : ago;
}
/** One status for each person: what state the account is in, and for a working account whether they are here now. */
const FAMILY_WORD: Record<string, string> = { parent: 'Parent', family: 'Family', friend: 'Friend', guest: 'Guest' };
/** On a team as a parent, family or a friend, whether or not they coach as well. */
const isFamily = (u: SystemUser) => u.follower || u.follows.length > 0;

function StatusCell({ u }: { u: SystemUser }) {
  const pill = (cls: string, text: string, title: string, note = '') => (
    <span className="status-cell">
      <span className={`presence ${cls}`} title={title}>
        {text}
      </span>
      {note && <span className="muted small">{note}</span>}
    </span>
  );
  if (u.status === 'disabled') return pill('off', 'Turned off', 'The account is turned off and cannot sign in');
  if (u.status === 'invited') {
    // How long the invitation has been sitting there.
    const ago = u.invited_at ? fmtAgo(u.invited_at) : '';
    const sent = !ago ? 'has not finished setting up' : ago === 'Now' ? 'invitation sent just now' : `invitation sent ${ago}`;
    return pill('waiting', 'Invited', 'Sent an invitation by email and has not chosen a password yet', sent);
  }
  if (u.status === 'pending') return pill('waiting', 'Signing up', 'Signed up and has not opened the confirmation email yet', 'email not confirmed');
  const note = u.must_change_password ? 'still on the starting password' : '';
  if (u.presence === 'active') return pill('active', 'Active', 'Signed in, and did something in the last 5 minutes', note);
  if (u.presence === 'inactive') return pill('inactive', 'Inactive', 'Signed in, but has not done anything for over 5 minutes', note);
  if (u.sign_ins === 0) return pill('out', 'Never signed in', 'Has an account and has not signed in yet', note);
  return pill('out', 'Logged out', 'Not signed in', note);
}
/**
 * For the system administrator only: every account, what each may do, and how much upload
 * space each has. Accounts can be created here too, with their upload space set from the start.
 */
/** The page in tabs, by what is being looked after. The tab is in the address, so a link can open one. */
type SysTab = 'people' | 'access' | 'email' | 'organizations' | 'content' | 'system';
const SYS_TABS: [SysTab, string][] = [
  ['people', 'People'],
  ['access', 'Access'],
  ['email', 'Email'],
  ['organizations', 'Organizations'],
  ['content', 'Content'],
  ['system', 'System'],
];

export default function SystemAdmin() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as SysTab | null;
  const tab: SysTab = SYS_TABS.some(([id]) => id === asked) ? asked! : 'people';
  const { user: me } = useApp();
  const [state, setState] = useState<SystemState | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  /** The person whose sign-ins and activity are open. */
  const [who, setWho] = useState<'all' | 'coaches' | 'family'>('all');
  const [viewing, setViewing] = useState<SystemUser | null>(null);
  /** The person being given a new password. */
  const [passwordFor, setPasswordFor] = useState<SystemUser | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** Cap boxes being typed in, by user id. Absent means the box shows the saved value. */
  const [caps, setCaps] = useState<Record<number, string>>({});
  const [defaultCap, setDefaultCap] = useState<string | null>(null);
  const blank = { name: '', first: '', last: '', email: '', password: '', can_import: false, cap: '', note: '' };
  const [draft, setDraft] = useState(blank);
  /** How a person is added: an emailed invitation, or an account made here with a starting password. */
  const [adding, setAdding] = useState<'invite' | 'password'>('invite');
  const canEmail = !!settings?.mailer.configured;
  const inviting = adding === 'invite' && canEmail;

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
  // Who is active is read again every half minute while this page is in view.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const now = await api.systemPresence();
        setState((s) => (s ? { ...s, users: s.users.map((u) => ({ ...u, presence: now[u.id] ?? u.presence })) } : s));
      } catch {
        /* the next round will try again */
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
        const made = inviting ? await api.adminInvite({ name: d.name, first_name: d.first, last_name: d.last, email: d.email, can_import: d.can_import, note: d.note }) : await api.adminCreateUser({ name: d.name, first_name: d.first, last_name: d.last, email: d.email, password: d.password, can_import: d.can_import });
        // The account exists from here on, so clear the form even if a follow-up setting fails.
        setDraft(blank);
        if (d.cap.trim() !== '') await api.systemUpdateUser(made.id, { upload_cap_mb: Number(d.cap) });
      },
      inviting
        ? `Invitation emailed to ${d.email}. They are listed as invited until they choose a password.`
        : `Account created for ${d.email}. Give them the starting password yourself. They will be asked to replace it when they first sign in.`,
    );
  };
  const resendInvite = (u: SystemUser) => run(() => api.adminResendInvite(u.id), `Invitation sent to ${u.email} again.`);
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
  /** Plan import runs Claude on the computer hosting Dime Coach, so it is granted person by person. */
  const setPaid = (u: SystemUser, on: boolean) => run(() => api.adminUpdateUser(u.id, { paid: on }), on ? `${u.name} is marked as paid, and can coach.` : `${u.name} is no longer marked as paid.`);
  const setImport = (u: SystemUser, on: boolean) => run(() => api.adminUpdateUser(u.id, { can_import: on }), on ? `${u.name} can now import plans.` : `${u.name} can no longer import plans.`);
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
      what.kept_teams.length > 0 &&
        `Kept, because ${count(what.helpers, 'other person', 'other people')} still ${what.helpers === 1 ? 'works' : 'work'} on ${what.kept_teams.length === 1 ? 'it' : 'them'}: ${what.kept_teams.join(', ')}, with ${what.kept_teams.length === 1 ? 'its' : 'their'} practices and the drills, plays and files in the workspace.`,
      what.communities_deleted.length > 0 && `Deleted with it: the communit${what.communities_deleted.length === 1 ? 'y' : 'ies'} ${what.communities_deleted.join(', ')}, which ${what.communities_deleted.length === 1 ? 'has' : 'have'} no other members.`,
      what.communities_passed_on.length > 0 && `Handed to another member: ${what.communities_passed_on.join(', ')}.`,
    ].filter(Boolean);
    const first = await confirmDialog({
      title: `Delete ${u.name}'s account?`,
      body: `This removes ${u.email} and ${what.kept_teams.length > 0 ? 'what nobody else uses' : 'everything in their workspace'}: ${goes}. ${also.join(' ')} To keep their work and only stop them signing in, use "Turn off" instead.`,
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
  // Who the list shows: everyone, the coaches, or the parents, family and friends of teams. Someone who coaches one team and follows another is both.
  // A person is listed once however many teams and roles they were put on: their roles sit side by side on one line.
  // Someone who already has a line of their own (an account, or an invitation to one) has the roles added to that line instead.
  const emailKey = (email: string) => email.trim().toLowerCase();
  const rolesWaiting = (state?.family_waiting ?? []).reduce((byEmail, w) => byEmail.set(emailKey(w.email), [...(byEmail.get(emailKey(w.email)) ?? []), w]), new Map<string, SystemState['family_waiting']>());
  const hasLine = new Set(users.map((u) => emailKey(u.email)));
  const waiting = [...rolesWaiting.entries()]
    .filter(([email]) => !hasLine.has(email))
    .map(([, roles]) => {
      const sent = roles.map((r) => r.invited_at).filter((d): d is string => !!d).sort();
      return { id: roles[0].id, name: roles.find((r) => r.name)?.name ?? '', email: roles[0].email, invited_at: sent.length ? sent[sent.length - 1] : null, roles };
    });
  /** Roles on a team's list that a person with a line of their own has not taken up yet, without what the line already says. */
  const extraRoles = (u: SystemUser) => (rolesWaiting.get(emailKey(u.email)) ?? []).filter((r, i, list) => !u.follows.some((f) => f.kind === r.kind && f.team === r.team) && list.findIndex((o) => o.kind === r.kind && o.team === r.team) === i);
  const shownUsers = who === 'all' ? users : who === 'coaches' ? users.filter((u) => !u.follower) : users.filter(isFamily);
  const shownWaiting = who === 'coaches' ? [] : waiting;
  const over = users.filter((u) => u.used_bytes >= u.cap_mb * MB && u.used_bytes > 0).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>System admin</h1>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {state === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <TopTabs tabs={SYS_TABS} value={tab} onChange={(id) => setParams(id === 'people' ? {} : { tab: id }, { replace: true })} label="System administration" />
          {tab === 'people' && (
            <>
          <div className="sys-top">
          <div className="card sys-glance">
            <h2>At a glance</h2>
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
              <div className="value">{users.filter((u) => u.presence === 'active').length}</div>
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
            <div className={`sys-tile disk-stat ${state.disk && state.disk.free_bytes < state.disk.total_bytes * 0.1 ? 'low' : ''}`}>
              {state.disk ? (
                <>
                  <div className="value">
                    {fmtSpace(state.disk.total_bytes - state.disk.free_bytes)} <small>of {fmtSpace(state.disk.total_bytes)}</small>
                  </div>
                  <div className="label">Disk used</div>
                  <div className="disk-bar" role="img" aria-label={`${Math.round(((state.disk.total_bytes - state.disk.free_bytes) / state.disk.total_bytes) * 100)}% of the disk is used`}>
                    <span style={{ width: `${Math.min(100, ((state.disk.total_bytes - state.disk.free_bytes) / state.disk.total_bytes) * 100)}%` }} />
                  </div>
                  <div className="muted small">
                    {fmtSpace(state.disk.site_bytes)} is this site's data. {fmtSpace(state.disk.free_bytes)} free.
                    {state.disk.own_disk === false && ' The data is not on a disk of its own, so it may not outlast a redeploy.'}
                  </div>
                </>
              ) : (
                <>
                  <div className="value">—</div>
                  <div className="label">Disk used</div>
                </>
              )}
            </div>
            <div className="sys-tile">
              <div className="value">{over}</div>
              <div className="label">At their cap</div>
            </div>
          </div>
          </div>
          <div className="card sys-add">
            <h2>Add a person</h2>
            <div className="seg add-how" role="group" aria-label="How to add them">
              <button type="button" className={inviting ? 'on' : ''} aria-pressed={inviting} disabled={!canEmail} onClick={() => setAdding('invite')}>
                Email an invitation
              </button>
              <button type="button" className={inviting ? '' : 'on'} aria-pressed={!inviting} onClick={() => setAdding('password')}>
                Set a starting password
              </button>
            </div>
            <p className="muted small">
              {inviting
                ? 'They get an email with a link, choose their own password, and start as any new person does, by making their first team.'
                : 'You pick a starting password and pass it along yourself. They must replace it when they first sign in.'}{' '}
              {!canEmail && 'Invitations by email need an email service, and none is connected. '}
              Each person gets a workspace of their own. Plan import runs Claude on the computer hosting Dime Coach, so allow it only for people you want using that.
            </p>
            <form className="fields" onSubmit={create}>
              <NameFields whose="their" name={draft.name} onChange={(name, p) => setDraft({ ...draft, name, first: p.first, last: p.last })} />
              <Field label="Email" grow>
                <input className="input" type="email" required value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </Field>
              {!inviting && (
                <Field label="Starting password" grow>
                  <input className="input" required minLength={10} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="off" />
                </Field>
              )}
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
              {inviting && (
                <label className="invite-note">
                  <span className="field-label">Your message (optional)</span>
                  <textarea
                    className="input"
                    rows={3}
                    maxLength={2000}
                    placeholder="A few words of your own to go in the invitation, such as why you are inviting them or what to do first."
                    value={draft.note}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  />
                  <span className="muted small">It goes in the email under “{me.name} wrote:”, above the link. Sending the invitation again sends the same message.</span>
                </label>
              )}
              <button className="btn primary">{inviting ? 'Send invitation' : 'Create account'}</button>
            </form>
          </div>
          </div>
          <h2 className="sys-section" id="people">
            People
          </h2>
          <div className="card">
            <div className="card-head">
              <h2>
                {who === 'all' ? 'Everyone' : who === 'coaches' ? 'Coaches' : 'Parents, family & friends'} <span className="muted">({shownUsers.length + shownWaiting.length})</span>
              </h2>
              <div className="seg" role="group" aria-label="Who to show">
                {(
                  [
                    ['all', 'Everyone', users.length + waiting.length],
                    ['coaches', 'Coaches', users.filter((u) => !u.follower).length],
                    ['family', 'Family & friends', users.filter(isFamily).length + waiting.length],
                  ] as [typeof who, string, number][]
                ).map(([id, label, n]) => (
                  <button key={id} type="button" className={who === id ? 'on' : ''} aria-pressed={who === id} onClick={() => setWho(id)}>
                    {label} <span className="muted">{n}</span>
                  </button>
                ))}
              </div>
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
                  {shownUsers.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span className="sys-person">
                          <button type="button" className="link sys-name" onClick={() => setViewing(u)} title="Sign-ins and activity">
                            {u.name}
                          </button>
                          <span className="muted small">{u.email}</span>
                          <span className="badges">
                            {u.is_system_admin && <span className="kind system">System admin</span>}
                            {u.paid && <span className="kind paid">Paid</span>}
                            {u.can_import && <span className="kind">Plan import</span>}
                            {u.id === me.id && <span className="kind">You</span>}
                            {/* Everything they are, each with where: a coach of one team can be a parent on another. */}
                            {u.roles
                              .filter((r) => r.kind !== 'system')
                              .map((r, i) => (
                                <span key={i} className={`kind ${r.kind === 'follow' ? '' : 'practice'}`}>
                                  {r.role} · {r.where}
                                </span>
                              ))}
                            {!u.follower && !u.roles.some((r) => r.kind === 'coach') && <span className="kind">Coach · no team yet</span>}
                            {extraRoles(u).map((r) => (
                              <span key={`r${r.id}`} className="kind" title="On this team’s list, and not taken up yet">
                                {FAMILY_WORD[r.kind] ?? 'Friend'} · {r.team}
                              </span>
                            ))}
                          </span>
                        </span>
                      </td>
                      <td>
                        <StatusCell u={u} />
                      </td>
                      <td>{lastActive(u)}</td>
                      <td className="num">{u.sign_ins}</td>
                      <td className="num">{fmtSpan(u.active_seconds)}</td>
                      {/* Someone who only follows teams uploads nothing, so has no space to show or cap. */}
                      <td>{u.follower ? <span className="muted">—</span> : <SpaceMeter used={u.used_bytes} cap={u.cap_mb * MB} files={u.files} />}</td>
                      <td>
                        {u.follower ? (
                          <span className="muted">—</span>
                        ) : (
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
                        )}
                      </td>
                      <td className="num">
                        <MoreMenu
                          label={`Options for ${u.name}`}
                          items={[
                            { label: 'Details', onSelect: () => setViewing(u) },
                            ...(u.status === 'invited' && canEmail ? [{ label: 'Send invitation again', onSelect: () => resendInvite(u) }] : []),
                            ...(u.id !== me.id && u.status !== 'invited' ? [{ label: 'Set password', onSelect: () => setPasswordFor(u) }] : []),
                            { label: u.paid ? 'Remove paid status' : 'Mark as paid', onSelect: () => setPaid(u, !u.paid) },
                            ...(u.follower ? [] : [{ label: u.can_import ? 'Stop plan import' : 'Allow plan import', onSelect: () => setImport(u, !u.can_import) }]),
                            ...(!u.is_system_admin && u.status !== 'pending' && u.status !== 'invited'
                              ? [{ label: u.status === 'active' ? 'Turn off account' : 'Turn on account', onSelect: () => setStatus(u, u.status === 'active' ? 'disabled' : 'active') }]
                              : []),
                            ...(!u.is_system_admin && u.id !== me.id ? [{ label: 'Delete account', onSelect: () => deleteAccount(u), danger: true }] : []),
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                  {/* On a team's list, and not signed up yet. There is no account to act on: the team's coach invites them. */}
                  {shownWaiting.map((w) => (
                    <tr key={`w${w.id}`} className="sys-waiting">
                      <td>
                        <span className="sys-person">
                          <strong className="sys-name">{w.name || w.email}</strong>
                          <span className="muted small">{w.email}</span>
                          <span className="badges">
                            {w.roles
                              .filter((r, i, list) => list.findIndex((o) => o.kind === r.kind && o.team === r.team) === i)
                              .map((r) => (
                                <span key={r.id} className="kind">
                                  {FAMILY_WORD[r.kind] ?? 'Friend'} · {r.team}
                                </span>
                              ))}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="status-cell">
                          <span className="presence waiting" title={w.invited_at ? 'Sent an invitation by the team’s coach and has not made an account yet' : 'On the team’s list, and not sent an invitation'}>
                            {w.invited_at ? 'Invited' : 'Not invited'}
                          </span>
                          <span className="muted small">{w.invited_at ? `invitation sent ${fmtAgo(w.invited_at) === 'Now' ? 'just now' : fmtAgo(w.invited_at)}` : 'no account yet'}</span>
                        </span>
                      </td>
                      <td className="muted">Never</td>
                      <td className="num muted">—</td>
                      <td className="num muted">—</td>
                      <td className="muted">—</td>
                      <td className="muted">—</td>
                      <td />
                    </tr>
                  ))}
                  {shownUsers.length + shownWaiting.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted">
                        Nobody here yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Leave a cap empty to use the default. A cap below what someone has already uploaded removes nothing. It only stops new uploads
              until they are back under it.
            </p>
          </div>


            </>
          )}
          {tab === 'access' && (
            <>
          <h2 className="sys-section" id="signup">
            Sign-up and email
          </h2>
          {settings && <RegistrationCard settings={settings} run={run} />}

            </>
          )}
          {tab === 'email' && (
            <>
          <h2 className="sys-section" id="email">
            Email
          </h2>
          <EmailLog />
          <EmailRules run={run} />
          <EmailSamples canSend={canEmail} run={run} />
            </>
          )}
          {tab === 'organizations' && (
            <>
          <h2 className="sys-section" id="organizations">
            Organizations
          </h2>
          <CommunityPlans />

            </>
          )}
          {tab === 'content' && (
            <>
          <h2 className="sys-section" id="library">
            Coach library
          </h2>
          <div className="card">
            <h2>Drills, plays and practices for every coach</h2>
            <p className="muted small">
              What you publish to the coach library can be searched and copied by every coach. Publish from Share on one of your own drills, plays or practices, then describe
              it and group it into packs in the library.
            </p>
            <Link className="btn" to="/coach-library">
              Manage the coach library
            </Link>
          </div>
            </>
          )}
          {tab === 'system' && (
            <>
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
          <h2 className="sys-section" id="accessibility">
            Accessibility
          </h2>
          {settings && <AccessibilityCard settings={settings} run={run} />}
          {settings && <PlayImportCard settings={settings} run={run} />}
          <SavedVideoCard run={run} />
            </>
          )}
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
          <input className="input" autoFocus={roomyScreen()} required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
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
  const app = useApp();
  /** Steps into a team as the system administrator. One of your own simply becomes the team being worked on. */
  const openTeam = async (teamId: number) => {
    if (app.own_teams.some((t) => t.id === teamId)) {
      app.openTeam(false, teamId);
      return window.location.assign('/');
    }
    try {
      await api.setWorkspace(teamId);
      window.location.assign('/');
    } catch (e) {
      setError((e as Error).message);
    }
  };
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
              [lastActive(data.user), 'Last active'],
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
          <h3>Recent activity</h3>
          {data.recent.length === 0 ? (
            <p className="muted">Nothing recorded yet. This list starts from when it was switched on.</p>
          ) : (
            <ol className="activity-recent">
              {data.recent.map((r) => (
                <li key={r.id}>
                  <span>{r.text}</span>
                  <time title={fmtMoment(r.at)}>{fmtAgo(r.at)}</time>
                </li>
              ))}
            </ol>
          )}
          <h3>Teams</h3>
          {data.teams.length === 0 ? (
            <p className="muted">No teams yet.</p>
          ) : (
            <ul className="activity-teams">
              {data.teams.map((t) => (
                <li key={`${t.id}-${t.role}`}>
                  <SportIcon sport={t.sport} size={22} />
                  <span className="activity-team">
                    <strong>{t.name}</strong>
                    <span className="muted small">{[t.sport, t.season, t.role].filter(Boolean).join(' · ')}</span>
                  </span>
                  <button className="btn small" onClick={() => openTeam(t.id)} title="Opens the team with full access, as the system administrator">
                    Open team
                  </button>
                </li>
              ))}
            </ul>
          )}
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
