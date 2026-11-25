// The lists a coach and the team's parents, family and friends both look at: resources, plays,
// drills, film and homework. Each is drawn once, here, as a coach sees it. A coach's page hands in
// what can be done to a thing (rename, share, delete); a parent's page hands in none of that, and
// the same list is then only read. What a person is allowed to see is settled before it gets
// here: these draw whatever they are given.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Play } from '../types';
import { PlayDiagram } from './PlayDiagram';
import Hit from './Hit';
import { MoreMenu, PlayIcon, ShareIcon, type MenuItem } from './bits';
import { CategoryDots, LayoutToggle, SideChoices, useCompact } from './cx';
import { SharedWithLine } from './ShareItem';
import { fmtDateShort, hasTerms, htmlPreview, htmlText, searchSnippet, searchTerms } from '../util';

/** A category as it is shown: its name and its color. */
export interface Cat {
  name: string;
  color: string;
}
const NONE = '\u0000none';

/** The box down the left of a list: the search, the layout, and whatever narrows the list. */
function SideBox({ search, q, onQ, compact, onCompact, children }: { search: string; q: string; onQ: (q: string) => void; compact: boolean; onCompact: (on: boolean) => void; children?: ReactNode }) {
  return (
    <aside className="card ps-side tall" aria-label="Search and filters">
      <section>
        <h2>Search</h2>
        <input className="input" type="search" placeholder={search} aria-label={search} value={q} onChange={(e) => onQ(e.target.value)} />
      </section>
      <section>
        <h2>Layout</h2>
        <LayoutToggle compact={compact} onChange={onCompact} />
      </section>
      {children}
    </aside>
  );
}

// ---------------------------------------------------------------- Resources

export interface BrowseResource {
  key: string;
  kind: 'link' | 'image' | 'video';
  title: string;
  url: string;
  tags: Cat[];
  /** What the search looks through, in small letters. */
  text: string;
  /** Where it is used, each a line with a link. A coach's only. */
  uses?: { label: string; name: string; to: string }[];
  /** A line under the name, such as a link's site. */
  sub?: string;
  /** Whether its name can be typed over, and whether it can be removed. */
  renamable?: boolean;
  removable?: boolean;
}
const RES_KINDS: [BrowseResource['kind'], string][] = [
  ['link', 'Links'],
  ['image', 'Pictures'],
  ['video', 'Videos'],
];
/**
 * Links, pictures and videos as cards or compact rows, behind a box of search, layout, kind and
 * category. With `actions` a resource can be renamed, filed, shared and removed; without, only opened.
 */
export function ResourceBrowser<R extends BrowseResource>({
  resources,
  compactKey,
  categories,
  thumb,
  onView,
  sharedWith,
  actions,
  empty,
}: {
  /** Null while they are being read. */
  resources: R[] | null;
  compactKey: string;
  /** Every category to offer, in order. Left out, they are the ones the resources carry. */
  categories?: Cat[];
  thumb: (r: R) => ReactNode;
  /** A picture or a video is opened large. A link opens in a new tab by itself. */
  onView: (r: R) => void;
  sharedWith?: (r: R) => string[];
  actions?: { rename: (r: R, title: string) => void; tag: (r: R) => void; share: (r: R) => void; remove: (r: R) => void };
  empty: ReactNode;
}) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | BrowseResource['kind']>('all');
  const [cat, setCat] = useState('');
  const [compact, setCompact] = useCompact(compactKey);
  const all = resources ?? [];
  const term = q.trim().toLowerCase();
  const found = all.filter((r) => !term || r.text.includes(term));
  // What the search and the kind leave, before a category narrows it: the categories are counted from these.
  const inKind = found.filter((r) => kind === 'all' || r.kind === kind);
  const cats = categories ?? [...new Map(all.flatMap((r) => r.tags).map((t) => [t.name, t])).values()].sort((x, y) => x.name.localeCompare(y.name));
  const shown = inKind.filter((r) => !cat || (cat === NONE ? r.tags.length === 0 : r.tags.some((t) => t.name === cat)));
  return (
    <div className="ps-layout">
      <SideBox search="Search resources" q={q} onQ={setQ} compact={compact} onCompact={setCompact}>
        <SideChoices<'all' | BrowseResource['kind']> title="Kind" all="all" total={found.length} value={kind} onChange={setKind} items={RES_KINDS.map(([id, label]) => ({ id, label, count: found.filter((r) => r.kind === id).length }))} />
        <SideChoices
          title="Category"
          all=""
          total={inKind.length}
          value={cat}
          onChange={setCat}
          items={[
            ...cats.map((t) => ({ id: t.name, label: t.name, color: t.color, count: inKind.filter((r) => r.tags.some((x) => x.name === t.name)).length })),
            // Someone who files resources can also ask for the ones not filed anywhere.
            ...(actions && cats.length ? [{ id: NONE, label: 'No category', count: inKind.filter((r) => r.tags.length === 0).length }] : []),
          ]}
        />
      </SideBox>
      <div className="ps-main">
        {resources === null ? (
          <p className="muted">Loading…</p>
        ) : all.length === 0 ? (
          empty
        ) : shown.length === 0 ? (
          <p className="muted">Nothing matches.</p>
        ) : (
          <div className={`res-grid ${compact ? 'compact' : ''}`}>
            {shown.map((r) => (
              <ResourceCard key={r.key} r={r} thumb={thumb(r)} onView={() => onView(r)} sharedWith={sharedWith?.(r) ?? []} actions={actions} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function ResourceCard<R extends BrowseResource>({ r, thumb, onView, sharedWith, actions }: { r: R; thumb: ReactNode; onView: () => void; sharedWith: string[]; actions?: { rename: (r: R, title: string) => void; tag: (r: R) => void; share: (r: R) => void; remove: (r: R) => void } }) {
  const [title, setTitle] = useState(r.title);
  useEffect(() => setTitle(r.title), [r.title]);
  const more: MenuItem[] = actions ? [{ label: 'Edit categories', onSelect: () => actions.tag(r) }, ...(r.removable ? [{ label: 'Delete', danger: true, onSelect: () => actions.remove(r) }] : [])] : [];
  return (
    <div className={`res-card kind-${r.kind}`}>
      {r.kind === 'link' ? (
        <a className="res-preview" href={r.url} target="_blank" rel="noopener noreferrer" title="Open in a new tab">
          {thumb}
        </a>
      ) : (
        <button type="button" className="res-preview" onClick={onView} title={r.kind === 'video' ? 'Play' : 'View larger'}>
          {thumb}
          {r.kind === 'video' && (
            <span className="res-play" aria-hidden="true">
              ▶
            </span>
          )}
        </button>
      )}
      <div className="res-info">
        {actions && r.renamable ? (
          <input className="input res-title" aria-label="Name" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() !== r.title && actions.rename(r, title.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        ) : (
          <strong className="res-title">{r.title}</strong>
        )}
        <CategoryDots tags={r.tags} />
        {r.tags.length > 0 && (
          <div className="res-tags">
            {r.tags.map((t) => (
              <span key={t.name} className="chip">
                <span className="dot" style={{ background: t.color }} />
                {t.name}
              </span>
            ))}
          </div>
        )}
        {r.sub && <span className="muted small">{r.sub}</span>}
        {!!r.uses?.length && (
          <ul className="res-uses">
            {r.uses.slice(0, 4).map((u, i) => (
              <li key={i}>
                <span className="kind">{u.label}</span> <Link to={u.to}>{u.name}</Link>
              </li>
            ))}
            {r.uses.length > 4 && <li className="muted small">and {r.uses.length - 4} more</li>}
          </ul>
        )}
        <SharedWithLine names={sharedWith} onClick={actions ? () => actions.share(r) : undefined} />
        <div className="res-actions">
          {r.kind === 'link' ? (
            <a className="btn small res-open" href={r.url} target="_blank" rel="noopener noreferrer" title={r.url}>
              <PlayIcon size={14} />
              Open
            </a>
          ) : (
            <button type="button" className="btn small res-open" onClick={onView}>
              <PlayIcon size={14} />
              {r.kind === 'video' ? 'Play' : 'View'}
            </button>
          )}
          {actions && (
            <button type="button" className="btn small res-share" onClick={() => actions.share(r)} aria-label={`Share ${r.title}`} title="Share">
              <ShareIcon size={16} />
            </button>
          )}
          {/* The less-used things, behind "...": its categories, and taking it out of the library. */}
          {more.length > 0 && (
            <span className="res-more">
              <MoreMenu label={`More for ${r.title}`} items={more} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Plays

export type BrowsePlay = Pick<Play, 'id' | 'name' | 'category' | 'labels' | 'court' | 'flipped' | 'upright' | 'notes' | 'frames'>;
/**
 * Plays as cards or compact rows, behind a box of search, layout, category and tags. With `href`
 * a card is a link to the play; with `onOpen` it is pressed to read the play. `onShare` puts the
 * share button on each.
 */
export function PlayBrowser<P extends BrowsePlay>({ plays, compactKey, href, onOpen, onShare, sharedWith, extra, empty }: { plays: P[]; compactKey: string; href?: (p: P) => string; onOpen?: (p: P) => void; onShare?: (p: P) => void; sharedWith?: (p: P) => string[]; /** More to say on a card's line of details, such as how many resources it has. */ extra?: (p: P) => string; empty: ReactNode }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [label, setLabel] = useState('');
  const [compact, setCompact] = useCompact(compactKey);
  if (plays.length === 0) return <>{empty}</>;
  const term = q.trim().toLowerCase();
  const shown = plays.filter((p) => (!category || p.category === category) && (!label || p.labels.includes(label)) && (!term || `${p.name} ${p.category} ${p.labels.join(' ')} ${p.notes || ''}`.toLowerCase().includes(term)));
  const categories = [...new Set(plays.map((p) => p.category).filter(Boolean))].sort();
  const labels = [...new Set(plays.flatMap((p) => p.labels))].sort();
  const inside = (p: P) => (
    <>
      <div className="paper">
        <PlayDiagram play={p} frame={p.frames[0]} />
      </div>
      <div className="play-card-info">
        <strong>{p.name}</strong>
        <span className="muted small">{[p.category || 'No category', `${p.frames.length} step${p.frames.length === 1 ? '' : 's'}`, extra?.(p)].filter(Boolean).join(' · ')}</span>
        {p.labels.length > 0 && (
          <span className="chips">
            {p.labels.map((l) => (
              <span key={l} className="chip">
                {l}
              </span>
            ))}
          </span>
        )}
        <SharedWithLine names={sharedWith?.(p) ?? []} />
      </div>
    </>
  );
  return (
    <div className="ps-layout">
      <SideBox search="Search plays" q={q} onQ={setQ} compact={compact} onCompact={setCompact}>
        <SideChoices title="Category" all="" total={plays.length} value={category} onChange={setCategory} items={categories.map((c) => ({ id: c, label: c, count: plays.filter((p) => p.category === c).length }))} />
        <SideChoices title="Tags" all="" allLabel="All tags" total={plays.length} value={label} onChange={setLabel} items={labels.map((l) => ({ id: l, label: l, count: plays.filter((p) => p.labels.includes(l)).length }))} />
      </SideBox>
      <div className="ps-main">
        {shown.length === 0 ? (
          <p className="muted">No plays match.</p>
        ) : (
          <div className={`play-grid ${compact ? 'compact' : ''}`}>
            {shown.map((p) => (
              <div key={p.id} className="play-card-wrap">
                {href ? (
                  <Link to={href(p)} className="play-card">
                    {inside(p)}
                  </Link>
                ) : (
                  <button type="button" className="play-card" onClick={() => onOpen?.(p)}>
                    {inside(p)}
                  </button>
                )}
                {onShare && (
                  <button type="button" className="btn small icon-btn play-share" aria-label={`Share ${p.name}`} title="Share" onClick={() => onShare(p)}>
                    <ShareIcon size={17} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Drills

export interface BrowseDrill {
  id: number;
  name: string;
  duration_min: number;
  notes_html: string;
  tags: Cat[];
  /** The small line at the foot of a card: how many resources and plays it has. */
  meta?: string;
}
/**
 * Drills as cards or compact rows, behind a box of search, layout and category. Pressing one opens
 * it: to change, for a coach; to read, for anyone else. `onShare` and `onRemove` put those buttons on each.
 */
export function DrillBrowser<D extends BrowseDrill>({ drills, compactKey, categories, onOpen, onShare, onRemove, empty }: { drills: D[] | null; compactKey: string; categories?: Cat[]; onOpen: (d: D) => void; onShare?: (d: D) => void; onRemove?: (d: D) => void; empty: ReactNode }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [compact, setCompact] = useCompact(compactKey);
  const all = drills ?? [];
  // Every word typed has to be in the drill's name or its notes.
  const terms = searchTerms(q);
  const shown = all.filter((d) => hasTerms(`${d.name} ${htmlText(d.notes_html)}`, terms) && (!cat || d.tags.some((t) => t.name === cat)));
  const cats = categories ?? [...new Map(all.flatMap((d) => d.tags).map((t) => [t.name, t])).values()].sort((x, y) => x.name.localeCompare(y.name));
  return (
    <div className="ps-layout">
      <SideBox search="Search drills" q={q} onQ={setQ} compact={compact} onCompact={setCompact}>
        <SideChoices title="Category" all="" total={all.length} value={cat} onChange={setCat} items={cats.map((t) => ({ id: t.name, label: t.name, color: t.color, count: all.filter((d) => d.tags.some((x) => x.name === t.name)).length }))} />
      </SideBox>
      <div className="ps-main">
        {drills === null ? (
          <p className="muted">Loading…</p>
        ) : all.length === 0 ? (
          empty
        ) : shown.length === 0 ? (
          <p className="muted">No drills match.</p>
        ) : (
          <ul className={`drill-cards ${compact ? 'compact' : ''}`}>
            {shown.map((d) => {
              // While searching, the notes are shown from where a word was found in them.
              const preview = (terms.length > 0 && searchSnippet(htmlText(d.notes_html), terms)) || htmlPreview(d.notes_html);
              return (
                <li key={d.id} className="drill-card">
                  <button type="button" className="drill-card-main" onClick={() => onOpen(d)}>
                    <span className="drill-card-top">
                      <span className="drill-card-name">
                        <Hit text={d.name} terms={terms} />
                      </span>
                      {d.duration_min > 0 && <span className="drill-card-time">{d.duration_min} min</span>}
                    </span>
                    <span className="chips">
                      {d.tags.map((t) => (
                        <span key={t.name} className="chip">
                          <span className="dot" style={{ background: t.color }} />
                          {t.name}
                        </span>
                      ))}
                    </span>
                    {preview && (
                      <span className="drill-card-notes">
                        <Hit text={preview} terms={terms} />
                      </span>
                    )}
                    <span className="plan-meta">{d.meta || ''}</span>
                  </button>
                  {(onShare || onRemove) && (
                    <span className="row-actions">
                      {onShare && (
                        <button type="button" className="btn small icon-btn" aria-label={`Share ${d.name}`} title="Share" onClick={() => onShare(d)}>
                          <ShareIcon size={17} />
                        </button>
                      )}
                      {onRemove && (
                        <button type="button" className="btn small icon-btn danger" aria-label={`Delete ${d.name}`} title="Delete" onClick={() => onRemove(d)}>
                          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l1 12.500h9l1-12.500M10 11v5M14 11v5" />
                          </svg>
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Film

export type FilmKind = 'video' | 'clip' | 'reel';
export interface BrowseFilm {
  key: string;
  kind: FilmKind;
  title: string;
  /** The line under the title: where it is from, and when. */
  meta: string;
  notes?: string;
  /** The game video whose picture stands for it, or null for none. */
  poster: number | null;
  length: string;
  /** Not watched yet by the person looking. */
  fresh?: boolean;
  /** Clips: the game video it was cut from, for narrowing the clips to one video's. */
  from?: { id: number; title: string };
}
const FILM_KINDS: [FilmKind, string][] = [
  ['video', 'Game videos'],
  ['clip', 'Clips'],
  ['reel', 'Cuts'],
];
/**
 * Game videos, clips and cuts as cards or compact rows, behind a box of search, layout and which
 * kind shows. `buttons` are what stands under each one: for a coach, play, edit, share and delete;
 * for anyone else, play. With `allKinds`, all three can be seen at once.
 */
export function FilmBrowser<F extends BrowseFilm>({ films, compactKey, kind, onKind, allKinds, onPlay, buttons, sharedWith, empty }: { films: F[] | null; compactKey: string; /** The names of where it is shared for all to see, such as the team. A coach's only. */ sharedWith?: (f: F) => string[]; /** '' for every kind at once. */ kind: FilmKind | ''; onKind: (k: FilmKind | '') => void; allKinds?: boolean; onPlay: (f: F) => void; buttons: (f: F) => ReactNode; /** What shows when there is none of the kind chosen, or none at all. */ empty: (kind: FilmKind | '') => ReactNode }) {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(0);
  const [compact, setCompact] = useCompact(compactKey);
  const all = films ?? [];
  const term = q.trim().toLowerCase();
  const found = all.filter((f) => !term || `${f.title} ${f.notes || ''} ${f.meta}`.toLowerCase().includes(term));
  const ofKind = all.filter((f) => !kind || f.kind === kind);
  const shown = found.filter((f) => (!kind || f.kind === kind) && (!from || kind !== 'clip' || f.from?.id === from));
  const sources = [...new Map(all.filter((f) => f.kind === 'clip' && f.from).map((f) => [f.from!.id, f.from!])).values()];
  return (
    <div className="ps-layout">
      <SideBox search="Search film" q={q} onQ={setQ} compact={compact} onCompact={setCompact}>
        <section>
          <h2>Show</h2>
          <div className="ps-side-filter" role="group" aria-label="Kinds of film">
            {allKinds && (
              <button type="button" className={kind === '' ? 'on' : ''} aria-pressed={kind === ''} onClick={() => onKind('')}>
                <span>All</span>
                <span className="ps-side-count">{all.length}</span>
              </button>
            )}
            {FILM_KINDS.map(([id, label]) => (
              <button key={id} type="button" className={kind === id ? 'on' : ''} aria-pressed={kind === id} onClick={() => onKind(id)}>
                <span>{label}</span>
                <span className="ps-side-count">{films ? all.filter((f) => f.kind === id).length : ''}</span>
              </button>
            ))}
          </div>
        </section>
        {kind === 'clip' && <SideChoices title="From game video" all={0} allLabel="All videos" total={all.filter((f) => f.kind === 'clip').length} value={from} onChange={setFrom} items={sources.map((v) => ({ id: v.id, label: v.title, count: all.filter((f) => f.kind === 'clip' && f.from?.id === v.id).length }))} />}
      </SideBox>
      <div className="ps-main">
        {films === null ? (
          <p className="muted">Loading…</p>
        ) : ofKind.length === 0 ? (
          empty(kind)
        ) : shown.length === 0 ? (
          <p className="muted">Nothing matches.</p>
        ) : (
          <div className={`res-grid ${compact ? 'compact' : ''}`}>
            {shown.map((f) => (
              <div key={f.key} className={`res-card kind-video ${f.kind === 'video' ? 'game-video' : 'film-card'}`}>
                <button type="button" className="res-preview" onClick={() => onPlay(f)} title="Play">
                  {f.poster ? (
                    <img className="res-thumb gv-poster" src={`/api/streams/${f.poster}/poster`} alt="" loading="lazy" />
                  ) : (
                    <span className="res-thumb site">
                      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3.5 7h11v10h-11zM14.5 10.500l6-3v9l-6-3" />
                      </svg>
                      {f.kind === 'video' ? 'Game video' : 'Video'}
                    </span>
                  )}
                  <span className="res-play" aria-hidden="true">
                    ▶
                  </span>
                  <span className="gv-length">{f.length}</span>
                </button>
                <div className="res-info">
                  <strong className="res-title">
                    {f.title} {f.fresh && <span className="kind new">New</span>}
                  </strong>
                  <span className="muted small">{f.meta}</span>
                  {f.notes && <p className="film-notes">{f.notes}</p>}
                  <SharedWithLine names={sharedWith?.(f) ?? []} />
                  <div className="res-actions">{buttons(f)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Homework

export interface BrowseHomework {
  id: number;
  title: string;
  /** The day it was set, and the day it is due ('' for none). */
  date: string;
  due: string;
  /** What it is about. Left undefined where that is not told. */
  about?: string;
  /** Who it is for, in words. */
  who: string;
  /** The names of what is on it. */
  items: string[];
}
/**
 * Homework sheets as cards, newest first: what each is called, when it was set and when it is
 * due, who it is for and what is on it. With `href` a card leads to the sheet; with `onOpen` it is
 * pressed to read it. `more` is what a coach's "..." holds.
 */
export function HomeworkCards<H extends BrowseHomework>({ sheets, today, href, onOpen, more, emptyAbout }: { sheets: H[]; today: string; href?: (h: H) => string; onOpen?: (h: H) => void; more?: (h: H) => MenuItem[]; /** Said on a card with nothing written about it. Left out, nothing is said. */ emptyAbout?: string }) {
  return (
    <ul className="hw-grid">
      {[...sheets]
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id)
        .map((h) => {
          // Past its due day it is over; with no due day it never is.
          const state = h.items.length === 0 ? 'empty' : h.due && h.due < today ? 'past' : h.due && h.due === today ? 'today' : 'open';
          const title = h.title || 'Untitled homework';
          const menu = more?.(h) ?? [];
          return (
            <li key={h.id} className={`card hw-card is-${state}`}>
              <header>
                {href ? (
                  <Link to={href(h)} className="hw-title">
                    {title}
                  </Link>
                ) : (
                  <button type="button" className="hw-title" onClick={() => onOpen?.(h)}>
                    {title}
                  </button>
                )}
                <span className={`hw-pill is-${state}`}>{state === 'empty' ? 'Empty' : state === 'past' ? 'Past due' : state === 'today' ? 'Due today' : 'Assigned'}</span>
              </header>
              <p className="hw-dates">
                <svg className="ps-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 6h14v14H5ZM5 10h14M9 3.500V7M15 3.500V7" />
                </svg>
                {h.date ? fmtDateShort(h.date) : 'No date'}
                {h.due ? (
                  <>
                    <span aria-hidden="true"> → </span>
                    <span className="sr-only"> to </span>
                    <strong>{fmtDateShort(h.due)}</strong>
                  </>
                ) : (
                  <span className="muted"> · no due date</span>
                )}
              </p>
              {h.about?.trim() ? <p className="hw-about">{h.about.trim()}</p> : emptyAbout ? <p className="hw-about muted">{emptyAbout}</p> : null}
              <dl className="hw-facts">
                <div>
                  <dt>For</dt>
                  <dd>{h.who}</dd>
                </div>
                <div>
                  <dt>{h.items.length === 1 ? '1 item' : `${h.items.length} items`}</dt>
                  <dd>{h.items.length === 0 ? 'Nothing on it yet' : h.items.slice(0, 3).join(', ') + (h.items.length > 3 ? ` and ${h.items.length - 3} more` : '')}</dd>
                </div>
              </dl>
              <footer>
                {href ? (
                  <Link className="btn primary" to={href(h)}>
                    View
                  </Link>
                ) : (
                  <button type="button" className="btn primary" onClick={() => onOpen?.(h)}>
                    View
                  </button>
                )}
                {menu.length > 0 && <MoreMenu items={menu} label={`More for ${title}`} />}
              </footer>
            </li>
          );
        })}
    </ul>
  );
}
