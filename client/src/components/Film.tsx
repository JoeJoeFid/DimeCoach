// The Filmroom's moving parts: a player that can start and stop at exact moments, a player for a
// run of clips one after another, and the strip a new video is put together on.
//
// A clip is two marks on a saved game video, and a video put together here is a list of clips.
// Nothing is copied or made: playing either plays the game video's own pieces, from one mark to
// another. See server/film.js.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Film, FilmClip, FilmItem, FilmMark, GameStream } from '../api';
import { joinedPlayer, type JoinedPlayer } from '../video';
import { FullButton, StreamPlayer, useFullScreen } from './GameVideo';

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
          <span className="muted small">{clock(markSeconds(at, stream))}</span>
          <input type="range" min={0} max={last} value={Math.min(at.n, last)} aria-label="Move through the video" onChange={(e) => go({ n: Number(e.target.value), off: 0 })} />
          <span className="muted small">{clock(stream.seconds)}</span>
        </div>
      )}
    </div>
  );
});

/** Plays a run of clips one after another, as one video, with each one's notes over the picture when it asks for them. */
export function ReelPlayer({ scenes: list, at, onAt }: { scenes: Scene[]; at: number; onAt: (index: number) => void }) {
  // Once it has been started it keeps going from clip to clip.
  const [running, setRunning] = useState(false);
  const scene = list[Math.min(at, list.length - 1)];
  if (!scene) return null;
  return (
    <div className="film-reel">
      <FilmPlayer
        key={`${scene.key}-${at}`}
        stream={scene.stream}
        start={scene.start ?? { n: 0, off: 0 }}
        end={scene.end ?? { n: scene.stream.segments - 1, off: 3600 }}
        autoPlay={running}
        onPlay={() => setRunning(true)}
        onEnded={() => (at + 1 < list.length ? onAt(at + 1) : (setRunning(false), onAt(0)))}
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

function StripCard({ scene, index, playing, onPlay, onShow, onRemove }: { scene: Scene; index: number; playing: boolean; onPlay: () => void; onShow: (show: boolean) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.key });
  return (
    <li ref={setNodeRef} className={`film-strip-card ${playing ? 'on' : ''} ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <button type="button" className="film-grip" aria-label={`Move ${scene.title}`} title="Drag to move" {...attributes} {...listeners}>
        <span aria-hidden="true">{index + 1}</span>
      </button>
      <button type="button" className="film-strip-title" onClick={onPlay} title="Play from here">
        <strong>{scene.title}</strong>
        <span className="muted small">
          {clock(scene.seconds)} · {scene.clip ? scene.stream.title || 'Game video' : 'Whole game video'}
        </span>
      </button>
      <label className="film-strip-show">
        <input type="checkbox" checked={scene.show} onChange={(e) => onShow(e.target.checked)} /> Show {scene.clip ? 'notes' : 'title'}
      </label>
      <button type="button" className="link small" onClick={onRemove} aria-label={`Take ${scene.title} out`}>
        Take out
      </button>
    </li>
  );
}
/**
 * The strip a video is put together on: its clips in order, left to right. They are dragged to
 * move them, and each says whether its notes show over the picture.
 */
export function Strip({ film, items, at, onChange, onPlay }: { film: Film; items: StripItem[]; at: number; onChange: (items: StripItem[]) => void; onPlay: (index: number) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const list = scenes(film, items);
  const dropped = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.key === e.active.id);
    const to = items.findIndex((i) => i.key === e.over!.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(items, from, to));
  };
  if (list.length === 0) return <p className="muted film-strip-none">Nothing in it yet.</p>;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropped}>
      <SortableContext items={list.map((s) => s.key)} strategy={horizontalListSortingStrategy}>
        <ol className="film-strip">
          {list.map((s, i) => (
            <StripCard
              key={s.key}
              scene={s}
              index={i}
              playing={i === at}
              onPlay={() => onPlay(i)}
              onShow={(show) => onChange(items.map((x) => (x.key === s.key ? { ...x, show_notes: show } : x)))}
              onRemove={() => onChange(items.filter((x) => x.key !== s.key))}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
/** How long a strip's video runs. */
export const stripSeconds = (film: Film, items: StripItem[]) => scenes(film, items).reduce((n, s) => n + s.seconds, 0);
