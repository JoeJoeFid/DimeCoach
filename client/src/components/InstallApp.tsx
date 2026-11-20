// Putting Dime Coach on a phone's home screen, where it opens full-screen like any other app.
// An Android phone can be asked to install it with one press. An iPhone cannot be asked: the
// person has to use the browser's own "Add to Home Screen", so they are shown how.
import { useEffect, useState } from 'react';
import { Modal } from './bits';

/** The browser's own offer to install, on the phones that make one. It is kept until someone presses Install. */
interface InstallOffer extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let offer: InstallOffer | null = null;
const heard = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // The browser's own banner is held back, so the offer can be made in the app's words.
    e.preventDefault();
    offer = e as InstallOffer;
    heard.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    heard.forEach((f) => f());
  });
}

/** True when the page is already running from the home screen. */
export const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
/** An iPhone or iPad. A newer iPad says it is a Mac, and is told apart by its touch screen. */
const isApple = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isPhone = () => isApple() || /android/i.test(navigator.userAgent);
const HIDE_KEY = 'dime.installHint';

/** What can be offered here: a one-press install, the steps for an iPhone, or the steps in general. */
function useInstall() {
  const [, again] = useState(0);
  useEffect(() => {
    const f = () => again((n) => n + 1);
    heard.add(f);
    return () => void heard.delete(f);
  }, []);
  const install = async () => {
    if (!offer) return false;
    await offer.prompt();
    const { outcome } = await offer.userChoice;
    offer = null;
    again((n) => n + 1);
    return outcome === 'accepted';
  };
  // An iPhone never makes the offer, so it is never acted on there: the steps are what works.
  return { canPrompt: !!offer && !isApple(), install };
}

/** The share mark an iPhone uses: a box with an arrow coming up out of it. */
const ShareMark = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="Share" role="img" className="ia-share">
    <path d="M12 15V3.500M8 7l4-4 4 4M7 10.500H5.500V20h13v-9.500H17" />
  </svg>
);

/** How to put the app on this device, in steps. */
function Steps() {
  const apple = isApple();
  const android = /android/i.test(navigator.userAgent);
  return apple ? (
    <ol className="ia-steps">
      <li>
        Tap the Share button <ShareMark /> in your browser's toolbar. In Safari it is at the bottom of the screen.
      </li>
      <li>
        Scroll down and tap <strong>Add to Home Screen</strong>.
      </li>
      <li>
        Tap <strong>Add</strong>. Dime Coach is now an icon beside your other apps.
      </li>
    </ol>
  ) : android ? (
    <ol className="ia-steps">
      <li>Open your browser's menu (the three dots).</li>
      <li>
        Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
      </li>
      <li>Dime Coach is now an icon beside your other apps.</li>
    </ol>
  ) : (
    <ol className="ia-steps">
      <li>
        <strong>On an iPhone or iPad:</strong> open dimecoach.com in Safari, tap the Share button <ShareMark />, then <strong>Add to Home Screen</strong>.
      </li>
      <li>
        <strong>On an Android phone:</strong> open it in Chrome, open the menu (the three dots), then <strong>Install app</strong>.
      </li>
      <li>
        <strong>On this computer:</strong> in Chrome or Edge, look for the install mark at the right of the address bar.
      </li>
    </ol>
  );
}

/** The whole of it, opened from the account menu. */
export function InstallDialog({ onClose }: { onClose: () => void }) {
  const { canPrompt, install } = useInstall();
  return (
    <Modal title="Get the app" onClose={onClose}>
      <div className="ia">
        {isInstalled() ? (
          <p>You are using the app now. There is nothing more to do.</p>
        ) : (
          <>
            <p className="muted">Put Dime Coach on your home screen and it opens full-screen like any other app, with nothing to download from a store. It is always the newest version.</p>
            {canPrompt ? (
              <button type="button" className="btn primary" onClick={() => install().then((ok) => ok && onClose())}>
                Install Dime Coach
              </button>
            ) : (
              <Steps />
            )}
            <p className="muted small">The first time you open it from its icon, you sign in once more.</p>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * A strip along the bottom of a phone's screen, once, for someone who is using the site in a
 * browser: put it on your home screen. Dismissed, it does not come back.
 */
export function InstallHint() {
  const { canPrompt, install } = useInstall();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === 'off';
    } catch {
      return true;
    }
  });
  const [showing, setShowing] = useState(false);
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDE_KEY, 'off');
    } catch {
      /* it comes back next time, which is no harm */
    }
  };
  // Only on a phone or tablet: at a desk the account menu has it for whoever wants it.
  if (hidden || isInstalled() || !isPhone()) return showing ? <InstallDialog onClose={() => setShowing(false)} /> : null;
  return (
    <>
      <div className="ia-hint" role="region" aria-label="Get the app">
        <span className="brand-mark" aria-hidden="true" />
        <span className="ia-hint-text">
          <strong>Put Dime Coach on your phone</strong>
          <span className="muted small">It opens full-screen from your home screen, like an app.</span>
        </span>
        <button type="button" className="btn small primary" onClick={() => (canPrompt ? install().then((ok) => ok && hide()) : setShowing(true))}>
          {canPrompt ? 'Install' : 'Show me how'}
        </button>
        <button type="button" className="btn small ghost" onClick={hide} aria-label="Not now">
          ✕
        </button>
      </div>
      {showing && <InstallDialog onClose={() => setShowing(false)} />}
    </>
  );
}
