// What a team's parents, family and friends see on the team's page, as its coaches set it:
// which parts each kind of follower gets, the plays and resources picked out for them, and what
// the coaches write to them.
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { MentionArea, MentionText, useFocusPost } from '../components/Mentions';
import { api, type Audience, type FamilyKind, type FamilySection, type FamilySettings, type TeamPost, type StreamPerson } from '../api';
import type { Team } from '../types';
import { SubTabs } from '../components/cx';

const KINDS: [FamilyKind, string][] = [
  ['parent', 'Parents'],
  ['family', 'Family'],
  ['friend', 'Friends'],
];
/**
 * The people who may broadcast on their own account, beside whichever whole groups may: each one a
 * chip, and a list to choose more from. Someone whose whole group may broadcast is marked as having
 * it that way already.
 */
function BroadcastPeople({ teamId, open, canEdit }: { teamId: number; open: FamilySettings['access']; canEdit: boolean }) {
  const [people, setPeople] = useState<StreamPerson[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setPeople(null);
    api.streamPeople(teamId).then((r) => setPeople(r.people), (e) => setError((e as Error).message));
  }, [teamId]);
  const set = (p: StreamPerson, on: boolean) => api.setStreamPerson(teamId, p.id, { broadcast: on }).then((r) => (setPeople(r.people), setError('')), (e) => setError((e as Error).message));
  const byGroup = (p: StreamPerson) => !!open[p.kind as FamilyKind]?.broadcast;
  const picked = (people ?? []).filter((p) => p.broadcast);
  return (
    <div className="tf-people">
      <span className="field-label">Specific people</span>
      {people === null ? (
        <span className="muted small">{error || 'Loading…'}</span>
      ) : (
        <>
          {picked.length === 0 && people.length > 0 && <span className="muted small">Nobody chosen by name.</span>}
          {picked.map((p) => (
            <span key={p.id} className="chip tf-person">
              {p.name}
              {!p.joined && <span className="muted"> · no account yet</span>}
              {canEdit && (
                <button type="button" aria-label={`Stop ${p.name} broadcasting`} title="Remove" onClick={() => set(p, false)}>
                  ×
                </button>
              )}
            </span>
          ))}
          {canEdit && people.length > 0 && (
            <button type="button" className="btn small" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>
              {choosing ? 'Done' : '+ Choose people'}
            </button>
          )}
          {people.length === 0 && <span className="muted small">Nobody is on the team’s list of parents, family and friends yet.</span>}
          {error && <span className="error small">{error}</span>}
          {choosing && (
            <div className="tf-people-pick" role="group" aria-label="People who may broadcast">
              {people.map((p) => (
                <button key={p.id} type="button" className={`chip toggle ${p.broadcast ? 'on' : ''}`} aria-pressed={p.broadcast} onClick={() => set(p, !p.broadcast)} title={byGroup(p) ? 'Their whole group may broadcast already' : undefined}>
                  {p.name}
                  <span className="muted"> · {p.kind}</span>
                  {byGroup(p) && !p.broadcast && <span className="muted"> · by group</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** What a part gives someone who does not coach, where it is more than looking: the words on its tag, and how the tag is colored. */
const GIVES: Partial<Record<FamilySection, [string, 'view' | 'write' | 'act']>> = {
  board: ['Read & write', 'write'],
  broadcast: ['Can broadcast', 'act'],
  live: ['Watch only', 'view'],
  pbp: ['Watch only', 'view'],
};
/** What can be opened to each kind of person, in groups: the part, what it is called, and what opening it gives. */
const ACCESS: { group: string; /** The line drawing beside its name. */ icon: string; about: string; rows: [FamilySection, string, string][] }[] = [
  {
    group: 'Schedule & games',
    icon: 'M5 6h14v14H5ZM5 10h14M9 3.500V7M15 3.500V7',
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
    icon: 'M3.500 6.500h12v11h-12ZM15.500 10.500l5-3v9l-5-3',
    about: 'Live games and saved film.',
    rows: [
      ['live', 'Watch live video', 'Watching a game while it is broadcast.'],
      ['broadcast', 'Broadcast live video', 'Sending a game’s live video from their own phone or tablet. Tick a whole group, choose people by name below, or both.'],
      ['film', 'Filmroom', 'Only the game videos, clips and cuts you share with the team from the Filmroom. Video shared with one person by name always shows to them.'],
    ],
  },
  {
    group: 'Communication',
    icon: 'M4 5.500h16v11H9l-5 4Z',
    about: 'Hearing from the coaches, and talking with the team.',
    rows: [
      ['news', 'Announcements', 'What the coaches post for the people around the team.'],
      ['board', 'Message board', 'Reading it and writing on it.'],
    ],
  },
  {
    group: 'Library',
    icon: 'M5 5.500A1.500 1.500 0 0 1 6.500 4H19v13H6.500A1.500 1.500 0 0 0 5 18.500v-13ZM5 18.500A1.500 1.500 0 0 0 6.500 20H19',
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
    icon: 'M9 11.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7ZM2.500 20c.600-3.300 3.200-5 6.500-5s5.900 1.700 6.500 5M16 4.800a3.500 3.500 0 0 1 0 6.400M18.500 15.500c1.700.700 2.700 2.200 3 4.500',
    about: 'Who is on the team.',
    rows: [['roster', 'Roster', 'Players’ names and numbers. Never their positions, parents’ details or your notes.']],
  },
];
const ROLE: Record<TeamPost['role'], string> = { coach: 'Coach', parent: 'Parent', family: 'Family', friend: 'Friend' };
const when = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
type View = 'access' | 'messages';

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
        <h2>Access &amp; permissions</h2>
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
        <h2>Access &amp; permissions</h2>
      </div>
      <p className="muted small">
        What each kind of person on {team.name} can see and do. Coaches and helpers can do everything here, always. The tag beside each line says what turning it on gives a parent, a relative or a friend: most are to look at only. Parents, family and friends each have their own page for the team, and you choose what it opens to them. They can never change the team.
      </p>
      {error && <p className="error">{error}</p>}
      <SubTabs<View>
        label="Parts of the team's page"
        value={view}
        onChange={setView}
        tabs={[
          ['access', 'What each group can do'],
          ['messages', 'Announcements & board', data.news.length + data.board.length],
        ]}
      />


      {view === 'access' && (
        <div className="tf-boxes">
          {/* A box for each kind of thing. Its heading names it, and stands over the three kinds of person it is opened to. */}
          {ACCESS.map((g) => (
            <section key={g.group} className="tf-box">
              <div className="table-scroll">
                <table className="table tf-access">
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="tf-box-title">
                          <span className="tf-box-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round">
                              <path d={g.icon} />
                            </svg>
                          </span>
                          <span>
                            <strong>{g.group}</strong>
                            <small className="muted">{g.about}</small>
                          </span>
                        </span>
                      </th>
                      {/* Coaches come first, and are not for changing: it is there to make plain that they have all of it. */}
                      <th scope="col" className="tf-col">
                        Coaches &amp; helpers
                        <small className="muted">Always</small>
                      </th>
                      {KINDS.map(([k, label]) => (
                        <th key={k} scope="col" className="tf-col">
                          {label}
                          <small className="muted">{data.joined[k] ? `${data.joined[k]} joined` : 'None yet'}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(([s, label, about]) => (
                      <Fragment key={s}>
                      <tr className={s === 'broadcast' ? 'tf-has-people' : ''}>
                        <td>
                          <strong>
                            {label}
                            {/* What having it lets someone who does not coach do: look, or more. */}
                            <span className={`tf-tag ${GIVES[s]?.[1] ?? 'view'}`}>{GIVES[s]?.[0] ?? 'View only'}</span>
                          </strong>
                          <span className="muted small">{about}</span>
                        </td>
                        <td className="tf-col">
                          <input type="checkbox" aria-label={`Coaches and helpers: ${label}. Always on.`} title="Coaches and helpers always have this" checked disabled readOnly />
                        </td>
                        {KINDS.map(([k, kindLabel]) => (
                          <td key={k} className="tf-col">
                            <input type="checkbox" aria-label={`${kindLabel}: ${label}`} checked={data.access[k][s]} disabled={!canEdit} onChange={() => toggle(k, s)} />
                          </td>
                        ))}
                      </tr>
                      {/* Broadcasting can also be given to people one at a time, with or without a whole group. */}
                      {s === 'broadcast' && (
                        <tr className="tf-people-row">
                          <td colSpan={KINDS.length + 2}>
                            <BroadcastPeople teamId={team.id} open={data.access} canEdit={canEdit} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
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
                : 'Announcements are not open to anyone yet. Turn them on under "What each group can do".'
              : anyone('board')
                ? 'Everyone the board is open to can read it and write on it, and so can the team’s coaches.'
                : 'The message board is not open to anyone yet. Turn it on under "What each group can do".'}
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
