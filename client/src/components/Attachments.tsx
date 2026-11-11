// The one place to attach things to a practice item, a library drill or a play:
// pictures, videos and links, each as a single compact row.
import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { ItemImage, ItemLink, ItemVideo, Resource } from '../types';
import { imageUrl, prepareImage } from './ItemImages';
import { MAX_VIDEO_MB, normalizeUrl, videoUrl } from './ItemMedia';
import { ResourcePicker, hostOf } from './ResourcePicker';
import { Modal } from './bits';

interface Value {
  images: ItemImage[];
  videos: ItemVideo[];
  links: ItemLink[];
}
interface Props extends Value {
  onChange: (patch: Partial<Value>) => void;
}

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" />
  </svg>
);

export default function Attachments({ images, videos, links, onChange }: Props) {
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [newLink, setNewLink] = useState<{ label: string; url: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState<{ kind: 'image' | 'video'; id: number; title: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Uploads finish one after another; these keep each new file from overwriting the one before it.
  const latest = useRef<Value>({ images, videos, links });
  latest.current = { images, videos, links };

  const upload = async (files: File[]) => {
    const usable = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(mov|mp4|webm)$/i.test(f.name));
    if (usable.length === 0) return;
    setError('');
    for (const f of usable) {
      try {
        if (f.type.startsWith('image/')) {
          setProgress('Uploading picture…');
          const { id } = await api.uploadImage(await prepareImage(f));
          onChange({ images: [...latest.current.images, { id, width_pct: 60, caption: '' }] });
          latest.current = { ...latest.current, images: [...latest.current.images, { id, width_pct: 60, caption: '' }] };
        } else if (f.size > MAX_VIDEO_MB * 1024 * 1024) {
          setError(`${f.name} is ${Math.round(f.size / 1024 / 1024)} MB. Videos can be up to ${MAX_VIDEO_MB} MB. Add a link to it instead.`);
        } else {
          setProgress('Uploading video 0%');
          const { id } = await api.uploadVideo(f, (p) => setProgress(`Uploading video ${Math.round(p * 100)}%`));
          onChange({ videos: [...latest.current.videos, { id, caption: '' }] });
          latest.current = { ...latest.current, videos: [...latest.current.videos, { id, caption: '' }] };
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setProgress(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const addLink = (e: FormEvent) => {
    e.preventDefault();
    const url = newLink ? normalizeUrl(newLink.url) : '';
    if (!url) return;
    onChange({ links: [...links, { url, label: newLink!.label.trim() }] });
    setNewLink(null);
  };
  const pick = (r: Resource) => {
    setPicking(false);
    if (r.kind === 'image') onChange({ images: [...images, { id: r.file_id!, width_pct: 60, caption: '' }] });
    else if (r.kind === 'video') onChange({ videos: [...videos, { id: r.file_id!, caption: '' }] });
    else onChange({ links: [...links, { url: r.url, label: r.title }] });
  };
  const count = images.length + videos.length + links.length;

  return (
    <div
      className={`attach ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        upload(Array.from(e.dataTransfer.files));
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.some((f) => f.type.startsWith('image/'))) {
          e.preventDefault();
          upload(files);
        }
      }}
    >
      {error && <p className="error">{error}</p>}
      {count > 0 && (
        <ul className="attach-list">
          {images.map((im, i) => (
            <li key={`i${im.id}:${i}`} className="attach-row">
              <button type="button" className="attach-thumb" title="View larger" onClick={() => setViewing({ kind: 'image', id: im.id, title: im.caption || 'Picture' })}>
                <img src={imageUrl(im.id)} alt="" />
              </button>
              <input
                className="input attach-name"
                aria-label="Picture caption"
                placeholder="Picture (add a caption)"
                value={im.caption}
                onChange={(e) => onChange({ images: images.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)) })}
              />
              <label className="attach-size" title="How wide the picture prints on the sheet">
                <span className="muted small">Print</span>
                <input
                  type="range"
                  min={15}
                  max={100}
                  step={5}
                  value={im.width_pct}
                  aria-label="Printed width of this picture"
                  onChange={(e) => onChange({ images: images.map((x, j) => (j === i ? { ...x, width_pct: Number(e.target.value) } : x)) })}
                />
                <span className="attach-pct">{im.width_pct}%</span>
              </label>
              <button type="button" className="btn ghost" aria-label="Remove picture" onClick={() => onChange({ images: images.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </li>
          ))}
          {videos.map((v, i) => (
            <li key={`v${v.id}:${i}`} className="attach-row">
              <button type="button" className="attach-thumb video" title="Play" onClick={() => setViewing({ kind: 'video', id: v.id, title: v.caption || 'Video' })}>
                <video src={videoUrl(v.id)} preload="metadata" muted />
                <span aria-hidden="true">▶</span>
              </button>
              <input
                className="input attach-name"
                aria-label="Video caption"
                placeholder="Video (add a caption)"
                value={v.caption}
                onChange={(e) => onChange({ videos: videos.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)) })}
              />
              <span className="attach-meta muted small">Video</span>
              <button type="button" className="btn ghost" aria-label="Remove video" onClick={() => onChange({ videos: videos.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </li>
          ))}
          {links.map((l, i) => (
            <li key={`l${l.url}:${i}`} className="attach-row">
              <a className="attach-thumb site" href={l.url} target="_blank" rel="noopener noreferrer" title={`Open ${l.url}`}>
                <LinkIcon />
              </a>
              <input
                className="input attach-name"
                aria-label="Link name"
                placeholder={hostOf(l.url)}
                value={l.label}
                onChange={(e) => onChange({ links: links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              />
              <a className="attach-meta small" href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}>
                {hostOf(l.url)} ↗
              </a>
              <button type="button" className="btn ghost" aria-label="Remove link" onClick={() => onChange({ links: links.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {newLink ? (
        <form className="attach-new-link" onSubmit={addLink}>
          <input className="input" aria-label="New link name" placeholder="Name (optional)" value={newLink.label} onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} />
          <input className="input grow" aria-label="New web address" placeholder="Paste a web address" autoFocus value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
          <button className="btn small primary" type="submit" disabled={!normalizeUrl(newLink.url)}>
            Add
          </button>
          <button className="btn small" type="button" onClick={() => setNewLink(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="attach-actions">
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            multiple
            hidden
            onChange={(e) => upload(Array.from(e.target.files || []))}
          />
          <button type="button" className="btn small" disabled={progress !== null} onClick={() => fileInput.current?.click()}>
            {progress ?? 'Upload picture or video'}
          </button>
          <button type="button" className="btn small" onClick={() => setNewLink({ label: '', url: '' })}>
            Add link
          </button>
          <button type="button" className="btn small" onClick={() => setPicking(true)}>
            Choose from resources
          </button>
        </div>
      )}

      {picking && (
        <ResourcePicker
          exclude={[...images.map((im) => `file:${im.id}`), ...videos.map((v) => `file:${v.id}`), ...links.map((l) => `link:${l.url}`)]}
          onClose={() => setPicking(false)}
          onPick={pick}
        />
      )}
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)} wide>
          {viewing.kind === 'image' ? (
            <img className="res-full" src={imageUrl(viewing.id)} alt={viewing.title} />
          ) : (
            <video className="res-full" src={videoUrl(viewing.id)} controls autoPlay />
          )}
        </Modal>
      )}
    </div>
  );
}
