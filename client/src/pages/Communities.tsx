import PageTitle from '../components/PageTitle';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Community, type CommunityNews, type CommunityNewsItem } from '../api';
import { useApp } from '../App';
import { Field, Modal } from '../components/bits';

const ROLE = { creator: 'Creator', admin: 'Admin', member: 'Member' } as const;
const SHARE_WORD = { drill: 'Drill', play: 'Play', plan: 'Practice plan' } as const;
const newsVerb = (n: CommunityNewsItem) => (n.kind === 'invite' ? 'invited you to join' : n.kind === 'share' ? 'shared something in' : 'wrote in');
/** "just now", "12 min ago", "3 days ago", from a time the database wrote in UTC. */
function ago(at: string) {
  const secs = Math.max(0, (Date.now() - new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`).getTime()) / 1000);
  if (secs < 90) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  const days = Math.round(secs / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The communities you belong to, invitations waiting for you, and the ways to start or join one. */
export default function Communities() {
  const app = useApp();
  const { user } = app;
  const navigate = useNavigate();
  const [list, setList] = useState<Community[] | null>(null);
  const [news, setNews] = useState<CommunityNews | null>(null);
  /** Takes a fresh answer about what is new, and passes the count on to the menu. */
  const gotNews = (n: CommunityNews) => {
    setNews(n);
    app.setCommunityUnread(n.unread);
  };
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', share_drills: true, share_plays: true, share_plans: false });
  const [code, setCode] = useState('');

  const load = useCallback(
    () =>
      Promise.all([api.communities(), api.communityNews()])
        .then(([c, n]) => {
          setList(c);
          gotNews(n);
        })
        .catch((e) => setError((e as Error).message)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const [shownNews, setShownNews] = useState(8);
  const unreadIn = (communityId: number) => (news?.items || []).filter((n) => n.unread && n.community_id === communityId).length;
  const invited = (list || []).filter((c) => c.status === 'invited');
  const mine = (list || []).filter((c) => c.status === 'active');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle>Communities</PageTitle>
          <p className="muted">Groups of coaches who talk to each other and, if the group allows it, share drills, plays and practice plans.</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => setCreating(true)}>
            + New community
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card news" id="messages">
        <div className="card-head">
          <h2>
            Messages {news && news.unread > 0 && <span className="nav-badge still">{news.unread} new</span>}
          </h2>
          {news && news.unread > 0 && news.items.some((i) => i.unread && i.kind !== 'invite') && (
            <button className="btn small" onClick={() => api.markCommunitySeen().then(gotNews, (e) => setError((e as Error).message))}>
              Mark all as read
            </button>
          )}
        </div>
        {news === null ? (
          <p className="muted small">Loading…</p>
        ) : news.items.length === 0 ? (
          <p className="muted small">Nothing yet. Invitations, messages from other coaches and things they share will show up here.</p>
        ) : (
          <ul className="news-list">
            {news.items.slice(0, shownNews).map((n) => (
              <li key={n.key} className={n.unread ? 'unread' : ''}>
                <button type="button" className="news-item" onClick={() => (n.kind === 'invite' ? document.getElementById('invitations')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) : navigate(`/communities/${n.community_id}`))}>
                  <span className={`news-dot ${n.unread ? 'on' : ''}`} aria-hidden="true" />
                  <span className="news-main">
                    <span className="news-line">
                      <strong>{n.by}</strong> {newsVerb(n)} <strong>{n.community}</strong>
                      {n.unread && <span className="sr-only"> (new)</span>}
                    </span>
                    {n.text && <span className={`news-text ${n.kind}`}>{n.kind === 'share' ? `${SHARE_WORD[n.share_kind!]}: ${n.text}` : n.text}</span>}
                  </span>
                  <span className="muted small news-when">{ago(n.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {news && news.items.length > shownNews && (
          <button className="link small" onClick={() => setShownNews(news.items.length)}>
            Show {news.items.length - shownNews} older
          </button>
        )}
      </div>

      {invited.length > 0 && (
        <div className="card invites" id="invitations">
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
                  {unreadIn(c.id) > 0 && <span className="nav-badge still">{unreadIn(c.id)} new</span>}
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
