// The Filmroom: a team's saved game video, the clips cut from it, and the cuts put together
// out of clips. One list at a time; a game video opens in the editor, where clips are made.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Film, type FilmClip, type FilmLink, type FilmPeople, type FilmReel, type FilmShare, type GameStream } from '../api';
import { useApp } from '../App';
import PageTitle from '../components/PageTitle';
import { BinIcon, Field, Modal, ShareIcon } from '../components/bits';
import { FilmBrowser, type FilmKind } from '../components/Browsers';
import { confirmDialog } from '../components/dialogs';
import { CutIcon, FilmPlayer, ReelPlayer, canClip, clock, scenes, stripItem } from '../components/Film';

type Tab = 'games' | 'clips' | 'videos';
const day = (at: string) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
/** Which game a video is of, in words, for asking before anything of it is deleted. */
const gameOf = (v: GameStream | undefined) => {
  if (!v) return 'Game: not known.';
  if (!v.game) return `Game: not tied to a game. Recorded ${day(v.started_at)}.`;
  // A game's date is a day, not a moment: read as it is written, wherever the reader is.
  const [y, m, d] = v.game.date.split('-').map(Number);
  const on = y && m && d ? new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return `Game: ${v.game.title || v.title || 'Untitled game'}${on ? `, ${on}` : ''}.`;
};

const mb = (bytes: number) => (bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`);
const recorded = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const TAB_OF: Record<FilmKind, Tab> = { video: 'games', clip: 'clips', reel: 'videos' };
const KIND_OF: Record<Tab, FilmKind> = { games: 'video', clips: 'clip', videos: 'reel' };

export default function Filmroom() {
  const { team, user } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'clips' ? 'clips' : params.get('tab') === 'videos' ? 'videos' : 'games';
  const [film, setFilm] = useState<Film | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [watching, setWatching] = useState<FilmClip | null>(null);
  const [showing, setShowing] = useState<{ reel: FilmReel; at: number } | null>(null);
  const [editing, setEditing] = useState<FilmClip | null>(null);
  const [sharing, setSharing] = useState<Shared | null>(null);
  /** The button that opens sharing for one thing, saying how many people have it already. */
  const shareButton = (what: Shared) => {
    const n = film?.shares.filter((s) => s.kind === what.kind && s.ref_id === what.id).length ?? 0;
    const team = !!film?.team_shares.some((s) => s.kind === what.kind && s.ref_id === what.id);
    return (
      <button type="button" className="btn small icon-btn film-share-btn" onClick={() => setSharing(what)} aria-label={`Share ${what.title}${team ? '. On the team\u2019s page' : ''}${n ? `. Shared with ${n} ${n === 1 ? 'person' : 'people'}` : ''}`} title={team || n ? `Share. ${[team && 'On the team\u2019s page', n && `shared with ${n} ${n === 1 ? 'person' : 'people'}`].filter(Boolean).join(', and ')}` : 'Share'}>
        <ShareIcon size={17} />
        {(n > 0 || team) && <span className="cm-count">{team ? (n > 0 ? `Team +${n}` : 'Team') : n}</span>}
      </button>
    );
  };
  const failed = (e: unknown) => setError((e as Error).message);
  const load = useCallback(() => {
    if (team) api.film(team.id).then(setFilm, failed);
  }, [team]);
  useEffect(() => {
    setFilm(null);
    load();
  }, [load]);
  if (!team) return null;

  const removeClip = async (c: FilmClip) => {
    const used = film?.reels.filter((r) => r.items.some((i) => i.clip_id === c.id)).length ?? 0;
    if (!(await confirmDialog({ title: `Delete the clip "${c.title}"?`, body: `${gameOf(videoOf(c.stream_id))} The clip is deleted${used ? `, and taken out of the ${used === 1 ? 'cut' : `${used} cuts`} it is in` : ''}. The game video it was cut from is not touched.`, confirmLabel: 'Delete clip', danger: true }))) return;
    api.deleteClip(c.id).then((f) => (setFilm(f), setNotice(`The clip "${c.title}" was deleted.`)), failed);
  };
  /** Deletes a whole game video, with every clip cut from it. */
  const removeVideo = async (v: GameStream) => {
    const clips = film?.clips.filter((c) => c.stream_id === v.id) ?? [];
    const used = film?.reels.filter((r) => r.items.some((i) => i.stream_id === v.id || clips.some((c) => c.id === i.clip_id))).length ?? 0;
    const body = [
      gameOf(v),
      `The whole video (${clock(v.seconds)}, recorded ${day(v.started_at)}, from ${v.by || 'a coach'}) is deleted for good.`,
      clips.length ? `Its ${clips.length === 1 ? 'clip is' : `${clips.length} clips are`} deleted with it${used ? `, and taken out of the ${used === 1 ? 'cut' : `${used} cuts`} that use ${clips.length === 1 && used === 1 ? 'it' : 'them'}` : ''}.` : used ? `It is taken out of the ${used === 1 ? 'cut' : `${used} cuts`} that use it.` : '',
      'The game itself, its plan and its score are not touched.',
    ];
    if (!(await confirmDialog({ title: `Delete the video "${v.title || 'Game video'}"?`, body: body.filter(Boolean).join(' '), confirmLabel: 'Delete video', danger: true }))) return;
    api.deleteStream(v.id).then(() => (setNotice(`The video "${v.title || 'Game video'}" was deleted.`), load()), failed);
  };
  const removeReel = async (r: FilmReel) => {
    if (!(await confirmDialog({ title: `Delete the cut "${r.title}"?`, body: 'This is a cut you put together. Its clips and the game videos they came from are not touched.', confirmLabel: 'Delete cut', danger: true }))) return;
    api.deleteReel(r.id).then((f) => (setFilm(f), setNotice(`The cut "${r.title}" was deleted.`)), failed);
  };
  const videoOf = (id: number) => film?.videos.find((v) => v.id === id);
  const choose = (t: Tab) => (setNotice(''), setParams(t === 'games' ? {} : { tab: t }, { replace: true }));
  // Everything in the Filmroom as the shared list wants it: game videos, then clips, then cuts.
  const items = !film
    ? null
    : [
        ...film.videos.map((v) => ({ key: `v${v.id}`, kind: 'video' as const, title: v.title || 'Game video', meta: `${recorded(v.started_at)} · ${mb(v.bytes)} · from ${v.by}`, notes: '', poster: v.has_poster ? v.id : null, length: clock(v.seconds), video: v, clip: undefined as FilmClip | undefined, reel: undefined as FilmReel | undefined })),
        ...film.clips.map((c) => ({ key: `c${c.id}`, kind: 'clip' as const, title: c.title, meta: `From ${videoOf(c.stream_id)?.title || 'a game video'} · ${day(c.created_at)}`, notes: c.notes, poster: videoOf(c.stream_id)?.has_poster ? c.stream_id : null, length: clock(c.seconds), from: { id: c.stream_id, title: videoOf(c.stream_id)?.title || 'Game video' }, video: undefined as GameStream | undefined, clip: c as FilmClip | undefined, reel: undefined as FilmReel | undefined })),
        ...film.reels.map((r) => {
          const list = scenes(film, r.items.map(stripItem));
          return { key: `r${r.id}`, kind: 'reel' as const, title: r.title, meta: `${list.length} part${list.length === 1 ? '' : 's'} · ${day(r.updated_at)}`, notes: r.notes, poster: list.find((x) => x.stream.has_poster)?.stream.id ?? null, length: clock(list.reduce((n, x) => n + x.seconds, 0)), video: undefined as GameStream | undefined, clip: undefined as FilmClip | undefined, reel: r as FilmReel | undefined };
        }),
      ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle
            about={{
              lead: 'Your team’s game film, and what you make from it.',
              points: ['Game videos: what was saved from a broadcast, or brought in from a file.', 'Clips: the moments you cut out of a game video.', 'Cuts: clips and videos put together in order, for film review, highlights or scouting.'],
            }}
          >
            Filmroom
          </PageTitle>
        </div>
        <Link className="btn primary" to="/filmroom/new">
          <CutIcon /> Create a new cut
        </Link>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {/* The same list the people a video was shared with see it in. Here each one can be opened to work on, shared and deleted. */}
      <FilmBrowser
        films={items}
        compactKey="practiceplan.filmCompact"
        sharedWith={(f) => {
          const ref = f.video?.id ?? f.clip?.id ?? f.reel?.id;
          return film!.team_shares.some((s) => s.kind === f.kind && s.ref_id === ref) ? [team.name] : [];
        }}
        kind={KIND_OF[tab]}
        onKind={(k) => k && choose(TAB_OF[k])}
        onPlay={(f) => (f.video ? navigate(`/filmroom/video/${f.video.id}`) : f.clip ? setWatching(f.clip) : f.reel && setShowing({ reel: f.reel, at: 0 }))}
        buttons={(f) =>
          f.video ? (
            <>
              <button type="button" className="btn small" onClick={() => navigate(`/filmroom/video/${f.video!.id}`)}>
                Open
              </button>
              <span className="muted small film-card-count">
                {film!.clips.filter((c) => c.stream_id === f.video!.id).length || 'No'} clip{film!.clips.filter((c) => c.stream_id === f.video!.id).length === 1 ? '' : 's'}
                {canClip(f.video) ? '' : ' · watch only'}
              </span>
              {shareButton({ kind: 'video', id: f.video.id, title: f.title })}
              <button type="button" className="btn small icon-btn danger res-remove" aria-label={`Delete ${f.title}`} title="Delete" onClick={() => removeVideo(f.video!)}>
                <BinIcon />
              </button>
            </>
          ) : f.clip ? (
            <>
              <button type="button" className="btn small" onClick={() => setWatching(f.clip!)}>
                Play
              </button>
              <button type="button" className="btn small" onClick={() => setEditing(f.clip!)}>
                Edit
              </button>
              {shareButton({ kind: 'clip', id: f.clip.id, title: f.title })}
              <button type="button" className="btn small icon-btn danger res-remove" aria-label={`Delete ${f.title}`} title="Delete" onClick={() => removeClip(f.clip!)}>
                <BinIcon />
              </button>
            </>
          ) : (
            f.reel && (
              <>
                <button type="button" className="btn small" onClick={() => setShowing({ reel: f.reel!, at: 0 })}>
                  Play
                </button>
                <Link className="btn small" to={`/filmroom/reel/${f.reel.id}`}>
                  Edit
                </Link>
                {shareButton({ kind: 'reel', id: f.reel.id, title: f.title })}
                <button type="button" className="btn small icon-btn danger res-remove" aria-label={`Delete ${f.title}`} title="Delete" onClick={() => removeReel(f.reel!)}>
                  <BinIcon />
                </button>
              </>
            )
          )
        }
        empty={(k) =>
          k === 'video' ? (
            <div className="empty">
              <h2>No game video yet</h2>
              <p>Broadcast a game from its Video tab and choose to save it to Dime Coach. It shows here afterwards, ready to watch and cut into clips.</p>
            </div>
          ) : k === 'clip' ? (
            <div className="empty">
              <h2>No clips yet</h2>
              <p>Open a game video, press Start clip where something begins and End clip where it ends, and give it a title.</p>
            </div>
          ) : (
            <div className="empty">
              <h2>No cuts yet</h2>
              <p>Put clips and game videos together, in the order you want, into a cut of your own.</p>
              <Link className="btn primary" to="/filmroom/new">
                <CutIcon /> Create a new cut
              </Link>
            </div>
          )
        }
      />

      {watching && videoOf(watching.stream_id) && (
        <Modal title={watching.title} onClose={() => setWatching(null)} wide>
          <FilmPlayer stream={videoOf(watching.stream_id)!} start={watching.start} end={watching.end} autoPlay />
          {watching.notes && <p className="film-notes">{watching.notes}</p>}
          <p className="muted small">
            {clock(watching.seconds)} · from <Link to={`/filmroom/video/${watching.stream_id}`}>{videoOf(watching.stream_id)!.title || 'the game video'}</Link>
          </p>
        </Modal>
      )}
      {showing && film && (
        <Modal title={showing.reel.title} onClose={() => setShowing(null)} wide>
          <ReelPlayer scenes={scenes(film, showing.reel.items.map((i, k) => ({ ...i, key: `r${k}` })))} at={showing.at} onAt={(at) => setShowing({ ...showing, at })} pause={{ seconds: showing.reel.pause_seconds, notes: showing.reel.pause_notes }} />
          {showing.reel.notes && <p className="film-notes">{showing.reel.notes}</p>}
        </Modal>
      )}
      {editing && <ClipForm clip={editing} onClose={() => setEditing(null)} onSaved={(f) => (setFilm(f), setEditing(null))} />}
      {sharing && film && <ShareForm teamId={team.id} what={sharing} film={film} links={user.is_system_admin} onFilm={setFilm} onClose={() => setSharing(null)} />}
    </div>
  );
}

/** One thing in the Filmroom that can be shared. */
interface Shared {
  kind: FilmShare['kind'];
  id: number;
  title: string;
}
const SHARED_WORD: Record<FilmShare['kind'], string> = { video: 'game video', clip: 'clip', reel: 'cut' };
/**
 * Who one thing in the Filmroom is shared with, and sharing it with more people: ones on the
 * team's list, or new ones by email, who are added to the team as guests and see nothing else.
 */
function ShareForm({ teamId, what, film, links, onFilm, onClose }: { teamId: number; what: Shared; film: Film; /** Whether links that can be passed around are offered: the system administrator's alone. */ links: boolean; onFilm: (f: Film) => void; onClose: () => void }) {
  const [people, setPeople] = useState<FilmPeople | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [fresh, setFresh] = useState<{ name: string; email: string }[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const failed = (e: unknown) => setError((e as Error).message);
  useEffect(() => {
    api.filmPeople(teamId).then(setPeople, failed);
  }, [teamId]);
  const has = film.shares.filter((s) => s.kind === what.kind && s.ref_id === what.id);
  const onTeam = film.team_shares.some((s) => s.kind === what.kind && s.ref_id === what.id);
  // Who the team's page shows the Filmroom to, as it is set in the team's access settings.
  const [sees, setSees] = useState<string[] | null>(null);
  useEffect(() => {
    api.teamFamily(teamId).then((f) => setSees((['parent', 'family', 'friend'] as const).filter((k) => f.access[k].film).map((k) => ({ parent: 'parents', family: 'family', friend: 'friends' })[k])), () => {});
  }, [teamId]);
  const setTeam = (shared: boolean) => api.shareFilmWithTeam({ team_id: teamId, kind: what.kind, ref_id: what.id, shared }).then(onFilm, failed);
  const open = people?.people.filter((p) => !has.some((s) => s.contact_id === p.id)) ?? [];
  // Someone typed in but not yet added to the list below goes too.
  const typed = email.trim() ? [{ name: name.trim(), email: email.trim() }] : [];
  const going = picked.length + fresh.length + typed.length;
  const addFresh = () => {
    if (!email.trim()) return;
    setFresh([...fresh.filter((f) => f.email.toLowerCase() !== email.trim().toLowerCase()), { name: name.trim(), email: email.trim() }]);
    setName('');
    setEmail('');
  };
  const share = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api.shareFilm({ team_id: teamId, kind: what.kind, ref_id: what.id, contact_ids: picked, people: [...fresh, ...typed], note });
      onFilm(r);
      setPicked([]);
      setFresh([]);
      setName('');
      setEmail('');
      setNote('');
      // People added as guests are on the team's list from now on.
      api.filmPeople(teamId).then(setPeople, () => {});
      if (r.warning) setError(r.warning);
      else setNotice(`Shared with ${going} ${going === 1 ? 'person' : 'people'}. They have been told.`);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };
  const stop = async (s: FilmShare) => {
    if (!(await confirmDialog({ title: `Stop sharing with ${s.name}?`, body: `They can no longer watch "${what.title}". ${s.guest ? 'They stay on the team\u2019s list as a guest until you take them off it on the Team page.' : 'Nothing else of theirs changes.'}`, confirmLabel: 'Stop sharing', danger: true }))) return;
    api.unshareFilm(s.id).then(onFilm, failed);
  };
  return (
    <Modal title={`Share the ${SHARED_WORD[what.kind]} "${what.title}"`} onClose={onClose}>
      {/* On the team's page, as a resource or a play is: everyone the Filmroom is open to sees it there. */}
      <h3 className="film-share-h">With the team</h3>
      <label className="check setting film-team-share">
        <input type="checkbox" checked={onTeam} onChange={(e) => setTeam(e.target.checked)} />
        <span>
          <strong>Show on the team's page</strong>
          <span className="muted small">
            {sees === null
              ? 'In the Filmroom on the team\u2019s page.'
              : sees.length
                ? `In the Filmroom on the team\u2019s page, for ${sees.join(', ').replace(/, ([^,]*)$/, ' and $1')}. `
                : 'The Filmroom on the team\u2019s page is not open to anyone yet. '}
            {sees !== null && <Link to="/teams?tab=access">Change who sees the Filmroom</Link>}
          </span>
        </span>
      </label>
      <h3 className="film-share-h">With one person</h3>
      <p className="muted small">
        Whoever you share it with needs a Dime Coach account to watch. Someone new is sent a link to make one, joins this team as a guest, and sees only what you share with them: not the schedule, the roster or anything else. It cannot be passed on.
      </p>
      {has.length > 0 && (
        <>
          <h3 className="film-share-h">Shared with</h3>
          <ul className="film-share-list">
            {has.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.name}</strong> {s.guest && <span className="kind">Guest</span>}
                  <span className="muted small">{s.watched_at ? `Watched ${day(s.watched_at)}` : s.joined ? 'Not watched yet' : 'Has not made an account yet'}</span>
                </span>
                <button type="button" className="link small" onClick={() => stop(s)}>
                  Stop sharing
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="film-share-h">Share with</h3>
      {!people ? (
        !error && <p className="muted">Loading…</p>
      ) : people.hidden ? (
        <p className="muted small">The team's list of parents, family and friends is hidden for you, so share by email address below.</p>
      ) : open.length === 0 ? (
        <p className="muted small">{people.people.length === 0 ? 'Nobody on the team\u2019s list has an email address yet.' : 'Everyone on the team\u2019s list has it already.'}</p>
      ) : (
        <ul className="film-share-list film-share-pick">
          {open.map((p) => (
            <li key={p.id}>
              <label>
                <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
                <span>
                  <strong>{p.name}</strong>
                  <span className="muted small">
                    {p.kind === 'guest' ? 'Guest' : p.kind === 'parent' ? 'Parent' : p.kind === 'family' ? 'Family' : 'Friend'}
                    {p.joined ? '' : ' · no account yet'}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <h3 className="film-share-h">Or someone new, by email</h3>
      {fresh.length > 0 && (
        <span className="chips">
          {fresh.map((f) => (
            <span key={f.email} className="chip">
              {f.name ? `${f.name} (${f.email})` : f.email}
              <button type="button" aria-label={`Take ${f.email} off`} onClick={() => setFresh(fresh.filter((x) => x !== f))}>
                ✕
              </button>
            </span>
          ))}
        </span>
      )}
      <div className="film-share-new">
        <input className="input" value={name} maxLength={120} placeholder="Name" aria-label="Their name" onChange={(e) => setName(e.target.value)} />
        <input className="input" type="email" value={email} maxLength={200} placeholder="Email address" aria-label="Their email address" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFresh())} />
        <button type="button" className="btn small" disabled={!email.trim()} onClick={addFresh}>
          Add another
        </button>
      </div>
      <Field label="A note to go with it (optional)">
        <textarea className="input" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {people && !people.mail && <p className="muted small">Email is not set up on this site, so only people who already have an account can be told.</p>}
      {links && <ShareLinks teamId={teamId} what={what} onCameIn={() => api.film(teamId).then(onFilm, () => {})} />}
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
        <button type="button" className="btn primary" disabled={going === 0 || busy} onClick={share}>
          {busy ? 'Sharing…' : going > 1 ? `Share with ${going} people` : 'Share'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Links to one thing that can be passed around, in a text message say. Whoever opens one signs
 * in or makes an account, and joins the team as a guest with this shared with them.
 */
function ShareLinks({ teamId, what, onCameIn }: { teamId: number; what: Shared; onCameIn: () => void }) {
  const [list, setList] = useState<FilmLink[] | null>(null);
  const [fresh, setFresh] = useState<{ id: number; url: string; days: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const failed = (e: unknown) => setError((e as Error).message);
  useEffect(() => {
    api.filmLinks(teamId).then(setList, failed);
  }, [teamId]);
  const mine = list?.filter((l) => l.kind === what.kind && l.ref_id === what.id) ?? [];
  const make = () =>
    api.makeFilmLink({ team_id: teamId, kind: what.kind, ref_id: what.id }).then((r) => {
      setList(r.links);
      setFresh(r);
      setCopied(false);
      setError('');
    }, failed);
  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.url);
      setCopied(true);
    } catch {
      setError('It could not be copied from here. Select the address and copy it yourself.');
    }
  };
  const drop = async (l: FilmLink) => {
    if (!(await confirmDialog({ title: 'Turn this link off?', body: `It stops working for anyone who has not used it yet. The ${l.opened} ${l.opened === 1 ? 'person' : 'people'} who came in by it keep the video until you stop sharing with them above.`, confirmLabel: 'Turn off', danger: true }))) return;
    api.dropFilmLink(teamId, l.id).then((r) => (setList(r), fresh?.id === l.id && setFresh(null), onCameIn()), failed);
  };
  return (
    <div className="film-share-links">
      <h3 className="film-share-h">
        A link you can send <span className="kind system">System administrator</span>
      </h3>
      <p className="muted small">For a text message or anywhere else. Whoever opens it signs in, or makes an account, and joins this team as a guest with this shared with them. They show under "Shared with" once they have, and you can stop any of them there.</p>
      {error && <p className="error">{error}</p>}
      {fresh && (
        <div className="film-share-url">
          <input className="input" readOnly value={fresh.url} aria-label="The link" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn small primary" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <span className="muted small">Copy it now: it is not shown again. It works for {fresh.days} days.</span>
        </div>
      )}
      {mine.length > 0 && (
        <ul className="film-share-list">
          {mine.map((l) => (
            <li key={l.id}>
              <span>
                <strong>Link made {day(l.created_at)}</strong>
                <span className="muted small">
                  {l.opened === 0 ? 'Nobody has used it yet' : `${l.opened} ${l.opened === 1 ? 'person has' : 'people have'} come in by it`} · works until {day(l.expires_at)}
                </span>
              </span>
              <button type="button" className="link small" onClick={() => drop(l)}>
                Turn off
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn small" onClick={make}>
        {mine.length > 0 ? 'Make another link' : 'Make a link'}
      </button>
    </div>
  );
}

/** A clip's title and notes, to change. */
export function ClipForm({ clip, onClose, onSaved }: { clip: FilmClip; onClose: () => void; onSaved: (film: Film) => void }) {
  const [title, setTitle] = useState(clip.title);
  const [notes, setNotes] = useState(clip.notes);
  const [error, setError] = useState('');
  return (
    <Modal title="Edit clip" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          api.saveClip(clip.id, { title, notes }).then(onSaved, (err) => setError((err as Error).message));
        }}
      >
        <Field label="Title">
          <input className="input" value={title} maxLength={120} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="input" rows={4} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
