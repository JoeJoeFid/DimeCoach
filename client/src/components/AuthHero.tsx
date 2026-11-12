import { useEffect, useState } from 'react';
import type { Play } from '../types';
import { COURT, Court, VIEW_PAD, courtHeight } from './PlayDiagram';

const TICKER = ['Dynamic warm-up', 'Shell drill', 'Ground ball triangles', 'Routes on air', 'Give and go', 'Cutoffs and relays', 'Form tackling', 'Free throws', 'Live batting practice', 'Special teams', 'Water break', 'Late-game situations'];
const POINTS = [
  { title: 'Practices that time themselves', text: 'Add drills and breaks. Every start time updates as you go.' },
  { title: 'Plays that move', text: 'Draw them on a court, a diamond or a football field, then press play and watch them run.' },
  { title: 'The whole season in one place', text: 'Drills, homework, film and the calendar, for every team you coach.' },
];

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Someone, or the ball, following a path on the scene's shared clock, holding still outside their own window. */
interface Mover {
  label?: string;
  lead?: boolean;
  path: string;
  keyPoints: string;
  keyTimes: string;
}
interface Scene {
  sport: string;
  court: Play['court'];
  caption: string;
  /** The drawn lines under the players. A trailing "p" marks a pass or throw, drawn dashed. */
  lines: [string, 'p'?][];
  players: Mover[];
  ball: Mover;
}
const HOLD = { keyPoints: '0;1', keyTimes: '0;1' };
export const SCENES: Scene[] = [
  {
    sport: 'Basketball',
    court: 'half',
    caption: 'A give and go drawn on a half court',
    lines: [['M 25 30 L 11.6 21.1', 'p'], ['M 25 28.2 L 25 10'], ['M 40 20 L 33 14.7'], ['M 11.4 18.6 L 23.6 9.4', 'p']],
    players: [
      { label: '2', path: 'M 10 20 L 10 20', ...HOLD },
      { label: '3', path: 'M 40 20 L 32 14', keyPoints: '0;0;1;1', keyTimes: '0;0.3;0.62;1' },
      { label: '1', lead: true, path: 'M 25 30 L 25 8.6', keyPoints: '0;0;1;1', keyTimes: '0;0.24;0.6;1' },
    ],
    ball: { path: 'M 26.8 28.4 L 11.8 18.4 L 26.6 7.2', keyPoints: '0;0;0.5;0.5;1;1', keyTimes: '0;0.06;0.22;0.58;0.74;1' },
  },
  {
    sport: 'Baseball',
    court: 'infield',
    caption: 'A double play drawn on a baseball infield',
    lines: [['M 25 42 L 18.6 22.4', 'p'], ['M 31 20 L 26.6 18.6'], ['M 19.4 20.4 L 24.4 18.8', 'p'], ['M 27 19.4 L 37 28.6', 'p'], ['M 26 42 L 36 32']],
    players: [
      { label: '3', path: 'M 38.4 29.4 L 38.4 29.4', ...HOLD },
      { label: '4', path: 'M 31 20 L 26 18.4', keyPoints: '0;0;1;1', keyTimes: '0;0.12;0.4;1' },
      { label: 'B', path: 'M 25 43 L 36 32', keyPoints: '0;0;1;1', keyTimes: '0;0.1;0.82;1' },
      { label: '6', lead: true, path: 'M 18 21 L 18 21', ...HOLD },
    ],
    ball: { path: 'M 25 41.6 L 19.4 22 L 27.2 19.6 L 37.2 28.4', keyPoints: '0;0;0.48;0.48;0.67;0.67;1;1', keyTimes: '0;0.08;0.3;0.4;0.5;0.56;0.72;1' },
  },
  {
    sport: 'Football',
    court: 'gridiron',
    caption: 'A slant pass drawn on a football field',
    lines: [['M 6 24 L 6 20 L 15.4 14.4'], ['M 44 25.4 L 44 8'], ['M 25 30.8 L 25 33'], ['M 24.4 31.2 L 16.6 15.6', 'p']],
    players: [
      { label: 'C', path: 'M 25 25.6 L 25 25.6', ...HOLD },
      { label: 'Z', path: 'M 44 27 L 44 8', keyPoints: '0;0;1;1', keyTimes: '0;0.14;0.72;1' },
      { label: 'Q', path: 'M 25 29.4 L 25 32.4', keyPoints: '0;0;1;1', keyTimes: '0;0.14;0.4;1' },
      { label: 'X', lead: true, path: 'M 6 25.6 L 6 20 L 16 14', keyPoints: '0;0;1;1', keyTimes: '0;0.14;0.72;1' },
    ],
    ball: { path: 'M 26.6 25 L 26.6 28.6 L 26.6 31.6 L 17.4 13', keyPoints: '0;0;0.13;0.24;0.24;1;1', keyTimes: '0;0.08;0.14;0.4;0.5;0.72;1' },
  },
];
const SCENE_SECONDS = 7;

/** One short play, looping on the surface its sport is played on. */
export function HeroPlay({ scene, still }: { scene: Scene; still: boolean }) {
  const h = courtHeight(scene.court);
  const place = (m: Mover) => {
    // With motion turned off, everyone simply stands where they start.
    if (still) return { transform: `translate(${m.path.match(/M\s*([\d.]+)\s+([\d.]+)/)!.slice(1).join(' ')})` };
    return {};
  };
  const motion = (m: Mover) =>
    still ? null : <animateMotion path={m.path} dur={`${SCENE_SECONDS}s`} repeatCount="indefinite" calcMode="linear" keyPoints={m.keyPoints} keyTimes={m.keyTimes} />;
  return (
    <svg className="play-svg hero-court" viewBox={`${-VIEW_PAD} ${-VIEW_PAD} ${COURT.width + VIEW_PAD * 2} ${h + VIEW_PAD * 2}`} role="img" aria-label={scene.caption}>
      <Court court={scene.court} flipped={false} />
      <g className="hero-lines">
        {scene.lines.map(([d, pass]) => (
          <path key={d} d={d} className={pass ? 'pass' : undefined} />
        ))}
      </g>
      {scene.players.map((p) => (
        <g key={p.label} className={`hero-player ${p.lead ? 'lead' : ''}`} {...place(p)}>
          <circle r="1.55" />
          <text textAnchor="middle" dominantBaseline="central">
            {p.label}
          </text>
          {motion(p)}
        </g>
      ))}
      <g className="hero-ball" {...place(scene.ball)}>
        <circle r="0.95" />
        {motion(scene.ball)}
      </g>
    </svg>
  );
}

/** The left side of every signed-out screen: what Dime Coach is, with a play running for each sport in turn. */
export default function AuthHero() {
  const still = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState(false);
  // Moves on to the next sport after each play has run twice, until the visitor picks one.
  useEffect(() => {
    if (still || picked) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % SCENES.length), SCENE_SECONDS * 2000);
    return () => clearTimeout(t);
  }, [index, still, picked]);
  const scene = SCENES[index];
  return (
    <aside className="hero">
      <div className="hero-top">
        <div className="brand hero-brand">
          <span className="brand-mark" aria-hidden="true" />
          Dime Coach
        </div>
      </div>

      <div className="hero-main">
        <h2 className="hero-title">
          Plan the practice. <em>Draw the play.</em>
        </h2>
        <p className="hero-lead">A practice planner and playbook for basketball, baseball and football coaches. Walk in knowing exactly what comes next.</p>
        <ul className="hero-points">
          {POINTS.map((p, i) => (
            <li key={p.title}>
              <span className="hero-num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>
                <strong>{p.title}</strong>
                <span className="hero-point-text">{p.text}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="hero-dime">
          <strong>Why "Dime"?</strong> A dime is a perfect pass that sets a teammate up to score. A good plan does the same for your team.
        </p>
      </div>

      <div className="hero-art">
        <HeroPlay key={scene.sport} scene={scene} still={still} />
        <div className="hero-sports" role="group" aria-label="Show a play for">
          {SCENES.map((s, i) => (
            <button
              key={s.sport}
              type="button"
              className={i === index ? 'on' : ''}
              aria-pressed={i === index}
              onClick={() => {
                setIndex(i);
                setPicked(true);
              }}
            >
              {s.sport}
            </button>
          ))}
        </div>
      </div>

      <div className="hero-ticker" aria-hidden="true">
        <div className={`hero-ticker-track ${still ? 'still' : ''}`}>
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
    </aside>
  );
}
