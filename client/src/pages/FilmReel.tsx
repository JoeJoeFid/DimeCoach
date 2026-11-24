// Putting a video together in the Filmroom: clips and whole game videos, from any of the team's
// games, set down on a strip in the order they will play. A new one, or one made before.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Film } from '../api';
import { useApp } from '../App';
import { Field } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { ReelPlayer, Strip, canClip, clock, scenes, stripItem, stripSeconds, type StripItem } from '../components/Film';

export default function FilmReel() {
  const { team } = useApp();
  const navigate = useNavigate();
  const id = Number(useParams().id) || 0;
  const [film, setFilm] = useState<Film | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [strip, setStrip] = useState<StripItem[]>([]);
  // The pause between one part and the next: none at 0 seconds.
  const [pauseSeconds, setPauseSeconds] = useState(0);
  const [pauseNotes, setPauseNotes] = useState(false);
  const [at, setAt] = useState(0);
  const [from, setFrom] = useState<'clips' | 'games'>('clips');
  const [dirty, setDirty] = useState(false);
  const failed = (e: unknown) => setError((e as Error).message);
  /** Takes what was saved as what is on the page. */
  const take = (f: Film, reelId: number) => {
    setFilm(f);
    const r = f.reels.find((x) => x.id === reelId);
    if (r) {
      setTitle(r.title);
      setNotes(r.notes);
      setStrip(r.items.map(stripItem));
      setPauseSeconds(r.pause_seconds);
      setPauseNotes(r.pause_notes);
    }
    setDirty(false);
  };
  const load = useCallback(() => {
    if (team) api.film(team.id).then((f) => take(f, id), failed);
  }, [team, id]);
  useEffect(load, [load]);
  if (!team) return null;
  if (!film) return <div className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;
  if (id && !film.reels.some((r) => r.id === id))
    return (
      <div className="page">
        <p className="muted">
          This video is not in the Filmroom. <Link to="/filmroom?tab=videos">Back to the Filmroom</Link>
        </p>
      </div>
    );
  const list = scenes(film, strip);
  const change = (items: StripItem[]) => {
    setStrip(items);
    setDirty(true);
    setNotice('');
  };
  const add = (item: { clip_id: number | null; stream_id: number | null }) => change([...strip, stripItem({ ...item, show_notes: false })]);
  const save = async () => {
    const body = { title, notes, pause_seconds: pauseSeconds, pause_notes: pauseSeconds > 0 && pauseNotes, items: list.map((s) => ({ clip_id: s.clip?.id ?? null, stream_id: s.clip ? null : s.stream.id, show_notes: s.show })) };
    try {
      const r = id ? await api.saveReel(id, body) : await api.addReel({ team_id: team.id, ...body });
      setError('');
      if (!id) return navigate(`/filmroom/reel/${r.id}`, { replace: true });
      take(r, id);
      setNotice('Saved.');
    } catch (e) {
      failed(e);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Delete this video?', body: `"${title}" is deleted. Its clips and the game videos they came from are not touched.`, confirmLabel: 'Delete', danger: true }))) return;
    api.deleteReel(id).then(() => navigate('/filmroom?tab=videos'), failed);
  };
  return (
    <div className="page film-editor">
      <p className="film-back">
        <Link to="/filmroom?tab=videos">← Filmroom</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{id ? title || 'Video' : 'New video'}</h1>
          <p className="muted">
            {list.length === 0 ? 'Add clips and game videos below, in the order they should play.' : `${list.length} part${list.length === 1 ? '' : 's'} · ${clock(stripSeconds(film, strip))}`}
            {dirty && list.length > 0 && ' · not saved yet'}
          </p>
        </div>
        <div className="film-head-acts">
          {id > 0 && (
            <button type="button" className="btn" onClick={remove}>
              Delete
            </button>
          )}
          <button type="button" className="btn primary" disabled={!title.trim() || list.length === 0} onClick={save}>
            {id ? 'Save changes' : 'Save video'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <div className="film-layout">
        <div className="film-main">
          {list.length > 0 ? (
            <ReelPlayer scenes={list} at={Math.min(at, list.length - 1)} onAt={setAt} pause={{ seconds: pauseSeconds, notes: pauseNotes }} />
          ) : (
            <div className="card film-blank">
              <p className="muted">The video plays here once it has something in it.</p>
            </div>
          )}
        </div>
        <div className="card film-side">
          <Field label="Title">
            <input className="input" value={title} maxLength={120} placeholder="Film review, highlights, scouting…" onChange={(e) => (setTitle(e.target.value), setDirty(true), setNotice(''))} />
          </Field>
          <Field label="Notes">
            <textarea className="input" rows={3} value={notes} maxLength={2000} placeholder="What this video is for." onChange={(e) => (setNotes(e.target.value), setDirty(true), setNotice(''))} />
          </Field>
          <Field label="Pause between parts">
            <span className="film-pause-set">
              <input
                className="input"
                type="number"
                min={0}
                max={60}
                step={1}
                aria-label="Seconds of pause between parts"
                value={pauseSeconds || ''}
                placeholder="0"
                onChange={(e) => (setPauseSeconds(Math.max(0, Math.min(60, Math.round(Number(e.target.value)) || 0))), setDirty(true), setNotice(''))}
              />
              <span className="muted small">{pauseSeconds > 0 ? 'seconds, on a screen that counts down' : 'seconds. 0 plays straight through.'}</span>
            </span>
          </Field>
          <label className={`film-pause-show ${pauseSeconds > 0 ? '' : 'off'}`}>
            <input type="checkbox" checked={pauseSeconds > 0 && pauseNotes} disabled={pauseSeconds === 0} onChange={(e) => (setPauseNotes(e.target.checked), setDirty(true), setNotice(''))} /> Show the next part's title and notes on that screen
          </label>
        </div>
      </div>
      <div className="card film-new">
        <h2>The video, in order</h2>
        <p className="muted small">Drag a part by its number to move it. "Show notes" puts the clip's title and notes over the picture while it plays.</p>
        <Strip film={film} items={strip} at={at} onChange={change} onPlay={setAt} />
      </div>
      <div className="card film-pick">
        <h2>Add to the video</h2>
        <div className="cx-subtabs" role="tablist">
          <button type="button" role="tab" aria-selected={from === 'clips'} className={from === 'clips' ? 'on' : ''} onClick={() => setFrom('clips')}>
            Clips <span className="muted small">{film.clips.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={from === 'games'} className={from === 'games' ? 'on' : ''} onClick={() => setFrom('games')}>
            Game videos <span className="muted small">{film.videos.length}</span>
          </button>
        </div>
        {from === 'clips' ? (
          film.clips.length === 0 ? (
            <p className="muted">
              No clips yet. Open a game video in the <Link to="/filmroom">Filmroom</Link> to cut some.
            </p>
          ) : (
            <ul className="film-clips film-sources">
              {film.clips.map((c) => (
                <li key={c.id}>
                  <span className="film-clip-play">
                    <strong>{c.title}</strong>
                    <span className="muted small">
                      {clock(c.seconds)} · from {film.videos.find((v) => v.id === c.stream_id)?.title || 'a game video'}
                    </span>
                    {c.notes && <span className="film-notes">{c.notes}</span>}
                  </span>
                  <button type="button" className="btn small" onClick={() => add({ clip_id: c.id, stream_id: null })}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : film.videos.length === 0 ? (
          <p className="muted">No game video has been saved yet.</p>
        ) : (
          <ul className="film-clips film-sources">
            {film.videos.map((v) => (
              <li key={v.id}>
                <span className="film-clip-play">
                  <strong>{v.title || 'Game video'}</strong>
                  <span className="muted small">
                    The whole video · {clock(v.seconds)} · {new Date(v.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {canClip(v) ? '' : ' · recorded the older way, so it cannot be used here'}
                  </span>
                </span>
                <button type="button" className="btn small" disabled={!canClip(v)} onClick={() => add({ clip_id: null, stream_id: v.id })}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
