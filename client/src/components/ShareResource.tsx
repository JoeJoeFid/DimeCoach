// The parts of sharing that only a resource has. A link goes into the discussions of a community,
// or out as the link itself. A picture or video is a private file, so it is handed over as the
// file: to the device's share sheet where there is one, or saved to the device to send on.
// The box they sit in, and sharing with coaches and the team, are in ShareItem.tsx.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Community } from '../api';
import type { Resource } from '../types';
import { ShareIcon } from './bits';
import { fileUrl } from './ResourcePicker';

const canSheet = () => typeof navigator.share === 'function';
/** Closing the share sheet without choosing anything is not a failure. */
const realError = (e: unknown) => ((e as Error).name === 'AbortError' ? '' : (e as Error).message);

/** A link goes into a community as a message in its discussions, where the members can talk about it. */
export function ToCommunities({ resource: r, onPosted }: { resource: Resource; /** Told which community it went to, so that can be kept. */ onPosted?: (communityId: number) => void }) {
  const [mine, setMine] = useState<Community[] | null>(null);
  const [note, setNote] = useState('');
  const [posted, setPosted] = useState<number[]>([]);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    api.communities().then((list) => setMine(list.filter((c) => c.status === 'active')), (e) => setError((e as Error).message));
  }, []);
  if (!mine) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const post = async (c: Community) => {
    setBusy(c.id);
    try {
      await api.postToCommunity(c.id, `${note.trim() ? `${note.trim()}\n\n` : ''}${r.title}\n${r.url}`);
      setPosted((list) => [...list, c.id]);
      onPosted?.(c.id);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(0);
  };
  return (
    <div className="share-send">
      <p className="muted small">The link is posted in the community's discussions, under your name, where the other coaches can open it and reply.</p>
      {error && <p className="error">{error}</p>}
      {mine.length === 0 ? (
        <p className="muted small">
          You are not in a community yet. <Link to="/communities">Find or start one</Link>.
        </p>
      ) : (
        <>
          <label>
            <span className="field-label">Say something about it (optional)</span>
            <textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ul className="res-share-places">
            {mine.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {posted.includes(c.id) ? (
                  <Link className="small" to={`/communities/${c.id}?tab=discussions`}>
                    Posted. See it
                  </Link>
                ) : (
                  <button type="button" className="btn small" disabled={busy === c.id} onClick={() => post(c)}>
                    {busy === c.id ? 'Posting…' : 'Post it here'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function TheLink({ resource: r }: { resource: Resource }) {
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.url);
      setSaid('Link copied.');
      setError('');
    } catch {
      setError('The link could not be copied. Select it and copy it yourself.');
    }
  };
  return (
    <div className="share-send">
      <p className="muted small">The address itself, to paste into a text or anywhere else.</p>
      {error && <p className="error">{error}</p>}
      {said && (
        <p className="banner ok" role="status">
          {said}
        </p>
      )}
      <div className="res-share-link">
        <input className="input" readOnly aria-label="Link" value={r.url} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn primary" onClick={copy}>
          Copy link
        </button>
        {canSheet() && (
          <button type="button" className="btn" onClick={() => navigator.share({ title: r.title, url: r.url }).catch((e) => setError(realError(e)))}>
            <ShareIcon size={16} /> Share…
          </button>
        )}
      </div>
    </div>
  );
}

export function TheFile({ resource: r }: { resource: Resource }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');
  const noun = r.kind === 'video' ? 'video' : 'picture';
  const sheet = canSheet();
  const share = async () => {
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
      setError(realError(e));
    }
    setBusy(false);
  };
  return (
    <div className="share-send">
      {error && <p className="error">{error}</p>}
      {said && (
        <p className="banner ok" role="status">
          {said}
        </p>
      )}
      <p className="muted small">
        This {noun} is a private file, so there is no link to it to send. {sheet ? 'Share the file itself with another app, such as Messages or Mail.' : 'Save it to this device, then attach it to a message.'}
      </p>
      <button type="button" className="btn primary res-share-file" disabled={busy} onClick={share}>
        <ShareIcon size={16} /> {busy ? 'Getting the file…' : sheet ? `Share this ${noun}…` : 'Save to this device'}
      </button>
    </div>
  );
}
