import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Plan } from '../types';
import { fmtClock, fmtDateShort, fmtDuration, schedule } from '../util';

const MAX_ROWS = 18;
const WIDTH = 330;

/**
 * A small "Preview" button. Hovering or focusing it shows the practice's schedule in a
 * condensed list: when each item starts, what it is and how long it runs. Clicking pins it open,
 * which is how it works on a touch screen.
 */
export default function SchedulePreview({ plan, label = 'Preview' }: { plan: Plan; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const button = useRef<HTMLButtonElement>(null);

  const rows = plan.items.slice(0, MAX_ROWS);
  const slots = schedule(plan.start_time, plan.items);
  const total = plan.items.reduce((s, i) => s + (i.duration_min || 0), 0);
  const timed = plan.kind === 'practice';

  const show = () => {
    const r = button.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    const height = 64 + rows.length * 23;
    // Open downward when there is room, otherwise upward.
    if (r.bottom + height + 8 <= window.innerHeight || r.top < height) setPlace({ left, top: r.bottom + 6 });
    else setPlace({ left, bottom: window.innerHeight - r.top + 6 });
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    setPinned(false);
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'pointerdown' && button.current?.contains(e.target as Node)) return;
      hide();
    };
    window.addEventListener('keydown', away);
    window.addEventListener('pointerdown', away);
    window.addEventListener('scroll', away, true);
    return () => {
      window.removeEventListener('keydown', away);
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open]);

  if (plan.items.length === 0) return null;

  return (
    <>
      <button
        ref={button}
        type="button"
        className="btn small preview-btn"
        aria-expanded={open}
        aria-label={`Preview the schedule for ${fmtDateShort(plan.date)}`}
        onMouseEnter={show}
        onMouseLeave={() => !pinned && setOpen(false)}
        onFocus={show}
        onBlur={() => !pinned && setOpen(false)}
        onClick={(e) => {
          // Inside a card that is itself a link, this must not follow the link.
          e.preventDefault();
          e.stopPropagation();
          if (pinned) hide();
          else {
            show();
            setPinned(true);
          }
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12ZM12 14.700a2.700 2.700 0 1 0 0-5.400 2.700 2.700 0 0 0 0 5.400Z" />
        </svg>
        {label}
      </button>
      {open &&
        createPortal(
          <div className="preview-pop" role="tooltip" style={{ ...place, width: WIDTH }}>
            <div className="preview-head">
              <strong>{plan.title || 'Practice'}</strong>
              <span>
                {[
                  fmtDateShort(plan.date),
                  timed && slots.length > 0 && `${fmtClock(slots[0].start)} - ${fmtClock(slots[slots.length - 1].end)}`,
                  fmtDuration(total),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <ol className="preview-rows">
              {rows.map((it, i) => (
                <li key={i} className={it.kind}>
                  {timed && <span className="preview-time">{fmtClock(slots[i].start)}</span>}
                  <span className="preview-title">{it.title || (it.kind === 'break' ? 'Break' : 'Untitled')}</span>
                  <span className="preview-dur">{timed || !it.reps ? `${it.duration_min}m` : it.reps}</span>
                </li>
              ))}
            </ol>
            {plan.items.length > MAX_ROWS && <div className="preview-more">and {plan.items.length - MAX_ROWS} more</div>}
          </div>,
          document.body,
        )}
    </>
  );
}
