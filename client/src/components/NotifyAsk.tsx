// The first time Dime Coach is opened from its own icon, it asks once whether to turn
// notifications on. A phone only shows its own question after a press, so the app asks in its
// own words first and the press on "Turn on notifications" brings up the phone's.
import { useEffect, useState } from 'react';
import { Modal } from './bits';
import { isInstalled } from './InstallApp';
import { enablePush, pushState } from '../push';

const ASKED_KEY = 'dime.notifyAsk';
const asked = () => {
  try {
    return localStorage.getItem(ASKED_KEY) === 'done';
  } catch {
    // Without a place to remember the answer it would ask every time, so it does not ask.
    return true;
  }
};
const remember = () => {
  try {
    localStorage.setItem(ASKED_KEY, 'done');
  } catch {
    /* nowhere to keep it */
  }
};

export function NotifyAsk() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    // Only in the installed app, and only where the person has not answered the phone's question before.
    if (!isInstalled() || asked() || !('Notification' in window) || Notification.permission !== 'default') return;
    let gone = false;
    // A moment after opening, so it does not land on top of the page while it is still drawing.
    const wait = window.setTimeout(() => {
      pushState().then(
        (state) => {
          if (!gone && state === 'off') setOpen(true);
        },
        () => {},
      );
    }, 1200);
    return () => {
      gone = true;
      window.clearTimeout(wait);
    };
  }, []);
  if (!open) return null;
  const close = () => {
    remember();
    setOpen(false);
  };
  const turnOn = async () => {
    setBusy(true);
    setNote('');
    try {
      const state = await enablePush();
      if (state === 'on' || state === 'blocked') return close();
      setNote(state === 'unsupported' ? 'This device cannot show notifications from Dime Coach yet. Close the app, open it again and try from Messages, then Settings.' : 'Notifications were not turned on. You can press the button again.');
    } catch (e) {
      setNote((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <Modal title="Turn on notifications?" onClose={close}>
      <div className="notify-ask">
        <p className="muted">Be told at once, even when Dime Coach is closed: a new message, a mention, something shared with you, or a game going live.</p>
        <p className="muted small">You can turn them off at any time in Messages, under Settings.</p>
        {note && <p className="notice">{note}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={close}>
            Not now
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={turnOn}>
            Turn on notifications
          </button>
        </div>
      </div>
    </Modal>
  );
}
