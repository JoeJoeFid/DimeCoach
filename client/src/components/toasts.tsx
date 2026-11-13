import { useEffect, useSyncExternalStore } from 'react';

/** How long a delete can still be taken back. */
const SECONDS = 10;

interface Toast {
  id: number;
  message: string;
  /** Called when Undo is pressed. */
  onUndo: () => void;
  /** Called when the time runs out, or the toast is dismissed. Not called after Undo. */
  onExpire: () => void;
  /** What the button says, when it is not "Undo". */
  action?: string;
  /** How long it stays, when not the usual ten seconds. */
  seconds?: number;
  /** What the close button is for, said aloud. */
  closeLabel?: string;
}

// One store for the whole app, so a delete started on one page can still be undone after moving to another.
let toasts: Toast[] = [];
let hidden = new Set<string>();
/** Counts deletes that have really happened, so a list on another page knows to read itself again. */
let completed = 0;
let nextId = 1;
const timers = new Map<number, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

function finish(id: number, how: 'undo' | 'expire') {
  const toast = toasts.find((t) => t.id === id);
  if (!toast) return;
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
  if (how === 'undo') toast.onUndo();
  else toast.onExpire();
}

/** Says something was done, in the corner of the screen, with an Undo button that works for ten seconds. */
export function showUndo(t: Omit<Toast, 'id'>) {
  const id = nextId++;
  toasts = [...toasts, { ...t, id }];
  timers.set(id, window.setTimeout(() => finish(id, 'expire'), (t.seconds ?? SECONDS) * 1000));
  emit();
}

/** Says something new has arrived, in the same corner, with a button that goes to it. Nothing happens if it is left alone. */
export function showNews(message: string, onOpen: () => void) {
  showUndo({ message, onUndo: onOpen, onExpire: () => {}, action: 'Open', seconds: 8, closeLabel: 'Dismiss' });
}

/**
 * Deletes something with a ten-second way back. It disappears from the screen straight away
 * (pages leave out anything whose key is in `usePendingDeletes()`), but the real delete only
 * happens when the time is up. Undo simply brings it back, since nothing was removed yet.
 */
export function deleteLater(opts: {
  /** Names the thing, such as "drill:12". */
  key: string;
  message: string;
  run: () => Promise<unknown>;
  /** Called once it is really gone, to refresh whatever lists it. */
  done?: () => unknown;
  /** Called with the reason if the delete fails. The thing comes back into view. */
  failed?: (message: string) => void;
}) {
  const show = (on: boolean) => {
    hidden = new Set(hidden);
    if (on) hidden.add(opts.key);
    else hidden.delete(opts.key);
    emit();
  };
  show(true);
  showUndo({
    message: opts.message,
    onUndo: () => show(false),
    onExpire: async () => {
      try {
        await opts.run();
        await opts.done?.();
        completed++;
        emit();
        // Lists that heard about it just now need a moment to read themselves again. Until they
        // have, the thing stays hidden, so it does not flash back into view.
        await new Promise((r) => window.setTimeout(r, 1500));
      } catch (e) {
        opts.failed?.((e as Error).message);
      } finally {
        show(false);
      }
    },
  });
}

/** The keys of things that are deleted as far as the screen is concerned, but can still be undone. */
export const usePendingDeletes = () => useSyncExternalStore(subscribe, () => hidden);

/** Goes up each time a delete has really happened. A list that may hold the deleted thing reads itself again when it changes. */
export const useCompletedDeletes = () => useSyncExternalStore(subscribe, () => completed);

/** Carries out every delete that is still waiting, now. Used before signing out or leaving the site. */
export function flushDeletes() {
  for (const t of [...toasts]) finish(t.id, 'expire');
}

/** Mount once near the app root. Shows the confirmations in the lower right corner. */
export function ToastHost() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  useEffect(() => {
    // Closing the tab should not quietly cancel a delete the person asked for.
    window.addEventListener('pagehide', flushDeletes);
    return () => window.removeEventListener('pagehide', flushDeletes);
  }, []);
  if (list.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.action ? 'news' : ''}`}>
          <span className="toast-text">{t.message}</span>
          <button type="button" className="btn small toast-undo" onClick={() => finish(t.id, 'undo')}>
            {t.action ?? 'Undo'}
          </button>
          <button type="button" className="btn ghost toast-close" aria-label={t.closeLabel ?? 'Dismiss. The delete goes ahead.'} title="Dismiss" onClick={() => finish(t.id, 'expire')}>
            ✕
          </button>
          <span className="toast-timer" style={{ animationDuration: `${t.seconds ?? SECONDS}s` }} aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
