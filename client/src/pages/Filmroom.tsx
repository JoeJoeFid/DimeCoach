// The Filmroom: a team's saved game video, the clips cut from it, and the cuts put together
// out of clips. One list at a time; a game video opens in the editor, where clips are made.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Film, type FilmClip, type FilmLink, type FilmPeople, type FilmReel, type FilmShare, type GameStream } from '../api';
import { useApp } from '../App';
import PageTitle from '../components/PageTitle';
import { BinIcon, Field, Modal, ShareIcon } from '../components/bits';
import { SideChoices } from '../components/cx';
import { confirmDialog } from '../components/dialogs';
import { GameVideoCard } from '../components/GameVideo';
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

/** A clip or a put-together video as a card: the picture of the game it is from, what it is, and what can be done with it. */
function FilmCard({ poster, length, title, meta, notes, onPlay, children }: { poster: number | null; length: string; title: string; meta: string; notes?: string; onPlay: () => void; children: React.ReactNode }) {
  return (
    <div className="res-card kind-video film-card">
      <button type="button" className="res-preview" onClick={onPlay} title="Play">
        {poster ? <img className="res-thumb gv-poster" src={`/api/streams/${poster}/poster`} alt="" loading="lazy" /> : <span className="res-thumb site">Video</span>}
        <span className="res-play" aria-hidden="true">
          ▶
        </span>
        <span className="gv-length">{length}</span>
      </button>
      <div className="res-info">
        <strong className="res-title">{title}</strong>
        <span className="muted small">{meta}</span>
        {notes && <p className="film-notes">{notes}</p>}
        <div className="res-actions">{children}</div>
      </div>
    </div>
  );
}

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
  // What is typed to find something by its title or notes, and the game video the clips are narrowed to (0 for all).
  const [q, setQ] = useState('');
  const [fromVideo, setFromVideo] = useState(0);
  /** The button that opens sharing for one thing, saying how many people have it already. */
  const shareButton = (what: Shared) => {
    const n = film?.shares.filter((s) => s.kind === what.kind && s.ref_id === what.id).length ?? 0;
    return (
      <button type="button" className="btn small icon-btn film-share-btn" onClick={() => setSharing(what)} aria-label={`Share ${what.title}${n ? `. Shared with ${n} ${n === 1 ? 'person' : 'people'}` : ''}`} title={n ? `Share. Shared with ${n} ${n === 1 ? 'person' : 'people'} so far` : 'Share'}>
        <ShareIcon size={17} />
        {n > 0 && <span className="cm-count">{n}</span>}
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
  const words = q.trim().toLowerCase();
  const has = (...texts: (string | undefined)[]) => !words || texts.some((t) => (t || '').toLowerCase().includes(words));
  const videos = (film?.videos ?? []).filter((v) => has(v.title, v.by));
  const clips = (film?.clips ?? []).filter((c) => (!fromVideo || c.stream_id === fromVideo) && has(c.title, c.notes, videoOf(c.stream_id)?.title));
  const reels = (film?.reels ?? []).filter((r) => has(r.title, r.notes));
  const choose = (t: Tab) => (setNotice(''), setParams(t === 'games' ? {} : { tab: t }, { replace: true }));
  const none = <p className="muted">Nothing matches.</p>;
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
      <div className="ps-layout">
        {/* Down the left: the search, which part of the Filmroom is showing, and for clips the game video they came from. */}
        <aside className="card ps-side tall" aria-label="Search and filters">
          <section>
            <h2>Search</h2>
            <input className="input" type="search" placeholder="Search film" aria-label="Search by title or notes" value={q} onChange={(e) => setQ(e.target.value)} />
          </section>
          <section>
            <h2>Show</h2>
            <div className="ps-side-filter" role="group" aria-label="Parts of the Filmroom">
              {(
                [
                  ['games', 'Game videos', film?.videos.length],
                  ['clips', 'Clips', film?.clips.length],
                  ['videos', 'Cuts', film?.reels.length],
                ] as [Tab, string, number | undefined][]
              ).map(([id, label, n]) => (
                <button key={id} type="button" className={tab === id ? 'on' : ''} aria-pressed={tab === id} onClick={() => choose(id)}>
                  <span>{label}</span>
                  <span className="ps-side-count">{n ?? ''}</span>
                </button>
              ))}
            </div>
          </section>
          {tab === 'clips' && film && (
            <SideChoices
              title="From game video"
              all={0}
              allLabel="All videos"
              total={film.clips.length}
              value={fromVideo}
              onChange={setFromVideo}
              items={film.videos.map((v) => ({ id: v.id, label: v.title || 'Game video', count: film.clips.filter((c) => c.stream_id === v.id).length })).filter((v) => v.count > 0)}
            />
          )}
        </aside>
        <div className="ps-main">
      {!film ? (
        <p className="muted">Loading…</p>
      ) : tab === 'games' ? (
        film.videos.length === 0 ? (
          <div className="empty">
            <h2>No game video yet</h2>
            <p>Broadcast a game from its Video tab and choose to save it to Dime Coach. It shows here afterwards, ready to watch and cut into clips.</p>
          </div>
        ) : videos.length === 0 ? (
          none
        ) : (
          <div className="res-grid">
            {videos.map((v) => (
              <GameVideoCard key={v.id} stream={v} playLabel="Open" onPlay={() => navigate(`/filmroom/video/${v.id}`)}>
                <span className="muted small film-card-count">
                  {film.clips.filter((c) => c.stream_id === v.id).length || 'No'} clip{film.clips.filter((c) => c.stream_id === v.id).length === 1 ? '' : 's'}
                  {canClip(v) ? '' : ' · watch only'}
                </span>
                {shareButton({ kind: 'video', id: v.id, title: v.title || 'Game video' })}
                <button type="button" className="btn small icon-btn danger res-remove" aria-label={`Delete ${v.title || 'Game video'}`} title="Delete" onClick={() => removeVideo(v)}>
                  <BinIcon />
                </button>
              </GameVideoCard>
            ))}
          </div>
        )
      ) : tab === 'clips' ? (
        film.clips.length === 0 ? (
          <div className="empty">
            <h2>No clips yet</h2>
            <p>Open a game video, press Start clip where something begins and End clip where it ends, and give it a title.</p>
          </div>
        ) : clips.length === 0 ? (
          none
        ) : (
          <div className="res-grid">
            {clips.map((c) => (
              <FilmCard key={c.id} poster={videoOf(c.stream_id)?.has_poster ? c.stream_id : null} length={clock(c.seconds)} title={c.title} meta={`From ${videoOf(c.stream_id)?.title || 'a game video'} · ${day(c.created_at)}`} notes={c.notes} onPlay={() => setWatching(c)}>
                <button type="button" className="btn small" onClick={() => setWatching(c)}>
                  Play
                </button>
                <button type="button" className="btn small" onClick={() => setEditing(c)}>
                  Edit
                </button>
                {shareButton({ kind: 'clip', id: c.id, title: c.title })}
                <button type="button" className="btn small icon-btn danger res-remove" aria-label={`Delete ${c.title}`} title="Delete" onClick={() => removeClip(c)}>
                  <BinIcon />
                </button>
              </FilmCard>
            ))}
          </div>
        )
      ) : film.reels.length === 0 ? (
        <div className="empty">
          <h2>No cuts yet</h2>
          <p>Put clips and game videos together, in the order you want, into a cut of your own.</p>
          <Link className="btn primary" to="/filmroom/new">
            <CutIcon /> Create a new cut
          </Link>
        </div>
      ) : reels.length === 0 ? (
        none
      ) : (
        <div className="res-grid">
          {reels.map((r) => {
            const list = scenes(film, r.items.map(stripItem));
            return (
              <FilmCard key={r.id} poster={list.find((s) => s.stream.has_poster)?.stream.id ?? null} length={clock(list.reduce((n, s) => n + s.seconds, 0))} title={r.title} meta={`${list.length} part${list.length === 1 ? '' : 's'} · ${day(r.updated_at)}`} notes={r.notes} onPlay={() => setShowing({ reel: r, at: 0 })}>
                <button type="button" className="btn small" onClick={() => setShowing({ reel: r, at: 0 })}>
                  Play
                </button>
                <Link className="btn small" to={`/filmroom/reel/${r.id}`}>
                  Edit
                </Link>
                {shareButton({ kind: 'reel', id: r.id, title: r.title })}
                <button type="button" className="btn small icon-btn danger res-remove" aria-label={`Delete ${r.title}`} title="Delete" onClick={() => removeReel(r)}>
                  <BinIcon />
                </button>
              </FilmCard>
            );
          })}
        </div>
      )}
        </div>
      </div>

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
