import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Step {
  /** Key of the sidebar icon this step is about, if any. */
  icon?: string;
  /** Where in the menu to find it. */
  where?: string;
  title: string;
  text: string;
  points?: string[];
}
const STEPS: Step[] = [
  {
    title: 'Welcome to Dime Coach',
    text: 'Dime Coach is where you plan practices and keep everything you coach with. This tour explains each part of the menu and takes about a minute.',
    points: ['Skip it whenever you like.', 'Reopen it any time with "Take the tour" at the bottom of the menu.'],
  },
  {
    icon: 'teams',
    where: 'Team → Teams & rosters',
    title: 'Teams & rosters',
    text: 'Everything belongs to a team. A team has a sport, a season and a roster of players.',
    points: ['Coach more than one team? Switch between them at the top of the menu.', 'Share a team with an assistant coach and choose what they can change.'],
  },
  {
    icon: 'library',
    where: 'Library → Drills',
    title: 'Drills',
    text: 'A drill is one activity you run at practice: a name, how long it takes, and your coaching notes.',
    points: ['Write a drill once and reuse it in any practice.', 'Your account starts with a few so you are not looking at an empty page.'],
  },
  {
    icon: 'tags',
    where: 'Team → Categories',
    title: 'Categories',
    text: 'Categories are labels for what a drill works on, such as shooting, hitting or tackling.',
    points: ['Give each one a target share of practice time.', 'The dashboard then shows whether your practices are balanced.'],
  },
  {
    icon: 'practices',
    where: 'Plan → Practices',
    title: 'Practices',
    text: 'A practice is a plan for one day: drills and breaks in the order you will run them.',
    points: ['Start times work themselves out as you add, remove or reorder.', 'See them as a list or a calendar, and print one to take to the gym or field.'],
  },
  {
    icon: 'homework',
    where: 'Plan → Homework',
    title: 'Homework',
    text: 'Homework is a plan players do on their own between practices. It is built the same way as a practice.',
  },
  {
    icon: 'playbook',
    where: 'Library → Playbook',
    title: 'Playbook',
    text: 'The playbook is where you draw plays, step by step, on a court or field for your sport.',
    points: ['Press play to watch a play run.', 'Attach plays to a practice, or print them on their own.'],
  },
  {
    icon: 'resources',
    where: 'Library → Resources',
    title: 'Resources',
    text: 'Resources are your film, pictures and links, kept in one place.',
    points: ['Attach them to drills, plays and practice items so they are on hand when you need them.'],
  },
  {
    icon: 'community',
    where: 'Community → Communities',
    title: 'Communities',
    text: 'A community is a group of coaches. Use one to talk, and to trade drills, plays and practice plans.',
    points: ['Nothing of yours is shared unless you choose to share it.'],
  },
  {
    icon: 'dashboard',
    where: 'Dashboard',
    title: 'You are set',
    text: 'The dashboard is your home page: what is coming up next and how your practice time has been spent. A good first step is to set up your team and add your players.',
  },
];

/** A short walk through the menu for someone new. Skip, the close button and Escape all leave it. */
export default function Tour({ icons, onClose }: { icons: Record<string, string>; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(STEPS.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-back tour-back">
      <div className="modal tour" role="dialog" aria-modal="true" aria-label="Tour of Dime Coach">
        <div className="tour-top">
          <span className="muted small">
            {index + 1} of {STEPS.length}
          </span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close the tour">
            ✕
          </button>
        </div>
        <div className="tour-body" aria-live="polite">
          {step.icon && (
            <span className="tour-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={icons[step.icon]} />
              </svg>
            </span>
          )}
          <h2>{step.title}</h2>
          {step.where && <p className="tour-where">{step.where}</p>}
          <p>{step.text}</p>
          {step.points && (
            <ul>
              {step.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="tour-dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.title} className={i === index ? 'on' : ''} />
          ))}
        </div>
        <div className="tour-foot">
          {!last && (
            <button type="button" className="link small" onClick={onClose}>
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
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onClose();
                  navigate('/teams');
                }}
              >
                Set up my team
              </button>
              <button type="button" className="btn primary" autoFocus onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" autoFocus onClick={() => setIndex(index + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
