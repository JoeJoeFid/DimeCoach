// Putting a cut together in the Filmroom: clips and whole game videos, from any of the team's
// games, set down on a timeline in the order they will play. A new one, or one made before.
// The player and the timeline are on the left; everything that can go into the cut is on the
// right, to search, press or drag.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Film } from '../api';
import { useApp } from '../App';
import { Field } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { FilmRow, ReelPlayer, Strip, TheaterButton, canClip, clock, scenes, stripItem, stripSeconds, useTheater, type StripItem } from '../components/Film';

const day = (at: string) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

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
  const [find, setFind] = useState('');
  const [dirty, setDirty] = useState(false);
  const [theater, toggleTheater] = useTheater();
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
          This cut is not in the Filmroom. <Link to="/filmroom?tab=videos">Back to the Filmroom</Link>
        </p>
      </div>
    );
  const list = scenes(film, strip);
  const touched = () => (setDirty(true), setNotice(''));
  const change = (items: StripItem[]) => {
    setStrip(items);
    touched();
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
    if (!(await confirmDialog({ title: `Delete the cut "${title}"?`, body: 'Its clips and the game videos they came from are not touched.', confirmLabel: 'Delete cut', danger: true }))) return;
    api.deleteReel(id).then(() => navigate('/filmroom?tab=videos'), failed);
  };
  // What can go into the cut, narrowed to what was typed: a clip by its title, its notes or the game it is from; a game by its title or date.
  const words = find.trim().toLowerCase();
  const has = (...texts: string[]) => !words || texts.some((t) => t.toLowerCase().includes(words));
  const videoOf = (streamId: number) => film.videos.find((v) => v.id === streamId);
  const clips = film.clips.filter((c) => has(c.title, c.notes, videoOf(c.stream_id)?.title ?? ''));
  const videos = film.videos.filter((v) => has(v.title || 'Game video', day(v.started_at)));
  type Item = { clip_id: number | null; stream_id: number | null };
  const same = (i: StripItem, item: Item) => (item.clip_id ? i.clip_id === item.clip_id : !i.clip_id && i.stream_id === item.stream_id);
  /** The button on a row: puts it on the end of the timeline, or takes it off when it is there. */
  const addButton = (item: Item, off?: boolean) => {
    const on = strip.some((i) => same(i, item));
    return (
      <button
        type="button"
        className={`btn small fr-add ${on ? 'in' : ''}`}
        aria-pressed={on}
        disabled={off}
        onClick={() => (on ? change(strip.filter((i) => !same(i, item))) : add(item))}
        title={on ? 'On the timeline. Press to take it off. To use it twice, drag it onto the timeline again.' : 'Put it on the end of the timeline'}
      >
        {on ? 'In cut ✓' : '+ Cut'}
      </button>
    );
  };
  return (
    <div className={`page film-editor ${theater ? 'theater' : ''}`}>
      <p className="film-back">
        <Link to="/filmroom?tab=videos">← Filmroom</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{id ? title || 'Cut' : 'New cut'}</h1>
          <p className="muted">
            {list.length === 0 ? 'Add clips and game videos from the list, in the order they should play.' : `${list.length} part${list.length === 1 ? '' : 's'} · ${clock(stripSeconds(film, strip))}`}
            {dirty && list.length > 0 && ' · not saved yet'}
            {list.length > 0 && !title.trim() && ' · give it a title below to save it'}
          </p>
        </div>
        <div className="film-head-acts">
          <TheaterButton on={theater} onClick={toggleTheater} />
          {id > 0 && (
            <button type="button" className="btn" onClick={remove}>
              Delete
            </button>
          )}
          <button type="button" className="btn primary" disabled={!title.trim() || list.length === 0} onClick={save}>
            {id ? 'Save changes' : 'Save cut'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <div className={`film-layout ${theater ? 'theater' : ''}`}>
        <div className="film-main">
          {list.length > 0 ? (
            <ReelPlayer scenes={list} at={Math.min(at, list.length - 1)} onAt={setAt} pause={{ seconds: pauseSeconds, notes: pauseNotes }} />
          ) : (
            <div className="card film-blank">
              <p className="muted">The cut plays here once it has something in it.</p>
            </div>
          )}
          <div className="card film-new">
            <div className="tl2-head">
              <h2>
                Timeline <span className="muted small">Drag to reorder. Click a part to play from there.</span>
              </h2>
              {list.length > 0 && (
                <span className="muted small">
                  {list.length} part{list.length === 1 ? '' : 's'} · {clock(stripSeconds(film, strip))}
                </span>
              )}
            </div>
            <Strip film={film} items={strip} at={at} onChange={change} onPlay={setAt} pause={pauseSeconds} onAdd={add} />
          </div>
          <div className="card film-new film-details">
            <h2>About this cut</h2>
            <Field label="Title">
              <input className="input" value={title} maxLength={120} placeholder="Film review, highlights, scouting…" onChange={(e) => (setTitle(e.target.value), touched())} />
            </Field>
            <Field label="Notes">
              <textarea className="input" rows={2} value={notes} maxLength={2000} placeholder="What this cut is for." onChange={(e) => (setNotes(e.target.value), touched())} />
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
                  onChange={(e) => (setPauseSeconds(Math.max(0, Math.min(60, Math.round(Number(e.target.value)) || 0))), touched())}
                />
                <span className="muted small">{pauseSeconds > 0 ? 'seconds, on a screen that counts down' : 'seconds. 0 plays straight through.'}</span>
              </span>
            </Field>
            <label className={`film-pause-show ${pauseSeconds > 0 ? '' : 'off'}`}>
              <input type="checkbox" checked={pauseSeconds > 0 && pauseNotes} disabled={pauseSeconds === 0} onChange={(e) => (setPauseNotes(e.target.checked), touched())} /> Show the next part's title and notes on that screen
            </label>
          </div>
        </div>
        <div className="card film-side">
          <h2>Add to the cut</h2>
          <input className="input fr-find" type="search" value={find} placeholder="Search clips and game videos" aria-label="Search clips and game videos" onChange={(e) => setFind(e.target.value)} />
          <div className="cx-subtabs" role="tablist">
            <button type="button" role="tab" aria-selected={from === 'clips'} className={from === 'clips' ? 'on' : ''} onClick={() => setFrom('clips')}>
              Clips <span className="muted small">{clips.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={from === 'games'} className={from === 'games' ? 'on' : ''} onClick={() => setFrom('games')}>
              Game videos <span className="muted small">{videos.length}</span>
            </button>
          </div>
          {from === 'clips' ? (
            film.clips.length === 0 ? (
              <p className="muted">
                No clips yet. Open a game video in the <Link to="/filmroom">Filmroom</Link> to cut some.
              </p>
            ) : clips.length === 0 ? (
              <p className="muted small">No clip matches "{find.trim()}".</p>
            ) : (
              <div className="fr-list">
                {clips.map((c) => {
                  const v = videoOf(c.stream_id);
                  return (
                    <FilmRow key={c.id} poster={v?.has_poster ? v.id : null} length={clock(c.seconds)} title={c.title} meta={`From ${v?.title || 'a game video'}${v ? ` · ${day(v.started_at)}` : ''}`} notes={c.notes} drag={{ clip_id: c.id, stream_id: null }}>
                      {addButton({ clip_id: c.id, stream_id: null })}
                    </FilmRow>
                  );
                })}
              </div>
            )
          ) : film.videos.length === 0 ? (
            <p className="muted">No game video has been saved yet.</p>
          ) : videos.length === 0 ? (
            <p className="muted small">No game video matches "{find.trim()}".</p>
          ) : (
            <div className="fr-list">
              {videos.map((v) => (
                <FilmRow
                  key={v.id}
                  poster={v.has_poster ? v.id : null}
                  length={clock(v.seconds)}
                  title={v.title || 'Game video'}
                  meta={`The whole game · ${day(v.started_at)}${canClip(v) ? '' : ' · recorded the older way, so it cannot be used here'}`}
                  drag={canClip(v) ? { clip_id: null, stream_id: v.id } : undefined}
                >
                  {addButton({ clip_id: null, stream_id: v.id }, !canClip(v))}
                </FilmRow>
              ))}
            </div>
          )}
          <p className="muted small fr-hint">Press + Cut to put one on the end of the timeline, or drag it there.</p>
        </div>
      </div>
    </div>
  );
}
