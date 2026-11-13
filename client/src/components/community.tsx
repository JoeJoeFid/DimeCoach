// Pieces of the community feature that other pages borrow: looking through what communities
// share and taking a copy, choosing which communities one of your own things is shared with,
// and showing a shared thing safely.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Community, type CommunityShare, type CommunityShareDetail, type MyShareState, type ShareKind, type SharedDrill, type SharedPlan, type SharedPlay } from '../api';
import { useApp } from '../App';
import { clean, fmtClock, fmtDateShort, isBlankHtml, parseClock, todayISO } from '../util';
import { Modal } from './bits';
import PlayAnimation from './PlayAnimation';
import { PlayDiagram } from './PlayDiagram';

export const KIND_WORDS: Record<ShareKind, { one: string; many: string; mine: string }> = {
  drill: { one: 'drill', many: 'drills', mine: 'my drills' },
  play: { one: 'play', many: 'plays', mine: 'my playbook' },
  plan: { one: 'practice plan', many: 'practice plans', mine: 'my practices' },
};
export const sharesKind = (c: Community, kind: ShareKind) => (kind === 'drill' ? c.share_drills : kind === 'play' ? c.share_plays : c.share_plans);

function Chips({ tags }: { tags: { name: string; color: string }[] }) {
  if (!tags.length) return null;
  return (
    <span className="chips">
      {tags.map((t) => (
        <span key={t.name} className="chip">
          <span className="dot" style={{ background: t.color }} />
          {t.name}
        </span>
      ))}
    </span>
  );
}
function Links({ links }: { links: { url: string; label: string }[] }) {
  if (!links.length) return null;
  return (
    <ul className="shared-links">
      {links.map((l) => (
        <li key={l.url}>
          <a href={l.url} target="_blank" rel="noreferrer noopener">
            {l.label || l.url}
          </a>
        </li>
      ))}
    </ul>
  );
}
/** A shared play: its first step, with a button to watch it run. */
function PlayPeek({ play }: { play: SharedPlay }) {
  const [watching, setWatching] = useState(false);
  return (
    <div className="shared-play">
      <PlayDiagram play={play} frame={play.frames[0]} />
      <div>
        <strong>{play.name}</strong>
        <div className="muted small">{[play.category, `${play.frames.length} step${play.frames.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div>
        <button type="button" className="btn small" onClick={() => setWatching(true)}>
          ▶ Play animation
        </button>
      </div>
      {watching && (
        <Modal title={play.name} onClose={() => setWatching(false)} wide>
          <PlayAnimation play={play} />
        </Modal>
      )}
    </div>
  );
}

/**
 * What someone else shared, for reading. Their notes are cleaned before they are shown, since
 * they were written in another person's account.
 */
export function SharedPreview({ detail }: { detail: Pick<CommunityShareDetail, 'kind' | 'content'> }) {
  if (detail.kind === 'play') {
    const p = detail.content as SharedPlay;
    return (
      <div className="shared">
        <PlayPeek play={p} />
        {p.notes && <p className="shared-notes">{p.notes}</p>}
        <Links links={p.links} />
      </div>
    );
  }
  if (detail.kind === 'drill') {
    const d = detail.content as SharedDrill;
    return (
      <div className="shared">
        {!isBlankHtml(d.notes_html) && <div className="rich shared-notes" dangerouslySetInnerHTML={clean(d.notes_html)} />}
        {d.groups.length > 0 && <p className="muted small">Stations: {d.groups.map((g) => g.name || 'Station').join(', ')}</p>}
        {d.plays.map((p) => (
          <PlayPeek key={p.id} play={p} />
        ))}
        <Links links={d.links} />
      </div>
    );
  }
  const plan = detail.content as SharedPlan;
  // A practice has a start time, so each item is shown with when it begins. Homework has none.
  const timed = plan.kind === 'practice';
  let at = parseClock(plan.start_time || '17:30');
  const total = plan.items.reduce((n, it) => n + (it.duration_min || 0), 0);
  return (
    <div className="shared shared-plan">
      {!isBlankHtml(plan.intro_html) && <div className="rich shared-notes" dangerouslySetInnerHTML={clean(plan.intro_html)} />}
      <ol className="shared-items">
        {plan.items.map((it, i) => {
          const starts = at;
          at += it.duration_min || 0;
          return (
            <li key={i} className={it.kind === 'break' ? 'break' : ''}>
              <div className="shared-when">
                {timed && <span className="shared-clock">{fmtClock(starts)}</span>}
                <span className="shared-min">{it.duration_min} min</span>
              </div>
              <div className="shared-what">
                <div className="shared-item-head">
                  <strong>{it.title || (it.kind === 'break' ? 'Break' : 'Untitled')}</strong>
                  {it.reps && <span className="muted small">{it.reps}</span>}
                  <Chips tags={it.tags} />
                </div>
                {!isBlankHtml(it.notes_html) && <div className="rich shared-notes" dangerouslySetInnerHTML={clean(it.notes_html)} />}
                {it.plays.map((p) => (
                  <PlayPeek key={p.id} play={p} />
                ))}
                <Links links={it.links} />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="muted small shared-total">
        {plan.items.filter((it) => it.kind === 'item').length} items · {total} min{timed ? ` · ends ${fmtClock(at)}` : ''}
      </p>
    </div>
  );
}

/** One row of a community library: what it is, who shared it, a look inside, and whatever actions the caller passes. */
export function ShareRow({ share, showCommunity, actions }: { share: CommunityShare; showCommunity?: boolean; actions: React.ReactNode }) {
  const [detail, setDetail] = useState<CommunityShareDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const toggle = async () => {
    setOpen(!open);
    if (!open && !detail) {
      try {
        setDetail(await api.communityShare(share.id));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };
  return (
    <li className="share-row">
      <div className="share-head">
        <button type="button" className="share-main" onClick={toggle} aria-expanded={open}>
          <span className="share-title">
            {share.title}
            {share.status === 'pending' && <span className="kind">Waiting for approval</span>}
          </span>
          <span className="muted small">
            {[share.summary, `Shared by ${share.mine ? 'you' : share.by}`, showCommunity ? share.community_name : ''].filter(Boolean).join(' · ')}
          </span>
          <Chips tags={share.tags} />
        </button>
        <span className="row-actions">
          <button type="button" className="btn small" onClick={toggle}>
            {open ? 'Hide' : 'Preview'}
          </button>
          {actions}
        </span>
      </div>
      {open && (error ? <p className="error">{error}</p> : detail ? <SharedPreview detail={detail} /> : <p className="muted small">Loading…</p>)}
    </li>
  );
}

/**
 * Looks through what the caller's communities share, of one kind, and adds a copy of the chosen
 * one to their own account. With more than one community they choose which to look through, or all.
 */
export function CommunityPicker({
  kind,
  onClose,
  onAdded,
  many,
}: {
  kind: ShareKind;
  onClose: () => void;
  onAdded: (id: number, title: string) => void;
  /** Stays open after each one is added, so several can be taken in one go. Each is marked as added. */
  many?: boolean;
}) {
  const { sport, team } = useApp();
  const words = KIND_WORDS[kind];
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [which, setWhich] = useState<'all' | number>('all');
  const [shares, setShares] = useState<CommunityShare[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  // What has been added since the box was opened, when it stays open for more.
  const [added, setAdded] = useState<number[]>([]);

  useEffect(() => {
    api
      .communities()
      .then((cs) => setCommunities(cs.filter((c) => c.status === 'active' && sharesKind(c, kind))))
      .catch((e) => setError((e as Error).message));
  }, [kind]);
  useEffect(() => {
    setShares(null);
    api
      .communityLibrary(kind, which)
      .then(setShares)
      .catch((e) => setError((e as Error).message));
  }, [kind, which]);

  const add = async (s: CommunityShare) => {
    setBusy(s.id);
    try {
      const made = await api.copyShare(s.id, kind === 'plan' ? { team_id: team?.id, date: todayISO() } : { sport_id: sport?.id });
      setError('');
      if (many) setAdded((list) => [...list, s.id]);
      onAdded(made.id, s.title);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };
  const shown = (shares || []).filter((s) => !q.trim() || `${s.title} ${s.by} ${s.tags.map((t) => t.name).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Modal title={`Add a ${words.one} from a community`} onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      {communities !== null && communities.length === 0 ? (
        <div className="empty">
          <p>
            None of your communities share {words.many} yet. <Link to="/communities">Go to communities</Link> to join one, start one, or turn
            sharing on in one you run.
          </p>
        </div>
      ) : (
        <>
          <div className="picker-filters">
            <select className="input" aria-label="Community to look through" value={String(which)} onChange={(e) => setWhich(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All my communities</option>
              {(communities || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input className="input grow" placeholder={`Search shared ${words.many}`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {shares === null ? (
            <p className="muted">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="muted">{shares.length === 0 ? `Nobody has shared a ${words.one} here yet.` : 'Nothing matches that search.'}</p>
          ) : (
            <ul className="share-list">
              {shown.map((s) => (
                <ShareRow
                  key={s.id}
                  share={s}
                  showCommunity={which === 'all'}
                  actions={
                    added.includes(s.id) ? (
                      <span className="added-mark" role="status">
                        ✓ Added
                      </span>
                    ) : (
                      <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => add(s)}>
                        {busy === s.id ? 'Adding…' : 'Add to mine'}
                      </button>
                    )
                  }
                />
              ))}
            </ul>
          )}
          <p className="muted small">
            Adding makes your own copy in {words.mine.replace('my ', 'your ')}, which you can change freely. The original stays with whoever shared it. Their private
            coach notes and uploaded files are not included.
          </p>
        </>
      )}
      {many && (
        <div className="modal-actions">
          {added.length > 0 && (
            <span className="muted small added-count">
              {added.length} {added.length === 1 ? words.one : words.many} added
            </span>
          )}
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}

/** For one of your own things: tick the communities it should be shared with. */
export function ShareDialog({ kind, itemId, title, onClose }: { kind: ShareKind; itemId: number; title: string; onClose: () => void }) {
  const words = KIND_WORDS[kind];
  const { user } = useApp();
  const [rows, setRows] = useState<MyShareState[] | null>(null);
  const [error, setError] = useState('');
  // The system administrator can also publish to the coach library, which every coach sees.
  const [pub, setPub] = useState<{ id: number | null; published_at: string | null } | null>(null);
  const [pubBusy, setPubBusy] = useState(false);
  useEffect(() => {
    if (user.is_system_admin) api.libraryState(kind, itemId).then(setPub, () => {});
  }, [user.is_system_admin, kind, itemId]);
  const publish = async (on: boolean) => {
    setPubBusy(true);
    try {
      if (on) await api.publishToLibrary(kind, itemId);
      else if (pub?.id) await api.unpublishLibraryItem(pub.id);
      setPub(await api.libraryState(kind, itemId));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
    setPubBusy(false);
  };
  const load = useCallback(
    () =>
      api
        .myShares(kind, itemId)
        .then(setRows)
        .catch((e) => setError((e as Error).message)),
    [kind, itemId],
  );
  useEffect(() => {
    load();
  }, [load]);
  const toggle = async (r: MyShareState) => {
    try {
      if (r.share_id) await api.unshare(r.share_id);
      else await api.share(r.community_id, kind, itemId);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  };
  return (
    <Modal title={`Share "${title}"`} onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {pub && (
        <div className="share-public">
          <label className="check">
            <input type="checkbox" checked={!!pub.id} disabled={pubBusy} onChange={(e) => publish(e.target.checked)} />
            <span>
              <strong>Coach library</strong>
              <span className="muted small"> · {pub.id ? `published ${fmtDateShort((pub.published_at || '').slice(0, 10))}` : 'every coach on Dime Coach can find it and take a copy'}</span>
            </span>
          </label>
          {pub.id && (
            <p className="muted small">
              Coaches get it as it was when you published it.{' '}
              <button type="button" className="link" disabled={pubBusy} onClick={() => publish(true)}>
                {pubBusy ? 'Publishing…' : 'Publish it again with my latest changes'}
              </button>
              . To describe it or put it in a pack, go to the <Link to="/coach-library">coach library</Link>.
            </p>
          )}
        </div>
      )}
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p>
          You are not in a community yet. <Link to="/communities">Go to communities</Link> to join or start one.
        </p>
      ) : (
        <>
          <p className="muted small">Choose which communities can see this {words.one}. Members can take their own copy. Your coach-only notes, player notes and uploaded files stay private.</p>
          <ul className="share-choices">
            {rows.map((r) => (
              <li key={r.community_id}>
                <label className={`check ${r.allowed ? '' : 'off'}`}>
                  <input type="checkbox" checked={!!r.share_id} disabled={!r.allowed && !r.share_id} onChange={() => toggle(r)} />
                  <span>
                    <strong>{r.name}</strong>
                    <span className="muted small">
                      {!r.allowed ? ` · does not share ${words.many}` : r.status === 'pending' ? ' · waiting for an admin to approve' : r.status === 'approved' ? ' · shared' : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
