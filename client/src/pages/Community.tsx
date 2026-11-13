import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type CommunityDetail, type CommunityPerson, type CommunityPower, type CommunityPost, type CommunityShare, type CommunityShareDetail, type ShareKind } from '../api';
import { useApp } from '../App';
import type { Drill, Plan, Play } from '../types';
import { fmtDateShort } from '../util';
import { Field, Modal, MoreMenu, type MenuItem } from '../components/bits';
import { KIND_WORDS, ShareRow, SharedPreview, sharesKind } from '../components/community';
import { confirmDialog, promptDialog } from '../components/dialogs';
import { PlayDiagram } from '../components/PlayDiagram';
import { EditBox, EditedMark, MentionArea, MentionText } from '../components/Mentions';

type Tab = 'messages' | 'library' | 'people' | 'settings';
const KINDS: ShareKind[] = ['drill', 'play', 'plan'];
const ROLE = { creator: 'Creator', admin: 'Admin', member: 'Member' } as const;
const KIND_LABEL: Record<ShareKind, string> = { drill: 'Drill', play: 'Play', plan: 'Practice plan' };
const KIND_TABS: Record<ShareKind, string> = { drill: 'Drills', play: 'Plays', plan: 'Practice plans' };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** The jobs a creator can give an admin, in the order they are offered. */
const POWERS: [CommunityPower, string, string][] = [
  ['moderate', 'Moderate', 'Delete anyone’s messages and replies, and take shared things down'],
  ['approve', 'Approve', 'Approve or decline what members share. Their own shares need no approval'],
  ['settings', 'Settings', 'Change the name, description, picture and what may be shared'],
  ['people', 'People', 'Invite and remove members, and see the join code'],
];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
const stamp = (at: string) => new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`).getTime();
/** "just now", "12 min ago", "3 days ago", then the date, from a time the database wrote in UTC. */
function ago(at: string) {
  const secs = Math.max(0, (Date.now() - stamp(at)) / 1000);
  if (secs < 90) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  const days = Math.round(secs / 86400);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(stamp(at)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const ICON = {
  talk: 'M4 5h16v11H10l-4 3.500V16H4z',
  library: 'M12 4 3.500 8.500 12 13l8.500-4.500zM3.500 12.500 12 17l8.500-4.500M3.500 16.500 12 21l8.500-4.500',
  people: 'M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7ZM2.500 20c.600-3.600 3.200-5.500 6.500-5.500s5.900 1.900 6.500 5.500M16 4.300a3.500 3.500 0 0 1 0 6.400M18 14.900c1.900.700 3.100 2.400 3.500 5.100',
  settings: 'M12 15.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7ZM12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  drill: 'M12 4l5 14H7zM5 20h14M9.500 12h5',
  play: 'M6 6l4 4M10 6l-4 4M17 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9 17c3 0 4.500-2 5.500-4.500',
  plan: 'M5 6h14v14H5zM5 10h14M9 4v4M15 4v4M8.500 14h3M8.500 17h6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 3M16 6h3a3 3 0 0 1-3 3M12 13v4M8.500 20h7',
};
const Svg = ({ d, size = 17 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
/** A person's initial in a circle. The color is always the same for the same name. */
function Avatar({ name, big }: { name: string; big?: boolean }) {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className={`cm-avatar ${big ? 'big' : ''}`} style={{ '--hue': n } as React.CSSProperties} aria-hidden="true">
      {(name.trim()[0] || '?').toUpperCase()}
    </span>
  );
}
const RoleBadge = ({ role }: { role: CommunityPerson['role'] }) => <span className={`cm-role ${role}`}>{ROLE[role]}</span>;

/** The picture on a shared thing: the play as drawn, the first lines of a practice, or the kind's own sign. */
function ShareArt({ share }: { share: CommunityShare }) {
  const art = share.art;
  return (
    <span className={`cm-art ${share.kind}`}>
      {art?.play ? (
        <PlayDiagram play={art.play} frame={art.play.frame} />
      ) : art?.lines?.length ? (
        <span className="cm-art-lines">
          {art.lines.map((l, i) => (
            <span key={i} className={l.kind === 'break' ? 'break' : ''}>
              <b>{l.duration_min}</b>
              {l.title || (l.kind === 'break' ? 'Break' : 'Untitled')}
            </span>
          ))}
        </span>
      ) : art?.text ? (
        <span className="cm-art-text">{art.text}</span>
      ) : (
        <span className="cm-art-sign">
          <Svg d={ICON[share.kind]} size={44} />
        </span>
      )}
      <span className="cm-art-kind">{KIND_LABEL[share.kind]}</span>
    </span>
  );
}

/** One community: a banner, then its discussion, what members share, who is in it, and its settings. */
export default function CommunityPage() {
  const { id } = useParams();
  const communityId = Number(id);
  const navigate = useNavigate();
  const app = useApp();
  const [c, setC] = useState<CommunityDetail | null>(null);
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [shares, setShares] = useState<CommunityShare[] | null>(null);
  const [tab, setTab] = useState<Tab>('messages');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState<ShareKind | 'choose' | null>(null);
  const [preview, setPreview] = useState<CommunityShare | null>(null);
  // Set while the picker was opened from a reply: what is chosen is shared and handed to that reply.
  const [attachTo, setAttachTo] = useState<{ done: (p: Picked) => void } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const fail = (e: unknown) => {
    setNotice('');
    setError((e as Error).message);
  };
  const load = useCallback(() => api.community(communityId).then(setC).catch(fail), [communityId]);
  const loadPosts = useCallback(() => api.communityPosts(communityId).then(setPosts).catch(fail), [communityId]);
  const loadShares = useCallback(() => api.communityShares(communityId).then(setShares).catch(fail), [communityId]);
  useEffect(() => {
    load();
    loadPosts();
    loadShares();
    // What other people write and share shows up without a refresh: at once when the server says so,
    // and every so often in case that was missed. Being here counts as having read it.
    const again = () => {
      loadPosts();
      loadShares();
    };
    const arrived = () => {
      again();
      load();
      api
        .markCommunitySeen(communityId)
        .then((n) => app.setCommunityUnread(n.unread))
        .catch(() => {});
    };
    const timer = window.setInterval(again, 20000);
    window.addEventListener('dime:news', arrived);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('dime:news', arrived);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, loadPosts, loadShares]);
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
      fail(e);
      return false;
    }
  };
  /** Runs something that answers with the library again. */
  const actShares = async (fn: () => Promise<CommunityShare[]>, done = '') => {
    try {
      setShares(await fn());
      setError('');
      setNotice(done);
      load();
    } catch (e) {
      fail(e);
    }
  };
  const copy = async (s: CommunityShare) => {
    try {
      const made = await api.copyShare(s.id, s.kind === 'plan' ? { team_id: app.team?.id } : { sport_id: app.sport?.id });
      setError('');
      if (s.kind === 'plan') navigate(`/plans/${made.id}`);
      else if (s.kind === 'play') navigate(`/plays/${made.id}`);
      else setNotice(`"${s.title}" was added to your drill library.`);
    } catch (e) {
      fail(e);
    }
  };

  if (!c)
    return (
      <div className="page">
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
        <Link to="/communities">Back to communities</Link>
      </div>
    );
  const may = c.can;
  const kinds = KINDS.filter((k) => sharesKind(c, k));
  const active = c.people.filter((p) => p.status === 'active');
  const approved = (shares || []).filter((s) => s.status === 'approved');
  const roleOf = (userId: number) => active.find((p) => p.id === userId)?.role;
  const startShare = () => {
    setAttachTo(null);
    setSharing(kinds.length === 1 ? kinds[0] : 'choose');
  };
  const pick = (kind: ShareKind, done: (p: Picked) => void) => {
    setAttachTo({ done });
    setSharing(kind);
  };
  /** Sends a message or a reply. Anything attached is shared with the community first, then sent along. */
  const sendPost = async (text: string, to: { parent_id?: number; share_id?: number }, attach?: Picked | null) => {
    try {
      let attachId: number | undefined;
      if (attach) {
        const list = await api.share(c.id, attach.kind, attach.item_id);
        setShares(list);
        attachId = list.find((x) => x.mine && x.kind === attach.kind && x.item_id === attach.item_id)?.id;
      }
      setPosts(await api.postToCommunity(c.id, text, { ...to, attach_share_id: attachId }));
      setError('');
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };
  /** What can be done with one shared thing, for the "..." beside it. */
  const shareMenu = (s: CommunityShare): MenuItem[] => [
    ...(s.status === 'pending' && may.approve ? [{ label: 'Approve', onSelect: () => actShares(() => api.approveShare(s.id), `"${s.title}" is now in the library.`) }] : []),
    ...(s.mine || (s.status === 'pending' ? may.approve : may.moderate) ? [{ label: s.mine ? 'Stop sharing' : s.status === 'pending' ? 'Decline' : 'Remove from the library', danger: true, onSelect: () => actShares(() => api.unshare(s.id)) }] : []),
  ];
  const tabs: [Tab, string, string, number][] = [
    ['messages', 'Discussion', ICON.talk, 0],
    ['library', 'Shared library', ICON.library, c.pending_shares],
    ['people', 'People', ICON.people, 0],
    ['settings', 'Settings', ICON.settings, 0],
  ];
  // Messages with their replies; replies made to shared things; and every one of them flat, newest first.
  const threads = posts ? posts.filter((p) => !p.share_id) : null;
  const shareReplies = new Map<number, CommunityPost[]>();
  for (const p of posts || []) if (p.share_id) shareReplies.set(p.share_id, [...(shareReplies.get(p.share_id) || []), p]);
  const everyPost = flatten(posts || []).sort((a, b) => stamp(b.created_at) - stamp(a.created_at));
  // Something sent along with a reply shows there, not as an entry of its own in the feed.
  const sentWithReply = new Set(everyPost.map((p) => p.attach_share_id).filter(Boolean));
  const rail = { c, active, posts: everyPost, approved, onPeople: () => setTab('people') };

  return (
    <div className="page cm">
      <Link to="/communities" className="back-link">
        ← Communities
      </Link>
      <header className="cm-hero">
        <span className="cm-crest" aria-hidden="true">
          {c.image ? <img src={c.image} alt="" /> : initials(c.name)}
        </span>
        <div className="cm-hero-text">
          <h1>{c.name}</h1>
          <p>{c.description || 'A place for coaches to talk and share.'}</p>
          <span className="cm-hero-meta">
            {active.length} member{active.length === 1 ? '' : 's'} · you are {c.role === 'member' ? 'a member' : c.role === 'admin' ? 'an admin' : 'the creator'}
          </span>
        </div>
        <div className="cm-hero-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTab('messages');
              window.setTimeout(() => composer.current?.focus(), 50);
            }}
          >
            <Svg d={ICON.plus} size={15} /> New post
          </button>
          {kinds.length > 0 && (
            <button type="button" className="btn primary" onClick={startShare}>
              <Svg d={ICON.library} size={15} /> Share one of mine
            </button>
          )}
        </div>
      </header>
      <div className="cm-bar">
        <div className="cm-tabs" role="tablist" aria-label="Sections">
          {tabs.map(([t, label, icon, count]) => (
            <button key={t} type="button" role="tab" className={tab === t ? 'on' : ''} aria-selected={tab === t} onClick={() => setTab(t)}>
              <Svg d={icon} />
              {label}
              {count > 0 && <span className="cm-count">{count}</span>}
            </button>
          ))}
        </div>
        {(tab === 'messages' || tab === 'library') && (
          <label className="cm-search">
            <Svg d={ICON.search} size={16} />
            <input type="search" placeholder="Search this community" aria-label="Search this community" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {tab === 'messages' && (
        <div className="cm-cols">
          <Feed
            c={c}
            q={q}
            kinds={kinds}
            posts={threads}
            shareReplies={shareReplies}
            shares={approved.filter((s) => !sentWithReply.has(s.id))}
            allShares={shares || []}
            people={active.map((p) => p.name)}
            onPick={pick}
            onSend={sendPost}
            roleOf={roleOf}
            composer={composer}
            onPosts={setPosts}
            onError={fail}
            onPreview={setPreview}
            onCopy={copy}
            shareMenu={shareMenu}
          />
          <aside className="cm-rail">
            <Overview {...rail} />
            <Members {...rail} admin={may.people} />
            <Activity {...rail} />
            <Contributors {...rail} />
          </aside>
        </div>
      )}
      {tab === 'library' && (
        <Library
          c={c}
          q={q}
          setQ={setQ}
          kinds={kinds}
          admin={may.approve}
          shares={shares}
          posts={everyPost}
          active={active}
          onShare={startShare}
          onPreview={setPreview}
          onCopy={copy}
          shareMenu={shareMenu}
          onDiscussion={() => setTab('messages')}
          onNewCode={() => run(() => api.newJoinCode(c.id), 'There is a new join code. The old one no longer works.')}
        />
      )}

      {tab === 'people' && (
        <>
          <div className="card">
            <h2>
              People <span className="muted">({active.length})</span>
            </h2>
            <ul className="cm-people">
              {c.people.map((p) => (
                <li key={p.id}>
                  <Avatar name={p.name} big />
                  <div className="cm-person">
                    <span className="cm-person-name">
                      {p.name}
                      <RoleBadge role={p.role} />
                      {p.id === app.user.id && <span className="kind">You</span>}
                      {p.status === 'invited' && <span className="kind">Invited, not joined yet</span>}
                    </span>
                    {p.email && <span className="muted small">{p.email}</span>}
                    {/* The creator hands out jobs one by one. Anyone with at least one is an admin. */}
                    {c.role === 'creator' && p.role !== 'creator' && p.status === 'active' && (
                      <span className="cm-powers" role="group" aria-label={`What ${p.name} may do`}>
                        {POWERS.map(([key, label, hint]) => (
                          <button
                            key={key}
                            type="button"
                            className={`chip toggle perm-chip ${p.perms[key] ? 'on' : ''}`}
                            aria-pressed={p.perms[key]}
                            title={hint}
                            onClick={() => run(() => api.setMemberPowers(c.id, p.id, { [key]: !p.perms[key] }))}
                          >
                            <span aria-hidden="true">{p.perms[key] ? '✓' : '–'}</span>
                            {label}
                          </button>
                        ))}
                      </span>
                    )}
                    {c.role !== 'creator' && p.role === 'admin' && (
                      <span className="muted small">
                        Can:{' '}
                        {POWERS.filter(([key]) => p.perms[key])
                          .map(([, label]) => label.toLowerCase())
                          .join(', ')}
                      </span>
                    )}
                  </div>
                  <span className="row-actions">
                    {may.people && p.id !== app.user.id && p.role !== 'creator' && (p.role !== 'admin' || c.role === 'creator') && (
                      <button
                        className="btn small danger"
                        onClick={async () => {
                          if (p.status === 'active' && !(await confirmDialog({ title: `Remove ${p.name} from ${c.name}?`, body: 'What they shared here is removed from the library. Their messages stay.', confirmLabel: 'Remove', danger: true }))) return;
                          run(() => api.removeMember(c.id, p.id), p.status === 'invited' ? 'Invitation withdrawn.' : `${p.name} was removed.`).then(loadShares);
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
          {c.role === 'creator' && (
            <div className="card cm-power-key">
              <h2>What admins can do</h2>
              <p className="muted small">Turn on any of these for a person above and they become an admin with just those jobs. Only you can delete the community or change who is an admin.</p>
              <dl>
                {POWERS.map(([key, label, hint]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{hint}.</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {may.people && <Invite c={c} run={run} />}
        </>
      )}

      {tab === 'settings' && (
        <>
          {may.settings ? (
            <Settings c={c} run={run} />
          ) : (
            <div className="card">
              <h2>Settings</h2>
              <p className="muted">
                Community admins control the settings. This community shares: {kinds.length ? kinds.map((k) => KIND_WORDS[k].many).join(', ') : 'messages only'}.
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
                    const others = active.length - 1;
                    if (
                      !(await confirmDialog({
                        title: `Delete ${c.name}?`,
                        body: `Its messages and shared library are removed for ${others > 0 ? `you and the ${others === 1 ? 'other member' : `${others} other members`}` : 'good'}. This cannot be undone.`,
                        confirmLabel: 'Continue',
                        danger: true,
                      }))
                    )
                      return;
                    // The last step is typed, so it cannot be clicked through.
                    const typed = await promptDialog({ title: 'Type the name of the community to delete it', body: `To delete it for good, type: ${c.name}`, confirmLabel: 'Delete community' });
                    if (typed === null) return;
                    if (typed.trim().toLowerCase() !== c.name.trim().toLowerCase()) return fail(new Error('That did not match the name of the community, so nothing was deleted.'));
                    try {
                      await api.deleteCommunity(c.id, typed);
                      navigate('/communities');
                    } catch (e) {
                      fail(e);
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
                      fail(e);
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

      {sharing === 'choose' && (
        <Modal title={`Share with ${c.name}`} onClose={() => setSharing(null)}>
          <p className="muted small">What would you like to share?</p>
          <div className="cm-choose">
            {kinds.map((k) => (
              <button key={k} type="button" onClick={() => setSharing(k)}>
                <Svg d={ICON[k]} size={26} />
                {cap(KIND_WORDS[k].one)}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {sharing && sharing !== 'choose' && (
        <ShareMine
          c={c}
          kind={sharing}
          attaching={!!attachTo}
          shared={attachTo ? [] : (shares || []).filter((s) => s.mine && s.kind === sharing)}
          needsApproval={c.require_approval && !may.approve}
          onShare={(itemId, title) => {
            if (!attachTo) return actShares(() => api.share(c.id, sharing, itemId));
            // Chosen for a message being written: it is only handed over. Sharing happens when the message is sent.
            attachTo.done({ kind: sharing, item_id: itemId, title });
            setAttachTo(null);
            setSharing(null);
          }}
          onClose={() => {
            setAttachTo(null);
            setSharing(null);
          }}
        />
      )}
      {preview && <PreviewModal share={preview} onClose={() => setPreview(null)} onCopy={preview.mine ? undefined : () => copy(preview)} />}
    </div>
  );
}

/** A shared thing opened up to read, with a button to take a copy. */
function PreviewModal({ share, onClose, onCopy }: { share: CommunityShare; onClose: () => void; onCopy?: () => void }) {
  const [detail, setDetail] = useState<CommunityShareDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.communityShare(share.id).then(setDetail, (e) => setError((e as Error).message));
  }, [share.id]);
  return (
    <Modal title={share.title} onClose={onClose} wide>
      <p className="muted small">
        {KIND_LABEL[share.kind]} · {share.summary} · shared by {share.mine ? 'you' : share.by}
      </p>
      {error ? <p className="error">{error}</p> : detail ? <SharedPreview detail={detail} /> : <p className="muted">Loading…</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
        {onCopy && (
          <button className="btn primary" onClick={onCopy}>
            Add to mine
          </button>
        )}
      </div>
    </Modal>
  );
}

type FeedEntry = { key: string; at: string; post?: CommunityPost; share?: CommunityShare };
type FeedFilter = 'all' | 'posts' | 'shares';

/** The discussion: a box to write in, then messages and newly shared things together, newest first. */
function Feed({
  c,
  q,
  kinds,
  posts,
  shareReplies,
  shares,
  allShares,
  people,
  onPick,
  onSend,
  roleOf,
  composer,
  onPosts,
  onError,
  onPreview,
  onCopy,
  shareMenu,
}: {
  c: CommunityDetail;
  q: string;
  kinds: ShareKind[];
  posts: CommunityPost[] | null;
  shareReplies: Map<number, CommunityPost[]>;
  shares: CommunityShare[];
  allShares: CommunityShare[];
  people: string[];
  onPick: (kind: ShareKind, done: (p: Picked) => void) => void;
  onSend: (text: string, to: { parent_id?: number; share_id?: number }, attach?: Picked | null) => Promise<boolean>;
  roleOf: (userId: number) => CommunityPerson['role'] | undefined;
  composer: React.RefObject<HTMLTextAreaElement | null>;
  onPosts: (p: CommunityPost[]) => void;
  onError: (e: unknown) => void;
  onPreview: (s: CommunityShare) => void;
  onCopy: (s: CommunityShare) => void;
  shareMenu: (s: CommunityShare) => MenuItem[];
}) {
  const { user } = useApp();
  const [body, setBody] = useState('');
  const [filter, setFilter] = useState<FeedFilter>('all');
  // A drill, play or practice chosen to go with the post. It is shared when the post is sent, not before.
  const [attached, setAttached] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  // The message of the reader's own that is open to be changed, if any.
  const [editing, setEditing] = useState<number | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if ((!body.trim() && !attached) || busy) return;
    setBusy(true);
    if (await onSend(body.trim(), {}, attached)) {
      setBody('');
      setAttached(null);
    }
    setBusy(false);
  };
  const words = q.trim().toLowerCase();
  const entries = useMemo(() => {
    const all: FeedEntry[] = [
      ...(posts || []).map((p) => ({ key: `p${p.id}`, at: p.created_at, post: p })),
      ...shares.map((s) => ({ key: `s${s.id}`, at: s.shared_at, share: s })),
    ];
    return all
      .filter((e) => filter === 'all' || (filter === 'posts' ? !!e.post : !!e.share))
      .filter((e) => {
        if (!words) return true;
        const replies = e.post ? e.post.replies || [] : shareReplies.get(e.share!.id) || [];
        const own = e.post ? `${e.post.body} ${e.post.by}` : `${e.share!.title} ${e.share!.by} ${e.share!.tags.map((t) => t.name).join(' ')}`;
        return `${own} ${flatten(replies).map((r) => `${r.body} ${r.by}`).join(' ')}`.toLowerCase().includes(words);
      })
      .sort((a, b) => stamp(b.at) - stamp(a.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, shares, filter, words]);
  const ctx: ThreadCtx = {
    kinds,
    people,
    shares: allShares,
    roleOf,
    pick: onPick,
    onPreview,
    onCopy,
    send: onSend,
    edit: async (r, text) => {
      try {
        onPosts(await api.editPost(c.id, r.id, text));
        return true;
      } catch (err) {
        onError(err);
        return false;
      }
    },
    del: async (r) => {
      const n = countReplies(r.replies || []);
      if (!(await confirmDialog({ title: 'Delete this reply?', body: n ? `It is removed for everyone, along with the ${n === 1 ? 'reply' : `${n} replies`} to it.` : 'It is removed for everyone.', confirmLabel: 'Delete', danger: true }))) return;
      api.deletePost(c.id, r.id).then(onPosts, onError);
    },
  };
  const chips: [FeedFilter, string][] = [
    ['all', 'All posts'],
    ['posts', 'Messages'],
    ['shares', 'Shared drills, plays and plans'],
  ];

  return (
    <div className="cm-feed">
      <form className="card cm-compose" onSubmit={send}>
        <div className="cm-compose-row">
          <Avatar name={user.name} big />
          <MentionArea
            inputRef={composer}
            people={people.filter((n) => n !== user.name)}
            className="input"
            rows={body.includes('\n') || body.length > 90 ? 3 : 1}
            maxLength={4000}
            aria-label="Message"
            placeholder="Ask a question, start a discussion, or share an idea. Type @ to mention someone."
            value={body}
            onChange={setBody}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e);
            }}
          />
        </div>
        {attached && (
          <div className="cm-attached cm-compose-attached">
            <Svg d={ICON[attached.kind]} size={15} />
            <span>
              <strong>{attached.title}</strong> <span className="muted small">{KIND_WORDS[attached.kind].one} · shared with the community when you post</span>
            </span>
            <button type="button" className="link small" onClick={() => setAttached(null)}>
              Take off
            </button>
          </div>
        )}
        <div className="cm-compose-actions">
          {!attached &&
            kinds.map((k) => (
              <button key={k} type="button" className="cm-pill" onClick={() => onPick(k, setAttached)}>
                <Svg d={ICON[k]} size={15} /> Attach a {KIND_WORDS[k].one}
              </button>
            ))}
          <button className="btn primary" disabled={(!body.trim() && !attached) || busy}>
            Post
          </button>
        </div>
      </form>

      <div className="cm-chips" role="group" aria-label="Show">
        {chips.map(([f, label]) => (
          <button key={f} type="button" className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>

      {posts === null ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="card cm-none">{words ? 'Nothing matches that search.' : filter === 'shares' ? 'Nothing has been shared here yet.' : 'No messages yet. Say hello.'}</div>
      ) : (
        <ul className="cm-posts">
          {entries.map((e) => {
            const by = e.post ? e.post.by : e.share!.by;
            const byId = e.post ? e.post.by_id : e.share!.by_id;
            const role = roleOf(byId);
            const menu: MenuItem[] = e.post
              ? [
                  ...(e.post.mine ? [{ label: 'Edit this message', onSelect: () => setEditing(e.post!.id) }] : []),
                  ...(e.post.can_delete
                ? [
                    {
                      label: 'Delete this message',
                      danger: true,
                      onSelect: async () => {
                        const n = countReplies(e.post!.replies || []);
                        if (!(await confirmDialog({ title: 'Delete this message?', body: n ? `It is removed for everyone, along with the ${n === 1 ? 'reply' : `${n} replies`} to it.` : 'It is removed for everyone.', confirmLabel: 'Delete', danger: true }))) return;
                        api.deletePost(c.id, e.post!.id).then(onPosts, onError);
                      },
                    },
                  ]
                : []),
                ]
              : shareMenu(e.share!);
            return (
              <li key={e.key} className="card cm-post">
                <Avatar name={by} big />
                <div className="cm-post-main">
                  <div className="cm-post-head">
                    <strong>{by}</strong>
                    {role && <RoleBadge role={role} />}
                    <span className="muted small">
                      {ago(e.at)}
                      {e.share && ` · shared a ${KIND_WORDS[e.share.kind].one}`}
                      <EditedMark at={e.post?.edited_at} />
                    </span>
                    <span className="cm-post-menu">
                      <MoreMenu items={menu} />
                    </span>
                  </div>
                  {e.post && editing === e.post.id ? (
                    <EditBox
                      initial={e.post.body}
                      people={people.filter((n) => n !== user.name)}
                      canBeEmpty={!!e.post.attach_share_id}
                      onCancel={() => setEditing(null)}
                      onSave={async (text) => {
                        const ok = await ctx.edit(e.post!, text);
                        if (ok) setEditing(null);
                        return ok;
                      }}
                    />
                  ) : (
                    e.post?.body && (
                      <p className="message-body">
                        <MentionText text={e.post.body} people={people} me={user.name} />
                      </p>
                    )
                  )}
                  {e.post?.attach_share_id &&
                    (allShares.some((s) => s.id === e.post!.attach_share_id) ? (
                      <Embed share={allShares.find((s) => s.id === e.post!.attach_share_id)!} onPreview={onPreview} onCopy={onCopy} />
                    ) : (
                      <p className="muted small cm-gone">Something was shared with this post. It is waiting for an admin to approve it, or is no longer shared.</p>
                    ))}
                  {e.share && (
                    <div className="cm-embed">
                      <button type="button" className="cm-embed-main" onClick={() => onPreview(e.share!)}>
                        <ShareArt share={e.share} />
                        <span className="cm-embed-text">
                          <strong>{e.share.title}</strong>
                          <span className="muted small">{[e.share.summary, ...e.share.tags.map((t) => t.name)].filter(Boolean).join(' · ')}</span>
                        </span>
                      </button>
                      <span className="row-actions">
                        <button type="button" className="btn small" onClick={() => onPreview(e.share!)}>
                          View
                        </button>
                        {!e.share.mine && (
                          <button type="button" className="btn small primary" onClick={() => onCopy(e.share!)}>
                            Add to mine
                          </button>
                        )}
                      </span>
                    </div>
                  )}
                  <Thread replies={e.post ? e.post.replies || [] : shareReplies.get(e.share!.id) || []} to={e.post ? { parent_id: e.post.id } : { share_id: e.share!.id }} ctx={ctx} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** How many replies show before the rest are folded away. */
const REPLIES_SHOWN = 3;
/** Replies set in under what they answer, up to this many steps. Deeper ones line up with the last step. */
const MAX_INDENT = 3;
const countReplies = (list: CommunityPost[]): number => list.reduce((n, r) => n + 1 + countReplies(r.replies || []), 0);
const flatten = (list: CommunityPost[]): CommunityPost[] => list.flatMap((r) => [r, ...flatten(r.replies || [])]);

/** One of the writer's own drills, plays or practices, chosen to go with a message. It is shared when the message is sent. */
interface Picked {
  kind: ShareKind;
  item_id: number;
  title: string;
}
/** What a thread needs from the page around it. */
interface ThreadCtx {
  kinds: ShareKind[];
  /** The names of everyone in the community, for "@" mentions. */
  people: string[];
  /** Everything shared here that the reader may see, to draw what a reply has attached. */
  shares: CommunityShare[];
  roleOf: (userId: number) => CommunityPerson['role'] | undefined;
  /** Opens the list of the writer's own drills, plays or practices, and hands back the one they choose. */
  pick: (kind: ShareKind, done: (p: Picked) => void) => void;
  send: (text: string, to: { parent_id?: number; share_id?: number }, attach?: Picked | null) => Promise<boolean>;
  /** Saves new words for one of the reader's own messages. */
  edit: (r: CommunityPost, text: string) => Promise<boolean>;
  del: (r: CommunityPost) => void;
  onPreview: (s: CommunityShare) => void;
  onCopy: (s: CommunityShare) => void;
}

/** A shared drill, play or practice shown inside a message. */
function Embed({ share, onPreview, onCopy }: { share: CommunityShare; onPreview: (s: CommunityShare) => void; onCopy: (s: CommunityShare) => void }) {
  return (
    <div className="cm-embed">
      <button type="button" className="cm-embed-main" onClick={() => onPreview(share)}>
        <ShareArt share={share} />
        <span className="cm-embed-text">
          <strong>{share.title}</strong>
          <span className="muted small">
            {[cap(KIND_WORDS[share.kind].one), share.summary, ...share.tags.map((t) => t.name), share.status === 'pending' ? 'waiting for approval' : ''].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
      <span className="row-actions">
        <button type="button" className="btn small" onClick={() => onPreview(share)}>
          View
        </button>
        {!share.mine && (
          <button type="button" className="btn small primary" onClick={() => onCopy(share)}>
            Add to mine
          </button>
        )}
      </span>
    </div>
  );
}

/** The box for writing a reply, with the same "share a drill, play or practice" choices as a new post. */
function ReplyBox({ ctx, to, onDone }: { ctx: ThreadCtx; to: { parent_id?: number; share_id?: number }; onDone: (sent: boolean) => void }) {
  const { user } = useApp();
  const [text, setText] = useState('');
  const [attached, setAttached] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = !!text.trim() || !!attached;
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const ok = await ctx.send(text.trim(), to, attached);
    setBusy(false);
    if (ok) onDone(true);
  };
  return (
    <div className="cm-reply-box">
      <Avatar name={user.name} />
      <div className="cm-reply-write">
        <MentionArea
          people={ctx.people.filter((n) => n !== user.name)}
          className="input"
          rows={2}
          maxLength={4000}
          autoFocus
          aria-label="Your reply"
          placeholder="Write a reply…"
          value={text}
          onChange={setText}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
            if (e.key === 'Escape') onDone(false);
          }}
        />
        {attached && (
          <div className="cm-attached">
            <Svg d={ICON[attached.kind]} size={15} />
            <span>
              <strong>{attached.title}</strong> <span className="muted small">{KIND_WORDS[attached.kind].one} · shared when you send this reply</span>
            </span>
            <button type="button" className="link small" onClick={() => setAttached(null)}>
              Take off
            </button>
          </div>
        )}
        <div className="cm-reply-actions">
          {!attached &&
            ctx.kinds.map((k) => (
              <button key={k} type="button" className="cm-pill" onClick={() => ctx.pick(k, setAttached)}>
                <Svg d={ICON[k]} size={14} /> Attach a {KIND_WORDS[k].one}
              </button>
            ))}
          <span className="cm-reply-send">
            <button type="button" className="btn small" onClick={() => onDone(false)}>
              Cancel
            </button>
            <button type="button" className="btn small primary" disabled={!ready || busy} onClick={send}>
              Reply
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** One reply, the replies to it, and the box for answering it. */
function ReplyNode({ r, depth, ctx }: { r: CommunityPost; depth: number; ctx: ThreadCtx }) {
  const me = useApp().user.name;
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState(false);
  const role = ctx.roleOf(r.by_id);
  const kids = r.replies || [];
  const share = r.attach_share_id ? ctx.shares.find((s) => s.id === r.attach_share_id) : undefined;
  return (
    <li className="cm-reply">
      <Avatar name={r.by} />
      <div className="cm-reply-main">
        <div className="cm-post-head">
          <strong>{r.by}</strong>
          {role && <RoleBadge role={role} />}
          <span className="muted small">
            {ago(r.created_at)}
            <EditedMark at={r.edited_at} />
          </span>
        </div>
        {editing ? (
          <EditBox
            initial={r.body}
            people={ctx.people.filter((n) => n !== me)}
            canBeEmpty={!!r.attach_share_id}
            onCancel={() => setEditing(false)}
            onSave={async (text) => {
              const ok = await ctx.edit(r, text);
              if (ok) setEditing(false);
              return ok;
            }}
          />
        ) : (
          r.body && (
            <p className="message-body">
              <MentionText text={r.body} people={ctx.people} me={me} />
            </p>
          )
        )}
        {share ? (
          <Embed share={share} onPreview={ctx.onPreview} onCopy={ctx.onCopy} />
        ) : (
          r.attach_share_id && <p className="muted small cm-gone">Something was shared with this reply. It is waiting for an admin to approve it, or is no longer shared.</p>
        )}
        <div className="cm-thread-bar">
          <button type="button" className="cm-reply-btn" onClick={() => setWriting(!writing)} aria-expanded={writing}>
            <Svg d={ICON.talk} size={14} /> Reply
          </button>
          {r.mine && !editing && (
            <button type="button" className="link small cm-reply-del" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {r.can_delete && (
            <button type="button" className="link small cm-reply-del" onClick={() => ctx.del(r)}>
              Delete
            </button>
          )}
        </div>
        {writing && <ReplyBox ctx={ctx} to={{ parent_id: r.id }} onDone={() => setWriting(false)} />}
        {kids.length > 0 && (
          <ul className={`cm-replies ${depth >= MAX_INDENT ? 'level' : ''}`}>
            {kids.map((k) => (
              <ReplyNode key={k.id} r={k} depth={depth + 1} ctx={ctx} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** The replies under a message or a shared thing, and the box for writing one. */
function Thread({ replies, to, ctx }: { replies: CommunityPost[]; to: { parent_id?: number; share_id?: number }; ctx: ThreadCtx }) {
  const [writing, setWriting] = useState(false);
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, replies.length - REPLIES_SHOWN);
  const total = countReplies(replies);
  return (
    <div className="cm-thread">
      <div className="cm-thread-bar">
        <button type="button" className="cm-reply-btn" onClick={() => setWriting(!writing)} aria-expanded={writing}>
          <Svg d={ICON.talk} size={15} /> Reply
        </button>
        {total > 0 && (
          <span className="muted small cm-thread-count">
            {total} repl{total === 1 ? 'y' : 'ies'}
          </span>
        )}
      </div>
      {writing && (
        <ReplyBox
          ctx={ctx}
          to={to}
          onDone={(sent) => {
            setWriting(false);
            if (sent) setAll(true);
          }}
        />
      )}
      {replies.length > 0 && (
        <ul className="cm-replies">
          {hidden > 0 && (
            <li>
              <button type="button" className="link small cm-earlier" onClick={() => setAll(true)}>
                Show {hidden} earlier repl{hidden === 1 ? 'y' : 'ies'}
              </button>
            </li>
          )}
          {replies.slice(hidden).map((r) => (
            <ReplyNode key={r.id} r={r} depth={1} ctx={ctx} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface RailProps {
  c: CommunityDetail;
  active: CommunityPerson[];
  posts: CommunityPost[];
  approved: CommunityShare[];
  onPeople: () => void;
}
const RailCard = ({ icon, title, action, children }: { icon: string; title: ReactNode; action?: ReactNode; children: ReactNode }) => (
  <section className="card cm-side">
    <div className="cm-side-head">
      <Svg d={icon} />
      <h2>{title}</h2>
      {action}
    </div>
    {children}
  </section>
);
function Overview({ c, active, posts, approved }: RailProps) {
  const tiles: [string, number, string][] = [
    [ICON.talk, posts.length, 'Messages'],
    [ICON.play, approved.filter((s) => s.kind !== 'plan').length, 'Drills & plays'],
    [ICON.plan, approved.filter((s) => s.kind === 'plan').length, 'Practice plans'],
  ];
  return (
    <RailCard icon={ICON.people} title="Community overview">
      <p className="muted small">
        <strong>{active.length}</strong> member{active.length === 1 ? '' : 's'} · started by {c.created_by_name || 'a coach'}
      </p>
      <div className="cm-tiles">
        {tiles.map(([icon, n, label]) => (
          <span key={label}>
            <Svg d={icon} size={20} />
            <b>{n}</b>
            <small>{label}</small>
          </span>
        ))}
      </div>
    </RailCard>
  );
}
function Members({ active, onPeople, admin }: RailProps & { admin: boolean }) {
  return (
    <RailCard
      icon={ICON.people}
      title={
        <>
          Members <span className="muted">({active.length})</span>
        </>
      }
      action={
        <button type="button" className="link small" onClick={onPeople}>
          {admin ? 'Manage' : 'See all'}
        </button>
      }
    >
      <ul className="cm-members">
        {active.slice(0, 8).map((p) => (
          <li key={p.id}>
            <Avatar name={p.name} />
            <span>{p.name}</span>
            <RoleBadge role={p.role} />
          </li>
        ))}
      </ul>
      {active.length > 8 && <p className="muted small">and {active.length - 8} more</p>}
    </RailCard>
  );
}
function Activity({ posts, approved }: RailProps) {
  const rows = [
    ...posts.map((p) => ({ key: `p${p.id}`, at: p.created_at, icon: ICON.talk, by: p.by, text: `wrote: ${p.body.length > 60 ? `${p.body.slice(0, 60)}…` : p.body}` })),
    ...approved.map((s) => ({ key: `s${s.id}`, at: s.shared_at, icon: ICON[s.kind], by: s.by, text: `shared a ${KIND_WORDS[s.kind].one}: ${s.title}` })),
  ]
    .sort((a, b) => stamp(b.at) - stamp(a.at))
    .slice(0, 5);
  return (
    <RailCard icon={ICON.activity} title="Recent activity">
      {rows.length === 0 ? (
        <p className="muted small">Nothing yet.</p>
      ) : (
        <ul className="cm-activity">
          {rows.map((r) => (
            <li key={r.key}>
              <Svg d={r.icon} size={15} />
              <span>
                <strong>{r.by}</strong> {r.text}
              </span>
              <small>{ago(r.at)}</small>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}
function Contributors({ active, posts, approved }: RailProps) {
  const counts = new Map<number, number>();
  for (const p of posts) counts.set(p.by_id, (counts.get(p.by_id) || 0) + 1);
  for (const s of approved) counts.set(s.by_id, (counts.get(s.by_id) || 0) + 1);
  const rows = active
    .map((p) => ({ p, n: counts.get(p.id) || 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  const most = rows[0]?.n || 1;
  return (
    <RailCard icon={ICON.trophy} title="Top contributors">
      {rows.length === 0 ? (
        <p className="muted small">Messages and shared items count here.</p>
      ) : (
        <ul className="cm-top">
          {rows.map(({ p, n }) => (
            <li key={p.id}>
              <Avatar name={p.name} />
              <span className="cm-top-main">
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {n} contribution{n === 1 ? '' : 's'}
                  </small>
                </span>
                <span className="cm-top-bar">
                  <span style={{ width: `${(n / most) * 100}%` }} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

type Sort = 'new' | 'name';
const VIEW_KEY = 'practiceplan.communityView';

/** What members have shared: kinds along the top, filters down the side, and each thing as a card. */
function Library({
  c,
  q,
  setQ,
  kinds,
  admin,
  shares,
  posts,
  active,
  onShare,
  onPreview,
  onCopy,
  shareMenu,
  onDiscussion,
  onNewCode,
}: {
  c: CommunityDetail;
  q: string;
  setQ: (q: string) => void;
  kinds: ShareKind[];
  admin: boolean;
  shares: CommunityShare[] | null;
  posts: CommunityPost[];
  active: CommunityPerson[];
  onShare: () => void;
  onPreview: (s: CommunityShare) => void;
  onCopy: (s: CommunityShare) => void;
  shareMenu: (s: CommunityShare) => MenuItem[];
  onDiscussion: () => void;
  onNewCode: () => void;
}) {
  const [kind, setKind] = useState<'all' | ShareKind>('all');
  const [tags, setTags] = useState<string[]>([]);
  const [mineOnly, setMineOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('new');
  const [view, setViewState] = useState<'grid' | 'list'>(() => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'));
  const [copied, setCopied] = useState(false);
  const setView = (v: 'grid' | 'list') => {
    localStorage.setItem(VIEW_KEY, v);
    setViewState(v);
  };

  if (kinds.length === 0)
    return (
      <div className="card">
        <h2>Shared library</h2>
        <p className="muted">
          This community is for messages only right now. {c.can.settings ? 'Turn on sharing of drills, plays or practice plans under Settings.' : 'Its admins can turn on sharing of drills, plays or practice plans.'}
        </p>
      </div>
    );
  const all = shares || [];
  const waiting = all.filter((s) => s.status === 'pending');
  const approved = all.filter((s) => s.status === 'approved');
  const count = (k: ShareKind) => approved.filter((s) => s.kind === k).length;
  const ofKind = approved.filter((s) => kind === 'all' || s.kind === kind);
  // Categories on what is being looked at, most used first.
  const tagCounts = new Map<string, number>();
  for (const s of ofKind) for (const t of s.tags) tagCounts.set(t.name, (tagCounts.get(t.name) || 0) + 1);
  const tagList = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const words = q.trim().toLowerCase();
  const shown = ofKind
    .filter((s) => tags.length === 0 || s.tags.some((t) => tags.includes(t.name)))
    .filter((s) => !mineOnly || s.mine)
    .filter((s) => !words || `${s.title} ${s.by} ${s.summary} ${s.tags.map((t) => t.name).join(' ')}`.toLowerCase().includes(words))
    .sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title) : stamp(b.shared_at) - stamp(a.shared_at)));
  const filtered = tags.length > 0 || mineOnly || kind !== 'all' || !!words;
  const clear = () => {
    setTags([]);
    setMineOnly(false);
    setKind('all');
    setQ('');
  };
  const flipTag = (name: string) => setTags((t) => (t.includes(name) ? t.filter((x) => x !== name) : [...t, name]));
  const actions = (s: CommunityShare, withPreview = true) => (
    <>
      {withPreview && (
        <button type="button" className="btn small" onClick={() => onPreview(s)}>
          Preview
        </button>
      )}
      {!s.mine && s.status === 'approved' && (
        <button type="button" className="btn small primary" onClick={() => onCopy(s)}>
          Add to mine
        </button>
      )}
      <MoreMenu items={shareMenu(s)} />
    </>
  );
  const card = (s: CommunityShare) => (
    <li key={s.id} className="cm-card">
      <button type="button" className="cm-card-art" onClick={() => onPreview(s)} aria-label={`Preview ${s.title}`}>
        <ShareArt share={s} />
      </button>
      <div className="cm-card-body">
        <h3>
          {s.title}
          {s.status === 'pending' && <span className="kind">Waiting for approval</span>}
        </h3>
        <p className="muted small">{s.summary}</p>
        <div className="cm-card-by">
          <Avatar name={s.by} />
          <span>{s.mine ? 'You' : s.by}</span>
          <small>{ago(s.shared_at)}</small>
        </div>
        {s.tags.length > 0 && (
          <span className="chips">
            {s.tags.slice(0, 3).map((t) => (
              <span key={t.name} className="chip">
                <span className="dot" style={{ background: t.color }} />
                {t.name}
              </span>
            ))}
            {s.tags.length > 3 && <span className="chip">+{s.tags.length - 3}</span>}
          </span>
        )}
        <div className="cm-card-actions">{actions(s)}</div>
      </div>
    </li>
  );
  const kindTabs: ['all' | ShareKind, string, string, number][] = [['all', 'Everything', ICON.grid, approved.length], ...kinds.map((k) => [k, KIND_TABS[k], ICON[k], count(k)] as ['all' | ShareKind, string, string, number])];

  return (
    <div className="cm-lib">
      <div className="cm-lib-head">
        <span className="cm-lib-icon">
          <Svg d={ICON.library} size={26} />
        </span>
        <div className="cm-lib-title">
          <h2>Shared library</h2>
          <p className="muted">
            {cap(kinds.map((k) => KIND_WORDS[k].many).join(', ').replace(/, ([^,]*)$/, ' and $1'))} shared by the coaches in {c.name}.
          </p>
        </div>
        {c.join_code && (
          <span className="cm-code" title="Send this code to a coach. They type it on their Communities page to join.">
            <small>Join code</small>
            <code>{c.join_code}</code>
            <button
              type="button"
              className="link small"
              onClick={() => {
                navigator.clipboard?.writeText(c.join_code || '');
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="link small"
              onClick={async () => {
                if (await confirmDialog({ title: 'Make a new join code?', body: 'The old code stops working. People already in the community are not affected.', confirmLabel: 'New code' })) onNewCode();
              }}
            >
              New
            </button>
          </span>
        )}
        <button type="button" className="btn primary" onClick={onShare}>
          <Svg d={ICON.plus} size={15} /> Share one of mine
        </button>
      </div>

      <div className="cm-kinds" role="group" aria-label="Kind">
        {kindTabs.map(([k, label, icon, n]) => (
          <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
            <Svg d={icon} />
            {label}
            <span className="cm-count">{n}</span>
          </button>
        ))}
      </div>

      <div className="cm-lib-cols">
        <aside className="card cm-filters" aria-label="Filters">
          <div className="cm-side-head">
            <h2>Filters</h2>
            {filtered && (
              <button type="button" className="link small" onClick={clear}>
                Clear all
              </button>
            )}
          </div>
          <h3>Kind</h3>
          {kinds.map((k) => (
            <label key={k} className="cm-check">
              <input type="checkbox" checked={kind === k} onChange={() => setKind(kind === k ? 'all' : k)} />
              <span>{KIND_TABS[k]}</span>
              <small>{count(k)}</small>
            </label>
          ))}
          {tagList.length > 0 && (
            <>
              <h3>Category</h3>
              {tagList.slice(0, 12).map(([name, n]) => (
                <label key={name} className="cm-check">
                  <input type="checkbox" checked={tags.includes(name)} onChange={() => flipTag(name)} />
                  <span>{name}</span>
                  <small>{n}</small>
                </label>
              ))}
            </>
          )}
          <h3>Shared by</h3>
          <label className="cm-check">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            <span>Only mine</span>
            <small>{ofKind.filter((s) => s.mine).length}</small>
          </label>
        </aside>

        <div className="cm-lib-main">
          <div className="cm-lib-tools">
            <label className="cm-search grow">
              <Svg d={ICON.search} size={16} />
              <input type="search" placeholder="Search the library" aria-label="Search the library" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <select className="input" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="new">Newest first</option>
              <option value="name">A to Z</option>
            </select>
            <div className="seg" role="group" aria-label="Layout">
              <button type="button" className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} aria-label="Cards" title="Cards" onClick={() => setView('grid')}>
                <Svg d={ICON.grid} size={16} />
              </button>
              <button type="button" className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} aria-label="List" title="List" onClick={() => setView('list')}>
                <Svg d={ICON.list} size={16} />
              </button>
            </div>
          </div>

          {shares === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              {waiting.length > 0 && (
                <section className="cm-waiting">
                  <h3>{admin ? 'Waiting for your approval' : 'Yours, waiting for an admin to approve'}</h3>
                  <ul className="cm-grid">{waiting.map(card)}</ul>
                </section>
              )}
              {shown.length === 0 ? (
                <div className="card cm-none">{approved.length === 0 ? 'Nobody has shared anything here yet. Be the first.' : 'Nothing matches those filters.'}</div>
              ) : view === 'grid' ? (
                <ul className="cm-grid">{shown.map(card)}</ul>
              ) : (
                <div className="card">
                  <ul className="share-list">
                    {shown.map((s) => (
                      <ShareRow key={s.id} share={s} actions={actions(s, false)} />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="cm-rail">
          <RailCard
            icon={ICON.talk}
            title="Recent discussion"
            action={
              <button type="button" className="link small" onClick={onDiscussion}>
                View all
              </button>
            }
          >
            {posts.length === 0 ? (
              <p className="muted small">No messages yet.</p>
            ) : (
              <ul className="cm-quotes">
                {posts.slice(0, 3).map((p) => (
                  <li key={p.id}>
                    <Avatar name={p.by} />
                    <span>
                      <strong>{p.by}</strong> <small>{ago(p.created_at)}</small>
                      <q>{p.body.length > 110 ? `${p.body.slice(0, 110)}…` : p.body}</q>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </RailCard>
          <RailCard
            icon={ICON.people}
            title={
              <>
                People <span className="muted">({active.length})</span>
              </>
            }
          >
            <ul className="cm-members">
              {active.slice(0, 8).map((p) => (
                <li key={p.id}>
                  <Avatar name={p.name} />
                  <span>{p.name}</span>
                  <RoleBadge role={p.role} />
                </li>
              ))}
            </ul>
          </RailCard>
        </aside>
      </div>
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
  attaching,
}: {
  c: CommunityDetail;
  kind: ShareKind;
  shared: CommunityShare[];
  needsApproval: boolean;
  onShare: (itemId: number, title: string) => void;
  /** Choosing for a message being written, not sharing straight away. */
  attaching?: boolean;
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
    <Modal title={attaching ? `Attach a ${KIND_WORDS[kind].one}` : `Share one of ${KIND_WORDS[kind].mine.replace('my ', 'your ')} with ${c.name}`} onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        {attaching ? `It goes with your message, and is shared with ${c.name} when you send it. ` : ''}
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
                  <button className="btn small primary" onClick={() => onShare(i.id, i.title)}>
                    {attaching ? 'Attach' : 'Share'}
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
  const [picError, setPicError] = useState('');
  const picInput = useRef<HTMLInputElement>(null);
  /** Shrinks the chosen picture to a small square before it is sent, so it stays quick to load everywhere it shows. */
  const choosePicture = async (file?: File) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const size = 256;
      const side = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
      setPicError('');
      await run(() => api.updateCommunity(c.id, { image: canvas.toDataURL('image/jpeg', 0.86) }), 'The picture was saved.');
    } catch {
      setPicError('That file could not be read as a picture. Choose a JPG or PNG image.');
    }
    if (picInput.current) picInput.current.value = '';
  };
  return (
    <>
      <div className="card">
        <h2>Picture</h2>
        <p className="muted small">Shown on the community's banner and in everyone's list of communities. The middle of the picture is used, as a square.</p>
        {picError && <p className="error">{picError}</p>}
        <div className="cm-pic">
          <span className="cm-crest" aria-hidden="true">
            {c.image ? <img src={c.image} alt="" /> : initials(c.name)}
          </span>
          <input ref={picInput} type="file" accept="image/*" hidden onChange={(e) => choosePicture(e.target.files?.[0])} />
          <button type="button" className="btn" onClick={() => picInput.current?.click()}>
            {c.image ? 'Change picture' : 'Upload a picture'}
          </button>
          {c.image && (
            <button type="button" className="btn" onClick={() => run(() => api.updateCommunity(c.id, { image: '' }), 'The picture was removed.')}>
              Remove
            </button>
          )}
        </div>
      </div>
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
