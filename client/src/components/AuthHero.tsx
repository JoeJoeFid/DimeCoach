import { useEffect, useState } from 'react';
import { COURT, Court, VIEW_PAD, courtHeight } from './PlayDiagram';

const TICKER = ['Dynamic warm-up', 'Shell drill', '3-on-2 continuous', 'Give and go', 'Free throws', 'Press break', 'Baseline out of bounds', 'Water break', 'Closeouts', 'Late-game sets'];
const POINTS = [
  { title: 'Practices that time themselves', text: 'Add drills and breaks. Every start time updates as you go.' },
  { title: 'Plays that move', text: 'Draw cuts, passes and screens, then press play and watch them run.' },
  { title: 'The whole season in one place', text: 'Drills, homework, film and your team calendar, ready on any screen.' },
];

function useReducedMotion() {
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

/** A give and go, looping: 1 passes to 2, cuts to the rim, and gets it back while 3 comes off the wing. */
function HeroPlay({ still }: { still: boolean }) {
  const h = courtHeight('half');
  const DUR = '7s';
  // Each mover follows its path on a shared seven-second clock, holding still outside its own window.
  const motion = (path: string, keyPoints: string, keyTimes: string) =>
    still ? null : <animateMotion path={path} dur={DUR} repeatCount="indefinite" calcMode="linear" keyPoints={keyPoints} keyTimes={keyTimes} />;
  return (
    <svg className="play-svg hero-court" viewBox={`${-VIEW_PAD} ${-VIEW_PAD} ${COURT.width + VIEW_PAD * 2} ${h + VIEW_PAD * 2}`} role="img" aria-label="A give and go drawn on a half court">
      <Court court="half" flipped={false} />
      <g className="hero-lines">
        <path d="M 25 30 L 11.6 21.1" className="pass" />
        <path d="M 25 28.2 L 25 10" />
        <path d="M 40 20 L 33 14.7" />
        <path d="M 11.4 18.6 L 23.6 9.4" className="pass" />
      </g>
      <g className="hero-player">
        <circle r="1.55" />
        <text textAnchor="middle" dominantBaseline="central">2</text>
        {still ? <animateTransform attributeName="transform" type="translate" from="10 20" to="10 20" dur="1s" fill="freeze" /> : motion('M 10 20 L 10 20', '0;1', '0;1')}
      </g>
      <g className="hero-player">
        <circle r="1.55" />
        <text textAnchor="middle" dominantBaseline="central">3</text>
        {still ? <animateTransform attributeName="transform" type="translate" from="40 20" to="40 20" dur="1s" fill="freeze" /> : motion('M 40 20 L 32 14', '0;0;1;1', '0;0.3;0.62;1')}
      </g>
      <g className="hero-player lead">
        <circle r="1.55" />
        <text textAnchor="middle" dominantBaseline="central">1</text>
        {still ? <animateTransform attributeName="transform" type="translate" from="25 30" to="25 30" dur="1s" fill="freeze" /> : motion('M 25 30 L 25 8.6', '0;0;1;1', '0;0.24;0.6;1')}
      </g>
      <g className="hero-ball">
        <circle r="0.95" />
        {still ? (
          <animateTransform attributeName="transform" type="translate" from="26.8 28.4" to="26.8 28.4" dur="1s" fill="freeze" />
        ) : (
          motion('M 26.8 28.4 L 11.8 18.4 L 26.6 7.2', '0;0;0.5;0.5;1;1', '0;0.06;0.22;0.58;0.74;1')
        )}
      </g>
    </svg>
  );
}

/** The left side of every signed-out screen: what Dime Coach is, with a play running on a court. */
export default function AuthHero() {
  const still = useReducedMotion();
  return (
    <aside className="hero">
      <div className="hero-top">
        <div className="brand hero-brand">
          <span className="brand-mark" aria-hidden="true" />
          Dime Coach
        </div>
        <span className="hero-tag">Basketball practice planner</span>
      </div>

      <div className="hero-main">
        <h2 className="hero-title">
          Run practice like you <em>drop dimes.</em>
        </h2>
        <p className="hero-lead">Plan every minute, draw every play, and walk into the gym knowing exactly what comes next.</p>
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
      </div>

      <div className="hero-art" aria-hidden={still ? undefined : true}>
        <HeroPlay still={still} />
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
