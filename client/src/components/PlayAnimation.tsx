import { useEffect, useMemo, useRef, useState } from 'react';
import type { Play } from '../types';
import { beatsOf, locate, ordinal, snapshot, timeline } from '../playAnimation';
import { COURT, Court, LineShape, MarkShape, ShapeView, VIEW_PAD, courtHeight, isLine, isShape } from './PlayDiagram';

const SPEEDS = [0.5, 1, 2];

/**
 * Plays a play: each step in turn, and within a step each group of movement in its order.
 * Players run their lines, the ball flies on passes, and the circle moves to whoever has it.
 */
export default function PlayAnimation({ play, startFrame = 0 }: { play: Pick<Play, 'frames' | 'court' | 'flipped'>; startFrame?: number }) {
  const { segments, total } = useMemo(() => timeline(play, startFrame), [play, startFrame]);
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const clock = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      clock.current = Math.min(total, clock.current + (now - last) * speed);
      last = now;
      setMs(clock.current);
      if (clock.current >= total) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, total]);

  const seek = (to: number) => {
    clock.current = Math.min(total, Math.max(0, to));
    setMs(clock.current);
  };
  const toggle = () => {
    if (!playing && clock.current >= total) seek(0);
    setPlaying(!playing);
  };

  const { segment, t } = locate(segments, ms);
  const frame = play.frames[segment.frame];
  const beats = beatsOf(frame).length;
  // A pause shows everything up to its beat as finished and nothing after it started.
  const shot = segment.moving ? snapshot(frame, segment.beat, t) : snapshot(frame, segment.beat - 1, 1);
  const h = courtHeight(play.court);
  const finished = ms >= total;
  const beatNow = Math.min(beats, segment.moving ? segment.beat + 1 : Math.max(1, segment.beat));
  const caption = [`Step ${segment.frame + 1} of ${play.frames.length}`, beats > 1 ? `${ordinal(beatNow)} of ${beats} movements` : ''].filter(Boolean).join(' · ');

  return (
    <div className="anim">
      <svg className="play-svg anim-court" viewBox={`${-VIEW_PAD} ${-VIEW_PAD} ${COURT.width + VIEW_PAD * 2} ${h + VIEW_PAD * 2}`} role="img" aria-label={`Animation, ${caption}`}>
        <Court court={play.court} flipped={play.flipped} />
        {frame.objects.filter(isShape).map((o) => (
          <ShapeView key={o.id} shape={o} />
        ))}
        {frame.objects.filter(isLine).map((o) => (
          // A line is faint until its turn, full while it moves, and settles back once it is done.
          <g key={o.id} className={`anim-line ${shot.active.has(o.id) ? 'now' : shot.done.has(o.id) ? 'done' : 'later'}`}>
            <LineShape line={o} objects={frame.objects} />
          </g>
        ))}
        {shot.marks.map((m) => (
          <MarkShape key={m.id} mark={m} />
        ))}
        {shot.flying.map((p, i) => (
          <MarkShape key={`fly${i}`} mark={{ id: `fly${i}`, type: 'ball', x: p[0], y: p[1], label: '' }} />
        ))}
      </svg>

      <div className="anim-bar">
        <button className="btn primary anim-play" onClick={toggle} aria-label={playing ? 'Pause' : finished ? 'Play again' : 'Play'}>
          {playing ? 'Pause' : finished ? 'Play again' : 'Play'}
        </button>
        <input
          className="anim-seek"
          type="range"
          min={0}
          max={Math.max(1, Math.round(total))}
          step={10}
          value={Math.round(ms)}
          aria-label="Position in the play"
          onPointerDown={() => setPlaying(false)}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <div className="seg" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'on' : ''} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      <p className="anim-caption">
        <strong>{caption}</strong>
        {frame.note && <span className="muted"> · {frame.note}</span>}
      </p>
    </div>
  );
}
