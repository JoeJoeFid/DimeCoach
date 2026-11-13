// Naming someone in a message with "@". Typing "@" in a message box offers the people who can be
// named there; choosing one writes "@Their Name". Where the message is shown, the name stands out,
// and the person named is sent a message of their own by the server.
import { useRef, useState, type KeyboardEvent, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** What is being typed after an "@" just before the caret, or null when the caret is not in one. */
function openMention(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|[\s(])@([^\s@][^@\n]{0,30})?$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - (m[2]?.length ?? 0) - 1, query: (m[2] ?? '').toLowerCase() };
}

/** A message box that offers people to name when "@" is typed. Behaves like a textarea otherwise. */
export function MentionArea({
  value,
  onChange,
  people,
  inputRef,
  onKeyDown,
  ...rest
}: {
  value: string;
  onChange: (text: string) => void;
  /** The names that can be chosen, without the caller's own. */
  people: string[];
  inputRef?: Ref<HTMLTextAreaElement>;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const [at, setAt] = useState<{ start: number; query: string } | null>(null);
  const [pick, setPick] = useState(0);
  const matches = at
    ? people
        .filter((n) => n.toLowerCase().includes(at.query))
        // Names that start with what was typed come first.
        .sort((a, b) => Number(b.toLowerCase().startsWith(at.query)) - Number(a.toLowerCase().startsWith(at.query)) || a.localeCompare(b))
        .slice(0, 6)
    : [];
  const look = (el: HTMLTextAreaElement) => {
    setAt(openMention(el.value, el.selectionStart ?? el.value.length));
    setPick(0);
  };
  const choose = (name: string) => {
    const el = own.current;
    if (!el || !at) return;
    const caret = el.selectionStart ?? value.length;
    const next = `${value.slice(0, at.start)}@${name} ${value.slice(caret)}`;
    onChange(next);
    setAt(null);
    const to = at.start + name.length + 2;
    // Put the caret after the name once the new text is in the box.
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(to, to);
    });
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        return setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
      }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
        e.preventDefault();
        return choose(matches[Math.min(pick, matches.length - 1)]);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return setAt(null);
      }
    }
    onKeyDown?.(e);
  };
  return (
    <span className="mention-area">
      <textarea
        {...rest}
        ref={(el) => {
          own.current = el;
          if (typeof inputRef === 'function') inputRef(el);
          else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = el;
        }}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          look(e.target);
        }}
        onKeyDown={keys}
        onClick={(e) => look(e.currentTarget)}
        onBlur={() => window.setTimeout(() => setAt(null), 150)}
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
      />
      {matches.length > 0 && (
        <ul className="mention-list" role="listbox" aria-label="People to mention">
          {matches.map((n, i) => (
            <li key={n} role="option" aria-selected={i === pick}>
              {/* Mouse down, not click, so the box keeps the caret where it was. */}
              <button type="button" className={i === pick ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), choose(n))} onMouseEnter={() => setPick(i)}>
                <span className="mention-at">@</span>
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** A message's words, with the names of people mentioned in it made to stand out. */
export function MentionText({ text, people, me }: { text: string; /** Everyone who could have been named, the reader included. */ people: string[]; me?: string }) {
  const names = [...new Set(people.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (names.length === 0 || !text.includes('@')) return <>{text}</>;
  const re = new RegExp(`@(${names.map(escapeRe).join('|')})(?![\\w])`, 'gi');
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    // Only at the start, or after a space or bracket: an email address is not a mention.
    if (i > 0 && !/[\s(]/.test(text[i - 1])) continue;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <span key={i} className={`mention ${me && m[1].toLowerCase() === me.toLowerCase() ? 'me' : ''}`}>
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** "edited on Nov 13 at 3:42 PM", from a time the database wrote in UTC. */
export function editedOn(at: string) {
  const d = new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`);
  return `edited on ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
/** The mark on a message that its writer changed after sending it. */
export function EditedMark({ at }: { at?: string | null }) {
  return at ? <span className="edited-mark"> · {editedOn(at)}</span> : null;
}

/** A message opened up to be changed by the person who wrote it. Ctrl+Enter saves, Escape leaves it as it was. */
export function EditBox({ initial, people, canBeEmpty, onSave, onCancel }: { initial: string; people: string[]; /** True when something is attached, so the words can go. */ canBeEmpty?: boolean; onSave: (text: string) => Promise<boolean>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ready = (!!text.trim() || !!canBeEmpty) && !busy;
  const save = async () => {
    if (!ready) return;
    if (text.trim() === initial.trim()) return onCancel();
    setBusy(true);
    if (!(await onSave(text.trim()))) setBusy(false);
  };
  return (
    <div className="edit-box">
      <MentionArea
        people={people}
        className="input"
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        maxLength={4000}
        autoFocus
        aria-label="Edit your message"
        value={text}
        onChange={setText}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <span className="edit-box-actions">
        <button type="button" className="btn small" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn small primary" disabled={!ready} onClick={save}>
          Save
        </button>
      </span>
    </div>
  );
}
