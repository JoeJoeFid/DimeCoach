// What a team's parents, family and friends see on the team's page, as its coaches set it:
// which parts each kind of follower gets, the plays and resources picked out for them, and what
// the coaches write to them.
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { MentionArea, MentionText, useFocusPost } from '../components/Mentions';
import { StreamPeople } from '../components/GameVideo';
import { api, type Audience, type FamilyKind, type FamilySection, type FamilySettings, type TeamPost } from '../api';
import type { Team } from '../types';
import { SubTabs } from '../components/cx';

const KINDS: [FamilyKind, string][] = [
  ['parent', 'Parents'],
  ['family', 'Family'],
  ['friend', 'Friends'],
];
/** What can be opened to each kind of person, in groups: the part, what it is called, and what opening it gives. */
const ACCESS: { group: string; about: string; rows: [FamilySection, string, string][] }[] = [
  {
    group: 'Schedule & games',
    about: 'What they know about when and where the team plays and practices.',
    rows: [
      ['schedule', 'Schedule', 'Practices, games and events on their days.'],
      ['games', 'Game details', 'The time, place and opponent of each game. Without this a game shows only as a game on its day. Needs the schedule.'],
      ['practices', 'Practice summaries', 'What each practice covers: its parts and how long each runs. Never your coach notes. Needs the schedule.'],
      ['pbp', 'Live play-by-play', 'Following a game as it is scored: the score and each play as it happens. Needs the schedule and game details.'],
    ],
  },
  {
    group: 'Video',
    about: 'Live games and saved film.',
    rows: [
      ['live', 'Watch live video', 'Watching a game while it is broadcast. One person can be turned off under "Live video".'],
      ['broadcast', 'Broadcast live video', 'Sending a game’s live video from their own phone or tablet. One person can be allowed alone under "Live video".'],
      ['film', 'Filmroom', 'Only the game videos, clips and cuts you share with the team from the Filmroom. Video shared with one person by name always shows to them.'],
    ],
  },
  {
    group: 'Communication',
    about: 'Hearing from the coaches, and talking with the team.',
    rows: [
      ['news', 'Announcements', 'What the coaches post for the people around the team.'],
      ['board', 'Message board', 'Reading it and writing on it.'],
    ],
  },
  {
    group: 'Library',
    about: 'What you share with the team to read, watch and work on.',
    rows: [
      ['homework', 'Homework', 'Sheets set for the whole team, and for their own players.'],
      ['playbook', 'Playbook', 'Only the plays you share with the team from the Playbook.'],
      ['drills', 'Drills', 'Only the drills you share with the team from Drills, without your coach notes.'],
      ['resources', 'Resources', 'Only the links, pictures and videos you share with the team from Resources.'],
    ],
  },
  {
    group: 'Team',
    about: 'Who is on the team.',
    rows: [['roster', 'Roster', 'Players’ names and numbers. Never their positions, parents’ details or your notes.']],
  },
];
const ROLE: Record<TeamPost['role'], string> = { coach: 'Coach', parent: 'Parent', family: 'Family', friend: 'Friend' };
const when = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
type View = 'access' | 'messages' | 'video';

/** Who an announcement goes out to unless the coach says otherwise. */
export const DEFAULT_AUDIENCE: Audience[] = ['coach', 'parent'];
const AUDIENCE_WORDS: [Audience, string][] = [
  ['coach', 'Coaches'],
  ['parent', 'Parents'],
  ['family', 'Family'],
  ['friend', 'Friends'],
];
export const audienceWords = (to: Audience[]) =>
  AUDIENCE_WORDS.filter(([id]) => to.includes(id))
    .map(([, word]) => word.toLowerCase())
    .join(', ');
/** The groups an announcement goes out to, each one pressed in or out. */
export function AudiencePick({ value, onChange }: { value: Audience[]; onChange: (to: Audience[]) => void }) {
  return (
    <div className="aud-pick" role="group" aria-label="Who it goes out to">
      <span className="field-label">Send to</span>
      {AUDIENCE_WORDS.map(([id, word]) => {
        const on = value.includes(id);
        return (
          <button key={id} type="button" className={`chip toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== id) : [...value, id])}>
            {word}
          </button>
        );
      })}
    </div>
  );
}

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
  const [sendTo, setSendTo] = useState<Audience[]>(DEFAULT_AUDIENCE);
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
    if (await act(() => api.teamFamilyPost(team.id, { kind: show, title: show === 'news' ? title : '', body, to: show === 'news' ? sendTo : undefined }))) {
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
          ['access', 'Access & permissions'],
          ['messages', 'Announcements & board', data.news.length + data.board.length],
          ['video', 'Live video'],
        ]}
      />

      {view === 'video' && <StreamPeople teamId={team.id} />}

      {view === 'access' && (
        <div className="table-scroll">
          <table className="table tf-access">
            <thead>
              <tr>
                <th>What they can see and do</th>
                {KINDS.map(([k, label]) => (
                  <th key={k} className="tf-col">
                    {label}
                    <small className="muted">{data.joined[k] ? `${data.joined[k]} with an account` : 'None with an account yet'}</small>
                  </th>
                ))}
              </tr>
            </thead>
            {ACCESS.map((g) => (
              <tbody key={g.group}>
                <tr className="tf-group">
                  <th colSpan={KINDS.length + 1} scope="colgroup">
                    {g.group}
                    <small className="muted">{g.about}</small>
                  </th>
                </tr>
                {g.rows.map(([s, label, about]) => (
                  <tr key={s}>
                    <td>
                      <strong>{label}</strong>
                      <span className="muted small">{about}</span>
                    </td>
                    {KINDS.map(([k, kindLabel]) => (
                      <td key={k} className="tf-col">
                        <input type="checkbox" aria-label={`${kindLabel}: ${label}`} checked={data.access[k][s]} disabled={!canEdit} onChange={() => toggle(k, s)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
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
                : 'Announcements are not open to anyone yet. Turn them on under "Access & permissions".'
              : anyone('board')
                ? 'Everyone the board is open to can read it and write on it, and so can the team’s coaches.'
                : 'The message board is not open to anyone yet. Turn it on under "Access & permissions".'}
          </p>
          <form className="fields stack tf-write" onSubmit={post}>
            {show === 'news' && <input className="input" maxLength={120} aria-label="Headline" placeholder="Headline (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />}
            {show === 'news' ? (
              <textarea className="input" rows={3} maxLength={4000} aria-label="Message" placeholder="What do the team’s parents, family and friends need to know?" value={body} onChange={(e) => setBody(e.target.value)} />
            ) : (
              <MentionArea people={data.board_people.filter((n) => n !== me)} className="input" rows={3} maxLength={4000} aria-label="Message" placeholder="Write on the board… Type @ to name someone." value={body} onChange={setBody} />
            )}
            {show === 'news' && <AudiencePick value={sendTo} onChange={setSendTo} />}
            <div className="modal-actions">
              <button className="btn primary" disabled={busy || !body.trim() || (show === 'news' && sendTo.length === 0)}>
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
              {show === 'news' && !!p.audience?.length && <span className="muted small">Sent to {audienceWords(p.audience)}</span>}
              <p>{show === 'board' ? <MentionText text={p.body} people={data.board_people} me={me} /> : p.body}</p>
            </article>
          ))}
        </>
      )}

    </div>
  );
}
