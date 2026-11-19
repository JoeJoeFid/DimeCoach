// Sharing a drill, a play or a resource, all the same way: to coaches and the team, to
// communities, or out as a link. And the box that says where a thing has been shared.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ItemShareState, type ShareItemKind, type SharedWithRow } from '../api';
import { useApp } from '../App';
import type { Resource } from '../types';
import { fmtDateShort } from '../util';
import { Modal, ShareIcon } from './bits';
import { CommunityChoices } from './community';
import { TheFile, TheLink, ToCommunities } from './ShareResource';

/** The thing being shared. A resource is named by its key, since one attached to a drill has no number of its own. */
export type ShareWhat = { kind: 'drill' | 'play'; id: number; title: string } | { kind: 'resource'; resource: Resource };
const refOf = (w: ShareWhat) => (w.kind === 'resource' ? w.resource.key : String(w.id));
const titleOf = (w: ShareWhat) => (w.kind === 'resource' ? w.resource.title : w.title);
const NOUN: Record<ShareItemKind, string> = { drill: 'drill', play: 'play', resource: 'resource' };
const PART: Record<ShareItemKind, string> = { drill: 'drills', play: 'playbook', resource: 'resources' };

type Tab = 'people' | 'communities' | 'link';
const TABS: [Tab, string][] = [
  ['people', 'Coaches & team'],
  ['communities', 'Communities'],
  ['link', 'Link'],
];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word.endsWith('ch') ? 'es' : 's'}`;

export function ShareItemDialog({ what, onClose }: { what: ShareWhat; onClose: () => void }) {
  const { team } = useApp();
  const [tab, setTab] = useState<Tab>('people');
  const [st, setSt] = useState<ItemShareState | null>(null);
  const [error, setError] = useState('');
  const kind = what.kind;
  const ref = refOf(what);
  const teamId = team?.id ?? 0;
  const isFile = what.kind === 'resource' && what.resource.kind !== 'link';
  const load = useCallback(() => api.itemShares(kind, ref, teamId).then(setSt, (e) => setError((e as Error).message)), [kind, ref, teamId]);
  useEffect(() => {
    load();
  }, [load]);
  const act = async (work: () => Promise<ItemShareState>) => {
    try {
      const next = await work();
      setSt(next);
      setError('');
      return next;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };
  return (
    <Modal title={`Share "${titleOf(what)}"`} onClose={onClose}>
      <div className="seg share-tabs" role="group" aria-label="Where to share it">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'on' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!st ? (
        !error && <p className="muted">Loading…</p>
      ) : (
        <>
          {tab === 'people' && <ToPeople what={what} st={st} isFile={isFile} teamId={teamId} act={act} />}
          {tab === 'communities' &&
            (what.kind === 'resource' ? (
              isFile ? (
                <p className="muted small">A picture or video is a private file, so it cannot be posted in a community. Share it with your team, or share the file itself under "Link".</p>
              ) : (
                <ToCommunities resource={what.resource} onPosted={(communityId) => act(() => api.itemSharePosted(kind, ref, communityId, teamId))} />
              )
            ) : (
              <CommunityChoices kind={what.kind} itemId={what.id} />
            ))}
          {tab === 'link' && (what.kind === 'resource' ? isFile ? <TheFile resource={what.resource} /> : <TheLink resource={what.resource} /> : <OpenLink what={what} st={st} teamId={teamId} act={act} />)}
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

type Act = (work: () => Promise<ItemShareState>) => Promise<ItemShareState | null>;

/** The team's parents, family and friends, then coaches picked from a list or written by email address. */
function ToPeople({ what, st, isFile, teamId, act }: { what: ShareWhat; st: ItemShareState; isFile: boolean; teamId: number; act: Act }) {
  const kind = what.kind;
  const ref = refOf(what);
  const [picked, setPicked] = useState<number[]>([]);
  const [emails, setEmails] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const typed = emails
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const count = picked.length + typed.length;
  const shown = st.people.filter((p) => !q.trim() || `${p.name} ${p.where}`.toLowerCase().includes(q.trim().toLowerCase()));
  const send = async () => {
    setBusy(true);
    setSaid('');
    const next = await act(() => api.sendItem(kind, ref, { team_id: teamId, user_ids: picked, emails: typed, note }));
    const r = next?.result;
    if (r) {
      setSaid(
        r.failed.length
          ? `The email to ${r.failed.join(', ')} did not go through.${r.mailed ? ` ${plural(r.mailed, 'other')} did.` : ''}`
          : next.mail
            ? `Sent to ${plural(r.total, 'coach')}.`
            : `${plural(r.messaged, 'coach')} got a message in Dime Coach with it.`,
      );
      setPicked([]);
      setEmails('');
      setNote('');
    }
    setBusy(false);
  };
  const t = st.team;
  const joined = t ? t.joined.parent + t.joined.family + t.joined.friend : 0;
  return (
    <div className="share-send">
      {t && (
        <div className="share-team">
          <span className="field-label">Your team</span>
          <label className="check">
            <input type="checkbox" checked={t.shared} onChange={(e) => act(() => api.shareWithTeam(kind, ref, teamId, e.target.checked))} />
            <span>
              <strong>{t.name}'s parents, family and friends</strong>
              <span className="muted small">
                {' '}
                · {t.words ? `${t.words} see it on the team's page` : `nobody is let into the ${PART[kind]} on the team's page yet`}
              </span>
            </span>
          </label>
          <p className="muted small">
            {joined ? `${plural(joined, 'person')} on the team's list ${joined === 1 ? 'has' : 'have'} an account.` : 'Nobody on the team’s list has an account yet.'} Who sees the {PART[kind]} is set under{' '}
            <Link to="/teams?tab=family">Team &amp; roster, Parents &amp; family</Link>.
          </p>
        </div>
      )}
      <span className="field-label">Coaches</span>
      {isFile ? (
        <p className="muted small">A picture or video is a private file, so it cannot be sent to a coach from here. Share the file itself under "Link".</p>
      ) : (
        <>
          <p className="muted small">
            {st.mail
              ? `Each coach gets an email with a link to ${kind === 'resource' ? 'it' : `the ${NOUN[kind]}`}. A coach you pick from the list also gets a message in Dime Coach.`
              : `Email is not set up on this site, so each coach you pick gets a message in Dime Coach with ${kind === 'resource' ? 'the link' : `the ${NOUN[kind]}`}.`}
            {kind !== 'resource' && ' Your coach-only notes and uploaded files stay private.'}
          </p>
          {said && (
            <p className="banner ok" role="status">
              {said}
            </p>
          )}
          {st.people.length > 8 && <input className="input" placeholder="Search coaches" aria-label="Search coaches" value={q} onChange={(e) => setQ(e.target.value)} />}
          {st.people.length === 0 ? (
            <p className="muted small">Coaches on your team and people in your communities show up here to pick.</p>
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
          {st.sent.length > 0 && (
            <div className="share-sent">
              <span className="field-label">Already sent to</span>
              <ul>
                {st.sent.map((r) => (
                  <li key={r.id}>
                    <span>
                      {r.to}
                      <span className="muted small"> · {fmtDateShort(r.created_at.slice(0, 10))}</span>
                    </span>
                    <button type="button" className="link" onClick={() => act(() => api.removeItemSend(kind, ref, r.id, teamId))} title={kind === 'resource' ? 'Takes them off the list' : 'Their link stops working'}>
                      Stop sharing
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A link to a drill or a play that anyone can open, for a text message or a group chat. */
function OpenLink({ what, st, teamId, act }: { what: ShareWhat; st: ItemShareState; teamId: number; act: Act }) {
  const [copied, setCopied] = useState(false);
  const kind = what.kind;
  const ref = refOf(what);
  const noun = NOUN[kind];
  return (
    <div className="share-send">
      {st.link ? (
        <>
          <p className="muted small">Anyone with this link can see the {noun} without an account. It shows the {noun} as it is when they open it, without your coach-only notes or uploaded files.</p>
          <div className="share-link-row">
            <code>{st.link.url}</code>
            <button
              type="button"
              className="btn small primary"
              onClick={() => {
                navigator.clipboard?.writeText(st.link!.url);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <button type="button" className="link" onClick={() => act(() => api.removeItemSend(kind, ref, st.link!.id, teamId))}>
            Turn this link off
          </button>
        </>
      ) : (
        <>
          <p className="muted small">Make a link that anyone can open to see this {noun}, without an account. Paste it into a text message, a group chat or your team app.</p>
          <button type="button" className="btn primary" onClick={() => act(() => api.itemShareLink(kind, ref, teamId))}>
            Make a link
          </button>
        </>
      )}
    </div>
  );
}

const TYPE_WORD: Record<SharedWithRow['type'], string> = { team: 'Team', coach: 'Coach', email: 'Email', community: 'Community', link: 'Link' };

/**
 * Where a drill, a play or a resource has been shared: the team, the coaches and addresses it was
 * sent to, the communities, and the link. `version` changes whenever sharing may have changed, so
 * the box reads it again.
 */
export function SharedWithBox({ what, version = 0, onShare }: { what: ShareWhat; version?: number; onShare?: () => void }) {
  const { team } = useApp();
  const [rows, setRows] = useState<SharedWithRow[] | null>(null);
  const kind = what.kind;
  const ref = refOf(what);
  const teamId = team?.id ?? 0;
  useEffect(() => {
    let live = true;
    api.itemShares(kind, ref, teamId).then((st) => live && setRows(st.with), () => live && setRows([]));
    return () => {
      live = false;
    };
  }, [kind, ref, teamId, version]);
  return (
    <section className="shared-with" aria-label="Shared with">
      <header>
        <ShareIcon size={16} />
        <strong>Shared with</strong>
        {onShare && (
          <button type="button" className="btn small" onClick={onShare}>
            Share
          </button>
        )}
      </header>
      {rows === null ? (
        <p className="muted small">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">Nobody yet. Only you and the coaches of your team can see this {NOUN[kind]}.</p>
      ) : (
        <ul>
          {rows.map((w) => (
            <li key={w.key}>
              <span className={`shared-with-kind ${w.type}`}>{TYPE_WORD[w.type]}</span>
              <strong>{w.label}</strong>
              <span className="muted small">{w.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One line for a card in a list: a green tick and the first few places a thing has been shared.
 * With `onClick` it is a button that opens the sharing; without, it is only words.
 */
export function SharedWithLine({ names, onClick }: { names: string[]; onClick?: () => void }) {
  if (!names.length) return null;
  const inner = (
    <>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span>
        <strong>Shared with</strong> {names.slice(0, 3).join(', ')}
        {names.length > 3 && ` and ${names.length - 3} more`}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="shared-with-line" onClick={onClick} title="See or change who this is shared with">
      {inner}
    </button>
  ) : (
    <span className="shared-with-line" title={`Shared with ${names.join(', ')}`}>
      {inner}
    </span>
  );
}

/** For a list of drills, plays or resources: the names of where each one has been shared, by its number or key. */
export function useShareSummary(kind: ShareItemKind, version = 0) {
  const [map, setMap] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let live = true;
    api.shareSummary(kind).then((m) => live && setMap(m), () => {});
    return () => {
      live = false;
    };
  }, [kind, version]);
  return map;
}
