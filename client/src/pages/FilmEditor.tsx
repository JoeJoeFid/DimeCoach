// One game video, to watch and to cut into clips. Start clip and End clip mark two moments;
// the clip gets a title and notes and is saved to the Filmroom. Beside the player are the video
// itself and the clips cut from it, with the one being watched marked. Each clip made here is
// also set down on a timeline at the bottom, where they can be put in order and saved as a cut.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Film, type FilmClip, type FilmMark } from '../api';
import { useApp } from '../App';
import { Field, MoreMenu } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { FilmPlayer, FilmRow, ReelPlayer, Strip, TheaterButton, canClip, clock, markSeconds, scenes, stripItem, stripSeconds, useTheater, type FilmHandle, type StripItem } from '../components/Film';
import { ClipForm } from './Filmroom';

export default function FilmEditor() {
  const { team } = useApp();
  const navigate = useNavigate();
  const streamId = Number(useParams().id);
  const [film, setFilm] = useState<Film | null>(null);
  const [error, setError] = useState('');
  const player = useRef<FilmHandle>(null);
  const [theater, toggleTheater] = useTheater();
  // What the player is showing: the whole video, or one clip of it. The cut on the timeline is a third thing, said by `stripAt`.
  const [now, setNow] = useState<'video' | number>('video');
  // A clip being made: where it starts, then where it ends, then its title and notes.
  const [from, setFrom] = useState<{ mark: FilmMark; time: number; moves: number } | null>(null);
  const [draft, setDraft] = useState<{ start: FilmMark; end: FilmMark; seconds: number } | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState<FilmClip | null>(null);
  // The cut being put together from this game's clips.
  const [strip, setStrip] = useState<StripItem[]>([]);
  const [stripAt, setStripAt] = useState(-1);
  const [reelTitle, setReelTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const failed = (e: unknown) => setError((e as Error).message);
  const load = useCallback(() => {
    if (team) api.film(team.id).then(setFilm, failed);
  }, [team]);
  useEffect(load, [load]);
  if (!team) return null;
  if (!film) return <div className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;
  const video = film.videos.find((v) => v.id === streamId);
  if (!video)
    return (
      <div className="page">
        <p className="muted">
          This video is not in the Filmroom. <Link to="/filmroom">Back to the Filmroom</Link>
        </p>
      </div>
    );
  const clips = film.clips.filter((c) => c.stream_id === video.id).sort((a, b) => a.start.n - b.start.n || a.start.off - b.start.off);
  const cuttable = canClip(video);
  const poster = video.has_poster ? video.id : null;
  const onCut = stripAt >= 0;

  const startClip = () => {
    const p = player.current;
    if (p) setFrom({ mark: p.mark(), time: p.time(), moves: p.moves() });
    setError('');
  };
  const endClip = () => {
    const p = player.current;
    if (!p || !from) return;
    const end = p.mark();
    if (end.n < from.mark.n || (end.n === from.mark.n && end.off <= from.mark.off + 0.2)) return setError('The clip has to end after it starts. Play on a little, then press End clip.');
    p.pause();
    // Played straight through from start to end, the player's own clock says how long. Moved in between, the marks say about how long.
    const seconds = p.moves() === from.moves ? p.time() - from.time : markSeconds(end, video) - markSeconds(from.mark, video);
    setDraft({ start: from.mark, end, seconds: Math.max(0.2, seconds) });
    setTitle(`Clip ${clips.length + 1}`);
    setNotes('');
    setError('');
  };
  const saveClip = async () => {
    if (!draft) return;
    try {
      const next = await api.addClip({ stream_id: video.id, title, notes, start: draft.start, end: draft.end, seconds: draft.seconds });
      // The newest clip is the one just made: it goes on the end of the timeline.
      const made = next.clips.reduce((a, c) => (c.id > a.id ? c : a), next.clips[0]);
      setFilm(next);
      setStrip((s) => [...s, stripItem({ clip_id: made.id, stream_id: null, show_notes: false })]);
      setDraft(null);
      setFrom(null);
    } catch (e) {
      failed(e);
    }
  };
  const removeClip = async (c: FilmClip) => {
    if (!(await confirmDialog({ title: `Delete the clip "${c.title}"?`, body: `It was cut from ${video.title || 'this game video'}, which is not touched.`, confirmLabel: 'Delete clip', danger: true }))) return;
    if (now === c.id) setNow('video');
    api.deleteClip(c.id).then(setFilm, failed);
  };
  const saveReel = async () => {
    setSaving(true);
    try {
      const r = await api.addReel({ team_id: team.id, title: reelTitle, notes: '', items: scenes(film, strip).map((s) => ({ clip_id: s.clip?.id ?? null, stream_id: s.clip ? null : s.stream.id, show_notes: s.show })) });
      navigate(`/filmroom/reel/${r.id}`);
    } catch (e) {
      failed(e);
      setSaving(false);
    }
  };
  /** Plays one clip in the player, in place of whatever it was showing. */
  const playClip = (c: FilmClip) => {
    setStripAt(-1);
    setNow(c.id);
    // The player may only now be coming back from showing the cut.
    window.setTimeout(() => player.current?.play(c.start, c.end), 0);
  };
  /** Back to the whole video: from the cut it starts afresh, and from a clip it carries on from where the clip left off. */
  const playVideo = () => {
    if (onCut) setStripAt(-1);
    else if (now !== 'video') {
      const p = player.current;
      if (p) p.play(p.mark());
    }
    setNow('video');
  };
  const inCut = (c: FilmClip) => strip.some((i) => i.clip_id === c.id);
  const toCut = (c: FilmClip) => setStrip((s) => (inCut(c) ? s.filter((i) => i.clip_id !== c.id) : [...s, stripItem({ clip_id: c.id, stream_id: null, show_notes: false })]));
  const onStrip = scenes(film, strip);
  return (
    <div className={`page film-editor ${theater ? 'theater' : ''}`}>
      <p className="film-back">
        <Link to="/filmroom">← Filmroom</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{video.title || 'Game video'}</h1>
          <p className="muted">
            {new Date(video.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {clock(video.seconds)} · from {video.by}
            {video.game && (
              <>
                {' '}
                · <Link to={`/plans/${video.game.id}?view=video`}>Open the game</Link>
              </>
            )}
          </p>
        </div>
        <TheaterButton on={theater} onClick={toggleTheater} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className={`film-layout ${theater ? 'theater' : ''}`}>
        <div className="film-main">
          {onCut && onStrip.length > 0 ? (
            <>
              <ReelPlayer scenes={onStrip} at={Math.min(stripAt, onStrip.length - 1)} onAt={setStripAt} />
              <div className="gv-actions">
                <button type="button" className="btn" onClick={playVideo}>
                  Back to the game video
                </button>
              </div>
            </>
          ) : (
            <>
              <FilmPlayer ref={player} stream={video} />
              {!cuttable ? (
                <p className="muted small">This video was recorded in separate pieces, the older way, so it can be watched here but not cut into clips. Video broadcast from now on can be.</p>
              ) : draft ? (
                <form
                  className="card film-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveClip();
                  }}
                >
                  <h2>
                    New clip <span className="muted small">{clock(markSeconds(draft.start, video))} to {clock(markSeconds(draft.end, video))} · {clock(draft.seconds)} long</span>
                  </h2>
                  <Field label="Title">
                    <input className="input" value={title} maxLength={120} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setTitle(e.target.value)} />
                  </Field>
                  <Field label="Notes">
                    <textarea className="input" rows={3} value={notes} maxLength={2000} placeholder="What to look for. These can be shown over the clip in a cut." onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                  <div className="gv-actions">
                    <button type="submit" className="btn primary" disabled={!title.trim()}>
                      Save clip
                    </button>
                    <button type="button" className="btn" onClick={() => player.current?.play(draft.start, draft.end)}>
                      Play it
                    </button>
                    <button type="button" className="btn" onClick={() => (setDraft(null), setFrom(null))}>
                      Discard
                    </button>
                  </div>
                </form>
              ) : (
                <div className="gv-actions film-cut">
                  <button type="button" className="btn" onClick={() => player.current?.nudge(-5)} aria-label="Back 5 seconds">
                    −5s
                  </button>
                  <button type="button" className="btn" onClick={() => player.current?.nudge(5)} aria-label="Forward 5 seconds">
                    +5s
                  </button>
                  {from ? (
                    <>
                      <button type="button" className="btn primary" onClick={endClip}>
                        End clip
                      </button>
                      <button type="button" className="btn" onClick={() => setFrom(null)}>
                        Cancel
                      </button>
                      <span className="muted small">Clip started at {clock(markSeconds(from.mark, video))}. Press End clip where it should stop.</span>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn primary" onClick={startClip}>
                        Start clip
                      </button>
                      <span className="muted small">Press where a clip should begin, while playing or paused.</span>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="card film-side">
          <h2>This video</h2>
          <div className="fr-list">
            <FilmRow
              poster={poster}
              length={clock(video.seconds)}
              title={video.title || 'Game video'}
              meta={`The whole game · ${new Date(video.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
              now={!onCut && now === 'video'}
              onPlay={playVideo}
            />
          </div>
          <h2 className="fr-head">
            Clips <span className="muted small">{clips.length}</span>
          </h2>
          {clips.length === 0 ? (
            <p className="muted small">None yet. Each clip you cut shows here, under the video it came from.</p>
          ) : (
            <>
              <div className="fr-list">
                {clips.map((c) => (
                  <FilmRow
                    key={c.id}
                    poster={poster}
                    length={clock(c.seconds)}
                    title={c.title}
                    meta={`Starts at ${clock(markSeconds(c.start, video))}`}
                    notes={c.notes}
                    now={!onCut && now === c.id}
                    onPlay={() => playClip(c)}
                    drag={{ clip_id: c.id, stream_id: null }}
                  >
                    <button type="button" className={`btn small fr-add ${inCut(c) ? 'in' : ''}`} aria-pressed={inCut(c)} onClick={() => toCut(c)} title={inCut(c) ? 'On the timeline. Press to take it off.' : 'Put it on the timeline below'}>
                      {inCut(c) ? 'In cut ✓' : '+ Cut'}
                    </button>
                    <MoreMenu
                      label={`More for ${c.title}`}
                      items={[
                        { label: 'Edit the title and notes', onSelect: () => setEditing(c) },
                        { label: 'Delete', onSelect: () => removeClip(c), danger: true },
                      ]}
                    />
                  </FilmRow>
                ))}
              </div>
              <p className="muted small fr-hint">Click a clip to watch it. Drag one onto the timeline below, or press + Cut.</p>
            </>
          )}
        </div>
      </div>
      {cuttable && (
        <div className="card film-new">
          <div className="tl2-head">
            <h2>
              Timeline <span className="muted small">Drag to reorder. Each clip you make is set down here.</span>
            </h2>
            {onStrip.length > 0 && (
              <span className="muted small">
                {onStrip.length} clip{onStrip.length === 1 ? '' : 's'} · {clock(stripSeconds(film, strip))}
              </span>
            )}
          </div>
          <Strip film={film} items={strip} at={stripAt} onChange={setStrip} onPlay={setStripAt} onAdd={(item) => setStrip((s) => [...s, stripItem({ ...item, show_notes: false })])} />
          {onStrip.length > 0 && (
            <div className="gv-actions">
              <input className="input film-reel-title" value={reelTitle} maxLength={120} placeholder="Title for the new cut" aria-label="Title for the new cut" onChange={(e) => setReelTitle(e.target.value)} />
              <button type="button" className="btn primary" disabled={!reelTitle.trim() || saving} onClick={saveReel}>
                Save as a cut
              </button>
              <button type="button" className="btn" onClick={() => setStripAt(0)}>
                Play it through
              </button>
              <span className="muted small">To mix in clips from other games, use "Create a new cut" in the Filmroom.</span>
            </div>
          )}
        </div>
      )}
      {editing && <ClipForm clip={editing} onClose={() => setEditing(null)} onSaved={(f) => (setFilm(f), setEditing(null))} />}
    </div>
  );
}
