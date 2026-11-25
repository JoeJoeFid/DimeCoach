import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Tag } from '../types';

export function TagChip({ tag, minutes }: { tag: Tag; minutes?: number }) {
  return (
    <span className="chip">
      <span className="dot" style={{ background: tag.color }} />
      {tag.name}
      {minutes != null && <span className="chip-num">{Math.round(minutes)}m</span>}
    </span>
  );
}

export function TagPicker({ tags, value, onChange }: { tags: Tag[]; value: number[]; onChange: (ids: number[]) => void }) {
  if (tags.length === 0) return <p className="muted small">No categories yet. Add some on the Categories page.</p>;
  return (
    <div className="chips">
      {tags.map((t) => {
        const on = value.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            className={`chip toggle ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== t.id) : [...value, t.id])}
          >
            <span className="dot" style={{ background: t.color }} />
            {t.name}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({ title, onClose, children, wide, label }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; /** Said aloud, when the title is more than words. */ label?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, grow }: { label: ReactNode; children: ReactNode; grow?: boolean }) {
  return (
    <label className={`field ${grow ? 'grow' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Styles the entry as destructive and sets it apart at the bottom. */
  danger?: boolean;
}

/** A "..." button that opens a short list of less-used actions. */
export function MoreMenu({ items, label = 'More options', caret = false }: { items: MenuItem[]; label?: string; /** Draws a down arrow, for the second half of a split button. */ caret?: boolean }) {
  const [open, setOpen] = useState(false);
  /** True when there is not room for the list under the button, so it opens above it instead. */
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = () => {
    const r = root.current?.getBoundingClientRect();
    const needed = items.length * 38 + 24;
    setUp(!!r && r.bottom + needed > window.innerHeight && r.top > needed);
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (e.type === 'keydown' ? (e as KeyboardEvent).key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', away);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', away);
    };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="more-menu" ref={root}>
      <button type="button" className="btn more-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={toggle}>
        {caret ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9.500l6 6 6-6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.900" />
            <circle cx="12" cy="12" r="1.900" />
            <circle cx="19" cy="12" r="1.900" />
          </svg>
        )}
      </button>
      {open && (
        <div className={`more-list ${up ? 'up' : ''}`} role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? 'danger' : ''}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The sign for sharing or sending: an arrow curving up and to the right, as on Windows and in social apps. */
export const ShareIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4.500 21 11l-7 6.500V13.500c-5.200 0-8.700 1.700-11 5.500.700-6.300 4.300-10.300 11-11V4.500Z" />
  </svg>
);

/** The bin on a Delete button. */
export const BinIcon = ({ size = 17 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />
  </svg>
);
/** The triangle on a Play button. */
export const PlayIcon = ({ size = 17 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 5.5v13l10.5-6.5Z" />
  </svg>
);

/** A whole name as its first word and the rest, for filling the two boxes from a name written as one. */
export const splitName = (name: string) => {
  const n = name.trim().replace(/\s+/g, ' ');
  const i = n.indexOf(' ');
  return i < 0 ? { first: n, last: '' } : { first: n.slice(0, i), last: n.slice(i + 1) };
};
export type NameParts = { first: string; last: string };
/**
 * A person's name as two boxes: first name and last name. It reports the whole name, as it is
 * shown everywhere, together with the two parts as typed.
 */
export function NameFields({ name, parts, onChange, autoFocus, whose = 'your' }: { name: string; parts?: NameParts; onChange: (name: string, parts: NameParts) => void; autoFocus?: boolean; whose?: 'your' | 'their' }) {
  const [typed, setTyped] = useState<NameParts>(() => parts ?? splitName(name));
  // When the name is filled in from outside (an invitation that already knows it), the boxes follow.
  useEffect(() => {
    if (`${typed.first} ${typed.last}`.trim() !== name.trim()) setTyped(parts && `${parts.first} ${parts.last}`.trim() === name.trim() ? parts : splitName(name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  const set = (next: NameParts) => {
    setTyped(next);
    onChange(`${next.first.trim()} ${next.last.trim()}`.trim(), { first: next.first.trim(), last: next.last.trim() });
  };
  return (
    <div className="name-pair">
      <label className="field">
        <span className="field-label">First name</span>
        <input className="input" autoFocus={autoFocus} required maxLength={40} value={typed.first} onChange={(e) => set({ ...typed, first: e.target.value })} autoComplete={whose === 'your' ? 'given-name' : 'off'} />
      </label>
      <label className="field">
        <span className="field-label">Last name</span>
        <input className="input" maxLength={40} value={typed.last} onChange={(e) => set({ ...typed, last: e.target.value })} autoComplete={whose === 'your' ? 'family-name' : 'off'} />
      </label>
    </div>
  );
}
