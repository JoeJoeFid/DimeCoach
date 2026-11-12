import PageTitle from '../components/PageTitle';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type CommunityDetail, type CommunityPost, type CommunityShare, type ShareKind } from '../api';
import { useApp } from '../App';
import type { Drill, Plan, Play } from '../types';
import { fmtDateShort } from '../util';
import { Field, Modal } from '../components/bits';
import { KIND_WORDS, ShareRow, sharesKind } from '../components/community';
import { confirmDialog } from '../components/dialogs';

type Tab = 'messages' | 'library' | 'people' | 'settings';
const KINDS: ShareKind[] = ['drill', 'play', 'plan'];
const ROLE = { creator: 'Creator', admin: 'Admin', member: 'Member' } as const;
const when = (iso: string) => {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** One community: its messages, what members share, who is in it, and its settings. */
export default function CommunityPage() {
  const { id } = useParams();
  const communityId = Number(id);
  const navigate = useNavigate();
  const app = useApp();
  const [c, setC] = useState<CommunityDetail | null>(null);
  const [tab, setTab] = useState<Tab>('messages');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(
    () =>
      api
        .community(communityId)
        .then(setC)
        .catch((e) => setError((e as Error).message)),
    [communityId],
  );
  useEffect(() => {
    load();
  }, [load]);
  // Coming in here is what "reading" a community means: nothing in it counts as new after this.
  useEffect(() => {
    api
      .markCommunitySeen(communityId)
      .then((n) => app.setCommunityUnread(n.unread))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId]);
  const run = async (fn: () => Promise<unknown>, done = '') => {
    try {
      await fn();
      setError('');
      setNotice(done);
      await load();
      return true;
    } catch (e) {
      setNotice('');
      setError((e as Error).message);
      return false;
    }
  };

  if (!c)
    return (
      <div className="page">
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
        <Link to="/communities">Back to communities</Link>
      </div>
    );
  const admin = c.role !== 'member';
  const kinds = KINDS.filter((k) => sharesKind(c, k));

  return (
    <div className="page">
      <Link to="/communities" className="back-link">
        ← Communities
      </Link>
      <div className="page-head">
        <div>
          <PageTitle>{c.name}</PageTitle>
          <p className="muted">
            {c.description || 'A place to talk and share.'} · {c.members} member{c.members === 1 ? '' : 's'}
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="Sections">
          {(
            [
              ['messages', 'Messages'],
              ['library', `Shared library${c.pending_shares ? ` (${c.pending_shares})` : ''}`],
              ['people', 'People'],
              ['settings', 'Settings'],
            ] as const
          ).map(([t, label]) => (
            <button key={t} role="tab" className={tab === t ? 'on' : ''} aria-selected={tab === t} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {tab === 'messages' && <Messages communityId={c.id} />}
      {tab === 'library' && <Library c={c} kinds={kinds} admin={admin} onChanged={load} />}

      {tab === 'people' && (
        <>
          <div className="card">
            <h2>
              People <span className="muted">({c.people.filter((p) => p.status === 'active').length})</span>
            </h2>
            <ul className="plan-list">
              {c.people.map((p) => (
                <li key={p.id} className="plan-row">
                  <div className="plan-main">
                    <span className="plan-title">
                      {p.name}
                      <span className={`kind ${p.role === 'member' ? '' : 'game'}`}>{ROLE[p.role]}</span>
                      {p.id === app.user.id && <span className="kind">You</span>}
                      {p.status === 'invited' && <span className="kind">Invited, not joined yet</span>}
                    </span>
                    {p.email && <span className="plan-meta">{p.email}</span>}
                  </div>
                  <span className="row-actions">
                    {c.role === 'creator' && p.role !== 'creator' && p.status === 'active' && (
                      <button
                        className="btn small"
                        onClick={() =>
                          run(() => api.setMemberRole(c.id, p.id, p.role === 'admin' ? 'member' : 'admin'), p.role === 'admin' ? `${p.name} is no longer an admin.` : `${p.name} is now an admin of this community.`)
                        }
                      >
                        {p.role === 'admin' ? 'Remove admin' : 'Make admin'}
                      </button>
                    )}
                    {admin && p.id !== app.user.id && p.role !== 'creator' && (p.role !== 'admin' || c.role === 'creator') && (
                      <button
                        className="btn small danger"
                        onClick={async () => {
                          if (p.status === 'active' && !(await confirmDialog({ title: `Remove ${p.name} from ${c.name}?`, body: 'What they shared here is removed from the library. Their messages stay.', confirmLabel: 'Remove', danger: true }))) return;
                          run(() => api.removeMember(c.id, p.id), p.status === 'invited' ? 'Invitation withdrawn.' : `${p.name} was removed.`);
                        }}
                      >
                        {p.status === 'invited' ? 'Withdraw invite' : 'Remove'}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {admin && <Invite c={c} run={run} />}
        </>
      )}

      {tab === 'settings' && (
        <>
          {admin ? (
            <Settings c={c} run={run} />
          ) : (
            <div className="card">
              <h2>Settings</h2>
              <p className="muted">
                Community admins control the settings. This community shares:{' '}
                {kinds.length ? kinds.map((k) => KIND_WORDS[k].many).join(', ') : 'messages only'}.
              </p>
            </div>
          )}
          <div className="card">
            <h2>{c.role === 'creator' ? 'Delete this community' : 'Leave this community'}</h2>
            {c.role === 'creator' ? (
              <>
                <p className="muted small">Removes the community, its messages and its shared library for everyone. Nobody's own drills, plays or practices are deleted.</p>
                <button
                  className="btn danger"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: `Delete ${c.name}?`, body: 'This cannot be undone.', confirmLabel: 'Delete community', danger: true }))) return;
                    try {
                      await api.deleteCommunity(c.id);
                      navigate('/communities');
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Delete community
                </button>
              </>
            ) : (
              <>
                <p className="muted small">What you shared here is removed from its library. Copies other people already took stay with them.</p>
                <button
                  className="btn danger"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: `Leave ${c.name}?`, body: 'You can rejoin with the join code or a new invitation.', confirmLabel: 'Leave', danger: true }))) return;
                    try {
                      await api.removeMember(c.id, app.user.id);
                      navigate('/communities');
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Leave community
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Messages({ communityId }: { communityId: number }) {
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      api
        .communityPosts(communityId)
        .then(setPosts)
        .catch((e) => setError((e as Error).message)),
    [communityId],
  );
  useEffect(() => {
    load();
    // New messages from others show up without a refresh.
    const timer = window.setInterval(load, 20000);
    return () => window.clearInterval(timer);
  }, [load]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setPosts(await api.postToCommunity(communityId, body));
      setBody('');
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className="card messages">
      <form className="message-form" onSubmit={send}>
        <textarea
          className="input"
          rows={2}
          maxLength={4000}
          aria-label="Message"
          placeholder="Write to the community"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) send(e);
          }}
        />
        <button className="btn primary" disabled={!body.trim()}>
          Post
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {posts === null ? (
        <p className="muted">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="muted">No messages yet. Say hello.</p>
      ) : (
        <ul className="message-list">
          {posts.map((p) => (
            <li key={p.id} className={p.mine ? 'mine' : ''}>
              <div className="message-meta">
                <strong>{p.mine ? 'You' : p.by}</strong>
                <span className="muted small">{when(p.created_at)}</span>
                {p.can_delete && (
                  <button
                    type="button"
                    className="link small"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: 'Delete this message?', body: 'It is removed for everyone.', confirmLabel: 'Delete', danger: true }))) return;
                      api.deletePost(communityId, p.id).then(setPosts, (e) => setError((e as Error).message));
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              <p className="message-body">{p.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Library({ c, kinds, admin, onChanged }: { c: CommunityDetail; kinds: ShareKind[]; admin: boolean; onChanged: () => void }) {
  const { sport, team } = useApp();
  const navigate = useNavigate();
  const [shares, setShares] = useState<CommunityShare[] | null>(null);
  const [kind, setKind] = useState<ShareKind>(kinds[0] ?? 'drill');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  const set = (list: CommunityShare[]) => {
    setShares(list);
    onChanged();
  };
  useEffect(() => {
    api.communityShares(c.id).then(setShares, (e) => setError((e as Error).message));
  }, [c.id]);
  const act = async (fn: () => Promise<CommunityShare[]>, done = '') => {
    try {
      set(await fn());
      setError('');
      setNotice(done);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copy = async (s: CommunityShare) => {
    try {
      const made = await api.copyShare(s.id, s.kind === 'plan' ? { team_id: team?.id } : { sport_id: sport?.id });
      setError('');
      if (s.kind === 'plan') navigate(`/plans/${made.id}`);
      else if (s.kind === 'play') navigate(`/plays/${made.id}`);
      else setNotice(`"${s.title}" was added to your drill library.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (kinds.length === 0)
    return (
      <div className="card">
        <h2>Shared library</h2>
        <p className="muted">
          This community is for messages only right now. {admin ? 'Turn on sharing of drills, plays or practice plans under Settings.' : 'Its admins can turn on sharing of drills, plays or practice plans.'}
        </p>
      </div>
    );
  const ofKind = (shares || []).filter((s) => s.kind === kind);
  const waiting = ofKind.filter((s) => s.status === 'pending');
  const approved = ofKind.filter((s) => s.status === 'approved');

  return (
    <div className="card">
      <div className="card-head">
        <div className="seg" role="group" aria-label="Kind">
          {kinds.map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {KIND_WORDS[k].many[0].toUpperCase() + KIND_WORDS[k].many.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => setSharing(true)}>
          Share one of mine
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}
      {shares === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {waiting.length > 0 && (
            <>
              <h4>{admin ? 'Waiting for your approval' : 'Yours, waiting for an admin to approve'}</h4>
              <ul className="share-list">
                {waiting.map((s) => (
                  <ShareRow
                    key={s.id}
                    share={s}
                    actions={
                      <>
                        {admin && (
                          <button className="btn small primary" onClick={() => act(() => api.approveShare(s.id), `"${s.title}" is now in the library.`)}>
                            Approve
                          </button>
                        )}
                        <button className="btn small danger" onClick={() => act(() => api.unshare(s.id))}>
                          {s.mine ? 'Stop sharing' : 'Decline'}
                        </button>
                      </>
                    }
                  />
                ))}
              </ul>
              <h4>In the library</h4>
            </>
          )}
          {approved.length === 0 ? (
            <p className="muted">Nobody has shared a {KIND_WORDS[kind].one} here yet.</p>
          ) : (
            <ul className="share-list">
              {approved.map((s) => (
                <ShareRow
                  key={s.id}
                  share={s}
                  actions={
                    <>
                      {!s.mine && (
                        <button className="btn small primary" onClick={() => copy(s)}>
                          Add to mine
                        </button>
                      )}
                      {(s.mine || admin) && (
                        <button className="btn small danger" onClick={() => act(() => api.unshare(s.id))}>
                          {s.mine ? 'Stop sharing' : 'Remove'}
                        </button>
                      )}
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
      {sharing && (
        <ShareMine
          c={c}
          kind={kind}
          shared={(shares || []).filter((s) => s.mine && s.kind === kind)}
          needsApproval={c.require_approval && !admin}
          onShare={(itemId) => act(() => api.share(c.id, kind, itemId))}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}

/** Picks one of the caller's own drills, plays or practices to share here. */
function ShareMine({
  c,
  kind,
  shared,
  needsApproval,
  onShare,
  onClose,
}: {
  c: CommunityDetail;
  kind: ShareKind;
  shared: CommunityShare[];
  needsApproval: boolean;
  onShare: (itemId: number) => void;
  onClose: () => void;
}) {
  const { sport, team } = useApp();
  const [items, setItems] = useState<{ id: number; title: string; meta: string }[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const done = (list: { id: number; title: string; meta: string }[]) => setItems(list);
    const fail = (e: unknown) => setError((e as Error).message);
    if (kind === 'drill')
      api.drills().then((ds: Drill[]) => done(ds.filter((d) => d.sport_id === sport?.id).map((d) => ({ id: d.id, title: d.name, meta: `${d.duration_min} min` }))), fail);
    else if (kind === 'play')
      api.plays().then((ps: Play[]) => done(ps.filter((p) => p.sport_id === sport?.id).map((p) => ({ id: p.id, title: p.name, meta: p.category }))), fail);
    else if (team)
      api.plansFull(team.id, 'practice').then(
        (ps: Plan[]) =>
          done(
            ps
              .filter((p) => p.items.length > 0)
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((p) => ({ id: p.id, title: p.title || 'Practice', meta: `${fmtDateShort(p.date)} · ${p.items.filter((i) => i.kind === 'item').length} items` })),
          ),
        fail,
      );
    else done([]);
  }, [kind, sport?.id, team?.id]);
  const sharedIds = useMemo(() => new Set(shared.map((s) => s.item_id)), [shared]);
  const shown = (items || []).filter((i) => !q.trim() || i.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal title={`Share one of ${KIND_WORDS[kind].mine.replace('my ', 'your ')} with ${c.name}`} onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        {needsApproval ? 'An admin approves each one before others see it. ' : ''}Members can take their own copy. Your coach-only notes, player notes and uploaded files stay private.
      </p>
      <div className="picker-filters">
        <input className="input grow" autoFocus placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">Nothing to share yet.</p>
      ) : (
        <ul className="plan-list">
          {shown.map((i) => (
            <li key={i.id} className="plan-row">
              <div className="plan-main">
                <span className="plan-title">{i.title}</span>
                <span className="plan-meta">{i.meta}</span>
              </div>
              <span className="row-actions">
                {sharedIds.has(i.id) ? (
                  <span className="muted small">Shared</span>
                ) : (
                  <button className="btn small primary" onClick={() => onShare(i.id)}>
                    Share
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function Invite({ c, run }: { c: CommunityDetail; run: (fn: () => Promise<unknown>, done?: string) => Promise<boolean> }) {
  const [email, setEmail] = useState('');
  return (
    <div className="card">
      <h2>Invite people</h2>
      <p className="muted small">
        People need a Dime Coach account first. Invite them by the email they sign in with and they will see the invitation on their Communities
        page. Or send them the join code to type in there.
      </p>
      <form
        className="join-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api.inviteToCommunity(c.id, email), `Invitation sent to ${email}. They will see it on their Communities page.`)) setEmail('');
        }}
      >
        <input className="input" type="email" required aria-label="Email to invite" placeholder="coach@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn primary">Invite</button>
      </form>
      <div className="join-code">
        <span className="field-label">Join code</span>
        <code>{c.join_code}</code>
        <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(c.join_code || '')}>
          Copy
        </button>
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            if (await confirmDialog({ title: 'Make a new join code?', body: 'The old code stops working. People already in the community are not affected.', confirmLabel: 'New code' })) run(() => api.newJoinCode(c.id), 'There is a new join code. The old one no longer works.');
          }}
        >
          New code
        </button>
      </div>
    </div>
  );
}

function Settings({ c, run }: { c: CommunityDetail; run: (fn: () => Promise<unknown>, done?: string) => Promise<boolean> }) {
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  const flag = (key: 'share_drills' | 'share_plays' | 'share_plans' | 'require_approval', label: string, hint: string) => (
    <label className="check setting">
      <input type="checkbox" checked={c[key]} onChange={(e) => run(() => api.updateCommunity(c.id, { [key]: e.target.checked }))} />
      <span>
        <strong>{label}</strong>
        <span className="muted small"> {hint}</span>
      </span>
    </label>
  );
  return (
    <>
      <div className="card">
        <h2>About</h2>
        <form
          className="fields stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.updateCommunity(c.id, { name, description }), 'Saved.');
          }}
        >
          <Field label="Name">
            <input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="What it is for">
            <textarea className="input" rows={2} maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <button className="btn primary" disabled={name === c.name && description === c.description}>
            Save
          </button>
        </form>
      </div>
      <div className="card">
        <h2>What members may share</h2>
        <p className="muted small">Each is turned on separately. Turning one off hides what was shared, and turning it back on brings it back.</p>
        <div className="settings-list">
          {flag('share_drills', 'Drills', 'from members\' drill libraries')}
          {flag('share_plays', 'Plays', 'from members\' playbooks')}
          {flag('share_plans', 'Practice plans', 'whole practices, with their items')}
        </div>
      </div>
      <div className="card">
        <h2>Approval</h2>
        <div className="settings-list">
          {flag('require_approval', 'An admin approves each shared item', 'before other members can see it. Admins\' own shares go straight in.')}
        </div>
      </div>
    </>
  );
}
