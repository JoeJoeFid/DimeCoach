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
  volleyball: ['Serving warm-up', 'Serve receive', 'Outside attack'],
};

// --- Pictures ---------------------------------------------------------------

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
/** A small practice plan, with a drill being dragged out of the list and dropped into it, over and over. */
function DragArt({ sport }: { sport: SportKind }) {
  const [warm, teach, play] = EXAMPLES[sport];
  return (
    <div className="choice-art drag-art" aria-hidden="true">
      <div className="da-list">
        <span className="da-label">Drills</span>
        <span className="da-tile">{warm}</span>
        <span className="da-tile">Scrimmage</span>
        <span className="da-tile da-source">{teach}</span>
      </div>
      <div className="da-plan">
        <span className="da-label">Practice</span>
        <span className="da-row">
          <time>5:30</time>
          {warm}
        </span>
        <span className="da-slot">
          <span className="da-drop">Drop here</span>
          <span className="da-row da-landed">
            <time>5:40</time>
            {teach}
          </span>
        </span>
        <span className="da-row">
          <time>5:55</time>
          {play}
        </span>
        <span className="da-row da-break">
          <time>6:05</time>
          Water break
        </span>
      </div>
      <span className="da-fly">
        {teach}
        <svg viewBox="0 0 16 16" width="15" height="15">
          <path d="M3 2l9.500 4.600-4 1.300-1.500 4.100z" fill="#fff" stroke="#0d0d0e" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}
/** The play for the coach's sport, running on its own court or field, as it looks in the playbook. */
function RunningPlayArt({ sport }: { sport: SportKind }) {
  const still = useReducedMotion();
  const scene = SCENES.find((s) => s.sport.toLowerCase() === sport) ?? SCENES[0];
  return (
    <div className="choice-art play-art" aria-hidden="true">
      <HeroPlay scene={scene} still={still} />
    </div>
  );
}
/** A play is a few steps in a row, then it runs. */
function StepsArt() {
  return (
    <div className="tour-art tour-steps">
      <span className="tour-chip play">Step 1</span>
      <span className="tour-arrow" aria-hidden="true">
        →
      </span>
      <span className="tour-chip play">Step 2</span>
      <span className="tour-arrow" aria-hidden="true">
        →
      </span>
      <span className="tour-chip play">Step 3</span>
      <span className="tour-arrow" aria-hidden="true">
        →
      </span>
      <span className="tour-chip practice">▶ Play</span>
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
/** The schedule from the team app: every practice already on its date, waiting for a plan. */
function ShellsArt() {
  const rows: [string, string, boolean][] = [
    ['Tue', 'Practice · 5:30 PM', true],
    ['Thu', 'Practice · 5:30 PM', false],
    ['Sat', 'Practice · 9:00 AM', false],
  ];
  return (
    <ul className="tour-art tour-timeline">
      {rows.map(([day, what, planned]) => (
        <li key={day}>
          <time>{day}</time>
          <span>{what}</span>
          <span className={`tour-chip ${planned ? 'drill' : 'break'}`}>{planned ? 'Planned' : 'No plan yet'}</span>
        </li>
      ))}
    </ul>
  );
}

// --- Steps ------------------------------------------------------------------

type Path = 'practices' | 'playbook';
interface Step {
  id: string;
  /** What to light up: a link in the menu, or a button on the page. Nothing means a card in the middle. */
  target?: string;
  /** The page shown behind the card. */
  route?: string;
  /** For a panel part way down a page: bring it to the top, so the card fits underneath. */
  toTop?: boolean;
  /** Skipped until there is a team, because the page it points at is not reachable before then. */
  needsTeam?: boolean;
  title: string;
  text: string;
  points?: string[];
  art?: (sport: SportKind) => ReactNode;
}
const nav = (to: string) => `.side-nav a[href="${to}"]`;
const PAGE_BUTTON = '.page-head .head-actions .btn.primary';
/** The first card: nothing lit, and a choice of what to be shown. */
const CHOOSE: Step = { id: 'choose', title: 'Welcome to Dime Coach', text: 'What would you like to do first? Pick one for a short look around.' };
const PATHS: Record<Path, { label: string; blurb: string; other: string; steps: Step[] }> = {
  practices: {
    label: 'Plan practices',
    blurb: 'Build practices from drills you write once and reuse.',
    other: 'Show me the playbook',
    steps: [
      {
        id: 'drills',
        target: nav('/library'),
        route: '/library',
        title: 'Practices start with drills',
        text: 'A drill is one activity: a name, how long it takes, and your coaching notes. Write it once and drop it into as many practices as you like.',
        art: (sport) => <DrillArt sport={sport} />,
      },
      {
        id: 'new-drill',
        target: PAGE_BUTTON,
        route: '/library',
        needsTeam: true,
        title: 'Add your own drills',
        text: 'Your account starts with a few examples. Create your own here, and they are ready to pick from in every practice from then on.',
      },
      {
        id: 'practices',
        target: nav('/practices'),
        route: '/practices',
        title: 'Fill a practice from your drills',
        text: 'A practice is your plan for one day. Add drills from your list, and type in anything of your own on the spot: a team talk, a scrimmage, a water break.',
        points: ['Start times work themselves out as you add and reorder.'],
        art: (sport) => <TimelineArt sport={sport} />,
      },
      {
        id: 'new-practice',
        target: PAGE_BUTTON,
        route: '/practices',
        needsTeam: true,
        title: 'Plan a practice from here',
        text: 'This button starts a new practice. Inside it, "+ Item" lets you choose a drill or add a custom item. Print the finished plan to take with you.',
      },
      {
        id: 'gamechanger',
        target: '[data-tour="calendar"]',
        route: '/teams?tab=schedule',
        toTop: true,
        needsTeam: true,
        title: 'Bring in your schedule from GameChanger',
        text: 'On the Schedule integration tab, paste your team calendar link and every scheduled practice shows up on its date as an empty shell. Open one and fill it with drills.',
        points: ['Games come across too, so you can see what you are preparing for.', 'TeamSnap, SportsEngine and Google Calendar links work the same way.'],
        art: () => <ShellsArt />,
      },
    ],
  },
  playbook: {
    label: 'Build a playbook',
    blurb: 'Draw your plays step by step and watch them run.',
    other: 'Show me practices',
    steps: [
      {
        id: 'playbook',
        target: nav('/playbook'),
        route: '/playbook',
        title: 'Your playbook lives here',
        text: 'Every play you draw is kept here, sorted by kind, on a court or field for your sport.',
        art: (sport) => <PlayArt sport={sport} />,
      },
      {
        id: 'new-play',
        target: PAGE_BUTTON,
        route: '/playbook',
        needsTeam: true,
        title: 'Draw a play step by step',
        text: 'Start a play here. Place your players, draw where each one goes, then add the next step. Each step picks up where the last one ended.',
        art: () => <StepsArt />,
      },
      {
        id: 'animate',
        route: '/playbook',
        title: 'Then watch it run',
        text: 'Press play and the players move through every step. You choose which movements happen one after another and which happen at the same time.',
        art: (sport) => <PlayArt sport={sport} />,
      },
      {
        id: 'use-plays',
        target: nav('/practices'),
        route: '/practices',
        title: 'Take plays to practice',
        text: 'Attach a play to a drill or a practice item so it is on the plan when you need it, or print plays on their own.',
        art: (sport) => <TimelineArt sport={sport} />,
      },
    ],
  },
};
const DONE: Step = {
  id: 'done',
  target: nav('/'),
  route: '/',
  title: 'You are set',
  text: 'The dashboard is home: what is coming up next, and how your practice time has been spent.',
  points: ['The menu also has homework, film and links, categories, and communities of other coaches.', 'Reopen this any time with "Take the tour" at the bottom of the menu.'],
};

const CARD_WIDTH = 380;
const EDGE = 12;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A short look around for someone new. They pick what they came to do, plan practices or build a
 * playbook, and the tour walks through just that, lighting up each part of the screen it is about.
 * Skip, the close button and Escape all leave it.
 */
export default function Tour({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const navigate = useNavigate();
  const startedAt = useRef(useLocation().pathname);
  const sport = sportKind(app.sport?.name) ?? 'basketball';
  const hasTeam = !!app.team;
  const [path, setPath] = useState<Path | null>(null);
  // Which of the two have been shown, so the last card only offers the one not seen yet.
  const [seen, setSeen] = useState<Path[]>([]);
  const steps = useMemo(() => (path ? [...PATHS[path].steps.filter((s) => !s.needsTeam || hasTeam), DONE] : [CHOOSE]), [path, hasTeam]);
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = !!path && index >= steps.length - 1;
  const other: Path | null = path && !seen.includes(path === 'practices' ? 'playbook' : 'practices') ? (path === 'practices' ? 'playbook' : 'practices') : null;
  const [spot, setSpot] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const card = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(0);

  const start = (p: Path) => {
    setSeen((s) => [...s, p]);
    setPath(p);
    setIndex(0);
  };
  const back = () => (index > 0 ? setIndex(index - 1) : setPath(null));
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
        el.scrollIntoView({ block: step.toTop ? 'start' : 'nearest', inline: 'nearest' });
      }
      setSpot((s) => (s && s.x === r.left && s.y === r.top && s.w === r.width && s.h === r.height ? s : { x: r.left, y: r.top, w: r.width, h: r.height }));
    };
    measure();
    const timer = setInterval(measure, 150);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, step.id]);

  useLayoutEffect(() => {
    const h = card.current?.offsetHeight ?? 0;
    if (h && h !== cardHeight) setCardHeight(h);
  });

  const width = Math.min(path ? CARD_WIDTH : 820, view.w - EDGE * 2);
  const height = cardHeight || 420;
  let at: CSSProperties;
  if (!spot) at = { left: (view.w - width) / 2, top: Math.max(EDGE, (view.h - height) / 2) };
  // On a narrow screen the menu is a row along the top, so the card sits at the bottom out of its way.
  else if (view.w <= 900) at = { left: (view.w - width) / 2, top: Math.max(EDGE, view.h - height - EDGE) };
  // Beside a link in the side menu.
  else if (spot.x + spot.w < 320) at = { left: spot.x + spot.w + 20, top: clamp(spot.y - 28, EDGE, view.h - height - EDGE) };
  // Under a button or a panel on the page, or above it when there is no room below.
  else {
    const below = spot.y + spot.h + 16;
    at = { left: clamp(spot.x + spot.w - width, EDGE, view.w - width - EDGE), top: below + height + EDGE <= view.h ? below : Math.max(EDGE, spot.y - height - 16) };
  }

  return (
    <div className="tour-layer">
      <div className="tour-block" />
      {spot ? <div className="tour-spot" style={{ left: spot.x - 6, top: spot.y - 6, width: spot.w + 12, height: spot.h + 12 }} /> : <div className={`tour-dim ${path ? '' : 'deep'}`} />}
      <div ref={card} className="tour" role="dialog" aria-modal="true" aria-label="Tour of Dime Coach" style={{ ...at, width }}>
        <div className="tour-top">
          <span className="muted small">{path ? `${PATHS[path].label} · ${index + 1} of ${steps.length}` : ''}</span>
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
          {!path && (
            <div className="tour-choices">
              <button type="button" className="tour-choice" onClick={() => start('practices')}>
                <strong>{PATHS.practices.label}</strong>
                <span className="muted small">{PATHS.practices.blurb}</span>
                <DragArt sport={sport} />
              </button>
              <button type="button" className="tour-choice" onClick={() => start('playbook')}>
                <strong>{PATHS.playbook.label}</strong>
                <span className="muted small">{PATHS.playbook.blurb}</span>
                <RunningPlayArt sport={sport} />
              </button>
            </div>
          )}
        </div>
        {path && (
          <div className="tour-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} className={i === index ? 'on' : ''} />
            ))}
          </div>
        )}
        <div className="tour-foot">
          {!last && (
            <button type="button" className="link small" onClick={() => leave()}>
              {path ? 'Skip the tour' : 'Skip, I will look around myself'}
            </button>
          )}
          <span className="tour-spacer" />
          {path && (
            <button type="button" className="btn" onClick={back}>
              Back
            </button>
          )}
          {last ? (
            <>
              {other && (
                <button type="button" className="btn" onClick={() => start(other)}>
                  {PATHS[path!].other}
                </button>
              )}
              <button type="button" className="btn primary" onClick={() => leave(hasTeam ? '/' : '/teams')}>
                {hasTeam ? 'Done' : 'Set up my team'}
              </button>
            </>
          ) : (
            path && (
              <button type="button" className="btn primary" onClick={() => setIndex(index + 1)}>
                Next
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
