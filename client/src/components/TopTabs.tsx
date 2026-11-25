// The bar of tabs at the top of a page: one rounded bar, each tab a sign and a word, and the
// chosen one filled in the accent colour. Every page with parts across its top uses this one.
import type { ReactNode } from 'react';

/** The signs, drawn on a 24 by 24 square in lines. */
const SIGNS = {
  clipboard: 'M9 4.5h6a1 1 0 0 1 1 1V7H8V5.5a1 1 0 0 1 1-1ZM8 5.8H6.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-12a1 1 0 0 0-1-1H16M9 12h6M9 15.5h4',
  bars: 'M5 19.5v-5M9.7 19.5V9M14.3 19.5v-7M19 19.5V4.5',
  play: 'M7.5 5.2v13.6a.6.6 0 0 0 .9.5l11-6.8a.6.6 0 0 0 0-1l-11-6.8a.6.6 0 0 0-.9.5Z',
  camera: 'M3.5 7.5h11v9h-11zM14.5 10.5l6-3v9l-6-3',
  film: 'M4.5 4.5h15v15h-15zM8.5 4.5v15M15.5 4.5v15M4.5 9.5h4M4.5 14.5h4M15.500 9.5h4M15.5 14.5h4',
  scissors: 'M6.5 9.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5ZM6.5 19.5a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5ZM8.600 8.300 20 18.500M8.600 15.700 20 5.500',
  calendar: 'M5 6.500h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM4 10.500h16M8.500 4.500v3.500M15.500 4.500v3.500',
  user: 'M12 12a3.800 3.800 0 1 0 0-7.600 3.800 3.800 0 0 0 0 7.600ZM5 19.600c.700-3.300 3.500-5 7-5s6.300 1.700 7 5',
  users: 'M9 11.500a3.300 3.300 0 1 0 0-6.600 3.300 3.300 0 0 0 0 6.600ZM3 19.500c.600-3 2.900-4.600 6-4.600s5.400 1.600 6 4.600M15.500 5.200a3.300 3.300 0 0 1 0 6.200M17.500 15.300c1.900.500 3.100 1.900 3.500 4.200',
  sliders: 'M4.500 7.500h9M17.500 7.500h2M4.500 16.500h2M10.500 16.500h9M15.500 5.500v4M8.500 14.500v4',
  home: 'M4.500 11 12 4.500 19.500 11M6.500 9.500v9.500h11V9.500M10 19v-5h4v5',
  book: 'M5 5.500A1.500 1.500 0 0 1 6.500 4H19v14.500H6.500A1.500 1.500 0 0 0 5 20ZM5 20V5.500M9 8.500h6',
  chat: 'M5 5.500h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7.500L7 20v-3.500H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z',
  megaphone: 'M4.500 10v4h3l7 4V6l-7 4ZM7.500 14l1 5h2.500l-1-4.300M17.500 9.500a3.500 3.500 0 0 1 0 5',
  mail: 'M4.500 6.500h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM4 7.500l8 6 8-6',
  pencil: 'M5 19l.800-3.800L16.500 4.500l3 3L8.800 18.200ZM14.500 6.500l3 3',
  folder: 'M4 7a1 1 0 0 1 1-1h4.500l2 2H19a1 1 0 0 1 1 1v8.500a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z',
  target: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 15.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7ZM12 12h.01',
  key: 'M8.500 15.500a4 4 0 1 1 3.700-5.500H20v3h-2.500v2.500h-3V13h-2.300a4 4 0 0 1-3.700 2.500Z',
  building: 'M5.500 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M14.500 9.500h3a1 1 0 0 1 1 1V20M3.500 20h17M8.500 8h3M8.500 11.500h3M8.500 15h3',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 4v2.200M12 17.800V20M4 12h2.200M17.800 12H20M6.300 6.300l1.600 1.600M16.100 16.100l1.600 1.600M6.300 17.700l1.600-1.600M16.100 7.900l1.600-1.600',
  grid: 'M4.500 4.500h6.500v6.500H4.500zM13 4.500h6.500v6.500H13zM4.500 13h6.500v6.500H4.500zM13 13h6.500v6.500H13z',
  layers: 'M12 4.500 20 9l-8 4.500L4 9ZM4.500 13 12 17.200 19.500 13',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  shield: 'M12 4l7 2.500v5c0 4.200-2.800 7.300-7 8.500-4.200-1.200-7-4.300-7-8.500v-5Z',
  send: 'M20 4 3.500 10.500l6.500 3 3 6.500ZM10 13.500 20 4',
  heart: 'M12 19.500s-7-4.300-7-9.300A3.700 3.700 0 0 1 12 8a3.700 3.700 0 0 1 7 2.200c0 5-7 9.300-7 9.300Z',
} as const;
export type Sign = keyof typeof SIGNS;

/** The sign each tab has, by what the page calls it. A tab not named here has none. */
const SIGN_OF: Record<string, Sign> = {
  // A game: its plan, its score, its video.
  plan: 'clipboard', score: 'bars', video: 'play',
  // The Filmroom.
  games: 'camera', clips: 'film', videos: 'scissors', film: 'film',
  // Stats.
  season: 'calendar', mine: 'user', shared: 'users', setup: 'sliders', stats: 'bars', box: 'grid',
  // A team, and its page for parents.
  team: 'shield', people: 'users', family: 'heart', access: 'key', schedule: 'calendar', roster: 'users',
  home: 'home', chat: 'chat', messages: 'megaphone', inbox: 'mail', homework: 'pencil', playbook: 'clipboard', drills: 'target', resources: 'folder',
  // A community, and running an organization.
  library: 'book', discussions: 'chat', members: 'users', overview: 'grid', seasons: 'layers', players: 'user', coaches: 'shield', more: 'dots',
  // System administration.
  // Messages.
  sent: 'send',
  email: 'mail', organizations: 'building', content: 'folder', system: 'gear',
};

export const TabSign = ({ sign, size = 20 }: { sign: Sign; size?: number }) => (
  <svg className="toptabs-sign" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={SIGNS[sign]} />
  </svg>
);

/**
 * The tabs across the top of a page. Each is [what the page calls it, what it says, a count when
 * it has one]. `nav` is for tabs that are places to go, not panels of one page. `isOn` is for a
 * page where a tab also stands for others that are not on the bar.
 */
export function TopTabs<T extends string>({ tabs, value, onChange, label, nav, isOn }: { tabs: [T, ReactNode, number?][]; value: T; onChange: (t: T) => void; label: string; nav?: boolean; isOn?: (t: T) => boolean }) {
  const Bar = nav ? 'nav' : 'div';
  return (
    <Bar className="toptabs" role={nav ? undefined : 'tablist'} aria-label={label}>
      {tabs.map(([id, text, count]) => {
        const on = isOn ? isOn(id) : value === id;
        const sign = SIGN_OF[id];
        return (
          <button key={id} type="button" role={nav ? undefined : 'tab'} aria-selected={nav ? undefined : on} aria-current={nav && on ? 'page' : undefined} className={on ? 'on' : ''} onClick={() => onChange(id)}>
            {sign && <TabSign sign={sign} />}
            <span>{text}</span>
            {!!count && <span className="cm-count">{count}</span>}
          </button>
        );
      })}
    </Bar>
  );
}
