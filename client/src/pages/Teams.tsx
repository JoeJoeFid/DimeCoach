import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Papa from 'papaparse';
import { api, type TeamContact, type TeamContacts } from '../api';
import { useApp } from '../App';
import type { Player, StaffMember, Team, TeamInvite, TeamPerm } from '../types';
import { Field, Modal } from '../components/bits';
import SportIcon from '../components/SportIcon';
import PageTitle from '../components/PageTitle';
import { fmtSynced, roomyScreen } from '../util';
import { SPORT_CHOICES, sportKind, surfaceWord } from '../sports';
import { confirmDialog } from '../components/dialogs';
import { deleteLater, usePendingDeletes } from '../components/toasts';

type Cell = string | number | boolean | Date | null | undefined;
type NewPlayer = Partial<Player> & { name: string };

const COLUMNS: { key: keyof Player; label: string; headers: string[] }[] = [
  { key: 'name', label: 'Name', headers: ['name', 'player', 'playername', 'fullname'] },
  { key: 'number', label: 'Number', headers: ['number', 'no', 'num', 'jersey', 'jerseynumber'] },
  { key: 'position', label: 'Position', headers: ['position', 'pos'] },
  { key: 'grade', label: 'Grade', headers: ['grade', 'year', 'class'] },
  { key: 'parent_name', label: 'Parent name', headers: ['parent', 'parentname', 'guardian', 'guardianname'] },
  { key: 'parent_email', label: 'Parent email', headers: ['email', 'parentemail', 'guardianemail', 'emailaddress'] },
  { key: 'notes', label: 'Notes (coach only)', headers: ['notes', 'note', 'comments'] },
];
const TEMPLATE =
  'data:text/csv;charset=utf-8,' +
  encodeURIComponent('Name,Number,Position,Grade,Parent name,Parent email,Notes\nJordan Smith,12,PG,5,Pat Smith,pat@example.com,\n');

/** Turns spreadsheet rows into players. Understands a header row in any column order. */
function rowsToPlayers(rows: Cell[][]): NewPlayer[] {
  const text = (c: Cell) => (c == null ? '' : String(c).trim());
  const norm = (c: Cell) => text(c).toLowerCase().replace(/[^a-z]/g, '');
  const data = rows.filter((r) => r.some((c) => text(c)));
  if (data.length === 0) return [];
  const head = data[0].map(norm);
  const first = head.findIndex((h) => ['first', 'firstname'].includes(h));
  const last = head.findIndex((h) => ['last', 'lastname'].includes(h));
  const index: Partial<Record<keyof Player, number>> = {};
  for (const col of COLUMNS) {
    const i = head.findIndex((h) => col.headers.includes(h));
    if (i >= 0) index[col.key] = i;
  }
  const hasHeader = index.name !== undefined || first >= 0;
  // Without a recognizable header, treat the sheet as the standard column order.
  if (!hasHeader) COLUMNS.forEach((c, i) => (index[c.key] = i));
  return data
    .slice(hasHeader ? 1 : 0)
    .map((r) => {
      const p: NewPlayer = { name: '' };
      for (const col of COLUMNS) {
        const i = index[col.key];
        if (i !== undefined) (p as unknown as Record<string, string>)[col.key] = text(r[i]);
      }
      if (!p.name && first >= 0) p.name = [text(r[first]), last >= 0 ? text(r[last]) : ''].filter(Boolean).join(' ');
      return p;
    })
    .filter((p) => p.name);
}

async function readRosterFile(file: File): Promise<NewPlayer[]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    return rowsToPlayers((await readSheet(file)) as Cell[][]);
  }
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. Save the sheet as .xlsx or .csv and try again.');
  return new Promise((resolve, reject) =>
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (r) => resolve(rowsToPlayers(r.data)),
      error: (e) => reject(new Error(e.message)),
    }),
  );
}

export default function Teams() {
  const app = useApp();
  const [error, setError] = useState('');
  // A team deleted a moment ago is gone from the screen, though the delete can still be undone.
  const gone = usePendingDeletes();
  const team = app.team!;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle>Team &amp; roster</PageTitle>
          <p className="muted">This team's details, who helps coach it, its schedule link and its players. To work on another team, use "Switch team" at the top of the menu.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {gone.has(`team:${team.id}`) ? (
        <div className="empty">
          <h2>{team.name} is being deleted</h2>
          <p>Use Undo in the corner to keep it. Otherwise you will be asked to choose another team in a moment.</p>
        </div>
      ) : (
        <TeamPanel key={team.id} team={team} onError={setError} />
      )}
    </div>
  );
}

/** What a helper can be allowed to change. */
const PERM_LABELS: [TeamPerm, string][] = [
  ['plans', 'Practices'],
  ['drills', 'Drills'],
  ['plays', 'Playbook'],
  ['resources', 'Resources'],
  ['roster', 'Roster'],
  ['schedule', 'Schedule'],
];

const KIND_WORDS: Record<TeamContact['kind'], string> = { parent: 'Parent or guardian', family: 'Family', friend: 'Friend of the team' };
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * The people around a team who do not coach it: parents, family and friends. Parents written on
 * the roster are listed too. Anyone can be added here by name and email and invited, and linked
 * to their players then or later. Someone linked to nobody is a friend of the whole team.
 */
function FamilyCard({ team, players, canSee, canEdit }: { team: Team; players: Player[] | null; canSee: boolean; canEdit: boolean }) {
  const [data, setData] = useState<TeamContacts | null>(null);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState<TeamContact['kind']>('parent');
  const [invite, setInvite] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState<TeamContact | null>(null);
  useEffect(() => {
    setData(null);
    if (canSee) api.teamContacts(team.id).then(setData, (e) => setError((e as Error).message));
  }, [team.id, canSee]);
  const act = async (work: () => Promise<TeamContacts>, done = '') => {
    setBusy(true);
    try {
      const next = await work();
      setData(next);
      setError('');
      setSaid(next.warning || done);
      setBusy(false);
      return true;
    } catch (e) {
      setSaid('');
      setError((e as Error).message);
      setBusy(false);
      return false;
    }
  };
  const roster = (players || []).filter((pl) => pl.active);
  // Parents written on the roster who have not been added here by the same address.
  const listed = new Set((data?.contacts ?? []).map((c) => c.email).filter(Boolean));
  const fromRoster = (players || []).filter((pl) => (pl.parent_name.trim() || pl.parent_email.trim()) && !listed.has(pl.parent_email.trim().toLowerCase()));
  const contacts = data?.contacts ?? [];
  const total = contacts.length + fromRoster.length;
  const emails = [...new Set([...contacts.map((c) => c.email), ...fromRoster.map((pl) => pl.parent_email.trim())].filter(Boolean))];
  const kids = (c: TeamContact) => roster.filter((pl) => c.player_ids.includes(pl.id)).map((pl) => pl.name);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const sending = invite && !!data?.mail && !!email.trim();
    if (await act(() => api.addTeamContact(team.id, { name, email, kind, player_ids: [], invite: sending, note }), sending ? `${name || email} was added and sent an invitation.` : `${name || email} was added.`)) {
      setName('');
      setEmail('');
      setNote('');
      setAdding(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2>Parents, family &amp; friends {canSee && total > 0 && <span className="muted">({total})</span>}</h2>
        {canSee && (
          <span className="row-actions">
            {emails.length > 0 && (
              <a className="btn small" href={`mailto:?bcc=${encodeURIComponent(emails.join(','))}`}>
                Email everyone
              </a>
            )}
            {canEdit && (
              <button type="button" className="btn small primary" onClick={() => setAdding(!adding)}>
                {adding ? 'Close' : '+ Add or invite someone'}
              </button>
            )}
          </span>
        )}
      </div>
      {!canSee ? (
        <p className="muted small">Parent and family contacts are hidden for you on this team.</p>
      ) : (
        <>
          <p className="muted small">The people around the team who do not coach it. Link each one to their players now or later. Someone linked to nobody is a friend of the whole team.</p>
          {error && <p className="error">{error}</p>}
          {said && (
            <p className="banner ok" role="status">
              {said}
            </p>
          )}
          {adding && (
            <form className="family-add" onSubmit={add}>
              <Field label="Name">
                <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="They are">
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value as TeamContact['kind'])}>
                  {(Object.keys(KIND_WORDS) as TeamContact['kind'][]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_WORDS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              {data?.mail ? (
                <label className="check family-wide">
                  <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Send them an invitation by email, saying you added them to {team.name}
                </label>
              ) : (
                <p className="muted small family-wide">Email is not set up on this site, so they are added to the list without an invitation.</p>
              )}
              {data?.mail && invite && (
                <label className="family-wide">
                  <span className="field-label">Add a note to the invitation (optional)</span>
                  <textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              )}
              <div className="family-wide">
                <button className="btn primary" disabled={busy || (!name.trim() && !email.trim())}>
                  {invite && data?.mail && email.trim() ? 'Add and invite' : 'Add'}
                </button>
              </div>
            </form>
          )}
          {data === null || players === null ? (
            <p className="muted small">Loading…</p>
          ) : total === 0 ? (
            <p className="muted small">Nobody yet. Add a parent, a relative or a friend of the team here, or put a parent's name and email on a player in the roster.</p>
          ) : (
            <div className="table-scroll">
              <table className="table family">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>They are</th>
                    <th>Linked to</th>
                    <th>Invitation</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name || c.email}</strong>
                        {c.name && c.email && (
                          <div className="small">
                            <a href={`mailto:${c.email}`}>{c.email}</a>
                          </div>
                        )}
                      </td>
                      <td>{KIND_WORDS[c.kind]}</td>
                      <td>
                        {kids(c).length ? kids(c).join(', ') : <span className="muted">{c.kind === 'friend' ? 'The whole team' : 'Nobody yet'}</span>}
                        {canEdit && (
                          <>
                            {' '}
                            <button type="button" className="link small" onClick={() => setLinking(c)}>
                              {kids(c).length ? 'Change' : 'Link to players'}
                            </button>
                          </>
                        )}
                      </td>
                      <td>
                        {c.invited_at ? <span className="muted small">Sent {fmtDay(c.invited_at)}</span> : <span className="muted small">Not invited</span>}
                        {canEdit && data.mail && c.email && (
                          <>
                            {' '}
                            <button type="button" className="link small" disabled={busy} onClick={() => act(() => api.inviteTeamContact(team.id, c.id, ''), `An invitation was sent to ${c.name || c.email}.`)}>
                              {c.invited_at ? 'Send again' : 'Invite'}
                            </button>
                          </>
                        )}
                      </td>
                      <td>
                        {canEdit && (
                          <button
                            type="button"
                            className="link small danger"
                            onClick={async () => {
                              if (await confirmDialog({ title: `Take ${c.name || c.email} off the list?`, body: 'They stop being listed with this team. Nothing is sent to them.', confirmLabel: 'Take off', danger: true }))
                                act(() => api.removeTeamContact(team.id, c.id));
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {fromRoster.map((pl) => (
                    <tr key={`p${pl.id}`}>
                      <td>
                        <strong>{pl.parent_name || 'Parent'}</strong>
                        {pl.parent_email && (
                          <div className="small">
                            <a href={`mailto:${pl.parent_email}`}>{pl.parent_email}</a>
                          </div>
                        )}
                      </td>
                      <td>{KIND_WORDS.parent}</td>
                      <td>{pl.name}</td>
                      <td>
                        <span className="muted small">From the roster</span>
                        {canEdit && data.mail && pl.parent_email.trim() && (
                          <>
                            {' '}
                            <button
                              type="button"
                              className="link small"
                              disabled={busy}
                              onClick={() => act(() => api.addTeamContact(team.id, { name: pl.parent_name, email: pl.parent_email, kind: 'parent', player_ids: [pl.id], invite: true, note: '' }), `An invitation was sent to ${pl.parent_name || pl.parent_email}.`)}
                            >
                              Invite
                            </button>
                          </>
                        )}
                      </td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {linking && (
        <LinkPlayers
          contact={linking}
          players={roster}
          onClose={() => setLinking(null)}
          save={async (ids, k) => {
            if (await act(() => api.updateTeamContact(team.id, linking.id, { name: linking.name, email: linking.email, kind: k, player_ids: ids }), 'Saved.')) setLinking(null);
          }}
        />
      )}
    </div>
  );
}

/** Choosing which players a person belongs to, and what they are to the team. */
function LinkPlayers({ contact, players, onClose, save }: { contact: TeamContact; players: Player[]; onClose: () => void; save: (ids: number[], kind: TeamContact['kind']) => void }) {
  const [ids, setIds] = useState<number[]>(contact.player_ids);
  const [kind, setKind] = useState(contact.kind);
  return (
    <Modal title={`Who is ${contact.name || contact.email} here for?`} onClose={onClose}>
      <Field label="They are">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as TeamContact['kind'])}>
          {(Object.keys(KIND_WORDS) as TeamContact['kind'][]).map((k) => (
            <option key={k} value={k}>
              {KIND_WORDS[k]}
            </option>
          ))}
        </select>
      </Field>
      <p className="muted small">Tick their players. Leave them all unticked for a friend of the whole team, or to decide later.</p>
      {players.length === 0 ? (
        <p className="muted small">There are no players on the roster yet.</p>
      ) : (
        <ul className="share-people">
          {players.map((pl) => (
            <li key={pl.id}>
              <label className="check">
                <input type="checkbox" checked={ids.includes(pl.id)} onChange={(e) => setIds((list) => (e.target.checked ? [...list, pl.id] : list.filter((id) => id !== pl.id)))} />
                <span>
                  {pl.name}
                  {pl.number && <span className="muted small"> · #{pl.number}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={() => save(ids, kind)}>
          Save
        </button>
      </div>
    </Modal>
  );
}

const CalIcon = ({ d }: { d: string }) => (
  <svg className="cal-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.700" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** The owner's list of people the team is shared with, and what each one may change. */
function StaffCard({ team }: { team: Team }) {
  const { user: me } = useApp();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  // People invited by email who have not made their account yet.
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('Assistant coach');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn: () => Promise<StaffMember[]>, after?: () => void) => {
    setBusy(true);
    try {
      setStaff(await fn());
      setError('');
      after?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    run(() => api.staff(team.id));
    api.invites(team.id).then(setInvites, () => {});
  }, [run, team.id]);
  const invite = async (fn: () => Promise<TeamInvite[]>, done: string) => {
    setBusy(true);
    setNote('');
    try {
      setInvites(await fn());
      setError('');
      setNote(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const share = () => {
    const to = email.trim();
    setNote('');
    run(
      () => api.addStaff(team.id, { email: to, title }),
      () => {
        setEmail('');
        // Someone with no account yet shows up as an invitation instead.
        api.invites(team.id).then((list) => {
          setInvites(list);
          if (list.some((i) => i.email === to.toLowerCase())) setNote(`Invitation emailed to ${to}. They join the team once they have created their account.`);
        }, () => {});
      },
    );
  };

  const setPerm = (m: StaffMember, perm: TeamPerm, on: boolean) => {
    const perms = { ...m.perms, [perm]: on };
    // Changing the roster means seeing all of it.
    if (perm === 'roster' && on) perms.contacts = true;
    if (perm === 'contacts' && !on) perms.roster = false;
    setStaff((list) => (list || []).map((x) => (x.user_id === m.user_id ? { ...x, perms } : x)));
    run(() => api.updateStaff(team.id, m.user_id, { perms }));
  };
  /** Handing over the team itself is asked about first: it includes deleting it. */
  const setManage = async (m: StaffMember, on: boolean) => {
    if (on) {
      const ok = await confirmDialog({
        title: `Let ${m.name} manage ${team.name}?`,
        body: `${m.name} will be able to rename the team, delete it with its practices and roster, and add, remove or change the other coaches and helpers.`,
        confirmLabel: 'Allow',
      });
      if (!ok) return;
    }
    setPerm(m, 'manage', on);
  };
  const remove = async (m: StaffMember) => {
    const ok = await confirmDialog({ title: `Stop sharing with ${m.name}?`, body: `${m.name} will no longer see ${team.name}. What they added stays.`, confirmLabel: 'Stop sharing', danger: true });
    if (ok) run(() => api.removeStaff(team.id, m.user_id));
  };

  const add = (
    <form
      className="add-row staff-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim()) share();
      }}
    >
      <input className="input grow" type="email" aria-label="Email of the person to add" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input" aria-label="Their title" placeholder="Title, such as Assistant coach" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
      <button className="btn primary" disabled={busy || !email.trim()}>
        Share team
      </button>
    </form>
  );

  return (
    <div className="card">
      <div className="card-head">
        <h2>Coaches and helpers {staff && staff.length > 0 && <span className="muted">({staff.length})</span>}</h2>
      </div>
      {add}
      <p className="muted small">
        If they already have a Dime Coach account, use the exact email they sign in with. Anyone else is emailed an invitation to create an account. Manage team covers renaming, deleting and
        sharing the team.
      </p>
      {error && <p className="error">{error}</p>}
      {note && <p className="notice">{note}</p>}

      {invites.length > 0 && (
        <ul className="staff-list compact invite-list" aria-label="Invitations waiting">
          {invites.map((i) => (
            <li key={i.id} className="staff-row invite-row">
              <div className="staff-top">
                <span className="staff-who">
                  <strong>{i.email}</strong>
                  <span className="kind">{i.expired ? 'Invitation expired' : 'Invited'}</span>
                  <span className="muted small">
                    {i.title} · {i.expired ? 'send it again to give them a new link' : 'waiting for them to create an account'}
                  </span>
                </span>
                <button className="btn small" disabled={busy} onClick={() => invite(() => api.resendInvite(team.id, i.id), `Invitation sent to ${i.email} again.`)}>
                  Send again
                </button>
                <button className="btn small danger" disabled={busy} onClick={() => invite(() => api.cancelInvite(team.id, i.id), `Invitation to ${i.email} cancelled.`)}>
                  Cancel
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {staff && staff.length > 0 && (
        <ul className="staff-list compact">
          {staff.map((m) => {
            // Someone managing a team that is not theirs can change other people, not themselves.
            const self = m.user_id === me.id;
            const chip = (perm: TeamPerm, label: string, extra = '') => (
              <button
                key={perm}
                type="button"
                className={`chip toggle perm-chip ${extra} ${m.perms[perm] ? 'on' : ''}`}
                aria-pressed={m.perms[perm]}
                disabled={self}
                onClick={() => (perm === 'manage' ? setManage(m, !m.perms.manage) : setPerm(m, perm, !m.perms[perm]))}
              >
                <span aria-hidden="true">{m.perms[perm] ? '✓' : '–'}</span>
                {label}
              </button>
            );
            return (
              <li key={m.user_id} className="staff-row">
                <div className="staff-top">
                  <span className="staff-who">
                    <strong>{m.name}</strong>
                    {self && <span className="kind">You</span>}
                    <span className="muted small">{m.email}</span>
                  </span>
                  <input
                    className="input staff-title"
                    aria-label={`Title for ${m.name}`}
                    defaultValue={m.title}
                    maxLength={60}
                    disabled={self}
                    onBlur={(e) => e.target.value.trim() !== m.title && run(() => api.updateStaff(team.id, m.user_id, { title: e.target.value }))}
                  />
                  {!self && (
                    <button className="btn small danger" onClick={() => remove(m)}>
                      Remove
                    </button>
                  )}
                </div>
                <div className="staff-perms" role="group" aria-label={`What ${m.name} can do`}>
                  <span className="perm-head">Can change</span>
                  {PERM_LABELS.map(([perm, label]) => chip(perm, label))}
                  <span className="perm-sep" aria-hidden="true" />
                  <span className="perm-head">Can see</span>
                  {chip('contacts', 'Parent contacts')}
                  <span className="perm-sep" aria-hidden="true" />
                  {chip('manage', 'Manage team', 'manage')}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The steps for making a team: its sport first, then its details. Opened from the team-choosing screen. */
export function NewTeam({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Team) => void }) {
  const app = useApp();
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  // Basketball, baseball and football first, then any other sport this workspace already has. '' means a new one.
  const choices = [...SPORT_CHOICES, ...app.sports.map((s) => s.name).filter((n) => !SPORT_CHOICES.some((c) => c.toLowerCase() === n.toLowerCase()))];
  // Null until a sport is picked on the first screen. '' is "another sport", named on the second.
  const [sportName, setSportName] = useState<string | null>(null);
  const [newSport, setNewSport] = useState('');
  const chosen = (sportName || newSport).trim();
  const other = sportName === '';
  const have = app.sports.find((s) => s.name.toLowerCase() === chosen.toLowerCase());
  const kind = sportKind(chosen);
  const [error, setError] = useState('');

  const save = async () => {
    try {
      if (!chosen) return setError('Name the sport.');
      // A sport new to this account is added on the way, with its starter categories and drills.
      const sid = have?.id ?? (await api.createSport(chosen)).id;
      const t = await api.createTeam({ name, season, sport_id: sid });
      await app.reload();
      onCreated(t);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (sportName === null)
    return (
      <Modal title="New team" onClose={onClose}>
        <p className="wizard-step muted small">Step 1 of 2</p>
        <h3 className="wizard-title">Which sport?</h3>
        <div className="sport-tiles">
          {choices.map((c) => (
            <button key={c} type="button" className="sport-tile" onClick={() => setSportName(c)}>
              <SportIcon sport={c} size={40} />
              {c}
            </button>
          ))}
          <button type="button" className="sport-tile" onClick={() => setSportName('')}>
            <SportIcon sport="" size={40} />
            Another sport
          </button>
        </div>
      </Modal>
    );
  return (
    <Modal title="New team" onClose={onClose}>
      <p className="wizard-step muted small">Step 2 of 2</p>
      <div className="wizard-sport">
        <SportIcon sport={chosen} size={30} />
        <strong>{other ? chosen || 'Another sport' : sportName}</strong>
        <button
          type="button"
          className="link small"
          onClick={() => {
            setSportName(null);
            setError('');
          }}
        >
          Change sport
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="fields stack">
        {other && (
          <Field label="Sport name">
            <input className="input" autoFocus={roomyScreen()} placeholder="Soccer" value={newSport} onChange={(e) => setNewSport(e.target.value)} />
          </Field>
        )}
        <Field label="Team name">
          <input className="input" autoFocus={!other && roomyScreen()} placeholder="5th grade boys" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Season or year">
          <input className="input" placeholder="2026-27" value={season} onChange={(e) => setSeason(e.target.value)} />
        </Field>
      </div>
      {!have && kind && (
        <p className="muted small">
          {chosen} comes with its own starter categories and drills, and a playbook that draws plays on a {kind} {surfaceWord(kind)}.
        </p>
      )}
      {!have && !kind && chosen && <p className="muted small">This sport starts with no categories or drills, and has no playbook yet. Add categories on the Categories page.</p>}
      <div className="modal-foot">
        <button className="btn" onClick={() => setSportName(null)}>
          Back
        </button>
        <button className="btn primary" onClick={save} disabled={!name.trim() || !chosen}>
          Create team
        </button>
      </div>
    </Modal>
  );
}

type TeamTab = 'team' | 'people' | 'schedule';
const TABS: [TeamTab, string][] = [
  ['team', 'Team info & roster'],
  ['people', 'Coaches & helpers'],
  ['schedule', 'Schedule integration'],
];

function TeamPanel({ team, onError }: { team: Team; onError: (msg: string) => void }) {
  const app = useApp();
  // The tab is in the address, so a link (or the welcome tour) can open a particular one.
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as TeamTab | null;
  const tab: TeamTab = TABS.some(([id]) => id === asked) ? asked! : 'team';
  const setTab = (id: TeamTab) => setParams(id === 'team' ? {} : { tab: id }, { replace: true });
  const [name, setName] = useState(team.name);
  const [season, setSeason] = useState(team.season);
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [newName, setNewName] = useState('');
  const [pending, setPending] = useState<NewPlayer[] | null>(null);
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const gone = usePendingDeletes();

  const load = useCallback(async () => {
    try {
      setPlayers(await api.players(team.id));
      onError('');
    } catch (e) {
      onError((e as Error).message);
    }
  }, [team.id, onError]);
  useEffect(() => {
    load();
  }, [load]);

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onError('');
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const saveTeam = () => {
    if (!name.trim()) return setName(team.name);
    if (name.trim() !== team.name || season !== team.season)
      guard(async () => {
        await api.updateTeam({ ...team, name: name.trim(), season });
        await app.reload();
      });
  };
  const deleteTeam = async () => {
    const ok = await confirmDialog({
      title: `Delete "${team.name}"?`,
      body: 'Its roster, practices and homework are deleted too. This cannot be undone.',
      confirmLabel: 'Delete team',
      danger: true,
    });
    if (!ok) return;
    // Once it is really gone there is no team open: back to the choosing screen.
    deleteLater({ key: `team:${team.id}`, message: `Deleted the team "${team.name}".`, run: () => api.deleteTeam(team.id), done: async () => { await app.reload(); app.pickTeam(); }, failed: onError });
  };
  const savePlayer = (p: Player) =>
    guard(async () => {
      const saved = await api.updatePlayer(p);
      setPlayers((ps) => (ps || []).map((x) => (x.id === saved.id ? saved : x)));
    });
  const addPlayer = () => {
    if (!newName.trim()) return;
    guard(async () => {
      await api.createPlayer(team.id, { name: newName.trim() });
      setNewName('');
      await load();
    });
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const found = await readRosterFile(file);
      if (found.length === 0) onError('No players found in that file. It needs a Name column.');
      else setPending(found);
    } catch (e) {
      onError(`Could not read that file: ${(e as Error).message}`);
    }
    if (fileInput.current) fileInput.current.value = '';
  };
  const doImport = (replace: boolean) =>
    guard(async () => {
      const r = await api.importPlayers(team.id, pending!, replace);
      setPending(null);
      setNotice(`Imported ${r.imported} players.`);
      await load();
    });

  return (
    <div className="team-panel">
      <div className="seg team-tabs" role="tablist" aria-label="Parts of this team">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'team' && (
      <div className="card">
        <div className="fields">
          <Field label="Team name" grow>
            <input className="input" disabled={!app.can('manage')} value={name} onChange={(e) => setName(e.target.value)} onBlur={saveTeam} />
          </Field>
          <Field label="Season or year">
            <input className="input" disabled={!app.can('manage')} value={season} onChange={(e) => setSeason(e.target.value)} onBlur={saveTeam} />
          </Field>
          <Field label="Sport">
            <input className="input" disabled value={app.sports.find((s) => s.id === team.sport_id)?.name || ''} />
          </Field>
          <div className="field end">
            {app.can('manage') && (
              <button className="btn danger" onClick={deleteTeam}>
                Delete team
              </button>
            )}
          </div>
        </div>
        {team.notes && <p className="muted small">{team.notes}</p>}
      </div>
      )}

      {tab === 'people' && (
        <>
          {app.can('manage') ? (
            <StaffCard team={team} />
          ) : (
            <div className="card">
              <h2>Coaches and helpers</h2>
              <p className="muted small">{app.access?.owner_name} decides who this team is shared with.</p>
            </div>
          )}
          <FamilyCard team={team} players={players} canSee={app.can('contacts')} canEdit={app.can('roster')} />
        </>
      )}

      {tab === 'schedule' && (
        <fieldset className="plain" disabled={!app.can('schedule')}>
          <CalendarCard team={team} />
        </fieldset>
      )}

      {tab === 'team' && (
      <fieldset className="plain" disabled={!app.can('roster')}>
      <div className="card">
        <div className="card-head">
          <h2>Roster {players && <span className="muted">({players.length})</span>}</h2>
          <div className="head-actions">
            <a className="link small" href={TEMPLATE} download="roster-template.csv">
              Download a template
            </a>
            <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="btn" onClick={() => fileInput.current?.click()}>
              Upload roster (CSV or Excel)
            </button>
          </div>
        </div>
        {notice && <p className="banner ok">{notice}</p>}
        {!app.can('roster') && (
          <p className="banner">
            View only. {app.access?.owner_name} has not given you permission to change the roster
            {app.can('contacts') ? '.' : ', and parent contacts and player notes are hidden.'}
          </p>
        )}

        {players === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-scroll">
            <table className="table roster">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  <th className="row-end" />
                </tr>
              </thead>
              <tbody>
                {players.filter((p) => !gone.has(`player:${p.id}`)).map((p) => (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    onSave={savePlayer}
                    onDelete={async () => {
                      const ok = await confirmDialog({
                        title: `Remove ${p.name} from the roster?`,
                        body: 'They also disappear from groups and player notes in existing practices.',
                        confirmLabel: 'Remove player',
                        danger: true,
                      });
                      if (ok) deleteLater({ key: `player:${p.id}`, message: `Removed ${p.name} from the roster.`, run: () => api.deletePlayer(p.id), done: load, failed: onError });
                    }}
                  />
                ))}
                {players.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="muted">
                      No players yet. Add them below or upload a roster file.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault();
            addPlayer();
          }}
        >
          <input className="input grow" placeholder="Player name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn primary" type="submit" disabled={!newName.trim()}>
            Add player
          </button>
        </form>
      </div>
      </fieldset>
      )}

      {pending && (
        <Modal title={`Import ${pending.length} players?`} onClose={() => setPending(null)} wide>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {COLUMNS.slice(0, 6).map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pending.slice(0, 8).map((p, i) => (
                  <tr key={i}>
                    {COLUMNS.slice(0, 6).map((c) => (
                      <td key={c.key}>{String(p[c.key] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pending.length > 8 && <p className="muted small">And {pending.length - 8} more.</p>}
          <div className="modal-foot">
            <button className="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
            {(players?.length || 0) > 0 && (
              <button
                className="btn danger"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: 'Replace the whole roster?',
                    body: 'Existing players are removed from groups and notes in past practices.',
                    confirmLabel: 'Replace roster',
                    danger: true,
                  });
                  if (ok) doImport(true);
                }}
              >
                Replace current roster
              </button>
            )}
            <button className="btn primary" onClick={() => doImport(false)}>
              Add to roster
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const CAL_ICONS = {
  phone: 'M7 3.500h10a1.500 1.500 0 0 1 1.500 1.500v14a1.500 1.500 0 0 1-1.500 1.500H7A1.500 1.500 0 0 1 5.500 19V5A1.500 1.500 0 0 1 7 3.500ZM10.500 17.500h3',
  screen: 'M4 5h16v11H4ZM9 20h6M12 16v4',
  team: 'M9 11.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7ZM2.500 20c.600-3.300 3.200-5 6.500-5s5.900 1.700 6.500 5M16 4.700a3.500 3.500 0 0 1 0 6.600M18 15.300c1.900.700 3.100 2.300 3.500 4.700',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800',
  calendar: 'M5 6h14v14H5ZM5 10h14M9 3.500V7M15 3.500V7',
  link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  paste: 'M9 4.500h6v3H9ZM9 6H6.500v14.500h11V6H15M12 11v6M9.500 14.500 12 17l2.500-2.500',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5.500M12 7.700v.200',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6Z',
};
type CalAppId = 'gamechanger' | 'teamsnap' | 'sportsengine' | 'google';
/** Where each team app keeps its calendar link. The last step, pasting it here, is the same for all of them. */
const CAL_APPS: { id: CalAppId; name: string; badge: string; color: string; /** Recognises a link from this app. */ match: RegExp; steps: [keyof typeof CAL_ICONS, ReactNode][]; notes: string[] }[] = [
  {
    id: 'gamechanger',
    name: 'GameChanger',
    badge: 'GC',
    color: '#1f8a4c',
    match: /gc\.com|gamechanger/i,
    steps: [
      ['phone', <>In the <strong>GameChanger</strong> app, open the team.</>],
      ['gear', <>Tap the <strong>gear</strong> icon.</>],
      ['calendar', <>Tap <strong>Schedule Sync</strong>, then <strong>Sync Schedule to Your Calendar</strong>.</>],
      ['link', <><strong>Copy</strong> the calendar link.</>],
    ],
    notes: [],
  },
  {
    id: 'teamsnap',
    name: 'TeamSnap',
    badge: 'TS',
    color: '#f26a21',
    match: /teamsnap/i,
    steps: [
      ['screen', <>Sign in at <strong>teamsnap.com</strong> in a web browser. The link is not offered in the phone app.</>],
      ['team', <>Open the team.</>],
      ['calendar', <>Open the <strong>Schedule</strong> tab, then <strong>Settings</strong>.</>],
      ['gear', <>Click <strong>Sync Calendar / Export</strong>.</>],
      ['link', <><strong>Copy</strong> the calendar link shown there.</>],
    ],
    notes: [],
  },
  {
    id: 'sportsengine',
    name: 'SportsEngine',
    badge: 'SE',
    color: '#0b5cab',
    match: /sportsengine|sportngin/i,
    steps: [
      ['screen', <>Open your team's page on the <strong>SportsEngine website</strong> in a web browser.</>],
      ['calendar', <>Go to its <strong>calendar</strong> or event list.</>],
      ['gear', <>Click the <strong>iCal</strong> icon, or <strong>Subscribe to iCal Feed</strong>.</>],
      ['link', <><strong>Copy</strong> the iCal feed link.</>],
    ],
    notes: ['The iCal option only appears once the calendar has events on it.', 'A change made in SportsEngine can take up to a day to reach its calendar link.'],
  },
  {
    id: 'google',
    name: 'Google Calendar',
    badge: 'G',
    color: '#4285f4',
    match: /google\.com/i,
    steps: [
      ['screen', <>Open <strong>calendar.google.com</strong> on a computer.</>],
      ['gear', <>Click the <strong>gear</strong> at the top right, then <strong>Settings</strong>.</>],
      ['calendar', <>Under <strong>Settings for my calendars</strong>, click the team's calendar.</>],
      ['team', <>Click <strong>Integrate calendar</strong>.</>],
      ['link', <><strong>Copy</strong> the <strong>Secret address in iCal format</strong>.</>],
    ],
    notes: ['Anyone with the secret address can read that calendar, so use one that holds only the team schedule.'],
  },
];

function CalendarCard({ team }: { team: Team }) {
  const app = useApp();
  const [url, setUrl] = useState(team.calendar_url);
  // Which app's steps are showing. A linked calendar's address usually says which app it came from.
  const [appId, setAppId] = useState<CalAppId>(() => CAL_APPS.find((x) => x.match.test(team.calendar_url))?.id ?? 'gamechanger');
  const calApp = CAL_APPS.find((x) => x.id === appId)!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const run = async (fn: () => Promise<{ count: number }>, done: (count: number) => string) => {
    setBusy(true);
    setNotice('');
    try {
      const r = await fn();
      await app.reload();
      setError('');
      setNotice(done(r.count));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => api.setCalendar(team.id, url.trim()), (n) => (url.trim() ? `Linked. Found ${n} events.` : 'Calendar unlinked.'));

  return (
    <div className="card" data-tour="calendar">
      <div className="card-head">
        <h2>Schedule from your team app</h2>
        {team.calendar_url && <span className="muted small">Last synced {fmtSynced(team.calendar_synced_at)}</span>}
      </div>
      <p className="muted small">Link the team's calendar to show its games and practices on your dashboard. Choose the app your team uses:</p>
      <div className="cal-apps" role="group" aria-label="The app your team uses">
        {CAL_APPS.map((x) => (
          <button key={x.id} type="button" className={`cal-app ${x.id === appId ? 'on' : ''}`} aria-pressed={x.id === appId} onClick={() => setAppId(x.id)}>
            <span className="cal-app-badge" style={{ background: x.color }} aria-hidden="true">
              {x.badge}
            </span>
            {x.name}
          </button>
        ))}
      </div>
      <ol className="cal-steps" aria-label={`Steps for ${calApp.name}`}>
        {calApp.steps.map(([icon, text], i) => (
          <li key={i}>
            <CalIcon d={CAL_ICONS[icon]} />
            <span>{text}</span>
          </li>
        ))}
        <li>
          <CalIcon d={CAL_ICONS.paste} />
          <span>
            <strong>Paste</strong> it in the box below and save it.
          </span>
        </li>
      </ol>
      <ul className="cal-notes muted small">
        {calApp.notes.map((n) => (
          <li key={n}>
            <CalIcon d={CAL_ICONS.info} />
            {n}
          </li>
        ))}
        <li>
          <CalIcon d={CAL_ICONS.lock} />
          The schedule is read-only here. Changes still happen in {calApp.name}.
        </li>
      </ul>
      {error && <p className="error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}
      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input className="input grow" aria-label="Calendar link" placeholder="webcal://..." value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn primary" type="submit" disabled={busy || url.trim() === team.calendar_url}>
          {busy ? 'Working…' : url.trim() ? 'Save and sync' : 'Unlink'}
        </button>
        {team.calendar_url && (
          <button className="btn" type="button" disabled={busy} onClick={() => run(() => api.syncCalendar(team.id), (n) => `Synced. Found ${n} events.`)}>
            Sync now
          </button>
        )}
      </form>
    </div>
  );
}

function PlayerRow({ player, onSave, onDelete }: { player: Player; onSave: (p: Player) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(player);
  useEffect(() => setDraft(player), [player]);
  const commit = () => {
    if (!draft.name.trim()) return setDraft(player);
    if (COLUMNS.some((c) => draft[c.key] !== player[c.key])) onSave(draft);
  };
  return (
    <tr>
      {COLUMNS.map((c) => (
        <td key={c.key}>
          <input
            className={`input cell-${c.key}`}
            aria-label={`${c.label} for ${player.name}`}
            value={String(draft[c.key] ?? '')}
            onChange={(e) => setDraft({ ...draft, [c.key]: e.target.value })}
            onBlur={commit}
          />
        </td>
      ))}
      <td className="row-end">
        <button className="btn small danger" aria-label={`Remove ${player.name} from the roster`} onClick={onDelete}>
          Remove
        </button>
      </td>
    </tr>
  );
}
