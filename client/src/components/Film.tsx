// The Filmroom's moving parts: a player that can start and stop at exact moments, a player for a
// run of clips one after another, and the strip a new video is put together on.
//
// A clip is two marks on a saved game video, and a video put together here is a list of clips.
// Nothing is copied or made: playing either plays the game video's own pieces, from one mark to
// another. See server/film.js.
import { Fragment, forwardRef, useEffect, useImperativeHandle, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, type Film, type FilmClip, type FilmItem, type FilmMark, type GameStream, type SharedFilm } from '../api';
import { Modal } from './bits';
import { joinedPlayer, reelPlayer, type JoinedPlayer, type ReelHandle } from '../video';
import { FullButton, SeekInput, StreamPlayer, useFullScreen } from './GameVideo';

/** Minutes and seconds. */
export const clock = (secs: number) => `${Math.floor(Math.max(0, secs) / 60)}:${String(Math.floor(Math.max(0, secs) % 60)).padStart(2, '0')}`;
/** About how far into its video a mark is, to show. The mark itself is what is exact. */
export const markSeconds = (m: FilmMark, s: GameStream) => m.n * s.segment_seconds + m.off;
/** Whether a video can be cut into clips here: it has to be one whose pieces join up. */
export const canClip = (s: GameStream) => s.layout === 'joined';

/** One thing to play in a run: a clip, or a whole game video, with what to show over it. */
export interface Scene {
  key: string;
  stream: GameStream;
  start?: FilmMark;
  end?: FilmMark;
  title: string;
  notes: string;
  seconds: number;
  /** Whether the title and notes show over the picture. */
  show: boolean;
  clip?: FilmClip;
}
/** One thing on the strip a video is put together on. `key` is its own, since the same clip can be used twice. */
export interface StripItem extends FilmItem {
  key: string;
}
let made = 0;
export const stripItem = (i: FilmItem): StripItem => ({ ...i, key: `i${++made}` });
/** What the things on a strip are, looked up in the Filmroom. One whose clip or video has since been deleted is left out. */
export function scenes(film: Film, items: StripItem[]): Scene[] {
  const out: Scene[] = [];
  for (const i of items) {
    const clip = i.clip_id ? film.clips.find((c) => c.id === i.clip_id) : undefined;
    const stream = film.videos.find((v) => v.id === (clip ? clip.stream_id : i.stream_id));
    if (!stream || (i.clip_id && !clip)) continue;
    out.push(clip ? { key: i.key, stream, start: clip.start, end: clip.end, title: clip.title, notes: clip.notes, seconds: clip.seconds, show: i.show_notes, clip } : { key: i.key, stream, title: stream.title || 'Game video', notes: '', seconds: stream.seconds, show: i.show_notes });
  }
  return out;
}

/** What a page can ask of a film player. */
export interface FilmHandle {
  /** Exactly where it is now. */
  mark: () => FilmMark;
  /** The player's own clock, in seconds: the difference between two readings is how long passed, as long as it was not moved in between. */
  time: () => number;
  /** How many times it has been moved to somewhere else. */
  moves: () => number;
  play: (from: FilmMark, end?: FilmMark) => void;
  pause: () => void;
  /** Back or forward a few seconds, as far as what is loaded allows. */
  nudge: (seconds: number) => void;
}
interface FilmPlayerProps {
  stream: GameStream;
  /** Where to start, and where to stop: a clip. Without them it is the whole video, with a bar to move through it. */
  start?: FilmMark;
  end?: FilmMark;
  autoPlay?: boolean;
  /** Shown over the picture. */
  overlay?: ReactNode;
  onAt?: (at: FilmMark) => void;
  /** It has been set playing, by a press or by itself. */
  onPlay?: () => void;
  onEnded?: () => void;
}
/**
 * Plays a saved game video, or a part of it from one mark to another. A video recorded the older
 * way, in separate pieces, or a browser that cannot play joined video as one, gets the ordinary
 * player: it can be watched, but not started and stopped at exact moments.
 */
export const FilmPlayer = forwardRef<FilmHandle, FilmPlayerProps>(function FilmPlayer({ stream, start, end, autoPlay, overlay, onAt, onPlay, onEnded }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [full, toggleFull] = useFullScreen(frame, video);
  // What is being played: from a mark, to a mark when it is a clip.
  const [range, setRange] = useState<{ from: FilmMark; end?: FilmMark }>({ from: start ?? { n: 0, off: 0 }, end });
  const [at, setAt] = useState<FilmMark>(range.from);
  const [playing, setPlaying] = useState(!!autoPlay);
  const [plain, setPlain] = useState(!canClip(stream));
  const atRef = useRef(at);
  const wantPlay = useRef(!!autoPlay);
  const moved = useRef(0);
  const player = useRef<JoinedPlayer | null>(null);
  const told = useRef({ onAt, onPlay, onEnded });
  told.current = { onAt, onPlay, onEnded };
  useEffect(() => {
    const el = video.current;
    if (!el || plain) return;
    atRef.current = range.from;
    setAt(range.from);
    const p = joinedPlayer(
      el,
      stream,
      range.from.n,
      false,
      (now) => {
        if (now.failed) return setPlain(true);
        if (now.at) {
          atRef.current = now.at;
          setAt(now.at);
          told.current.onAt?.(now.at);
        }
        if (now.ended) {
          wantPlay.current = false;
          setPlaying(false);
          told.current.onEnded?.();
        }
      },
      { offset: range.from.off, end: range.end },
    );
    if (!p) return setPlain(true);
    player.current = p;
    if (wantPlay.current) el.play().catch(() => setPlaying(false));
    return () => {
      player.current = null;
      p.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, plain]);
  const go = (from: FilmMark, to?: FilmMark, play = wantPlay.current) => {
    moved.current += 1;
    wantPlay.current = play;
    setPlaying(play);
    setRange({ from, end: to });
  };
  useImperativeHandle(ref, () => ({
    mark: () => atRef.current,
    time: () => video.current?.currentTime ?? 0,
    moves: () => moved.current,
    play: (from, to) => go(from, to, true),
    pause: () => video.current?.pause(),
    nudge: (seconds) => {
      const el = video.current;
      if (!el || el.buffered.length === 0) return;
      el.currentTime = Math.min(Math.max(el.currentTime + seconds, el.buffered.start(0)), el.buffered.end(el.buffered.length - 1) - 0.05);
    },
  }));
  if (plain) return <StreamPlayer stream={stream} />;
  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      wantPlay.current = true;
      // Played to the end of a clip: again from its start.
      if (range.end && (at.n > range.end.n || (at.n === range.end.n && at.off >= range.end.off - 0.05))) return go(range.from, range.end, true);
      el.play().catch(() => setPlaying(false));
    } else {
      wantPlay.current = false;
      el.pause();
    }
  };
  const last = stream.segments - 1;
  const total = stream.segments * stream.segment_seconds;
  const seek = (seconds: number) => {
    const s = Math.max(0, Math.min(seconds, total - 1));
    const to = { n: Math.floor(s / stream.segment_seconds), off: s % stream.segment_seconds };
    // Somewhere already loaded is simply moved to. Anywhere else, the video starts again from there.
    if (player.current?.seek(to)) {
      moved.current += 1;
      atRef.current = to;
      setAt(to);
    } else go(to);
  };
  return (
    <div className="gv-player film-player" ref={frame}>
      <div className="gv-screen">
        <video ref={video} playsInline data-film="" data-n={at.n} onClick={toggle} onPlay={() => (setPlaying(true), told.current.onPlay?.())} onPause={() => setPlaying(false)} />
        {!playing && (
          <button type="button" className="gv-play" onClick={toggle} aria-label="Play">
            ▶
          </button>
        )}
        {overlay}
        <FullButton full={full} onClick={toggleFull} />
      </div>
      {!end && !range.end && last > 0 && (
        <div className="gv-seek">
          <SeekInput value={Math.floor(markSeconds(at, stream))} max={total} label="Move through the video" say={clock} onSeek={seek} />
          <span className="muted small">{clock(stream.seconds)}</span>
        </div>
      )}
    </div>
  );
});

/** A pause between one part of a video and the next: how long, and whether the screen says what is coming. */
export interface ReelPause {
  seconds: number;
  notes: boolean;
}
interface ReelProps {
  scenes: Scene[];
  at: number;
  onAt: (index: number) => void;
  pause?: ReelPause;
}
/**
 * Plays a run of clips one after another, as one video, with each one's notes over the picture
 * when it asks for them. With a `pause`, a screen is held between one and the next for that long,
 * counting down, and can say what the next one is. Where the browser can, it truly is one video:
 * one player for all of it, with one bar to move through the whole. Where it cannot, or a part
 * was recorded the older way, the parts are played one at a time.
 */
export function ReelPlayer(props: ReelProps) {
  const [stepped, setStepped] = useState(false);
  return stepped || !props.scenes.every((s) => canClip(s.stream)) ? <SteppedReel {...props} /> : <JoinedReel {...props} onFail={() => setStepped(true)} />;
}

const untilPart = (list: Scene[], i: number) => list.slice(0, i).reduce((n, s) => n + s.seconds, 0);
/** A run of clips as a single video (reelPlayer in ../video.ts). */
function JoinedReel({ scenes: list, at, onAt, pause, onFail }: ReelProps & { onFail: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [full, toggleFull] = useFullScreen(frame, video);
  const [playing, setPlaying] = useState(false);
  // The pause that is up: the part it is ahead of, and the seconds left of it.
  const [held, setHeld] = useState<{ next: number; left: number } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [ended, setEnded] = useState(false);
  // How far into the whole of it, in seconds.
  const [played, setPlayed] = useState(() => Math.floor(untilPart(list, at)));
  const player = useRef<ReelHandle | null>(null);
  const cur = useRef(Math.min(at, list.length - 1));
  const now = useRef({ list, pause, onAt, onFail });
  now.current = { list, pause, onAt, onFail };
  // What is played, and from where to where: the player is made again only when that changes, not when a title or a tick does.
  const made = list.map((s) => `${s.stream.id}:${s.start?.n ?? ''}:${s.start?.off ?? ''}:${s.end?.n ?? ''}:${s.end?.off ?? ''}`).join('|');
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const parts = now.current.list;
    cur.current = Math.max(0, Math.min(cur.current, parts.length - 1));
    setHeld(null);
    setEnded(false);
    setPlaying(false);
    const p = reelPlayer(
      el,
      parts.map((s) => ({ stream: s.stream, start: s.start, end: s.end })),
      cur.current,
      () => (now.current.pause?.seconds ?? 0) > 0,
      (said) => {
        if (said.failed) return now.current.onFail();
        if (said.part !== undefined) {
          setHeld(null);
          setEnded(false);
          if (said.part !== cur.current) {
            cur.current = said.part;
            now.current.onAt(said.part);
          }
          setPlayed(Math.floor(untilPart(parts, said.part)));
        }
        if (said.at) {
          const s = parts[cur.current];
          const into = markSeconds(said.at, s.stream) - (s.start ? markSeconds(s.start, s.stream) : 0);
          setPlayed(Math.floor(untilPart(parts, cur.current) + Math.max(0, Math.min(into, s.seconds))));
        }
        if (said.hold !== undefined) setHeld({ next: said.hold, left: Math.max(1, Math.round(now.current.pause?.seconds ?? 0)) });
        if (said.waiting !== undefined) setWaiting(said.waiting);
        if (said.ended) {
          setEnded(true);
          setPlaying(false);
        }
      },
    );
    if (!p) return now.current.onFail();
    player.current = p;
    return () => {
      player.current = null;
      p.close();
    };
  }, [made]);
  // Moved to another part from outside: by pressing one on the strip.
  useEffect(() => {
    if (at === cur.current || at < 0 || at >= list.length) return;
    cur.current = at;
    player.current?.go(at, undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  useEffect(() => {
    if (!held) return;
    if (held.left <= 0) {
      setHeld(null);
      player.current?.resume();
      return;
    }
    const t = window.setTimeout(() => setHeld((h) => h && { ...h, left: h.left - 1 }), 1000);
    return () => window.clearTimeout(t);
  }, [held]);
  const scene = list[Math.min(at, list.length - 1)];
  if (!scene) return null;
  const total = untilPart(list, list.length);
  const toggle = () => {
    const el = video.current;
    // The pause screen has its own way on.
    if (!el || held) return;
    if (!el.paused) return el.pause();
    // Played to the end: again from the start.
    if (ended) return player.current?.go(0, undefined, true);
    el.play().catch(() => setPlaying(false));
  };
  /** Moves to a number of seconds into the whole: the part that falls in, and how far into it. */
  const seek = (seconds: number) => {
    let i = 0;
    while (i < list.length - 1 && seconds >= untilPart(list, i + 1)) i++;
    const s = list[i];
    const into = (s.start ? markSeconds(s.start, s.stream) : 0) + Math.max(0, Math.min(seconds - untilPart(list, i), s.seconds - 0.5));
    setPlayed(Math.floor(seconds));
    player.current?.go(i, { n: Math.floor(into / s.stream.segment_seconds), off: into % s.stream.segment_seconds });
  };
  const coming = held ? list[held.next] : undefined;
  return (
    <div className="film-reel">
      <div className="gv-player film-player" ref={frame}>
        <div className="gv-screen">
          <video ref={video} playsInline data-film="" data-reel="" onClick={toggle} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          {!playing && !held && (
            <button type="button" className="gv-play" onClick={toggle} aria-label={ended ? 'Play again' : 'Play'}>
              ▶
            </button>
          )}
          {waiting && playing && !held && <span className="gv-wait">Loading…</span>}
          {held && coming ? (
            <div className="film-pause film-pause-over" role="status">
              {pause?.notes && (
                <div className="film-pause-text">
                  <span className="film-pause-next">Next</span>
                  <strong>{coming.title}</strong>
                  {coming.notes && <p>{coming.notes}</p>}
                </div>
              )}
              <span className="film-pause-left" aria-label={`The next part starts in ${held.left} second${held.left === 1 ? '' : 's'}`}>
                {held.left}
              </span>
              <button type="button" className="btn small film-pause-skip" onClick={() => (setHeld(null), player.current?.resume())}>
                Skip
              </button>
            </div>
          ) : (
            scene.show && (
              <div className="film-over">
                <strong>{scene.title}</strong>
                {scene.notes && <p>{scene.notes}</p>}
              </div>
            )
          )}
          <FullButton full={full} onClick={toggleFull} />
        </div>
        {total >= 2 && (
          <div className="gv-seek">
            <SeekInput value={played} max={Math.floor(total)} label="Move through the video" say={clock} onSeek={seek} />
            <span className="muted small">{clock(total)}</span>
          </div>
        )}
      </div>
      <p className="muted small film-count">
        {held && coming ? `Next, ${held.next + 1} of ${list.length}: ${coming.title}` : `${Math.min(at, list.length - 1) + 1} of ${list.length}: ${scene.title}`}
      </p>
    </div>
  );
}

/** A run of clips played one at a time, each in a player of its own: for a browser, or a recording, that cannot be played as one. */
function SteppedReel({ scenes: list, at, onAt, pause }: ReelProps) {
  // Once it has been started it keeps going from clip to clip.
  const [running, setRunning] = useState(false);
  // The pause that is up: the part it is ahead of, and the seconds left of it.
  const [held, setHeld] = useState<{ next: number; left: number } | null>(null);
  const move = useRef(onAt);
  move.current = onAt;
  useEffect(() => {
    if (!held) return;
    if (held.left <= 0) {
      setHeld(null);
      move.current(held.next);
      return;
    }
    const t = window.setTimeout(() => setHeld((h) => h && { ...h, left: h.left - 1 }), 1000);
    return () => window.clearTimeout(t);
  }, [held]);
  // Moved to another part by hand: the pause is over.
  useEffect(() => setHeld(null), [at]);
  const scene = list[Math.min(at, list.length - 1)];
  if (!scene) return null;
  const coming = held ? list[held.next] : undefined;
  if (held && coming)
    return (
      <div className="film-reel">
        <div className="gv-player film-player">
          <div className="gv-screen film-pause" role="status">
            {pause?.notes && (
              <div className="film-pause-text">
                <span className="film-pause-next">Next</span>
                <strong>{coming.title}</strong>
                {coming.notes && <p>{coming.notes}</p>}
              </div>
            )}
            <span className="film-pause-left" aria-label={`The next part starts in ${held.left} second${held.left === 1 ? '' : 's'}`}>
              {held.left}
            </span>
            <button type="button" className="btn small film-pause-skip" onClick={() => (setHeld(null), onAt(held.next))}>
              Skip
            </button>
          </div>
        </div>
        <p className="muted small film-count">
          Next, {held.next + 1} of {list.length}: {coming.title}
        </p>
      </div>
    );
  return (
    <div className="film-reel">
      <FilmPlayer
        key={`${scene.key}-${at}`}
        stream={scene.stream}
        start={scene.start ?? { n: 0, off: 0 }}
        end={scene.end ?? { n: scene.stream.segments - 1, off: 3600 }}
        autoPlay={running}
        onPlay={() => setRunning(true)}
        onEnded={() => (at + 1 >= list.length ? (setRunning(false), onAt(0)) : pause && pause.seconds > 0 ? setHeld({ next: at + 1, left: Math.round(pause.seconds) }) : onAt(at + 1))}
        overlay={
          scene.show && (
            <div className="film-over">
              <strong>{scene.title}</strong>
              {scene.notes && <p>{scene.notes}</p>}
            </div>
          )
        }
      />
      <p className="muted small film-count">
        {at + 1} of {list.length}: {scene.title}
      </p>
    </div>
  );
}

/** What is carried when a clip or a game video is dragged from a list onto the timeline. */
const DRAG_TYPE = 'application/x-dime-film';
type Dragged = { clip_id: number | null; stream_id: number | null };

/**
 * Whether the bigger player is on: the video takes the whole width of the page, and the lists
 * that sit beside it move underneath. Kept on this device, since it is about its screen.
 */
export function useTheater(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem('dime.film.theater') === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOn(!on);
    try {
      localStorage.setItem('dime.film.theater', on ? '0' : '1');
    } catch {
      // Not remembered, which is all that is lost.
    }
  };
  return [on, toggle];
}
export function TheaterButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn film-theater-btn" aria-pressed={on} onClick={onClick} title={on ? 'Back to the video with the lists beside it' : 'A bigger video, with the lists underneath'}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {on ? <path d="M3 6h18v12H3zM15 6v12" /> : <path d="M3 6h18v12H3z" />}
      </svg>
      {on ? 'Leave theater mode' : 'Theater mode'}
    </button>
  );
}

/**
 * A game video or a clip as a row in a list: its picture with how long it runs, what it is
 * called and about, and what can be done with it (`children`). The one being watched is marked.
 * With `drag`, it can be dragged onto the timeline.
 */
export function FilmRow({ poster, length, title, meta, notes, now, onPlay, drag, children }: { poster: number | null; length: string; title: string; meta: string; notes?: string; /** It is what the player is showing. */ now?: boolean; onPlay?: () => void; drag?: Dragged; children?: ReactNode }) {
  const carry = (e: DragEvent) => {
    if (!drag) return;
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(drag));
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <div className={`fr ${now ? 'now' : ''}`} draggable={!!drag} onDragStart={carry} aria-current={now ? 'true' : undefined}>
      <button type="button" className="fr-thumb" onClick={onPlay} disabled={!onPlay} aria-label={`Play ${title}`}>
        {poster ? <img src={`/api/streams/${poster}/poster`} alt="" loading="lazy" draggable={false} /> : <span className="fr-blank" aria-hidden="true" />}
        <span className="fr-len">{length}</span>
        {now && <span className="fr-now">Watching</span>}
      </button>
      <button type="button" className="fr-text" onClick={onPlay} disabled={!onPlay}>
        <strong>{title}</strong>
        <span className="fr-meta">{meta}</span>
        {notes && <span className="fr-notes">{notes}</span>}
      </button>
      {children && <span className="fr-acts">{children}</span>}
    </div>
  );
}

function StripCard({ scene, playing, onPlay, onShow, onRemove }: { scene: Scene; playing: boolean; onPlay: () => void; onShow: (show: boolean) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.key });
  return (
    <li ref={setNodeRef} className={`tl2-card ${playing ? 'on' : ''} ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Translate.toString(transform), transition }} title="Drag to move" {...attributes} {...listeners}>
      <span className="tl2-kind">
        {scene.clip ? 'Clip' : 'Game video'} · {clock(scene.seconds)}
      </span>
      <button type="button" className="tl2-title" onClick={onPlay} title="Play from here">
        {scene.title}
      </button>
      <span className="tl2-foot">
        <label title={`Put the ${scene.clip ? "clip's title and notes" : 'title'} over the picture while it plays`}>
          <input type="checkbox" checked={scene.show} onChange={(e) => onShow(e.target.checked)} /> {scene.clip ? 'Notes' : 'Title'}
        </label>
        <button type="button" className="tl2-out" onClick={onRemove} aria-label={`Take ${scene.title} out`} title="Take out">
          ✕
        </button>
      </span>
    </li>
  );
}
/**
 * The timeline a cut is put together on: its parts in order, left to right, each a card saying
 * what it is and how long. They are dragged to move them. A pause between parts, when the cut has
 * one, shows as a card of its own, and the place at the end takes a clip dragged from a list.
 */
export function Strip({ film, items, at, onChange, onPlay, pause = 0, onAdd }: { film: Film; items: StripItem[]; at: number; onChange: (items: StripItem[]) => void; onPlay: (index: number) => void; /** Seconds held between one part and the next. */ pause?: number; /** Something was dragged in from a list. */ onAdd?: (item: Dragged) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [over, setOver] = useState(false);
  const list = scenes(film, items);
  const dropped = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.key === e.active.id);
    const to = items.findIndex((i) => i.key === e.over!.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(items, from, to));
  };
  const carried = (e: DragEvent) => !!onAdd && e.dataTransfer.types.includes(DRAG_TYPE);
  const taken = (e: DragEvent) => {
    setOver(false);
    if (!carried(e)) return;
    e.preventDefault();
    try {
      const d = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
      onAdd!({ clip_id: Number(d.clip_id) || null, stream_id: Number(d.stream_id) || null });
    } catch {
      // Not something of ours after all.
    }
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropped}>
      <SortableContext items={list.map((s) => s.key)} strategy={horizontalListSortingStrategy}>
        <ol
          className={`tl2 ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            if (!carried(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={taken}
        >
          {list.map((s, i) => (
            <Fragment key={s.key}>
              {i > 0 && pause > 0 && (
                <li className="tl2-card gap" aria-label={`A pause of ${pause} seconds`}>
                  <span className="tl2-kind">Pause</span>
                  <strong>{pause}s</strong>
                </li>
              )}
              <StripCard
                scene={s}
                playing={i === at}
                onPlay={() => onPlay(i)}
                onShow={(show) => onChange(items.map((x) => (x.key === s.key ? { ...x, show_notes: show } : x)))}
                onRemove={() => onChange(items.filter((x) => x.key !== s.key))}
              />
            </Fragment>
          ))}
          <li className="tl2-drop">{onAdd ? 'Drop a clip here' : list.length === 0 ? 'Clips you add show here' : 'Add another clip'}</li>
        </ol>
      </SortableContext>
    </DndContext>
  );
}
/** How long a strip's video runs. */
export const stripSeconds = (film: Film, items: StripItem[]) => scenes(film, items).reduce((n, s) => n + s.seconds, 0);

/**
 * The videos from a team's Filmroom that were shared with the person looking: whole game videos,
 * clips, and videos put together. `openId` is one to open at once, as a link to it asks.
 */
export function SharedFilms({ teamId, openId }: { teamId: number; openId?: number }) {
  const [list, setList] = useState<SharedFilm[] | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<{ share: SharedFilm; at: number } | null>(null);
  const opened = useRef(false);
  useEffect(() => {
    setList(null);
    api.sharedFilm(teamId).then(setList, (e) => setError((e as Error).message));
  }, [teamId]);
  const play = (share: SharedFilm) => {
    setPlaying({ share, at: 0 });
    if (share.watched) return;
    // The coach who shared it can see that it was opened.
    api.watchedShare(share.id).catch(() => {});
    setList((l) => l && l.map((x) => (x.id === share.id ? { ...x, watched: true } : x)));
  };
  // The one a link asked for opens by itself, as does the only one there is while it is still new.
  useEffect(() => {
    if (!list || opened.current) return;
    opened.current = true;
    const first = list.find((x) => x.id === openId) ?? (list.length === 1 && !list[0].watched ? list[0] : undefined);
    if (first) play(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
  if (error) return <p className="error">{error}</p>;
  if (!list) return <p className="muted">Loading…</p>;
  if (list.length === 0)
    return (
      <div className="empty">
        <h2>No video has been shared with you</h2>
        <p>When one of the team's coaches shares a video with you, it shows here to watch.</p>
      </div>
    );
  const WORD = { video: 'Game video', clip: 'Clip', reel: 'Cut' };
  const on = playing?.share;
  return (
    <>
      <div className="res-grid">
        {list.map((f) => {
          const poster = f.parts.find((p) => p.stream.has_poster)?.stream.id;
          return (
            <div key={f.id} className="res-card kind-video film-card">
              <button type="button" className="res-preview" onClick={() => play(f)} title="Play">
                {poster ? <img className="res-thumb gv-poster" src={`/api/streams/${poster}/poster`} alt="" loading="lazy" /> : <span className="res-thumb site">Video</span>}
                <span className="res-play" aria-hidden="true">
                  ▶
                </span>
                <span className="gv-length">{clock(f.parts.reduce((n, p) => n + p.seconds, 0))}</span>
              </button>
              <div className="res-info">
                <strong className="res-title">
                  {f.title} {!f.watched && <span className="kind new">New</span>}
                </strong>
                <span className="muted small">
                  {WORD[f.kind]} · from {f.by} · {new Date(f.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                {f.notes && <p className="film-notes">{f.notes}</p>}
                <div className="res-actions">
                  <button type="button" className="btn small" onClick={() => play(f)}>
                    Play
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {playing && on && (
        <Modal title={on.title} onClose={() => setPlaying(null)} wide>
          {on.parts.length === 1 ? (
            <FilmPlayer stream={on.parts[0].stream} start={on.parts[0].start} end={on.parts[0].end} />
          ) : (
            <ReelPlayer scenes={on.parts.map((p, k) => ({ ...p, key: `p${k}` }))} at={Math.min(playing.at, on.parts.length - 1)} onAt={(at) => setPlaying({ share: on, at })} pause={{ seconds: on.pause_seconds, notes: on.pause_notes }} />
          )}
          {on.notes && <p className="film-notes">{on.notes}</p>}
          <p className="muted small">Shared with you by {on.by}. It is for you to watch here, and cannot be passed on.</p>
        </Modal>
      )}
    </>
  );
}
