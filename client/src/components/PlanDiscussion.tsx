// Coaches talking about one practice: the team's owner and everyone the team is shared with.
// Messages can be replied to, and replies replied to. A new one shows up in each coach's Messages.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PlanCollaborator, type PlanPost } from '../api';
import { useApp } from '../App';
import { confirmDialog } from './dialogs';

const stamp = (at: string) => new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`).getTime();
function ago(at: string) {
  const secs = Math.max(0, (Date.now() - stamp(at)) / 1000);
  if (secs < 90) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  const days = Math.round(secs / 86400);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(stamp(at)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function Avatar({ name }: { name: string }) {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="cm-avatar" style={{ '--hue': n } as React.CSSProperties} aria-hidden="true">
      {(name.trim()[0] || '?').toUpperCase()}
    </span>
  );
}
const count = (list: PlanPost[]): number => list.reduce((n, p) => n + 1 + count(p.replies), 0);
/** Replies step in under what they answer this many times. Deeper ones line up, so words keep their room in a narrow column. */
const MAX_INDENT = 2;

/** A box to write in. Ctrl+Enter sends. */
function Write({ placeholder, autoFocus, onSend, onCancel }: { placeholder: string; autoFocus?: boolean; onSend: (text: string) => Promise<boolean>; onCancel?: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    if (await onSend(text.trim())) setText('');
    setBusy(false);
  };
  return (
    <div className="pd-write">
      <textarea
        className="input"
        rows={2}
        maxLength={4000}
        autoFocus={autoFocus}
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
      />
      <span className="pd-write-actions">
        {onCancel && (
          <button type="button" className="btn small" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn small primary" disabled={!text.trim() || busy} onClick={send}>
          {onCancel ? 'Reply' : 'Post'}
        </button>
      </span>
    </div>
  );
}

function Node({ p, depth, onReply, onDelete }: { p: PlanPost; depth: number; onReply: (parent: number, text: string) => Promise<boolean>; onDelete: (p: PlanPost) => void }) {
  const [writing, setWriting] = useState(false);
  return (
    <li className="cm-reply pd-post">
      <Avatar name={p.by} />
      <div className="cm-reply-main">
        <div className="cm-post-head">
          <strong>{p.mine ? 'You' : p.by}</strong>
          <span className="muted small">{ago(p.created_at)}</span>
        </div>
        <p className="message-body">{p.body}</p>
        <div className="cm-thread-bar">
          <button type="button" className="cm-reply-btn" onClick={() => setWriting(!writing)} aria-expanded={writing}>
            Reply
          </button>
          {p.can_delete && (
            <button type="button" className="link small cm-reply-del" onClick={() => onDelete(p)}>
              Delete
            </button>
          )}
        </div>
        {writing && (
          <Write
            placeholder="Write a reply…"
            autoFocus
            onCancel={() => setWriting(false)}
            onSend={async (text) => {
              const ok = await onReply(p.id, text);
              if (ok) setWriting(false);
              return ok;
            }}
          />
        )}
        {p.replies.length > 0 && (
          <ul className={`cm-replies ${depth >= MAX_INDENT ? 'level' : ''}`}>
            {p.replies.map((r) => (
              <Node key={r.id} p={r} depth={depth + 1} onReply={onReply} onDelete={onDelete} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** Who can work on this plan with you: the team's owner and the people the team is shared with. */
export function PlanCollaborators({ planId }: { planId: number }) {
  const app = useApp();
  const [people, setPeople] = useState<PlanCollaborator[] | null>(null);
  useEffect(() => {
    setPeople(null);
    api.planCollaborators(planId).then(setPeople, () => setPeople([]));
  }, [planId]);
  // The owner, or a helper who manages the team, decides who is on it.
  const manages = !app.access || app.can('manage');
  return (
    <section className="plan-collab" aria-label="Collaborators">
      <div className="plan-collab-head">
        <h2>
          Collaborators {people && people.length > 0 && <span className="muted">({people.length})</span>}
        </h2>
        {manages && (
          <Link className="link small" to="/teams?tab=people">
            {people && people.length > 1 ? 'Manage' : 'Add a coach'}
          </Link>
        )}
      </div>
      {people === null ? (
        <p className="muted small">Loading…</p>
      ) : (
        <ul>
          {people.map((p) => (
            <li key={p.id}>
              <Avatar name={p.name} />
              <span className="plan-collab-name">
                <strong>{p.you ? 'You' : p.name}</strong>
                <span className="muted small">{p.role}</span>
              </span>
              <span className={`plan-collab-can ${p.can_edit ? 'edit' : ''}`} title={p.can_edit ? 'Can change this plan and take part in the discussion' : 'Can read this plan and take part in the discussion'}>
                {p.can_edit ? 'Can edit' : 'Can comment'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {people && people.length === 1 && <p className="muted small">Only you so far. Share the team with another coach to plan together.</p>}
    </section>
  );
}

export default function PlanDiscussion({ planId, what }: { planId: number; /** "practice" or "homework sheet". */ what: string }) {
  const [posts, setPosts] = useState<PlanPost[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.planPosts(planId).then(setPosts, (e) => setError((e as Error).message)), [planId]);
  useEffect(() => {
    setPosts(null);
    load();
    // Another coach writing shows up at once.
    window.addEventListener('dime:news', load);
    return () => window.removeEventListener('dime:news', load);
  }, [load]);
  const send = async (text: string, parent?: number) => {
    try {
      setPosts(await api.postToPlan(planId, text, parent));
      setError('');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const remove = async (p: PlanPost) => {
    const n = count(p.replies);
    if (!(await confirmDialog({ title: 'Delete this message?', body: n ? `It is removed for everyone, along with the ${n === 1 ? 'reply' : `${n} replies`} to it.` : 'It is removed for everyone.', confirmLabel: 'Delete', danger: true }))) return;
    api.deletePlanPost(planId, p.id).then(setPosts, (e) => setError((e as Error).message));
  };
  const total = count(posts || []);
  return (
    <section className="plan-discussion" aria-label="Discussion">
      <h2>
        Discussion {total > 0 && <span className="muted">({total})</span>}
      </h2>
      {error && <p className="error">{error}</p>}
      <Write placeholder={`Write about this ${what}…`} onSend={(text) => send(text)} />
      {posts === null ? (
        !error && <p className="muted small">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="muted small pd-none">Nothing yet. Start the conversation.</p>
      ) : (
        <ul className="pd-list">
          {posts.map((p) => (
            <Node key={p.id} p={p} depth={1} onReply={(parent, text) => send(text, parent)} onDelete={remove} />
          ))}
        </ul>
      )}
    </section>
  );
}
