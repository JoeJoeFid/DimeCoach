import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { LINE_WORDS, sportKind, surfaceWord } from '../sports';
import { Modal } from './bits';

// Small drawings for each card: a few players, a player with a line, and the row of steps.
const Art = ({ step }: { step: number }) => (
  <svg className="play-intro-art" viewBox="0 0 240 120" aria-hidden="true">
    <rect x="1" y="1" width="238" height="118" rx="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
    {step === 0 && (
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <circle cx="70" cy="42" r="13" />
        <circle cx="126" cy="80" r="13" />
        <path d="M168 30l20 20M188 30l-20 20" />
        <path d="M40 92h26M53 79v26" strokeOpacity="0.5" />
      </g>
    )}
    {step === 1 && (
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="52" cy="82" r="13" />
        <path d="M66 74C104 60 140 52 178 34" />
        <path d="M162 30l17 4-8 15" />
        <circle cx="196" cy="84" r="13" strokeOpacity="0.5" />
        <path d="M67 84h112" strokeDasharray="6 8" strokeOpacity="0.5" />
      </g>
    )}
    {step === 2 && (
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <rect x="24" y="38" width="48" height="44" rx="8" />
        <rect x="84" y="38" width="48" height="44" rx="8" />
        <rect x="144" y="38" width="72" height="44" rx="8" strokeDasharray="6 7" />
        <path d="M170 60h20M180 50v20" />
        <text x="48" y="67" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor" stroke="none">
          1
        </text>
        <text x="108" y="67" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor" stroke="none">
          2
        </text>
      </g>
    )}
  </svg>
);

/**
 * A short introduction to drawing a play, shown the first time someone opens the playbook and
 * remembered with their account. `force` shows it again when asked for.
 */
export default function PlayIntro({ force, onClose }: { force?: boolean; onClose?: () => void }) {
  const { user, sport, touring, refreshUser } = useApp();
  const [step, setStep] = useState(0);
  const [closed, setClosed] = useState(false);
  // The welcome tour has its own say about the playbook, so this waits its turn.
  if (closed || (!force && (user.prefs.play_intro_done || touring))) return null;
  const kind = sportKind(sport?.name) ?? 'basketball';
  const surface = surfaceWord(kind);
  const words = LINE_WORDS[kind];
  const cards = [
    {
      title: `Put your players on the ${surface}`,
      text: `Drag Offense and Defense from the tools onto the ${surface}, or click a tool and then click where it goes. Cones and labels work the same way. Select a player to give them the ball.`,
    },
    {
      title: 'Give players something to do',
      text: `Drag an action such as ${words.cut.label}, ${words.pass.label} or ${words.dribble.label} onto a player, then click where it ends. Each line is one movement, and "Order of movement" sets which goes first.`,
    },
    {
      title: 'Press "+ Next step" for what happens next',
      text: 'A new step starts with everyone where the last one left them. Add that step\'s actions, and keep going. "Play animation" runs the whole play, one step after another.',
    },
  ];
  const done = () => {
    setClosed(true);
    onClose?.();
    if (!user.prefs.play_intro_done) api.savePrefs({ play_intro_done: true }).then(refreshUser, () => {});
  };
  const last = step === cards.length - 1;
  return (
    <Modal title="How to draw a play" onClose={done}>
      <div className="play-intro">
        <Art step={step} />
        <p className="muted small play-intro-count">
          {step + 1} of {cards.length}
        </p>
        <h3>{cards[step].title}</h3>
        <p>{cards[step].text}</p>
      </div>
      <div className="modal-actions">
        {!last && (
          <button type="button" className="btn ghost" onClick={done}>
            Skip
          </button>
        )}
        {step > 0 && (
          <button type="button" className="btn" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        <button type="button" className="btn primary" onClick={() => (last ? done() : setStep(step + 1))}>
          {last ? 'Got it' : 'Next'}
        </button>
      </div>
    </Modal>
  );
}
