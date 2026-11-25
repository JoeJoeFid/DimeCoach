// Messages laid out as an inbox: what the app and other people sent you, what you sent, and a
// form for writing to the people you share a team, a community or an organization with.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type CommunityNews, type CommunityNewsItem, type ToGroup, type ToPerson, type User } from '../api';
import { Modal } from './bits';
import { TopTabs } from './TopTabs';
import { confirmDialog } from './dialogs';
import { MentionText } from './Mentions';
import { disablePush, enablePush, pushState, type PushState } from '../push';

const SHARE_WORD = { drill: 'Drill', play: 'Play', plan: 'Practice plan' } as const;
const stamp = (at: string) => new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`);
/** "3:42 PM" for today, "Nov 13" for this year, and the whole date before that. */
function shortWhen(at: string) {
  const d = stamp(at);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
const fullWhen = (at: string) => stamp(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** Who a line is from, and what stands as its subject. */
function lineOf(n: CommunityNewsItem): { from: string; subject: string; text: string } {
  if (n.kind === 'direct') return { from: n.by, subject: n.title || '(no subject)', text: n.text };
  if (n.kind === 'sent') return { from: `To: ${(n.to || []).join(', ')}`, subject: n.title || '(no subject)', text: n.text };
  if (n.kind === 'notice') return { from: 'Dime Coach', subject: n.title || 'Message', text: n.text };
  if (n.kind === 'invite') return { from: n.by, subject: `Invitation to join ${n.community}`, text: '' };
  if (n.kind === 'share') return { from: n.by, subject: `Shared in ${n.community}`, text: `${SHARE_WORD[n.share_kind!]}: ${n.text}` };
  return { from: n.by, subject: `New in ${n.community}`, text: n.text };
}

/** Notifications on the device in hand: on, off, and why not when it cannot be. */
function DevicePush() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    pushState().then(setState, () => setState('unsupported'));
  }, []);
  const run = async (work: () => Promise<PushState>, done = '') => {
    setBusy(true);
    setNote('');
    try {
      const next = await work();
      setState(next);
      setNote(next === 'blocked' ? '' : done);
    } catch (e) {
      setNote((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="push-box">
      <strong>Notifications on this device</strong>
      {state === null ? (
        <span className="muted small">Checking…</span>
      ) : state === 'on' ? (
        <>
          <span className="muted small">On. This device is told at once when you get a message, are mentioned, have something shared with you, or a game you can watch goes live.</span>
          <span className="push-actions">
            <button type="button" className="btn small" disabled={busy} onClick={() => run(async () => ((await api.pushTest()), 'on'), 'Sent. It should arrive in a moment.')}>
              Send me a test
            </button>
            <button type="button" className="btn small" disabled={busy} onClick={() => run(disablePush, 'Notifications are off for this device.')}>
              Turn off
            </button>
          </span>
        </>
      ) : state === 'off' ? (
        <>
          <span className="muted small">Be told at once, even when Dime Coach is closed: a new message, a mention, something shared with you, or a game going live. Each device is turned on by itself.</span>
          <span className="push-actions">
            <button type="button" className="btn small primary" disabled={busy} onClick={() => run(enablePush, 'Notifications are on for this device.')}>
              Turn on notifications
            </button>
          </span>
        </>
      ) : state === 'needs-install' ? (
        <span className="muted small">An iPhone or iPad only allows notifications for an app on the home screen. Put Dime Coach there first ("Get the app" in your account menu), open it from its icon, and turn them on here.</span>
      ) : state === 'blocked' ? (
        <span className="muted small">Notifications from this site are blocked in this browser. Allow them in the browser's or the phone's settings for Dime Coach, then come back here.</span>
      ) : (
        <span className="muted small">This browser cannot show notifications from Dime Coach.</span>
      )}
      {note && <span className="notice">{note}</span>}
    </div>
  );
}

/** The choices a person has about messages. Each is saved as it is ticked. */
export function MessageSettings({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [prefs, setPrefs] = useState({ mention_email_off: !!user.prefs.mention_email_off, message_email_off: !!user.prefs.message_email_off, hide_in_to: !!user.prefs.hide_in_to });
  const [error, setError] = useState('');
  const save = async (change: Partial<typeof prefs>) => {
    const before = prefs;
    setPrefs({ ...prefs, ...change });
    try {
      await api.savePrefs(change);
      setError('');
      onChanged();
    } catch (e) {
      setPrefs(before);
      setError((e as Error).message);
    }
  };
  return (
    <div className="msg-settings">
      <DevicePush />
      <label className="check setting">
        <input type="checkbox" checked={!prefs.mention_email_off} onChange={(e) => save({ mention_email_off: !e.target.checked })} />
        <span>
          <strong>Email me when someone mentions me</strong>
          <span className="muted small">When someone writes "@" and your name, you get an email with a link to where. With this off, the mention still shows in your Messages.</span>
        </span>
      </label>
      <label className="check setting">
        <input type="checkbox" checked={!prefs.message_email_off} onChange={(e) => save({ message_email_off: !e.target.checked })} />
        <span>
          <strong>Email me when someone sends me a message and asks for an email too</strong>
          <span className="muted small">The email says who wrote and the subject, with a link to your inbox. With this off, the message still shows in your Messages.</span>
        </span>
      </label>
      <label className="check setting">
        <input type="checkbox" checked={!prefs.hide_in_to} onChange={(e) => save({ hide_in_to: !e.target.checked })} />
        <span>
          <strong>Let people choose my name when they write a message</strong>
          <span className="muted small">With this off, your name is not offered under "To" for a new message. People can still answer a message you sent them.</span>
        </span>
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** One person to tick, with how they are known in the group. */
function PersonChip({ p, on, toggle }: { p: ToPerson; on: boolean; toggle: (p: ToPerson) => void }) {
  return (
    <button type="button" className={`to-person ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(p)}>
      {on && <span aria-hidden="true">✓ </span>}
      {p.name}
      <span className="to-role">{p.role}</span>
    </button>
  );
}

/**
 * Writing a message. The people on your teams are laid out to pick from; communities and
 * organizations wait folded underneath, and typing a name finds anyone in any of them.
 */
function Compose({ reply, onClose, onSent }: { reply?: CommunityNewsItem; onClose: () => void; onSent: (sent: CommunityNewsItem[]) => void }) {
  const [groups, setGroups] = useState<ToGroup[] | null>(null);
  const [to, setTo] = useState<ToPerson[]>(reply?.by_id ? [{ id: reply.by_id, name: reply.by, role: '' }] : []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState(reply ? (/^re:/i.test(reply.title || '') ? reply.title! : `Re: ${reply.title}`) : '');
  const [body, setBody] = useState('');
  // Off unless asked for: the message is in their Messages, and on their phone if they have notifications on.
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const find = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api.messagePeople().then(setGroups, (e) => setError((e as Error).message));
  }, []);
  const chosen = new Set(to.map((p) => p.id));
  const toggle = (p: ToPerson) => {
    setTo(chosen.has(p.id) ? to.filter((x) => x.id !== p.id) : [...to, p]);
    setQ('');
  };
  const teams = (groups || []).filter((g) => g.tier === 'team');
  const further = (groups || []).filter((g) => g.tier === 'community');
  const words = q.trim().toLowerCase();
  /** Everyone whose name matches what was typed, once each, nearest group first. */
  const found = useMemo(() => {
    if (!words || !groups) return [];
    const seen = new Set<number>();
    const out: { p: ToPerson; group: string }[] = [];
    for (const g of groups)
      for (const p of g.people)
        if (!seen.has(p.id) && p.name.toLowerCase().includes(words)) {
          seen.add(p.id);
          out.push({ p, group: g.label });
        }
    return out.slice(0, 40);
  }, [words, groups]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || to.length === 0 || !body.trim()) return;
    setBusy(true);
    try {
      const r = await api.sendMessage({ to: to.map((p) => p.id), subject, body, reply_to: reply?.id, email: alsoEmail });
      onSent(r.sent);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const addAll = (g: ToGroup) => setTo([...to, ...g.people.filter((p) => !chosen.has(p.id))]);
  return (
    <Modal title={reply ? 'Reply' : 'New message'} onClose={onClose} wide>
      <form className="fields stack compose" onSubmit={send}>
        <div className="compose-to">
          <span className="compose-label">To</span>
          <div className="to-box" onClick={() => find.current?.focus()}>
            {to.map((p) => (
              <span key={p.id} className="to-chip">
                {p.name}
                <button type="button" aria-label={`Take ${p.name} off`} onClick={() => setTo(to.filter((x) => x.id !== p.id))}>
                  ✕
                </button>
              </span>
            ))}
            <input ref={find} type="search" aria-label="Find a person by name" placeholder={to.length ? 'Add someone…' : 'Type a name, or pick below'} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="to-pick" aria-label="People you can write to">
          {groups === null ? (
            <p className="muted small">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="muted small">There is nobody to write to yet. People appear here once you share a team, a community or an organization with them.</p>
          ) : words ? (
            found.length === 0 ? (
              <p className="muted small">Nobody you can write to has that name.</p>
            ) : (
              <div className="to-people">
                {found.map(({ p, group }) => (
                  <PersonChip key={p.id} p={{ ...p, role: `${p.role} · ${group}` }} on={chosen.has(p.id)} toggle={() => toggle(p)} />
                ))}
              </div>
            )
          ) : (
            <>
              {teams.map((g) => (
                <section key={g.key} className="to-group">
                  <header>
                    <strong>{g.label}</strong>
                    <span className="muted small">{g.sub}</span>
                    {g.people.some((p) => !chosen.has(p.id)) && g.people.length > 1 && (
                      <button type="button" className="link small" onClick={() => addAll(g)}>
                        Add everyone
                      </button>
                    )}
                  </header>
                  <div className="to-people">
                    {g.people.map((p) => (
                      <PersonChip key={p.id} p={p} on={chosen.has(p.id)} toggle={toggle} />
                    ))}
                  </div>
                </section>
              ))}
              {further.length > 0 && (
                <section className="to-further">
                  <span className="side-label">Communities and organizations</span>
                  {further.map((g) => {
                    const isOpen = open.has(g.key);
                    return (
                      <div key={g.key} className="to-group folded">
                        <button
                          type="button"
                          className="to-fold"
                          aria-expanded={isOpen}
                          onClick={() => {
                            const next = new Set(open);
                            if (isOpen) next.delete(g.key);
                            else next.add(g.key);
                            setOpen(next);
                          }}
                        >
                          <span className="to-caret" aria-hidden="true">
                            {isOpen ? '▾' : '▸'}
                          </span>
                          <strong>{g.label}</strong>
                          <span className="muted small">
                            {g.sub} · {g.people.length} {g.people.length === 1 ? 'person' : 'people'}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="to-people">
                            {g.people.map((p) => (
                              <PersonChip key={p.id} p={p} on={chosen.has(p.id)} toggle={toggle} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              )}
            </>
          )}
        </div>
        <input className="input" maxLength={150} aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="input" rows={7} maxLength={8000} aria-label="Message" placeholder="Write your message…" value={body} onChange={(e) => setBody(e.target.value)} autoFocus={!!reply} />
        <label className="check compose-email">
          <input type="checkbox" checked={alsoEmail} onChange={(e) => setAlsoEmail(e.target.checked)} />
          <span>
            Also email {to.length > 1 ? 'them' : 'the person'}
            <span className="muted small"> · Without this it shows in their Messages, and as a notification if they have those on.</span>
          </span>
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <span className="muted small compose-note">Only names are shown. Nobody sees anyone's email address.</span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || to.length === 0 || !body.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Where a line leads, to the very thing it is about: '' when there is nowhere to go. */
function linkOf(n: CommunityNewsItem): string {
  if (n.kind === 'notice') return n.link || '';
  if (n.kind === 'post') return `/communities/${n.community_id}?tab=discussions&post=${n.ref_id}`;
  if (n.kind === 'share') return `/communities/${n.community_id}?tab=library&share=${n.ref_id}`;
  if (n.kind === 'invite') return '/communities';
  return '';
}
/** What the button to that place says. */
function linkWord(n: CommunityNewsItem, link: string): string {
  if (n.kind === 'post') return 'Open the conversation';
  if (n.kind === 'share') return `Open the ${SHARE_WORD[n.share_kind!].toLowerCase()}`;
  if (n.kind === 'invite') return 'Open your invitations';
  if (/^https?:\/\//.test(link)) return 'Open the link';
  if (/[?&]post=/.test(link)) return 'Open the message';
  if (/^\/go\/plan\//.test(link)) return 'Open the practice';
  if (/^\/shared\//.test(link) || /[?&]share=/.test(link)) return 'Open what was shared';
  if (/^\/communities/.test(link)) return 'Open the community';
  if (/^\/teams/.test(link)) return 'Open the team';
  if (/^\/account/.test(link)) return 'Open your account';
  return 'Open';
}
/** All the words of a line, for when it is opened. */
function wordsOf(n: CommunityNewsItem): string {
  if (n.kind === 'invite') return `${n.by} invited you to join ${n.community}.`;
  if (n.kind === 'share') return `${n.by} shared a ${SHARE_WORD[n.share_kind!].toLowerCase()} in ${n.community}: ${n.text}`;
  return n.body || n.text || '';
}

/**
 * The inbox itself. Every line opens to be read, with a link to the thing it is about. Lines can
 * be ticked and deleted together. `onUnread` hears the count of unread messages, for the menu.
 */
export default function Inbox({ user, onUnread, onUserChanged }: { user: User; onUnread?: (count: number) => void; onUserChanged: () => void }) {
  const [news, setNews] = useState<CommunityNews | null>(null);
  const [sent, setSent] = useState<CommunityNewsItem[] | null>(null);
  const [folder, setFolder] = useState<'inbox' | 'sent'>('inbox');
  const [reading, setReading] = useState<CommunityNewsItem | null>(null);
  const [writing, setWriting] = useState<{ reply?: CommunityNewsItem } | null>(null);
  const [settings, setSettings] = useState(false);
  const [shown, setShown] = useState(25);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const heard = useRef(onUnread);
  heard.current = onUnread;
  /** Takes a fresh answer about what is new, and passes the count on to the menu. */
  const got = useCallback((n: CommunityNews) => {
    setNews(n);
    heard.current?.(n.unread);
  }, []);
  const failed = (e: unknown) => setError((e as Error).message);
  useEffect(() => {
    api.messages().then(got, failed);
    // A message that arrives while this is open is added to the list.
    const again = () => api.messages().then(got, failed);
    window.addEventListener('dime:news', again);
    const timer = window.setInterval(again, 60_000);
    return () => {
      window.removeEventListener('dime:news', again);
      window.clearInterval(timer);
    };
  }, [got]);
  useEffect(() => {
    if (folder === 'sent' && sent === null) api.messagesSent().then(setSent, failed);
  }, [folder, sent]);
  const choose = (f: 'inbox' | 'sent') => {
    setFolder(f);
    setReading(null);
    setTicked(new Set());
  };

  /** Opens a line to be read, and counts it as read. */
  const open = (n: CommunityNewsItem) => {
    setNotice('');
    setReading(n);
    if (!n.unread || !n.id) return;
    if (n.kind === 'direct') api.readDirect(n.id).then(got, failed);
    else if (n.kind === 'notice') api.markMessagesRead(n.id).then(got, failed);
  };
  const remove = async (keys: string[]) => {
    if (keys.length === 0) return;
    const many = keys.length > 1;
    if (!(await confirmDialog({ title: many ? `Delete ${keys.length} messages?` : 'Delete this message?', body: `${many ? 'They are' : 'It is'} taken out of your list only. Nobody else's copy is touched.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      const r = await api.deleteMessages(keys);
      got(r.news);
      setSent(r.sent);
      setTicked(new Set());
      setReading(null);
      setNotice(many ? `${keys.length} messages deleted.` : 'Message deleted.');
    } catch (e) {
      failed(e);
    }
  };
  const items = folder === 'inbox' ? news?.items ?? null : sent;
  const unread = news?.unread ?? 0;
  const onPage = (items || []).slice(0, shown);
  const allTicked = onPage.length > 0 && onPage.every((n) => ticked.has(n.key));
  const tick = (key: string) => {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setTicked(next);
  };
  const link = reading ? linkOf(reading) : '';
  const line = reading ? lineOf(reading) : null;

  return (
    <div className="inbox">
      <div className="inbox-bar">
        <TopTabs<'inbox' | 'sent'>
          label="Folder"
          value={folder}
          onChange={choose}
          tabs={[
            ['inbox', 'Inbox', unread],
            ['sent', 'Sent'],
          ]}
        />
        <span className="inbox-space" />
        {folder === 'inbox' && !reading && news && news.items.some((i) => i.unread && i.kind !== 'invite') && (
          <button type="button" className="btn small" onClick={() => api.markMessagesRead().then(got, failed)}>
            Mark all as read
          </button>
        )}
        <button type="button" className="btn small" onClick={() => setSettings(true)}>
          Settings
        </button>
        <button type="button" className="btn primary" onClick={() => setWriting({})}>
          + New message
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="card inbox-card">
        {reading && line ? (
          <article className="inbox-read">
            <button type="button" className="link small" onClick={() => setReading(null)}>
              ← Back to {folder === 'inbox' ? 'the inbox' : 'sent messages'}
            </button>
            <h2>{line.subject}</h2>
            <p className="muted small inbox-meta">
              <strong>{reading.kind === 'sent' ? 'You' : line.from}</strong>
              {reading.to && <> to {reading.to.map((n) => (reading.kind === 'direct' && n === user.name ? 'you' : n)).join(', ')}</>} · {fullWhen(reading.at)}
            </p>
            <div className="inbox-body">
              <MentionText text={wordsOf(reading)} people={[]} />
              {link &&
                (/^https?:\/\//.test(link) ? (
                  <a className="inbox-target" href={link} target="_blank" rel="noopener noreferrer">
                    {linkWord(reading, link)} <span aria-hidden="true">→</span>
                  </a>
                ) : (
                  <Link className="inbox-target" to={link}>
                    {linkWord(reading, link)} <span aria-hidden="true">→</span>
                  </Link>
                ))}
            </div>
            <div className="inbox-actions">
              {reading.kind === 'direct' && (
                <button type="button" className="btn primary" onClick={() => setWriting({ reply: reading })}>
                  Reply
                </button>
              )}
              <button type="button" className="btn" onClick={() => remove([reading.key])}>
                Delete
              </button>
            </div>
          </article>
        ) : items === null ? (
          <p className="muted small">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted small inbox-none">{folder === 'inbox' ? 'Nothing here yet. Messages from other people land here, and so does news from the app: being added to a team, being mentioned, something shared with you.' : 'You have not sent any messages yet.'}</p>
        ) : (
          <>
            <div className="inbox-tools">
              <label className="check">
                <input type="checkbox" checked={allTicked} onChange={() => setTicked(allTicked ? new Set() : new Set(onPage.map((n) => n.key)))} />
                <span>{ticked.size > 0 ? `${ticked.size} selected` : 'Select all'}</span>
              </label>
              {ticked.size > 0 && (
                <button type="button" className="btn small" onClick={() => remove([...ticked])}>
                  Delete
                </button>
              )}
            </div>
            <ul className="inbox-list">
              {onPage.map((n) => {
                const l = lineOf(n);
                return (
                  <li key={n.key} className={`${n.unread ? 'unread' : ''} ${ticked.has(n.key) ? 'ticked' : ''} kind-${n.kind}`}>
                    <input type="checkbox" className="inbox-tick" aria-label={`Select: ${l.subject}`} checked={ticked.has(n.key)} onChange={() => tick(n.key)} />
                    <button type="button" className="inbox-row" onClick={() => open(n)}>
                      <span className={`news-dot ${n.unread ? 'on' : ''}`} aria-hidden="true" />
                      <span className="inbox-from">{l.from}</span>
                      <span className="inbox-line">
                        <span className="inbox-subject">{l.subject}</span>
                        {l.text && <span className="inbox-snip"> — {l.text}</span>}
                        {n.unread && <span className="sr-only"> (new)</span>}
                      </span>
                      <span className="muted small inbox-when">{shortWhen(n.at)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {!reading && items && items.length > shown && (
          <button type="button" className="link small" onClick={() => setShown(items.length)}>
            Show {items.length - shown} older
          </button>
        )}
      </div>

      {writing && (
        <Compose
          reply={writing.reply}
          onClose={() => setWriting(null)}
          onSent={(list) => {
            setSent(list);
            setWriting(null);
            setReading(null);
            setNotice('Message sent.');
          }}
        />
      )}
      {settings && (
        <Modal title="Message settings" onClose={() => setSettings(false)}>
          <MessageSettings user={user} onChanged={onUserChanged} />
        </Modal>
      )}
    </div>
  );
}
