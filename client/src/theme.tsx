import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'practiceplan.theme';

export const storedTheme = (): ThemeChoice => {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
};
/** 'system' leaves the attribute off so the stylesheet follows the operating system. */
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const OPTIONS: { id: ThemeChoice; label: string; icon: string }[] = [
  { id: 'light', label: 'Light', icon: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
  { id: 'system', label: 'Match system', icon: 'M4 5h16v11H4zM9 20h6M12 16v4' },
  { id: 'dark', label: 'Dark', icon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z' },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);
  useEffect(() => {
    applyTheme(choice);
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  }, [choice]);
  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" title={o.label} aria-label={o.label} aria-pressed={choice === o.id} className={choice === o.id ? 'on' : ''} onClick={() => setChoice(o.id)}>
          {icon(o.icon)}
        </button>
      ))}
    </div>
  );
}
