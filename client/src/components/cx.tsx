// The building blocks of the community and organization pages: a page heading, number tiles,
// rows that lead somewhere, things that need attention, and the "season › league › team" selectors.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TopTabs } from './TopTabs';

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
export const Pill = ({ tone = 'plain', children }: { tone?: 'ok' | 'warn' | 'bad' | 'plain'; children: ReactNode }) => <span className={`cx-pill ${tone}`}>{children}</span>;

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
export function SubTabs<T extends string>({ tabs, value, onChange, label, boxed, fold }: { /** Each tab: what it is, what it says (words, or words with an icon), and a count when it has one. */ tabs: [T, ReactNode, number?][]; value: T; onChange: (t: T) => void; label: string; /** Drawn as the boxed bar at the top of a page, as on Team. */ boxed?: boolean; /** With `boxed`: on a phone, only the chosen tab keeps its words. */ fold?: boolean }) {
  if (boxed) return <TopTabs tabs={tabs} value={value} onChange={onChange} label={label} fold={fold} />;
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

/** Whether a list is shown as large cards or small rows. The choice is kept on this device, under `key`. */
export function useCompact(key: string): [boolean, (on: boolean) => void] {
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const choose = (on: boolean) => {
    setCompact(on);
    try {
      localStorage.setItem(key, on ? '1' : '0');
    } catch {
      /* no storage: it lasts until the page is left */
    }
  };
  return [compact, choose];
}
/** "Cards" or "Compact", at the end of a list's row of filters. */
export function LayoutToggle({ compact, onChange }: { compact: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="seg" role="group" aria-label="Layout">
      <button type="button" className={compact ? '' : 'on'} aria-pressed={!compact} onClick={() => onChange(false)}>
        Cards
      </button>
      <button type="button" className={compact ? 'on' : ''} aria-pressed={compact} onClick={() => onChange(true)}>
        Compact
      </button>
    </div>
  );
}
/** The heading of the box that says what is on air: a broadcast sign on a red tile, and "Broadcast". */
export function BroadcastHead() {
  return (
    <div className="cx-card-head">
      <h2 className="fam-h">
        <span className="fam-ico live" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 13.5a1.500 1.500 0 1 0 0-3 1.500 1.500 0 0 0 0 3ZM8.500 15.500a5 5 0 0 1 0-7M15.500 8.500a5 5 0 0 1 0 7M5.800 18.200a9 9 0 0 1 0-12.400M18.200 5.800a9 9 0 0 1 0 12.400" />
          </svg>
        </span>
        Broadcast
      </h2>
    </div>
  );
}
/** The picture for nothing on air: a screen with nothing on it yet, between two clouds. */
export function BroadcastArt() {
  return (
    <svg className="bc-art" viewBox="0 0 220 76" width="220" height="76" fill="none" aria-hidden="true">
      <path className="fam-quiet-cloud" d="M12 62a14 14 0 0 1 14-14 18 18 0 0 1 34-3 12 12 0 0 1 14 17Z" />
      <path className="fam-quiet-cloud" d="M150 62a11 11 0 0 1 11-11 15 15 0 0 1 28-2 10 10 0 0 1 12 13Z" />
      <rect className="fam-quiet-screen" x="80" y="16" width="62" height="44" rx="9" />
      <path className="fam-quiet-play" d="M105 29v18l15-9Z" />
      <path className="fam-quiet-spark" d="M148 14l8-8M153 21l11-4M150 28h9" />
    </svg>
  );
}
/** Nothing on air: the picture, and the words under it. */
export function BroadcastQuiet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fam-quiet">
      <BroadcastArt />
      <strong>{title}</strong>
      {children}
    </div>
  );
}
/**
 * A thing's categories as a row of their colors, for the compact list of resources. Pointing at it,
 * or reaching it with the keyboard, names them. Nothing is drawn with no categories.
 */
export function CategoryDots({ tags }: { tags: { name: string; color: string }[] }) {
  if (!tags.length) return null;
  return (
    <span className="res-dots" tabIndex={0} aria-label={`Categories: ${tags.map((t) => t.name).join(', ')}`}>
      <span className="res-dots-word">{tags.length === 1 ? 'Category' : 'Categories'}</span>
      {tags.map((t) => (
        <span key={t.name} className="dot" style={{ background: t.color }} />
      ))}
      <span className="res-dots-pop" role="tooltip">
        {tags.map((t) => (
          <span key={t.name}>
            <span className="dot" style={{ background: t.color }} />
            {t.name}
          </span>
        ))}
      </span>
    </span>
  );
}
/**
 * A short list of choices for the box down the left of a list page, one above the other: "All", then
 * each choice with how many it holds. Pressing the chosen one again goes back to all. Nothing is
 * drawn when there are no choices.
 */
export function SideChoices<T extends string | number>({ title, all, allLabel = 'All', total, items, value, onChange }: { title: string; /** What `value` is when everything shows. */ all: T; allLabel?: string; total: number; items: { id: T; label: string; count: number; color?: string }[]; value: T; onChange: (id: T) => void }) {
  if (!items.length) return null;
  return (
    <section>
      <h2>{title}</h2>
      <div className="ps-side-filter" role="group" aria-label={title}>
        <button type="button" className={value === all ? 'on' : ''} aria-pressed={value === all} onClick={() => onChange(all)}>
          <span>{allLabel}</span>
          <span className="ps-side-count">{total}</span>
        </button>
        {items.map((c) => (
          <button key={String(c.id)} type="button" className={value === c.id ? 'on' : ''} aria-pressed={value === c.id} onClick={() => onChange(value === c.id ? all : c.id)}>
            <span>
              {c.color && <span className="dot" style={{ background: c.color }} />}
              {c.label}
            </span>
            <span className="ps-side-count">{c.count}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
/**
 * The row of categories under a list's filters: "All", then each category with how many it holds.
 * Pressing the chosen one again goes back to all. Nothing is drawn when there are no categories.
 */
export function CategoryChips<T extends string | number>({ all, total, items, value, onChange }: { /** What `value` is when every category shows. */ all: T; total: number; items: { id: T; label: string; count: number; color?: string }[]; value: T; onChange: (id: T) => void }) {
  if (!items.length) return null;
  return (
    <div className="chips category-filter" role="group" aria-label="Filter by category">
      <button type="button" className={`chip toggle ${value === all ? 'on' : ''}`} aria-pressed={value === all} onClick={() => onChange(all)}>
        All <span className="chip-num">{total}</span>
      </button>
      {items.map((c) => (
        <button key={String(c.id)} type="button" className={`chip toggle ${value === c.id ? 'on' : ''}`} aria-pressed={value === c.id} onClick={() => onChange(value === c.id ? all : c.id)}>
          {c.color && <span className="dot" style={{ background: c.color }} />}
          {c.label} <span className="chip-num">{c.count}</span>
        </button>
      ))}
    </div>
  );
}
