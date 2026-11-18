// Sharing one resource, laid out like sharing a practice. A link can go to coaches (picked from a
// list, or by email address), into the discussions of a community, or out as the link itself.
// A picture or video is a private file, so it is handed over as the file: to the device's share
// sheet where there is one, or saved to the device to send on.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Community, type ResourcePeople } from '../api';
import type { Resource } from '../types';
import { Modal, ShareIcon } from './bits';
import { fileUrl } from './ResourcePicker';

type Tab = 'coaches' | 'communities' | 'link';
const TABS: [Tab, string][] = [
  ['coaches', 'Coaches'],
  ['communities', 'Communities'],
  ['link', 'Link'],
];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word.endsWith('ch') ? 'es' : 's'}`;
const canSheet = () => typeof navigator.share === 'function';
/** Closing the share sheet without choosing anything is not a failure. */
const realError = (e: unknown) => ((e as Error).name === 'AbortError' ? '' : (e as Error).message);

export default function ShareResource({ resource: r, onClose }: { resource: Resource; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('coaches');
  const isLink = r.kind === 'link';
  return (
    <Modal title={`Share "${r.title}"`} onClose={onClose}>
      {isLink ? (
        <>
          <div className="seg share-tabs" role="group" aria-label="Where to share it">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? 'on' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'coaches' && <ToCoaches resource={r} />}
          {tab === 'communities' && <ToCommunities resource={r} />}
          {tab === 'link' && <TheLink resource={r} />}
        </>
      ) : (
        <TheFile resource={r} />
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function ToCoaches({ resource: r }: { resource: Resource }) {
  const [st, setSt] = useState<ResourcePeople | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [emails, setEmails] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api.resourcePeople().then(setSt, (e) => setError((e as Error).message));
  }, []);
  if (!st) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const typed = emails
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const count = picked.length + typed.length;
  const shown = st.people.filter((p) => !q.trim() || `${p.name} ${p.where}`.toLowerCase().includes(q.trim().toLowerCase()));
  const send = async () => {
    setBusy(true);
    setSaid('');
    try {
      const out = await api.sendResource(r.key, { user_ids: picked, emails: typed, note });
      setSaid(
        out.failed.length
          ? `The email to ${out.failed.join(', ')} did not go through.${out.mailed ? ` ${plural(out.mailed, 'other')} did.` : ''}`
          : st.mail
            ? `Sent to ${plural(out.total, 'coach')}.`
            : `${plural(out.messaged, 'coach')} got a message in Dime Coach with the link.`,
      );
      setPicked([]);
      setEmails('');
      setNote('');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="share-send">
      <p className="muted small">
        {st.mail
          ? 'Each coach gets an email with a button that opens the link. A coach you pick from the list also gets a message in Dime Coach.'
          : 'Email is not set up on this site, so each coach you pick gets a message in Dime Coach with the link.'}
      </p>
      {error && <p className="error">{error}</p>}
      {said && (
        <p className="banner ok" role="status">
          {said}
        </p>
      )}
      {st.people.length > 8 && <input className="input" placeholder="Search coaches" aria-label="Search coaches" value={q} onChange={(e) => setQ(e.target.value)} />}
      {st.people.length === 0 ? (
        <p className="muted small">Coaches on your teams and people in your communities show up here to pick.</p>
      ) : (
        <ul className="share-people">
          {shown.map((p) => (
            <li key={p.id}>
              <label className="check">
                <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked((list) => (e.target.checked ? [...list, p.id] : list.filter((id) => id !== p.id)))} />
                <span>
                  <strong>{p.name}</strong>
                  <span className="muted small"> · {p.where}</span>
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="muted small">Nobody matches that search.</li>}
        </ul>
      )}
      {st.mail && (
        <label>
          <span className="field-label">{st.people.length ? 'Or send to email addresses' : 'Email addresses'}</span>
          <input className="input" type="text" inputMode="email" placeholder="coach@example.com, another@example.com" value={emails} onChange={(e) => setEmails(e.target.value)} />
        </label>
      )}
      <label>
        <span className="field-label">Add a note (optional)</span>
        <textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="button" className="btn primary" disabled={busy || count === 0} onClick={send}>
        {busy ? 'Sending…' : count ? `Send to ${plural(count, 'coach')}` : 'Send'}
      </button>
    </div>
  );
}

/** A link goes into a community as a message in its discussions, where the members can talk about it. */
function ToCommunities({ resource: r }: { resource: Resource }) {
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

function TheLink({ resource: r }: { resource: Resource }) {
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

function TheFile({ resource: r }: { resource: Resource }) {
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
