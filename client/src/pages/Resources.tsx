import PageTitle from '../components/PageTitle';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type StorageSpace } from '../api';
import { SpaceMeter } from '../components/SpaceMeter';
import type { Resource } from '../types';
import { prepareImage } from '../components/ItemImages';
import { normalizeUrl } from '../components/ItemMedia';
import { ResourceThumb, fileUrl, searchText } from '../components/ResourcePicker';
import { Modal } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { deleteLater, usePendingDeletes } from '../components/toasts';

type Filter = 'all' | Resource['kind'];
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'link', label: 'Links' },
  { id: 'image', label: 'Pictures' },
  { id: 'video', label: 'Videos' },
];
const MAX_VIDEO_MB = 250;
const useLink = (u: Resource['uses'][number]) => (u.type === 'play' ? `/plays/${u.id}` : u.type === 'practice' ? `/plans/${u.id}` : '/library');
const USE_LABEL = { drill: 'Drill', play: 'Play', practice: 'Practice' } as const;

/**
 * Every link, picture and video in the workspace: the ones saved here directly, and the ones
 * attached to drills, plays and practice items.
 */
export default function Resources() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', url: '' });
  const [progress, setProgress] = useState<number | null>(null);
  const [viewing, setViewing] = useState<Resource | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.resources().then(setResources).catch((e) => setError((e as Error).message)), []);
  useEffect(() => {
    load();
  }, [load]);
  // How much of the upload space is used. Refreshed whenever the list changes, since that is when it can.
  const [space, setSpace] = useState<StorageSpace | null>(null);
  useEffect(() => {
    api.storage().then(setSpace, () => {});
  }, [resources]);

  const run = async (fn: () => Promise<Resource[]>) => {
    try {
      setResources(await fn());
      setError('');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const titleFromFile = (f: File) => f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

  const addLink = async (e: FormEvent) => {
    e.preventDefault();
    const url = normalizeUrl(draft.url);
    if (!url) return setError('Enter a web address, such as youtube.com/watch?v=...');
    if (await run(() => api.addResource({ kind: 'link', title: draft.title.trim(), url }))) {
      setDraft({ title: '', url: '' });
      setAdding(false);
    }
  };
  const addImages = async (files: FileList | null) => {
    for (const f of Array.from(files || [])) {
      try {
        const { id } = await api.uploadImage(await prepareImage(f));
        await run(() => api.addResource({ kind: 'image', title: titleFromFile(f), file_id: id }));
      } catch (e) {
        setError((e as Error).message);
      }
    }
    if (imageInput.current) imageInput.current.value = '';
  };
  const addVideo = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_VIDEO_MB * 1024 * 1024) setError(`That video is ${Math.round(f.size / 1024 / 1024)} MB. Use one under ${MAX_VIDEO_MB} MB, or add a link to it.`);
    else {
      setProgress(0);
      try {
        const { id } = await api.uploadVideo(f, setProgress);
        await run(() => api.addResource({ kind: 'video', title: titleFromFile(f), file_id: id }));
      } catch (e) {
        setError((e as Error).message);
      }
      setProgress(null);
    }
    if (videoInput.current) videoInput.current.value = '';
  };
  const remove = async (r: Resource) => {
    const inUse = r.uses.length > 0;
    const ok = await confirmDialog({
      title: `Remove "${r.title}" from your resources?`,
      body: inUse
        ? `It stays on the ${r.uses.length === 1 ? 'item that uses' : `${r.uses.length} items that use`} it, and stays in this list for as long as it is used there.`
        : r.kind === 'link'
          ? 'The link is removed from this list.'
          : 'The file is deleted. This cannot be undone.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok)
      deleteLater({
        key: `resource:${r.resource_id}`,
        message: `Removed "${r.title}".`,
        run: async () => setResources(await api.deleteResource(r.resource_id!)),
        failed: setError,
      });
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, link: 0, image: 0, video: 0 };
    for (const r of resources || []) {
      c.all++;
      c[r.kind]++;
    }
    return c;
  }, [resources]);
  const gone = usePendingDeletes();
  const shown = (resources || []).filter((r) => !(r.resource_id && gone.has(`resource:${r.resource_id}`)) && (filter === 'all' || r.kind === filter) && (!q.trim() || searchText(r).includes(q.trim().toLowerCase())));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle>Resources</PageTitle>
          <p className="muted">
            Every link, picture and video in one place: the ones you save here, and the ones already on your drills, plays and practices. Anything
            here can be attached to a drill, play or practice item.
          </p>
        </div>
        <div className="head-actions">
          <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => addImages(e.target.files)} />
          <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" hidden onChange={(e) => addVideo(e.target.files?.[0])} />
          <button className="btn" onClick={() => imageInput.current?.click()}>
            + Picture
          </button>
          <button className="btn" disabled={progress !== null} onClick={() => videoInput.current?.click()}>
            {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : '+ Video'}
          </button>
          <button className="btn primary" onClick={() => setAdding(true)}>
            + Link
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {space && (
        <p className="storage-note muted small">
          <span>Upload space</span>
          <SpaceMeter used={space.used_bytes} cap={space.cap_bytes} />
        </p>
      )}

      {adding && (
        <form className="card add-link" onSubmit={addLink}>
          <input className="input" aria-label="Link name" placeholder="Name, such as Shell drill explained" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input className="input grow" aria-label="Web address" autoFocus placeholder="Paste a web address" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <button className="btn primary" type="submit" disabled={!normalizeUrl(draft.url)}>
            Save link
          </button>
          <button className="btn" type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      )}

      <div className="playbook-filters">
        <input className="input grow" placeholder="Search by name, address, or the drill, play or practice it is on" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Kind of resource">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="chip-num">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {resources === null ? (
        <p className="muted">Loading…</p>
      ) : resources.length === 0 ? (
        <div className="empty">
          <h2>No resources yet</h2>
          <p>Save a link to a video, or upload a picture or clip. Links, pictures and videos you add to drills, plays and practices appear here too.</p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            + Link
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">Nothing matches.</p>
      ) : (
        <div className="res-grid">
          {shown.map((r) => (
            <ResourceCard key={r.key} resource={r} onView={() => setViewing(r)} onRename={(title) => run(() => api.renameResource(r.resource_id!, title))} onRemove={() => remove(r)} />
          ))}
        </div>
      )}

      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)} wide>
          {viewing.kind === 'image' ? <img className="res-full" src={fileUrl(viewing)} alt={viewing.title} /> : <video className="res-full" src={fileUrl(viewing)} controls autoPlay />}
        </Modal>
      )}
    </div>
  );
}

function ResourceCard({ resource: r, onView, onRename, onRemove }: { resource: Resource; onView: () => void; onRename: (title: string) => void; onRemove: () => void }) {
  const [title, setTitle] = useState(r.title);
  useEffect(() => setTitle(r.title), [r.title]);
  const saved = r.resource_id !== null;
  return (
    <div className={`res-card kind-${r.kind}`}>
      {r.kind === 'link' ? (
        <a className="res-preview" href={r.url} target="_blank" rel="noopener noreferrer" title="Open in a new tab">
          <ResourceThumb resource={r} />
        </a>
      ) : (
        <button type="button" className="res-preview" onClick={onView} title={r.kind === 'video' ? 'Play' : 'View larger'}>
          <ResourceThumb resource={r} />
          {r.kind === 'video' && (
            <span className="res-play" aria-hidden="true">
              ▶
            </span>
          )}
        </button>
      )}
      <div className="res-info">
        {saved ? (
          <input
            className="input res-title"
            aria-label="Name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() !== r.title && onRename(title.trim())}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <strong className="res-title">{r.title}</strong>
        )}
        {r.kind === 'link' && (
          <a className="muted small res-url" href={r.url} target="_blank" rel="noopener noreferrer">
            {r.url}
          </a>
        )}
        {r.uses.length > 0 ? (
          <ul className="res-uses">
            {r.uses.slice(0, 4).map((u, i) => (
              <li key={i}>
                <span className="kind">{USE_LABEL[u.type]}</span> <Link to={useLink(u)}>{u.name}</Link>
              </li>
            ))}
            {r.uses.length > 4 && <li className="muted small">and {r.uses.length - 4} more</li>}
          </ul>
        ) : (
          <span className="muted small">Not attached to anything yet.</span>
        )}
        <div className="res-actions">
          {r.kind === 'link' ? (
            <a className="btn small" href={r.url} target="_blank" rel="noopener noreferrer">
              Open
            </a>
          ) : (
            <button className="btn small" onClick={onView}>
              {r.kind === 'video' ? 'Play' : 'View'}
            </button>
          )}
          {saved && (
            <button className="btn small danger" onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
