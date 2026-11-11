import { useEffect, useRef, useState } from 'react';

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  /** Styles the action as destructive and puts the keyboard focus on Cancel. */
  danger?: boolean;
}
interface PromptOptions {
  title: string;
  body?: string;
  initial?: string;
  confirmLabel?: string;
}
type Request =
  | ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: 'prompt'; resolve: (value: string | null) => void } & PromptOptions);

let open: ((r: Request) => void) | null = null;

/** Asks the coach to confirm an action. Resolves true only if they confirm. */
export const confirmDialog = (opts: ConfirmOptions) =>
  new Promise<boolean>((resolve) => (open ? open({ kind: 'confirm', resolve, ...opts }) : resolve(window.confirm(opts.title))));

/** Asks for a short piece of text. Resolves null if cancelled or left blank. */
export const promptDialog = (opts: PromptOptions) =>
  new Promise<string | null>((resolve) => (open ? open({ kind: 'prompt', resolve, ...opts }) : resolve(window.prompt(opts.title, opts.initial))));

/** Mount once near the app root. Renders whichever dialog is currently being asked. */
export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [text, setText] = useState('');
  const focusRef = useRef<HTMLButtonElement & HTMLInputElement>(null);

  useEffect(() => {
    open = (r) => {
      setText(r.kind === 'prompt' ? r.initial || '' : '');
      setReq(r);
    };
    return () => {
      open = null;
    };
  }, []);
  useEffect(() => {
    if (req) focusRef.current?.focus();
  }, [req]);
  if (!req) return null;

  const finish = (ok: boolean) => {
    if (req.kind === 'confirm') req.resolve(ok);
    else req.resolve(ok && text.trim() ? text.trim() : null);
    setReq(null);
  };
  const danger = req.kind === 'confirm' && req.danger;

  return (
    <div
      className="modal-back dialog-back"
      onMouseDown={(e) => e.target === e.currentTarget && finish(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') finish(false);
      }}
    >
      <form
        className="modal dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onSubmit={(e) => {
          e.preventDefault();
          finish(true);
        }}
      >
        <h2 id="dialog-title">{req.title}</h2>
        {req.body && <p className="dialog-body">{req.body}</p>}
        {req.kind === 'prompt' && (
          <input ref={focusRef} className="input" aria-label={req.title} value={text} onChange={(e) => setText(e.target.value)} />
        )}
        <div className="modal-foot">
          <button type="button" className="btn" ref={danger ? focusRef : undefined} onClick={() => finish(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className={`btn ${danger ? 'danger-solid' : 'primary'}`}
            ref={req.kind === 'confirm' && !danger ? focusRef : undefined}
            disabled={req.kind === 'prompt' && !text.trim()}
          >
            {req.confirmLabel || (req.kind === 'prompt' ? 'Save' : 'Confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}
