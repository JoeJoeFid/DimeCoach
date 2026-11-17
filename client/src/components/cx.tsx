// The building blocks of the community and organization pages: a page heading, number tiles,
// rows that lead somewhere, things that need attention, and the "season › league › team" selectors.
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** The top of a page: where you are in small letters, the title, a line under it, and its main action. */
export function PageHead({ eyebrow, title, sub, children }: { eyebrow: string; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="cx-head">
      <div>
        <span className="cx-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {children && <div className="cx-head-actions">{children}</div>}
    </header>
  );
}

/** One number with what it counts. Pressing it goes to where the number comes from, when there is such a place. */
export function Stat({ value, label, note, warn, onClick }: { value: ReactNode; label: string; note?: ReactNode; warn?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <strong>{value}</strong>
      <span>{label}</span>
      {note && <small className={warn ? 'warn' : ''}>{note}</small>}
    </>
  );
  return onClick ? (
    <button type="button" className="cx-stat" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="cx-stat">{inner}</div>
  );
}

/** Letters in a circle, for a thing that has no picture. The color is always the same for the same words. */
export function Badge({ text, children }: { text: string; children?: ReactNode }) {
  let n = 0;
  for (const ch of text) n = (n * 31 + ch.charCodeAt(0)) % 360;
  const letters = text
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
  return (
    <span className="cx-badge" style={{ '--hue': n } as React.CSSProperties} aria-hidden="true">
      {children ?? letters}
    </span>
  );
}

export const Chevron = () => (
  <svg className="cx-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

/** One line of a list: a sign, a title with a line under it, and something at the end. The whole line is a button when it leads somewhere. */
export function Row({ lead, title, sub, end, onClick }: { lead?: ReactNode; title: ReactNode; sub?: ReactNode; end?: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      {lead}
      <span className="cx-row-text">
        <strong>{title}</strong>
        {sub && <span className="muted small">{sub}</span>}
      </span>
      {end && <span className="cx-row-end">{end}</span>}
      {onClick && <Chevron />}
    </>
  );
  return (
    <li>
      {onClick ? (
        <button type="button" className="cx-row" onClick={onClick}>
          {inner}
        </button>
      ) : (
        <div className="cx-row">{inner}</div>
      )}
    </li>
  );
}

/** Something that needs doing, with the way to do it. */
export function Alert({ title, sub, action, onAction }: { title: ReactNode; sub?: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="cx-alert">
      <span className="cx-alert-sign" aria-hidden="true">
        !
      </span>
      <span className="cx-row-text">
        <strong>{title}</strong>
        {sub && <span className="small">{sub}</span>}
      </span>
      {action && onAction && (
        <button type="button" className="link cx-alert-go" onClick={onAction}>
          {action} →
        </button>
      )}
    </div>
  );
}

/** A short word about the state of something. */
export const Pill = ({ tone = 'plain', children }: { tone?: 'ok' | 'warn' | 'plain'; children: ReactNode }) => <span className={`cx-pill ${tone}`}>{children}</span>;

/** A day, as the month over the number. */
export function DateBlock({ date }: { date: string }) {
  const d = new Date(`${date}T12:00:00`);
  return (
    <span className="cx-date" aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}>
      <small>{d.toLocaleDateString(undefined, { month: 'short' })}</small>
      <b>{d.getDate()}</b>
    </span>
  );
}

export interface Crumb {
  /** What kind of thing it is: "Season", "League", "Team". */
  label: string;
  /** The one being looked at, or the words for "none chosen". */
  value: string;
  options: { id: number; label: string; note?: string }[];
  /** The one that is open now, or 0. */
  current: number;
  onPick: (id: number) => void;
  /** A first choice that steps back up, such as "All leagues". */
  all?: string;
}
/**
 * Where you are, as a row of selectors: season › league › team. Each opens a list to jump
 * sideways to another one of the same kind, without going back up first.
 */
export function Crumbs({ items }: { items: Crumb[] }) {
  const [open, setOpen] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open < 0) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(-1);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(-1);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="cx-crumbs" ref={box}>
      {items.map((it, i) => (
        <span key={it.label} className="cx-crumb-wrap">
          {i > 0 && (
            <span className="cx-crumb-sep" aria-hidden="true">
              ›
            </span>
          )}
          <button type="button" className={`cx-crumb ${i === items.length - 1 ? 'last' : ''}`} aria-haspopup="listbox" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
            <span>
              <small>{it.label}</small>
              <b>{it.value}</b>
            </span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {open === i && (
            <ul className="cx-menu" role="listbox" aria-label={it.label}>
              {it.all && (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={it.current === 0}
                    className={it.current === 0 ? 'on' : ''}
                    onClick={() => {
                      setOpen(-1);
                      it.onPick(0);
                    }}
                  >
                    <span>{it.all}</span>
                  </button>
                </li>
              )}
              {it.options.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.id === it.current}
                    className={o.id === it.current ? 'on' : ''}
                    onClick={() => {
                      setOpen(-1);
                      it.onPick(o.id);
                    }}
                  >
                    <span>{o.label}</span>
                    {o.note && <small>{o.note}</small>}
                  </button>
                </li>
              ))}
              {it.options.length === 0 && <li className="muted small cx-menu-none">Nothing here yet.</li>}
            </ul>
          )}
        </span>
      ))}
    </div>
  );
}

/** Smaller tabs inside a page. */
export function SubTabs<T extends string>({ tabs, value, onChange, label }: { tabs: [T, string, number?][]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="cx-subtabs" role="tablist" aria-label={label}>
      {tabs.map(([id, text, count]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
          {text}
          {!!count && <span className="cm-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}
