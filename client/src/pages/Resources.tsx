import PageTitle from '../components/PageTitle';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type StorageSpace } from '../api';
import { SpaceMeter } from '../components/SpaceMeter';
import type { Resource, Tag } from '../types';
import { useApp } from '../App';
import { prepareImage } from '../components/ItemImages';
import { normalizeUrl } from '../components/ItemMedia';
import { ResourceThumb, fileUrl, searchText } from '../components/ResourcePicker';
import { Modal, ShareIcon } from '../components/bits';
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
const COMPACT_KEY = 'practiceplan.resourcesCompact';

export default function Resources() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Categories are the team's own: the ones of its sport. 0 is every category, -1 is filed under none.
  const { sportTags } = useApp();
  const [tagId, setTagId] = useState(0);
  const [sharing, setSharing] = useState<Resource | null>(null);
  /** The key of the resource whose categories are being chosen. */
  const [tagging, setTagging] = useState('');
  const sportTagIds = useMemo(() => new Set(sportTags.map((t) => t.id)), [sportTags]);
  const inTag = (r: Resource) => tagId === 0 || (tagId === -1 ? !r.tag_ids.some((id) => sportTagIds.has(id)) : r.tag_ids.includes(tagId));
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
  // Cards with a large preview, or one short line each. The choice is remembered on this device.
  const [compact, setCompact] = useState(() => localStorage.getItem(COMPACT_KEY) === '1');
  const chooseCompact = (on: boolean) => {
    setCompact(on);
    localStorage.setItem(COMPACT_KEY, on ? '1' : '0');
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
  const tagged = tagging ? (resources || []).find((r) => r.key === tagging) : undefined;
  const shown = (resources || []).filter((r) => !(r.resource_id && gone.has(`resource:${r.resource_id}`)) && (filter === 'all' || r.kind === filter) && inTag(r) && (!q.trim() || searchText(r).includes(q.trim().toLowerCase())));

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
        {sportTags.length > 0 && (
          <select className="input res-tag-filter" aria-label="Filter by category" value={tagId} onChange={(e) => setTagId(Number(e.target.value))}>
            <option value={0}>All categories</option>
            {sportTags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value={-1}>No category</option>
          </select>
        )}
        <div className="seg" role="group" aria-label="Kind of resource">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="chip-num">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Layout">
          <button className={compact ? '' : 'on'} aria-pressed={!compact} onClick={() => chooseCompact(false)}>
            Cards
          </button>
          <button className={compact ? 'on' : ''} aria-pressed={compact} onClick={() => chooseCompact(true)}>
            Compact
          </button>
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
        <div className={`res-grid ${compact ? 'compact' : ''}`}>
          {shown.map((r) => (
            <ResourceCard key={r.key} resource={r} tags={sportTags} onShare={() => setSharing(r)} onTag={() => setTagging(r.key)} onView={() => setViewing(r)} onRename={(title) => run(() => api.renameResource(r.resource_id!, title))} onRemove={() => remove(r)} />
          ))}
        </div>
      )}

      {tagged && (
        <Modal title={`Categories for "${tagged.title}"`} onClose={() => setTagging('')}>
          {sportTags.length === 0 ? (
            <p className="muted">
              This team has no categories yet. <Link to="/tags">Add categories</Link>, then file resources under them.
            </p>
          ) : (
            <>
              <p className="muted small">Choose every category this belongs under. It is saved as you choose.</p>
              <div className="res-tag-choices">
                {sportTags.map((t) => {
                  const on = tagged.tag_ids.includes(t.id);
                  return (
                    <button key={t.id} type="button" className={`chip toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => run(() => api.tagResource(tagged.key, on ? tagged.tag_ids.filter((id) => id !== t.id) : [...tagged.tag_ids, t.id]))}>
                      <span className="dot" style={{ background: t.color }} />
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={() => setTagging('')}>
              Done
            </button>
          </div>
        </Modal>
      )}
      {sharing && <ShareResource resource={sharing} onClose={() => setSharing(null)} />}
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)} wide>
          {viewing.kind === 'image' ? <img className="res-full" src={fileUrl(viewing)} alt={viewing.title} /> : <video className="res-full" src={fileUrl(viewing)} controls autoPlay />}
        </Modal>
      )}
    </div>
  );
}

function ResourceCard({ resource: r, tags, onShare, onTag, onView, onRename, onRemove }: { resource: Resource; tags: Tag[]; onShare: () => void; onTag: () => void; onView: () => void; onRename: (title: string) => void; onRemove: () => void }) {
  const [title, setTitle] = useState(r.title);
  useEffect(() => setTitle(r.title), [r.title]);
  const saved = r.resource_id !== null;
  const mine = tags.filter((t) => r.tag_ids.includes(t.id));
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
        {mine.length > 0 && (
          <div className="res-tags">
            {mine.map((t) => (
              <span key={t.id} className="chip">
                <span className="dot" style={{ background: t.color }} />
                {t.name}
              </span>
            ))}
          </div>
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
          <button className="btn small res-share" onClick={onShare} aria-label={`Share ${r.title}`} title="Share">
            <ShareIcon size={16} />
          </button>
          <button className="btn small" onClick={onTag} aria-label={`Categories for ${r.title}`}>
            Categories
          </button>
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

/**
 * Sharing one resource. A link can be emailed to other coaches, copied, or handed to the device's
 * own share sheet. A picture or video is a private file, so it is handed over as the file itself:
 * to the share sheet where the device has one, or saved to the device to send on.
 */
function ShareResource({ resource: r, onClose }: { resource: Resource; onClose: () => void }) {
  const [emails, setEmails] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');
  const isLink = r.kind === 'link';
  const typed = emails
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const sheet = typeof navigator.share === 'function';
  const fail = (e: unknown) => {
    // Closing the share sheet without choosing anything is not a failure.
    if ((e as Error).name !== 'AbortError') setError((e as Error).message);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.url);
      setSaid('Link copied.');
      setError('');
    } catch {
      setError('The link could not be copied. Select it above and copy it yourself.');
    }
  };
  const shareLink = () => navigator.share({ title: r.title, url: r.url }).catch(fail);
  const shareFile = async () => {
    setBusy(true);
    try {
      const blob = await (await fetch(fileUrl(r))).blob();
      const ext = (blob.type.split('/')[1] || (r.kind === 'video' ? 'mp4' : 'jpg')).replace('quicktime', 'mov').replace('jpeg', 'jpg');
      const file = new File([blob], `${r.title.replace(/[^\w .-]+/g, '').trim() || r.kind}.${ext}`, { type: blob.type });
      if (sheet && navigator.canShare?.({ files: [file] })) await navigator.share({ title: r.title, files: [file] });
      else {
        // No share sheet for files here: save it, to attach to a message.
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        setSaid('Saved to this device. Attach it to a message to send it on.');
      }
      setError('');
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };
  const send = async () => {
    setBusy(true);
    setSaid('');
    try {
      const out = await api.sendResource(r.key, typed, note);
      setSaid(out.failed.length ? `The email to ${out.failed.join(', ')} did not go through.${out.sent ? ` ${out.sent} did.` : ''}` : `Sent to ${out.sent} ${out.sent === 1 ? 'person' : 'people'}.`);
      if (!out.failed.length) {
        setEmails('');
        setNote('');
      }
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <Modal title={`Share "${r.title}"`} onClose={onClose}>
      <div className="res-share-box">
        {error && <p className="error">{error}</p>}
        {said && (
          <p className="banner ok" role="status">
            {said}
          </p>
        )}
        {isLink ? (
          <>
            <div className="res-share-link">
              <input className="input" readOnly aria-label="Link" value={r.url} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn" onClick={copy}>
                Copy link
              </button>
              {sheet && (
                <button type="button" className="btn" onClick={shareLink}>
                  <ShareIcon size={16} /> Share…
                </button>
              )}
            </div>
            <label className="field">
              <span className="field-label">Email it to coaches</span>
              <input className="input" placeholder="Email addresses, separated by commas" value={emails} onChange={(e) => setEmails(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Add a note (optional)</span>
              <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <p className="muted small">
              This {r.kind === 'video' ? 'video' : 'picture'} is a private file, so there is no link to it. {sheet ? 'Share the file itself with another app, such as Messages or Mail.' : 'Save it to this device, then attach it to a message.'}
            </p>
            <button type="button" className="btn primary" disabled={busy} onClick={shareFile}>
              <ShareIcon size={16} /> {busy ? 'Getting the file…' : sheet ? `Share this ${r.kind === 'video' ? 'video' : 'picture'}…` : 'Save to this device'}
            </button>
          </>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
        {isLink && (
          <button type="button" className="btn primary" disabled={busy || typed.length === 0} onClick={send}>
            <ShareIcon size={16} /> {busy ? 'Sending…' : typed.length > 1 ? `Send to ${typed.length} people` : 'Send'}
          </button>
        )}
      </div>
    </Modal>
  );
}
