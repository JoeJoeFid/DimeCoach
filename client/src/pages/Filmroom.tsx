// The Filmroom: a team's saved game video, the clips cut from it, and the videos put together
// out of clips. One list at a time; a game video opens in the editor, where clips are made.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Film, type FilmClip, type FilmReel } from '../api';
import { useApp } from '../App';
import PageTitle from '../components/PageTitle';
import { Field, Modal } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { GameVideoCard } from '../components/GameVideo';
import { FilmPlayer, ReelPlayer, canClip, clock, scenes, stripItem } from '../components/Film';

type Tab = 'games' | 'clips' | 'videos';
const day = (at: string) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

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
  const { team } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'clips' ? 'clips' : params.get('tab') === 'videos' ? 'videos' : 'games';
  const [film, setFilm] = useState<Film | null>(null);
  const [error, setError] = useState('');
  const [watching, setWatching] = useState<FilmClip | null>(null);
  const [showing, setShowing] = useState<{ reel: FilmReel; at: number } | null>(null);
  const [editing, setEditing] = useState<FilmClip | null>(null);
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
    if (!(await confirmDialog({ title: 'Delete this clip?', body: `"${c.title}" is deleted${used ? `, and taken out of the ${used === 1 ? 'video' : `${used} videos`} it is in` : ''}. The game video it was cut from is not touched.`, confirmLabel: 'Delete', danger: true }))) return;
    api.deleteClip(c.id).then(setFilm, failed);
  };
  const removeReel = async (r: FilmReel) => {
    if (!(await confirmDialog({ title: 'Delete this video?', body: `"${r.title}" is deleted. Its clips and the game videos they came from are not touched.`, confirmLabel: 'Delete', danger: true }))) return;
    api.deleteReel(r.id).then(setFilm, failed);
  };
  const videoOf = (id: number) => film?.videos.find((v) => v.id === id);
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'games', label: 'Game videos', n: film?.videos.length ?? 0 },
    { key: 'clips', label: 'Clips', n: film?.clips.length ?? 0 },
    { key: 'videos', label: 'Videos', n: film?.reels.length ?? 0 },
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle>Filmroom</PageTitle>
          <p className="muted">Saved game video, the clips you cut from it, and the videos you put together: film review, highlights, scouting.</p>
        </div>
        <Link className="btn primary" to="/filmroom/new">
          Create a new video
        </Link>
      </div>
      <div className="cx-subtabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setParams(t.key === 'games' ? {} : { tab: t.key }, { replace: true })}>
            {t.label} <span className="muted small">{t.n}</span>
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!film ? (
        <p className="muted">Loading…</p>
      ) : tab === 'games' ? (
        film.videos.length === 0 ? (
          <div className="empty">
            <h2>No game video yet</h2>
            <p>Broadcast a game from its Video tab and choose to save it to Dime Coach. It shows here afterwards, ready to watch and cut into clips.</p>
          </div>
        ) : (
          <div className="res-grid">
            {film.videos.map((v) => (
              <GameVideoCard key={v.id} stream={v} playLabel="Open" onPlay={() => navigate(`/filmroom/video/${v.id}`)}>
                <span className="muted small film-card-count">
                  {film.clips.filter((c) => c.stream_id === v.id).length || 'No'} clip{film.clips.filter((c) => c.stream_id === v.id).length === 1 ? '' : 's'}
                  {canClip(v) ? '' : ' · watch only'}
                </span>
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
        ) : (
          <div className="res-grid">
            {film.clips.map((c) => (
              <FilmCard key={c.id} poster={videoOf(c.stream_id)?.has_poster ? c.stream_id : null} length={clock(c.seconds)} title={c.title} meta={`From ${videoOf(c.stream_id)?.title || 'a game video'} · ${day(c.created_at)}`} notes={c.notes} onPlay={() => setWatching(c)}>
                <button type="button" className="btn small" onClick={() => setWatching(c)}>
                  Play
                </button>
                <button type="button" className="btn small" onClick={() => setEditing(c)}>
                  Edit
                </button>
                <button type="button" className="btn small res-remove" onClick={() => removeClip(c)}>
                  Delete
                </button>
              </FilmCard>
            ))}
          </div>
        )
      ) : film.reels.length === 0 ? (
        <div className="empty">
          <h2>No videos yet</h2>
          <p>Put clips and game videos together, in the order you want, into a video of your own.</p>
          <Link className="btn primary" to="/filmroom/new">
            Create a new video
          </Link>
        </div>
      ) : (
        <div className="res-grid">
          {film.reels.map((r) => {
            const list = scenes(film, r.items.map(stripItem));
            return (
              <FilmCard key={r.id} poster={list.find((s) => s.stream.has_poster)?.stream.id ?? null} length={clock(list.reduce((n, s) => n + s.seconds, 0))} title={r.title} meta={`${list.length} part${list.length === 1 ? '' : 's'} · ${day(r.updated_at)}`} notes={r.notes} onPlay={() => setShowing({ reel: r, at: 0 })}>
                <button type="button" className="btn small" onClick={() => setShowing({ reel: r, at: 0 })}>
                  Play
                </button>
                <Link className="btn small" to={`/filmroom/reel/${r.id}`}>
                  Edit
                </Link>
                <button type="button" className="btn small res-remove" onClick={() => removeReel(r)}>
                  Delete
                </button>
              </FilmCard>
            );
          })}
        </div>
      )}

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
          <ReelPlayer scenes={scenes(film, showing.reel.items.map((i, k) => ({ ...i, key: `r${k}` })))} at={showing.at} onAt={(at) => setShowing({ ...showing, at })} />
          {showing.reel.notes && <p className="film-notes">{showing.reel.notes}</p>}
        </Modal>
      )}
      {editing && <ClipForm clip={editing} onClose={() => setEditing(null)} onSaved={(f) => (setFilm(f), setEditing(null))} />}
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
