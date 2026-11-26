import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { InstallDialog } from './InstallApp';

/** One page in the menu. */
export interface BottomItem {
  key: string;
  label: string;
  icon: string;
  active: boolean;
  go: () => void;
  /** Things waiting to be read there. */
  badge?: number;
}
/** One button of the bar, and the pages that open above it. */
export interface BottomGroup {
  title: string;
  icon: string;
  items: BottomItem[];
  /** On one of its pages that is not in the list itself, such as an editor. */
  active?: boolean;
}

const PROFILE_ICON = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.700 1.900 7.500 5.500';

const Icon = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const Badge = ({ n }: { n: number }) => (
  <span className="nav-badge">
    {n > 9 ? '9+' : n}
    <span className="sr-only"> new</span>
  </span>
);

/** A line in the sheet that is not one of a group's pages: something the profile sheet adds of its own. */
export const BottomRow = ({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) => (
  <button type="button" role="menuitem" className="bn-row" onClick={onClick}>
    <Icon d={icon} size={19} />
    <span>{label}</span>
  </button>
);

/** Whether the thing with the keyboard's attention is one that is typed into. */
const typedInto = (el: Element | null) => {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return true;
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color'].includes(el.type);
};

/**
 * The menu on a tablet or phone: a bar across the bottom with a button for the dashboard, one for
 * each group of pages, and one for the person signed in. A group's pages open in a small menu above
 * its button, as wide as its longest line. A coach's menu and a follower's are both drawn by this; each hands in its own pages. The
 * stylesheet decides which screens show it, so on a wide screen it is not seen at all.
 */
export default function BottomNav({
  home,
  groups,
  profile,
  profileActive,
  where,
  hidden,
}: {
  home: BottomItem;
  groups: BottomGroup[];
  /** What the last button opens: the team, the account, signing out. `close` shuts the sheet; `install` opens the steps for getting the app. */
  profile: (close: () => void, install: () => void) => ReactNode;
  profileActive?: boolean;
  /** The address being shown. The sheet shuts when it changes. */
  where: string;
  /** On a page that wants the whole screen. */
  hidden?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [typing, setTyping] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(null), [where]);
  // The menu stands over the middle of the button that opened it, pulled in where that would put it off the screen.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = sheet.current;
      const btn = bar.current?.querySelector<HTMLElement>('.bn-tab.open');
      if (!el || !btn) return;
      const b = btn.getBoundingClientRect();
      const w = el.offsetWidth;
      const left = Math.max(8, Math.min(b.left + b.width / 2 - w / 2, document.documentElement.clientWidth - w - 8));
      el.style.left = `${Math.round(left)}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  // With the keyboard up on a touch screen the bar would ride on top of it and take what little room is left.
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const look = () => window.setTimeout(() => setTyping(typedInto(document.activeElement)), 0);
    window.addEventListener('focusin', look);
    window.addEventListener('focusout', look);
    return () => {
      window.removeEventListener('focusin', look);
      window.removeEventListener('focusout', look);
    };
  }, []);
  // The stylesheet leaves room for the bar under every page; the room goes when the bar does.
  const off = !!hidden || typing;
  useEffect(() => {
    document.documentElement.classList.toggle('bn-off', off);
    return () => document.documentElement.classList.remove('bn-off');
  }, [off]);

  // A group with nothing in it, as when none of its pages are open to this person, has no button.
  const shown = groups.filter((g) => g.items.length > 0);
  const group = shown.find((g) => g.title === open);
  const close = () => setOpen(null);
  const tab = (key: string, label: string, icon: string, active: boolean, badge: number, press: () => void, opens: boolean) => (
    <button key={key} type="button" className={`bn-tab ${active ? 'active' : ''} ${open === key ? 'open' : ''}`} aria-current={active && !opens ? 'page' : undefined} aria-haspopup={opens ? 'menu' : undefined} aria-expanded={opens ? open === key : undefined} onClick={press}>
      <span className="bn-icon">
        <Icon d={icon} />
        {badge > 0 && <Badge n={badge} />}
      </span>
      <span className="bn-label">{label}</span>
    </button>
  );
  return (
    <>
      {installing && createPortal(<InstallDialog onClose={() => setInstalling(false)} />, document.body)}
      {open && <div className="bn-scrim" onClick={close} />}
      {open && (
        <div ref={sheet} className="bn-sheet" role="menu" aria-label={open === 'profile' ? 'You and your team' : open}>
          {group ? (
            <>
              <span className="bn-sheet-title">{group.title}</span>
              {group.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  className={`bn-row ${it.active ? 'active' : ''}`}
                  aria-current={it.active ? 'page' : undefined}
                  onClick={() => {
                    close();
                    it.go();
                  }}
                >
                  <Icon d={it.icon} size={19} />
                  <span>{it.label}</span>
                  {!!it.badge && <Badge n={it.badge} />}
                </button>
              ))}
            </>
          ) : (
            profile(close, () => {
              close();
              setInstalling(true);
            })
          )}
        </div>
      )}
      <nav ref={bar} className="bottom-nav" aria-label="Main">
        {tab('home', home.label, home.icon, home.active, home.badge ?? 0, () => {
          close();
          home.go();
        }, false)}
        {shown.map((g) =>
          tab(
            g.title,
            g.title,
            g.icon,
            !!g.active || g.items.some((i) => i.active),
            g.items.reduce((n, i) => n + (i.badge ?? 0), 0),
            () => setOpen(open === g.title ? null : g.title),
            true,
          ),
        )}
        {tab('profile', 'Profile', PROFILE_ICON, !!profileActive, 0, () => setOpen(open === 'profile' ? null : 'profile'), true)}
      </nav>
    </>
  );
}
