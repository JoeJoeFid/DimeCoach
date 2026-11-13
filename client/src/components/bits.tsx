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
