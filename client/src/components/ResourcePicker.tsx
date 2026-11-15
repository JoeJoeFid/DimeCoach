import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Resource } from '../types';
import { Modal } from './bits';
import { roomyScreen } from '../util';
import { makeThumb, thumbUrl } from '../linkThumb';

export const fileUrl = (r: Resource) => `/api/${r.kind === 'video' ? 'videos' : 'images'}/${r.file_id}`;
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
/** Words a search should match for a resource: its title, address and everywhere it is used. */
export const searchText = (r: Resource) => `${r.title} ${r.url} ${r.uses.map((u) => u.name).join(' ')}`.toLowerCase();

const KINDS: { id: Resource['kind']; label: string }[] = [
  { id: 'link', label: 'Links' },
  { id: 'image', label: 'Pictures' },
  { id: 'video', label: 'Videos' },
];

/** A small preview of a resource: the picture, the first frame of the video, or the site name of a link. */
export function ResourceThumb({ resource }: { resource: Resource }) {
  // A link shows its preview picture when there is one: kept already, or found and shrunk now.
  const isLink = resource.kind === 'link';
  const [picture, setPicture] = useState<string | null>(isLink && resource.thumb === 'ok' ? thumbUrl(resource.url) : null);
  useEffect(() => {
    if (!isLink || resource.thumb === 'none') return setPicture(null);
    if (resource.thumb === 'ok') return setPicture(thumbUrl(resource.url));
    let live = true;
    makeThumb(resource.url).then((data) => live && setPicture(data));
    return () => {
      live = false;
    };
  }, [isLink, resource.url, resource.thumb]);
  if (isLink && picture) return <img className="res-thumb link-shot" src={picture} alt="" loading="lazy" onError={() => setPicture(null)} />;
  if (resource.kind === 'image') return <img className="res-thumb" src={fileUrl(resource)} alt="" loading="lazy" />;
  if (resource.kind === 'video') return <video className="res-thumb" src={fileUrl(resource)} preload="metadata" muted />;
  return (
    <span className="res-thumb site">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" />
      </svg>
      {hostOf(resource.url)}
    </span>
  );
}

/** Choose something already in the workspace instead of uploading or typing it again. */
export function ResourcePicker(props: {
  /** Keys of resources already attached here, which are left out. */
  exclude?: string[];
  onPick: (r: Resource) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<Resource[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Resource['kind'] | 'all'>('all');
  useEffect(() => {
    api.resources().then(setAll).catch((e) => setError((e as Error).message));
  }, []);
  const available = (all || []).filter((r) => !(props.exclude || []).includes(r.key));
  const shown = available.filter((r) => (kind === 'all' || r.kind === kind) && (!q.trim() || searchText(r).includes(q.trim().toLowerCase())));

  return (
    <Modal title="Choose from your resources" onClose={props.onClose} wide>
      {error && <p className="error">{error}</p>}
      <div className="picker-filters">
        <input className="input grow" autoFocus={roomyScreen()} placeholder="Search by name, address, or where it is used" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Kind of resource">
          <button className={kind === 'all' ? 'on' : ''} aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
            All
          </button>
          {KINDS.map((k) => (
            <button key={k.id} className={kind === k.id ? 'on' : ''} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {all === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">
          {available.length === 0
            ? 'Nothing else to choose yet. Anything you add to a drill, play or practice, or on the Resources page, shows up here.'
            : 'Nothing matches.'}
        </p>
      ) : (
        <ul className="res-pick">
          {shown.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={() => props.onPick(r)}>
                <ResourceThumb resource={r} />
                <span className="res-pick-info">
                  <strong>{r.title}</strong>
                  {r.uses.length > 0 && <span className="muted small">Used in {r.uses.length === 1 ? r.uses[0].name : `${r.uses.length} places`}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
