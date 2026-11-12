import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Community } from '../api';
import { useApp } from '../App';
import { Field, Modal } from '../components/bits';

const ROLE = { creator: 'Creator', admin: 'Admin', member: 'Member' } as const;

/** The communities you belong to, invitations waiting for you, and the ways to start or join one. */
export default function Communities() {
  const { user } = useApp();
  const navigate = useNavigate();
  const [list, setList] = useState<Community[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', share_drills: true, share_plays: true, share_plans: false });
  const [code, setCode] = useState('');

  const load = useCallback(
    () =>
      api
        .communities()
        .then(setList)
        .catch((e) => setError((e as Error).message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const c = await api.createCommunity({ name: draft.name, description: draft.description });
      await api.updateCommunity(c.id, { share_drills: draft.share_drills, share_plays: draft.share_plays, share_plans: draft.share_plans });
      navigate(`/communities/${c.id}`);
    });
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const c = await api.joinCommunity(code);
      navigate(`/communities/${c.id}`);
    });
  };

  const invited = (list || []).filter((c) => c.status === 'invited');
  const mine = (list || []).filter((c) => c.status === 'active');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Communities</h1>
          <p className="muted">Groups of coaches who talk to each other and, if the group allows it, share drills, plays and practice plans.</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => setCreating(true)}>
            + New community
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {invited.length > 0 && (
        <div className="card invites">
          <h2>Invitations</h2>
          <ul className="plan-list">
            {invited.map((c) => (
              <li key={c.id} className="plan-row">
                <div className="plan-main">
                  <span className="plan-title">{c.name}</span>
                  <span className="plan-meta">
                    {c.members} member{c.members === 1 ? '' : 's'} · started by {c.created_by_name}
                  </span>
                  {c.description && <span className="muted small">{c.description}</span>}
                </div>
                <span className="row-actions">
                  <button className="btn small primary" onClick={() => run(() => api.acceptInvite(c.id))}>
                    Join
                  </button>
                  <button className="btn small" onClick={() => run(() => api.removeMember(c.id, user.id))}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {list === null ? (
        <p className="muted">Loading…</p>
      ) : mine.length === 0 ? (
        <div className="empty">
          <h2>You are not in a community yet</h2>
          <p>Start one for your club, league or coaching friends, or join one with a code someone sent you.</p>
          <button className="btn primary" onClick={() => setCreating(true)}>
            + New community
          </button>
        </div>
      ) : (
        <ul className="community-grid">
          {mine.map((c) => (
            <li key={c.id}>
              <Link to={`/communities/${c.id}`} className="community-card">
                <span className="community-name">
                  {c.name}
                  <span className={`kind ${c.role === 'member' ? '' : 'game'}`}>{ROLE[c.role]}</span>
                </span>
                {c.description && <span className="muted small community-about">{c.description}</span>}
                <span className="community-meta">
                  {c.members} member{c.members === 1 ? '' : 's'}
                  {' · '}
                  {[c.share_drills && 'drills', c.share_plays && 'plays', c.share_plans && 'practice plans'].filter(Boolean).join(', ') || 'messages only'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form className="card join-card" onSubmit={join}>
        <h2>Join with a code</h2>
        <p className="muted small">A community admin can give you their join code.</p>
        <div className="join-row">
          <input className="input" aria-label="Join code" placeholder="Such as 4F9A21C07B" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn" disabled={!code.trim()}>
            Join
          </button>
        </div>
      </form>

      {creating && (
        <Modal title="New community" onClose={() => setCreating(false)}>
          <form className="fields stack" onSubmit={create}>
            <Field label="Name">
              <input className="input" autoFocus required maxLength={80} placeholder="Such as Altoona youth coaches" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="What it is for">
              <textarea className="input" rows={2} maxLength={600} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <div className="share-kinds">
              <span className="field-label">Members may share</span>
              {(
                [
                  ['share_drills', 'Drills'],
                  ['share_plays', 'Plays'],
                  ['share_plans', 'Practice plans'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="check">
                  <input type="checkbox" checked={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
              <span className="muted small">You can change this later. Every community has messages.</span>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn primary">Create community</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
