import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { sportKind, type SportKind } from '../sports';
import { HeroPlay, SCENES, useReducedMotion } from './AuthHero';

/** Example names in the coach's own sport: a warm-up drill, a teaching drill, and a play. */
const EXAMPLES: Record<SportKind, [string, string, string]> = {
  basketball: ['Dynamic warm-up', 'Shell drill', 'Give and go'],
  baseball: ['Throwing progression', 'Ground ball triangles', 'Bunt defense'],
  football: ['Dynamic warm-up', 'Form tackling', 'Slant pass'],
};

// --- Pictures ---------------------------------------------------------------

/** Drills, plays and your own items all feed a practice. */
function FlowArt() {
  return (
    <div className="tour-art tour-flow">
      <div className="tour-flow-in">
        <span className="tour-chip drill">Drills</span>
        <span className="tour-chip play">Plays</span>
        <span className="tour-chip custom">Your own items</span>
      </div>
      <span className="tour-arrow" aria-hidden="true">
        →
      </span>
      <span className="tour-chip practice">Practice</span>
    </div>
  );
}
function RosterArt() {
  return (
    <ul className="tour-art tour-rows">
      {[
        ['12', 'Jordan Smith'],
        ['4', 'Sam Lee'],
        ['23', 'Riley Cruz'],
      ].map(([n, name]) => (
        <li key={n}>
          <span className="tour-num">{n}</span>
          {name}
        </li>
      ))}
    </ul>
  );
}
/** One drill, used again and again. */
function DrillArt({ sport }: { sport: SportKind }) {
  return (
    <div className="tour-art tour-drill">
      <div className="tour-card">
        <strong>{EXAMPLES[sport][1]}</strong>
        <span className="tour-meta">
          <span className="tour-pill">15 min</span>
          <span className="tour-chip drill">Drill</span>
        </span>
      </div>
      <span className="tour-arrow" aria-hidden="true">
        →
      </span>
      <div className="tour-uses">
        <span>Tue practice</span>
        <span>Thu practice</span>
        <span>Sat practice</span>
      </div>
    </div>
  );
}
/** A play running, on the surface for the coach's sport. */
function PlayArt({ sport }: { sport: SportKind }) {
  const still = useReducedMotion();
  const scene = SCENES.find((s) => s.sport.toLowerCase() === sport) ?? SCENES[0];
  return (
    <div className="tour-art tour-play">
      <HeroPlay scene={scene} still={still} />
    </div>
  );
}
/** A practice built from drills, a play, a break and something typed in on the spot. */
function TimelineArt({ sport }: { sport: SportKind }) {
  const [warm, teach, play] = EXAMPLES[sport];
  const rows: [string, string, string, string][] = [
    ['5:30', warm, 'drill', 'Drill'],
    ['5:40', teach, 'drill', 'Drill'],
    ['5:55', play, 'play', 'Play'],
    ['6:05', 'Water break', 'break', 'Break'],
    ['6:10', 'Team talk', 'custom', 'Custom'],
  ];
  return (
    <ul className="tour-art tour-timeline">
      {rows.map(([time, name, kind, label]) => (
        <li key={time}>
          <time>{time}</time>
          <span>{name}</span>
          <span className={`tour-chip ${kind}`}>{label}</span>
        </li>
      ))}
    </ul>
  );
}
function ChecklistArt() {
  return (
    <ul className="tour-art tour-rows">
      {['50 form shots', '10 minutes of ball handling', 'Watch the film clip'].map((t, i) => (
        <li key={t}>
          <span className={`tour-box ${i === 0 ? 'on' : ''}`} aria-hidden="true">
            {i === 0 ? '✓' : ''}
          </span>
          {t}
        </li>
      ))}
    </ul>
  );
}
function TilesArt() {
  return (
    <div className="tour-art tour-tiles">
      <span>
        <b aria-hidden="true">▶</b>Film
      </span>
      <span>
        <b aria-hidden="true">▧</b>Pictures
      </span>
      <span>
        <b aria-hidden="true">↗</b>Links
      </span>
    </div>
  );
}
/** Time spent against a target, per category. */
function BarsArt() {
  const bars: [string, number, number][] = [
    ['Offense', 78, 60],
    ['Defense', 34, 55],
    ['Skills', 52, 50],
  ];
  return (
    <ul className="tour-art tour-bars">
      {bars.map(([name, value, target]) => (
        <li key={name}>
          <span>{name}</span>
          <span className="tour-bar">
            <i style={{ width: `${value}%` }} />
            <u style={{ left: `${target}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
function ChatArt({ sport }: { sport: SportKind }) {
  return (
    <div className="tour-art tour-chat">
      <p>Anyone have a good press break?</p>
      <p className="mine">
        Sharing mine now. <span className="tour-chip play">{EXAMPLES[sport][2]}</span>
      </p>
    </div>
  );
}

// --- Steps ------------------------------------------------------------------

interface Step {
  id: string;
  /** What to light up: a link in the menu, or a button on the page. Nothing means a card in the middle. */
  target?: string;
  /** The page shown behind the card. */
  route?: string;
  /** Skipped until there is a team, because the page it points at is not reachable before then. */
  needsTeam?: boolean;
  title: string;
  text: string;
  points?: string[];
  art?: (sport: SportKind) => ReactNode;
}
const nav = (to: string) => `.side-nav a[href="${to}"]`;
const PAGE_BUTTON = '.page-head .head-actions .btn.primary';
const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to Dime Coach',
    text: 'Build drills and plays once, then put them together into practices. This quick tour points out where everything lives.',
    points: ['Skip it whenever you like.', 'Reopen it any time with "Take the tour" at the bottom of the menu.'],
    art: () => <FlowArt />,
  },
  {
    id: 'teams',
    target: nav('/teams'),
    route: '/teams',
    title: 'Start with your team',
    text: 'Everything belongs to a team: a sport, a season and a roster of players.',
    points: ['Coach more than one team? Switch between them at the top of the menu.', 'Share a team with an assistant coach and choose what they can change.'],
    art: () => <RosterArt />,
  },
  {
    id: 'drills',
    target: nav('/library'),
    route: '/library',
    title: 'Drills you write once and reuse',
    text: 'A drill is one activity: a name, how long it takes, and your coaching notes. Drop the same drill into as many practices as you like.',
    art: (sport) => <DrillArt sport={sport} />,
  },
  {
    id: 'new-drill',
    target: PAGE_BUTTON,
    route: '/library',
    needsTeam: true,
    title: 'Add your own drills',
    text: 'Your account starts with a few examples. Create your own here, and they are ready to use in every practice from then on.',
  },
  {
    id: 'playbook',
    target: nav('/playbook'),
    route: '/playbook',
    title: 'Plays that move',
    text: 'Draw a play step by step on a court or field for your sport, then press play and watch it run.',
    points: ['Attach plays to drills and practices, or print them on their own.'],
    art: (sport) => <PlayArt sport={sport} />,
  },
  {
    id: 'practices',
    target: nav('/practices'),
    route: '/practices',
    title: 'Put it together into a practice',
    text: 'A practice is your plan for one day. Build it from your drills and plays, and type in anything of your own on the spot: a team talk, a scrimmage, a water break.',
    points: ['Start times work themselves out as you add and reorder.'],
    art: (sport) => <TimelineArt sport={sport} />,
  },
  {
    id: 'new-practice',
    target: PAGE_BUTTON,
    route: '/practices',
    needsTeam: true,
    title: 'Plan a practice from here',
    text: 'Start a new practice with this button. Switch to the calendar to see the whole season, and print a practice to take to the gym or field.',
  },
  {
    id: 'homework',
    target: nav('/homework'),
    route: '/homework',
    title: 'Homework for between practices',
    text: 'Homework is a plan players do on their own. It is built the same way as a practice.',
    art: () => <ChecklistArt />,
  },
  {
    id: 'resources',
    target: nav('/resources'),
    route: '/resources',
    title: 'Film, pictures and links',
    text: 'Keep them in one place, and attach them to drills, plays and practice items so they are on hand when you need them.',
    art: () => <TilesArt />,
  },
  {
    id: 'categories',
    target: nav('/tags'),
    route: '/tags',
    title: 'Keep practices balanced',
    text: 'Categories label what a drill works on. Give each one a target share of practice time, and the dashboard shows where you are over or under.',
    art: () => <BarsArt />,
  },
  {
    id: 'communities',
    target: nav('/communities'),
    route: '/communities',
    title: 'Trade ideas with other coaches',
    text: 'A community is a group of coaches. Talk, and share drills, plays and practice plans.',
    points: ['Nothing of yours is shared unless you choose to share it.'],
    art: (sport) => <ChatArt sport={sport} />,
  },
  {
    id: 'done',
    target: nav('/'),
    route: '/',
    title: 'You are set',
    text: 'The dashboard is home: what is coming up next, and how your practice time has been spent. A good first step is to set up your team and add your players.',
    art: () => <FlowArt />,
  },
];

const CARD_WIDTH = 380;
const EDGE = 12;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A walk through the app for someone new. Each step lights up the part of the screen it is about
 * and opens that page behind the card. Skip, the close button and Escape all leave it.
 */
export default function Tour({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const navigate = useNavigate();
  const startedAt = useRef(useLocation().pathname);
  const sport = sportKind(app.sport?.name) ?? 'basketball';
  const hasTeam = !!app.team;
  const steps = useMemo(() => STEPS.filter((s) => !s.needsTeam || hasTeam), [hasTeam]);
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const [spot, setSpot] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const card = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(0);

  /** Leaves the tour, going back to the page it was started from unless told otherwise. */
  const leave = (to = startedAt.current) => {
    onClose();
    navigate(to);
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') leaveRef.current();
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(steps.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps.length]);

  // Open the step's page, then keep finding the thing to light up: it can arrive a moment after the page does.
  useEffect(() => {
    if (step.route) navigate(step.route);
    let scrolled = false;
    const measure = () => {
      setView((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      const el = step.target ? document.querySelector(step.target) : null;
      const r = el?.getBoundingClientRect();
      if (!el || !r || r.width === 0) return setSpot(null);
      if (!scrolled) {
        scrolled = true;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      setSpot((s) => (s && s.x === r.left && s.y === r.top && s.w === r.width && s.h === r.height ? s : { x: r.left, y: r.top, w: r.width, h: r.height }));
    };
    measure();
    const timer = setInterval(measure, 150);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  useLayoutEffect(() => {
    const h = card.current?.offsetHeight ?? 0;
    if (h && h !== cardHeight) setCardHeight(h);
  });

  const width = Math.min(CARD_WIDTH, view.w - EDGE * 2);
  const height = cardHeight || 420;
  let at: CSSProperties;
  if (!spot) at = { left: (view.w - width) / 2, top: Math.max(EDGE, (view.h - height) / 2) };
  // On a narrow screen the menu is a row along the top, so the card sits at the bottom out of its way.
  else if (view.w <= 900) at = { left: (view.w - width) / 2, top: Math.max(EDGE, view.h - height - EDGE) };
  // Beside a link in the side menu.
  else if (spot.x + spot.w < 320) at = { left: spot.x + spot.w + 20, top: clamp(spot.y - 28, EDGE, view.h - height - EDGE) };
  // Under a button on the page, or above it when there is no room below.
  else {
    const below = spot.y + spot.h + 16;
    at = { left: clamp(spot.x + spot.w - width, EDGE, view.w - width - EDGE), top: below + height + EDGE <= view.h ? below : Math.max(EDGE, spot.y - height - 16) };
  }

  return (
    <div className="tour-layer">
      <div className="tour-block" />
      {spot ? <div className="tour-spot" style={{ left: spot.x - 6, top: spot.y - 6, width: spot.w + 12, height: spot.h + 12 }} /> : <div className="tour-dim" />}
      <div ref={card} className="tour" role="dialog" aria-modal="true" aria-label="Tour of Dime Coach" style={{ ...at, width }}>
        <div className="tour-top">
          <span className="muted small">
            {index + 1} of {steps.length}
          </span>
          <button type="button" className="btn ghost" onClick={() => leave()} aria-label="Close the tour">
            ✕
          </button>
        </div>
        <div className="tour-body" aria-live="polite">
          {step.art?.(sport)}
          <h2>{step.title}</h2>
          <p>{step.text}</p>
          {step.points && (
            <ul className="tour-points">
              {step.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s.id} className={i === index ? 'on' : ''} />
          ))}
        </div>
        <div className="tour-foot">
          {!last && (
            <button type="button" className="link small" onClick={() => leave()}>
              Skip the tour
            </button>
          )}
          <span className="tour-spacer" />
          {index > 0 && (
            <button type="button" className="btn" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          {last ? (
            <>
              <button type="button" className="btn" onClick={() => leave('/teams')}>
                Set up my team
              </button>
              <button type="button" className="btn primary" onClick={() => leave('/')}>
                Done
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" onClick={() => setIndex(index + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
