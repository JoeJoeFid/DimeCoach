import PageTitle from '../components/PageTitle';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type StorageSpace } from '../api';
import { SpaceMeter } from '../components/SpaceMeter';
import type { Resource } from '../types';
import { useApp } from '../App';
import { prepareImage } from '../components/ItemImages';
import { normalizeUrl } from '../components/ItemMedia';
import { ResourceThumb, fileUrl, searchText } from '../components/ResourcePicker';
import { Modal } from '../components/bits';
import { ResourceBrowser } from '../components/Browsers';
import { ShareItemDialog, SharedWithBox, useShareSummary } from '../components/ShareItem';
import { confirmDialog } from '../components/dialogs';
import { deleteLater, usePendingDeletes } from '../components/toasts';

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
  // Categories are the team's own: the ones of its sport.
  const { sportTags } = useApp();
  const [sharing, setSharing] = useState<Resource | null>(null);
  const [shareVersion, setShareVersion] = useState(0);
  const sharedWith = useShareSummary('resource', shareVersion);
  /** The key of the resource whose categories are being chosen. */
  const [tagging, setTagging] = useState('');
  // The box for adding one: first asking which kind, then, for a link, its name and address.
  const [adding, setAdding] = useState<false | 'pick' | 'link'>(false);
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

  // Saved video of the team's games is not here: it is in the Filmroom, with the clips cut from it.
  const gone = usePendingDeletes();
  const tagged = tagging ? (resources || []).find((r) => r.key === tagging) : undefined;
  // Each resource as the shared list wants it: its categories by name and color, and where it is used as lines with links.
  const items = (resources || [])
    .filter((r) => !(r.resource_id && gone.has(`resource:${r.resource_id}`)))
    .map((r) => ({
      src: r,
      key: r.key,
      kind: r.kind,
      title: r.title,
      url: r.url,
      tags: sportTags.filter((t) => r.tag_ids.includes(t.id)).map((t) => ({ name: t.name, color: t.color })),
      text: searchText(r),
      uses: r.uses.map((u) => ({ label: USE_LABEL[u.type], name: u.name, to: useLink(u) })),
      // Only one saved here directly has a name of its own to change, and can be taken out.
      renamable: r.resource_id !== null,
      removable: r.resource_id !== null,
    }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle
            about={{
              lead: 'Every link, picture and video in one place.',
              points: ['The ones you save here, and the ones already on your drills, plays and practices.', 'Anything here can be attached to a drill, a play or a practice item.'],
            }}
            beside={
              space && (
                <span className="space-pill" title="How much of your upload space is used by pictures and videos">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 18.500a4.500 4.500 0 0 1-.600-8.960 6 6 0 0 1 11.600 1.500A3.750 3.750 0 0 1 17.500 18.500ZM12 16.500v-5M9.800 13.500 12 11.300l2.200 2.200" />
                  </svg>
                  <SpaceMeter used={space.used_bytes} cap={space.cap_bytes} />
                </span>
              )
            }
          >
            Resources
          </PageTitle>
        </div>
        <div className="head-actions">
          <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => addImages(e.target.files)} />
          <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" hidden onChange={(e) => addVideo(e.target.files?.[0])} />
          <button className="btn primary" disabled={progress !== null} onClick={() => setAdding('pick')}>
            {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : '+ Resource'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {adding === 'pick' && (
        <Modal title="Add a resource" onClose={() => setAdding(false)}>
          <p className="muted small res-add-lead">What kind is it?</p>
          <div className="res-add-kinds">
            <button type="button" className="res-add-kind" autoFocus onClick={() => setAdding('link')}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" />
              </svg>
              <strong>Link</strong>
              <span className="muted small">A web address, such as a video on YouTube</span>
            </button>
            <button type="button" className="res-add-kind" onClick={() => (setAdding(false), imageInput.current?.click())}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 5.500h16v13H4ZM4 15.500l4.500-4.500 4 4 2.500-2.500 5 5M15.500 9.500h.010" />
              </svg>
              <strong>Picture</strong>
              <span className="muted small">One or more from this device</span>
            </button>
            <button type="button" className="res-add-kind" onClick={() => (setAdding(false), videoInput.current?.click())}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3.500 6.500h12v11h-12ZM15.500 10.500l5-3v9l-5-3" />
              </svg>
              <strong>Video</strong>
              <span className="muted small">A clip from this device: MP4, MOV or WebM</span>
            </button>
          </div>
        </Modal>
      )}
      {adding === 'link' && (
        <Modal title="Add a link" onClose={() => setAdding(false)}>
          <form className="fields stack" onSubmit={addLink}>
            <label className="field">
              <span className="field-label">Web address</span>
              <input className="input" aria-label="Web address" autoFocus placeholder="Paste a web address" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Name</span>
              <input className="input" aria-label="Link name" placeholder="Such as Shell drill explained" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            {error && <p className="error small">{error}</p>}
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setAdding('pick')}>
                Back
              </button>
              <button className="btn primary" type="submit" disabled={!normalizeUrl(draft.url)}>
                Save link
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* The same list the team's parents, family and friends see what was shared with them in. Here each one can be renamed, filed, shared and removed. */}
      <ResourceBrowser
        resources={resources === null ? null : items}
        compactKey={COMPACT_KEY}
        categories={sportTags.map((t) => ({ name: t.name, color: t.color }))}
        thumb={(x) => <ResourceThumb resource={x.src} />}
        onView={(x) => setViewing(x.src)}
        sharedWith={(x) => sharedWith[x.key] || []}
        actions={{
          rename: (x, title) => run(() => api.renameResource(x.src.resource_id!, title)),
          tag: (x) => setTagging(x.key),
          share: (x) => setSharing(x.src),
          remove: (x) => remove(x.src),
        }}
        empty={
          <div className="empty">
            <h2>No resources yet</h2>
            <p>Save a link to a video, or upload a picture or clip. Links, pictures and videos you add to drills, plays and practices appear here too.</p>
            <button className="btn primary" onClick={() => setAdding('pick')}>
              + Resource
            </button>
          </div>
        }
      />

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
      {sharing && (
        <ShareItemDialog
          what={{ kind: 'resource', resource: sharing }}
          onClose={() => {
            setSharing(null);
            setShareVersion((v) => v + 1);
          }}
        />
      )}
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)} wide>
          {viewing.kind === 'image' ? <img className="res-full" src={fileUrl(viewing)} alt={viewing.title} /> : <video className="res-full" src={fileUrl(viewing)} controls autoPlay />}
          <SharedWithBox what={{ kind: 'resource', resource: viewing }} version={shareVersion} onShare={() => setSharing(viewing)} />
        </Modal>
      )}
    </div>
  );
}
