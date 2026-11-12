import { useCallback, useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { api } from '../api';
import { useApp } from '../App';
import type { Player, StaffMember, Team, TeamPerm } from '../types';
import { Field, Modal } from '../components/bits';
import SportIcon from '../components/SportIcon';
import { fmtSynced } from '../util';
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
  { key: 'parent_phone', label: 'Parent phone', headers: ['phone', 'parentphone', 'cell', 'mobile', 'phonenumber'] },
  { key: 'notes', label: 'Notes (coach only)', headers: ['notes', 'note', 'comments'] },
];
const TEMPLATE =
  'data:text/csv;charset=utf-8,' +
  encodeURIComponent('Name,Number,Position,Grade,Parent name,Parent email,Parent phone,Notes\nJordan Smith,12,PG,5,Pat Smith,pat@example.com,555-0100,\n');

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
  const [selectedId, setSelectedId] = useState<number>(app.team?.id || 0);
  const [adding, setAdding] = useState(app.teams.length === 0);
  const [error, setError] = useState('');
  // A team deleted a moment ago is left out of this page, though the delete can still be undone.
  const gone = usePendingDeletes();
  const teams = app.teams.filter((t) => !gone.has(`team:${t.id}`));
  const selected = teams.find((t) => t.id === selectedId) || teams[0] || null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Teams &amp; rosters</h1>
          <p className="muted">One team per sport and season. Each team has its own roster, practices and homework.</p>
        </div>
        {!app.access && (
          <div className="head-actions">
            <button className="btn primary" onClick={() => setAdding(true)}>
              + New team
            </button>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {!app.access && app.shared_teams.length > 0 && <SharedTeams onError={setError} />}

      {teams.length === 0 ? (
        <div className="empty">
          <h2>Create your first team</h2>
          <p>Everything in Dime Coach belongs to a team, so start here.</p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            + New team
          </button>
        </div>
      ) : (
        <div className="teams-layout">
          <ul className="team-list">
            {teams.map((t) => (
              <li key={t.id}>
                <button className={selected?.id === t.id ? 'on' : ''} onClick={() => setSelectedId(t.id)}>
                  <strong>{t.name}</strong>
                  <span className="muted small">
                    {app.sports.find((s) => s.id === t.sport_id)?.name}
                    {t.season ? ` · ${t.season}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && <TeamPanel key={selected.id} team={selected} onError={setError} />}
        </div>
      )}

      {/* With no team yet this form opens by itself, but not on top of the welcome tour: it waits until the tour is over. */}
      {adding && !app.touring && (
        <NewTeam
          onClose={() => setAdding(false)}
          onCreated={(t) => {
            setAdding(false);
            setSelectedId(t.id);
            app.setTeamId(t.id);
          }}
        />
      )}
    </div>
  );
}

/** Teams other coaches have shared with you. */
function SharedTeams({ onError }: { onError: (msg: string) => void }) {
  const app = useApp();
  const leave = async (id: number, name: string) => {
    const ok = await confirmDialog({ title: `Leave "${name}"?`, body: 'You will no longer see this team. Its owner can share it with you again.', confirmLabel: 'Leave team', danger: true });
    if (!ok) return;
    try {
      await api.leaveSharedTeam(id);
      await app.reload();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <div className="card shared-teams">
      <h2>Shared with you</h2>
      <ul className="staff-list">
        {app.shared_teams.map((t) => (
          <li key={t.id} className="staff-row">
            <div className="staff-who">
              <strong>
                {t.name}
                {t.season ? ` · ${t.season}` : ''}
              </strong>
              <span className="muted small">
                From {t.owner_name}
                {t.title ? ` · you are ${t.title}` : ''}
              </span>
            </div>
            <div className="head-actions">
              <button className="btn primary small" onClick={() => app.openTeam(true, t.id)}>
                Open
              </button>
              <button className="btn small" onClick={() => leave(t.id, t.name)}>
                Leave
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PERM_LABELS: [TeamPerm, string][] = [
  ['plans', 'Practices & homework'],
  ['drills', 'Drills & categories'],
  ['plays', 'Playbook'],
  ['resources', 'Resources & uploads'],
  ['roster', 'Roster'],
  ['schedule', 'Schedule link'],
];

/** The owner's list of people the team is shared with, and what each one may change. */
function StaffCard({ team }: { team: Team }) {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
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
  }, [run, team.id]);

  const setPerm = (m: StaffMember, perm: TeamPerm, on: boolean) => {
    const perms = { ...m.perms, [perm]: on };
    // Changing the roster means seeing all of it.
    if (perm === 'roster' && on) perms.contacts = true;
    if (perm === 'contacts' && !on) perms.roster = false;
    setStaff((list) => (list || []).map((x) => (x.user_id === m.user_id ? { ...x, perms } : x)));
    run(() => api.updateStaff(team.id, m.user_id, { perms }));
  };
  const remove = async (m: StaffMember) => {
    const ok = await confirmDialog({ title: `Stop sharing with ${m.name}?`, body: `${m.name} will no longer see ${team.name}. What they added stays.`, confirmLabel: 'Stop sharing', danger: true });
    if (ok) run(() => api.removeStaff(team.id, m.user_id));
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Coaches and helpers {staff && staff.length > 0 && <span className="muted">({staff.length})</span>}</h2>
      </div>
      <p className="muted small">
        Share this team with an assistant coach or anyone else who helps. They see this team only, not your other teams, along with your drills,
        playbook and resources. They can look at everything and change only what you tick.
      </p>
      {error && <p className="error">{error}</p>}
      {staff && staff.length > 0 && (
        <ul className="staff-list">
          {staff.map((m) => (
            <li key={m.user_id} className="staff-row">
              <div className="staff-who">
                <strong>{m.name}</strong>
                <span className="muted small">{m.email}</span>
              </div>
              <input
                className="input staff-title"
                aria-label={`Role for ${m.name}`}
                defaultValue={m.title}
                maxLength={60}
                onBlur={(e) => e.target.value.trim() !== m.title && run(() => api.updateStaff(team.id, m.user_id, { title: e.target.value }))}
              />
              <button className="btn small danger" onClick={() => remove(m)}>
                Remove
              </button>
              <div className="perm-list" role="group" aria-label={`What ${m.name} can do`}>
                <span className="perm-head">Can change</span>
                {PERM_LABELS.map(([perm, label]) => (
                  <label key={perm} className="check">
                    <input type="checkbox" checked={m.perms[perm]} onChange={(e) => setPerm(m, perm, e.target.checked)} />
                    {label}
                  </label>
                ))}
                <span className="perm-head">Can see</span>
                <label className="check">
                  <input type="checkbox" checked={m.perms.contacts} onChange={(e) => setPerm(m, 'contacts', e.target.checked)} />
                  Parent contacts &amp; player notes
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) run(() => api.addStaff(team.id, { email: email.trim(), title }), () => setEmail(''));
        }}
      >
        <input className="input grow" type="email" aria-label="Email of the person to add" placeholder="Their Dime Coach email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" aria-label="Their role" placeholder="Role" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn primary" disabled={busy || !email.trim()}>
          Share team
        </button>
      </form>
    </div>
  );
}

function NewTeam({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Team) => void }) {
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
            <input className="input" autoFocus placeholder="Soccer" value={newSport} onChange={(e) => setNewSport(e.target.value)} />
          </Field>
        )}
        <Field label="Team name">
          <input className="input" autoFocus={!other} placeholder="5th grade boys" value={name} onChange={(e) => setName(e.target.value)} />
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

function TeamPanel({ team, onError }: { team: Team; onError: (msg: string) => void }) {
  const app = useApp();
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
    deleteLater({ key: `team:${team.id}`, message: `Deleted the team "${team.name}".`, run: () => api.deleteTeam(team.id), done: app.reload, failed: onError });
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
      <div className="card">
        <div className="fields">
          <Field label="Team name" grow>
            <input className="input" disabled={!!app.access} value={name} onChange={(e) => setName(e.target.value)} onBlur={saveTeam} />
          </Field>
          <Field label="Season or year">
            <input className="input" disabled={!!app.access} value={season} onChange={(e) => setSeason(e.target.value)} onBlur={saveTeam} />
          </Field>
          <Field label="Sport">
            <input className="input" disabled value={app.sports.find((s) => s.id === team.sport_id)?.name || ''} />
          </Field>
          <div className="field end">
            {app.team?.id !== team.id && (
              <button className="btn" onClick={() => app.setTeamId(team.id)}>
                Switch to this team
              </button>
            )}
            {!app.access && (
              <button className="btn danger" onClick={deleteTeam}>
                Delete team
              </button>
            )}
          </div>
        </div>
        {team.notes && <p className="muted small">{team.notes}</p>}
      </div>

      {!app.access && <StaffCard team={team} />}

      <fieldset className="plain" disabled={!app.can('schedule')}>
        <CalendarCard team={team} />
      </fieldset>

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

      {pending && (
        <Modal title={`Import ${pending.length} players?`} onClose={() => setPending(null)} wide>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {COLUMNS.slice(0, 7).map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pending.slice(0, 8).map((p, i) => (
                  <tr key={i}>
                    {COLUMNS.slice(0, 7).map((c) => (
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

function CalendarCard({ team }: { team: Team }) {
  const app = useApp();
  const [url, setUrl] = useState(team.calendar_url);
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
        <h2>Schedule from GameChanger</h2>
        {team.calendar_url && <span className="muted small">Last synced {fmtSynced(team.calendar_synced_at)}</span>}
      </div>
      <p className="muted small">
        Paste the team's calendar link to show its games and practices on your dashboard. In the GameChanger app, open the team, tap the gear
        icon, then Schedule Sync, then Sync Schedule to Your Calendar, and copy the calendar link. Links from TeamSnap, SportsEngine and Google
        Calendar work the same way. The schedule is read-only here: changes still happen in GameChanger.
      </p>
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
