// What a team's parents, family and friends see on the team's page, as its coaches set it:
// which parts each kind of follower gets, the plays and resources picked out for them, and what
// the coaches write to them.
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { MentionArea, MentionText, useFocusPost } from '../components/Mentions';
import { StreamPeople } from '../components/GameVideo';
import { api, type FamilyKind, type FamilySection, type FamilySettings, type TeamPost } from '../api';
import type { Team } from '../types';
import { SubTabs } from '../components/cx';

const KINDS: [FamilyKind, string][] = [
  ['parent', 'Parents'],
  ['family', 'Family'],
  ['friend', 'Friends'],
];
const SECTIONS: [FamilySection, string, string][] = [
  ['schedule', 'Schedule', 'Practices, games and events on their days.'],
  ['games', 'Game details', 'The time, place and opponent of each game. Without this a game shows only as a game on its day. Needs the schedule.'],
  ['practices', 'Practice summaries', 'What each practice covers: its parts and how long each runs. Never your coach notes. Needs the schedule.'],
  ['news', 'Announcements', 'What the coaches post for the people around the team.'],
  ['board', 'Message board', 'Reading it and writing on it.'],
  ['homework', 'Homework', 'Sheets set for the whole team, and for their own players.'],
  ['playbook', 'Playbook', 'Only the plays picked under "Shared plays".'],
  ['drills', 'Drills', 'Only the drills picked under "Shared drills", without your coach notes.'],
  ['resources', 'Resources', 'Only the links, pictures and videos picked under "Shared resources".'],
  ['roster', 'Roster', 'Players’ names and numbers. Never their positions, parents’ details or your notes.'],
];
const ROLE: Record<TeamPost['role'], string> = { coach: 'Coach', parent: 'Parent', family: 'Family', friend: 'Friend' };
const when = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
type View = 'access' | 'messages' | 'plays' | 'drills' | 'resources' | 'video';

export function FamilyPageCard({ team, canEdit }: { team: Team; canEdit: boolean }) {
  const [data, setData] = useState<FamilySettings | null>(null);
  const [error, setError] = useState('');
  // A link to a message on the board ("you were mentioned") opens the board itself.
  const [params] = useSearchParams();
  const me = useApp().user.name;
  const [view, setView] = useState<View>(params.get('view') === 'messages' ? 'messages' : 'access');
  const [show, setShow] = useState<'news' | 'board'>(params.get('show') === 'board' ? 'board' : 'news');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setData(null);
    api.teamFamily(team.id).then(setData, (e) => setError((e as Error).message));
  }, [team.id]);
  const act = async (work: () => Promise<FamilySettings>) => {
    setBusy(true);
    try {
      setData(await work());
      setError('');
      setBusy(false);
      return true;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      return false;
    }
  };
  useFocusPost(!!data && view === 'messages' && show === 'board');
  if (!data)
    return (
      <div className="card">
        <h2>The team's page for parents, family &amp; friends</h2>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </div>
    );
  // Shown at once, and saved one box at a time, so ticking several quickly loses none of them.
  const toggle = (kind: FamilyKind, section: FamilySection) => {
    const value = !data.access[kind][section];
    setData({ ...data, access: { ...data.access, [kind]: { ...data.access[kind], [section]: value } } });
    act(() => api.saveTeamFamily(team.id, { access: { [kind]: { [section]: value } } }));
  };
  const post = async (e: FormEvent) => {
    e.preventDefault();
    if (await act(() => api.teamFamilyPost(team.id, { kind: show, title: show === 'news' ? title : '', body }))) {
      setTitle('');
      setBody('');
    }
  };
  const posts = show === 'news' ? data.news : data.board;
  const anyone = (section: FamilySection) => KINDS.some(([k]) => data.access[k][section]);

  return (
    <div className="card tf">
      <div className="card-head">
        <h2>The team's page for parents, family &amp; friends</h2>
      </div>
      <p className="muted small">
        Someone you invite above makes an account from the link in their invitation, and then has a page for {team.name}. Here you choose what that page shows to each kind of person. They can never change the team.
      </p>
      {error && <p className="error">{error}</p>}
      <SubTabs<View>
        label="Parts of the team's page"
        value={view}
        onChange={setView}
        tabs={[
          ['access', 'Who sees what'],
          ['messages', 'Announcements & board', data.news.length + data.board.length],
          ['plays', 'Shared plays', data.plays.length],
          ['drills', 'Shared drills', data.drills.length],
          ['resources', 'Shared resources', data.resources.length],
          ['video', 'Live video'],
        ]}
      />

      {view === 'video' && <StreamPeople teamId={team.id} />}

      {view === 'access' && (
        <div className="table-scroll">
          <table className="table tf-access">
            <thead>
              <tr>
                <th>Part of the page</th>
                {KINDS.map(([k, label]) => (
                  <th key={k} className="tf-col">
                    {label}
                    <small className="muted">{data.joined[k] ? `${data.joined[k]} with an account` : 'None with an account yet'}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map(([s, label, about]) => (
                <tr key={s}>
                  <td>
                    <strong>{label}</strong>
                    <span className="muted small">{about}</span>
                  </td>
                  {KINDS.map(([k, kindLabel]) => (
                    <td key={k} className="tf-col">
                      <input type="checkbox" aria-label={`${kindLabel} see the ${label.toLowerCase()}`} checked={data.access[k][s]} disabled={!canEdit} onChange={() => toggle(k, s)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!canEdit && <p className="muted small">You can see these settings, but changing them needs permission to change the roster.</p>}
        </div>
      )}

      {view === 'messages' && (
        <>
          <div className="seg tf-seg" role="group" aria-label="Which messages">
            <button type="button" className={show === 'news' ? 'on' : ''} aria-pressed={show === 'news'} onClick={() => setShow('news')}>
              Announcements
            </button>
            <button type="button" className={show === 'board' ? 'on' : ''} aria-pressed={show === 'board'} onClick={() => setShow('board')}>
              Message board
            </button>
          </div>
          <p className="muted small">
            {show === 'news'
              ? anyone('news')
                ? 'Only coaches write announcements. They show first on the team’s page for everyone who may see them.'
                : 'Announcements are not open to anyone yet. Turn them on under "Who sees what".'
              : anyone('board')
                ? 'Everyone the board is open to can read it and write on it, and so can the team’s coaches.'
                : 'The message board is not open to anyone yet. Turn it on under "Who sees what".'}
          </p>
          <form className="fields stack tf-write" onSubmit={post}>
            {show === 'news' && <input className="input" maxLength={120} aria-label="Headline" placeholder="Headline (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />}
            {show === 'news' ? (
              <textarea className="input" rows={3} maxLength={4000} aria-label="Message" placeholder="What do the team’s parents, family and friends need to know?" value={body} onChange={(e) => setBody(e.target.value)} />
            ) : (
              <MentionArea people={data.board_people.filter((n) => n !== me)} className="input" rows={3} maxLength={4000} aria-label="Message" placeholder="Write on the board… Type @ to name someone." value={body} onChange={setBody} />
            )}
            <div className="modal-actions">
              <button className="btn primary" disabled={busy || !body.trim()}>
                {show === 'news' ? 'Post announcement' : 'Post'}
              </button>
            </div>
          </form>
          {posts.length === 0 && <p className="muted">{show === 'news' ? 'No announcements yet.' : 'Nobody has written on the board yet.'}</p>}
          {posts.map((p) => (
            <article key={p.id} className={`fam-post ${p.role === 'coach' ? 'coach' : ''}`} data-post={p.id}>
              <header>
                <strong>{p.author}</strong>
                <span className="kind">{ROLE[p.role]}</span>
                <span className="muted small">{when(p.at)}</span>
                <button type="button" className="link small" disabled={busy} onClick={() => act(() => api.deleteTeamFamilyPost(team.id, p.id))}>
                  Delete
                </button>
              </header>
              {p.title && <h3>{p.title}</h3>}
              <p>{show === 'board' ? <MentionText text={p.body} people={data.board_people} me={me} /> : p.body}</p>
            </article>
          ))}
        </>
      )}

      {view === 'plays' && (
        <Picker
          about={anyone('playbook') ? `Tick the plays the team's followers may see. They get the diagram, its steps and its notes, and cannot change it.` : 'The playbook is not open to anyone yet. Turn it on under "Who sees what", then pick the plays here.'}
          empty="This team's sport has no plays yet. Draw some in the Playbook first."
          rows={data.all_plays.map((p) => ({ id: String(p.id), title: p.name, sub: p.category }))}
          picked={data.plays.map(String)}
          disabled={!canEdit || busy}
          save={(ids) => act(() => api.saveTeamFamily(team.id, { plays: ids.map(Number) }))}
        />
      )}
      {view === 'drills' && (
        <Picker
          about={anyone('drills') ? `Tick the drills the team's followers may see: something to work on at home, say. They get the drill's notes and diagrams, and never your coach notes.` : 'Drills are not open to anyone yet. Turn them on under "Who sees what", then pick the drills here.'}
          empty="This team's sport has no drills yet. Add some on the Drills page first."
          rows={data.all_drills.map((d) => ({ id: String(d.id), title: d.name, sub: '' }))}
          picked={data.drills.map(String)}
          disabled={!canEdit || busy}
          save={(ids) => act(() => api.saveTeamFamily(team.id, { drills: ids.map(Number) }))}
        />
      )}
      {view === 'resources' && (
        <Picker
          about={anyone('resources') ? `Tick the links, pictures and videos the team's followers may open.` : 'Resources are not open to anyone yet. Turn them on under "Who sees what", then pick them here.'}
          empty="There are no resources yet. Add links, pictures or videos on the Resources page first."
          rows={data.all_resources.map((r) => ({ id: r.key, title: r.title, sub: r.kind === 'link' ? r.url : r.kind === 'image' ? 'Picture' : 'Video' }))}
          picked={data.resources}
          disabled={!canEdit || busy}
          save={(keys) => act(() => api.saveTeamFamily(team.id, { resources: keys }))}
        />
      )}
    </div>
  );
}

/** A list to tick things on. Each tick is saved as it is made. */
function Picker({ about, empty, rows, picked, disabled, save }: { about: string; empty: string; rows: { id: string; title: string; sub: string }[]; picked: string[]; disabled: boolean; save: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = rows.filter((r) => !term || `${r.title} ${r.sub}`.toLowerCase().includes(term));
  return (
    <>
      <p className="muted small">{about}</p>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <>
          <div className="tf-pick-bar">
            {rows.length > 8 && <input className="input" type="search" aria-label="Find" placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} />}
            <span className="muted small">
              {picked.length} of {rows.length} shared
            </span>
            <button type="button" className="link small" disabled={disabled || picked.length === rows.length} onClick={() => save(rows.map((r) => r.id))}>
              Share all
            </button>
            <button type="button" className="link small" disabled={disabled || picked.length === 0} onClick={() => save([])}>
              Share none
            </button>
          </div>
          <ul className="tf-pick">
            {shown.map((r) => (
              <li key={r.id}>
                <label>
                  <input type="checkbox" checked={picked.includes(r.id)} disabled={disabled} onChange={() => save(picked.includes(r.id) ? picked.filter((id) => id !== r.id) : [...picked, r.id])} />
                  <span>
                    <strong>{r.title}</strong>
                    {r.sub && <span className="muted small">{r.sub}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
