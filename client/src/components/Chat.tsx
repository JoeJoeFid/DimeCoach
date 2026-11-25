// Chat: a running back-and-forth among a group of people, as on a phone. A list of the chats a
// person is in, and beside it (or in its place, on a phone) the one that is open: what has been
// said in bubbles, who is typing, and a line to write on.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, onLive, type ChatLine, type ChatRoom, type ToGroup, type ToPerson, type User } from '../api';
import { Modal } from './bits';
import { EmojiPanel, QUICK_EMOJI, onlyEmoji, rememberEmoji } from './Emoji';

/** What a chat is called: a team's name, the name it was given, or else the people in it. */
export function chatTitle(c: ChatRoom, meId: number) {
  if (c.name) return c.name;
  const others = c.members.filter((p) => p.id !== meId).map((p) => p.name);
  if (others.length === 0) return 'Just you';
  if (others.length <= 3) return others.join(', ');
  return `${others.slice(0, 2).join(', ')} and ${others.length - 2} more`;
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const clock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** When something was said, as a phone puts it above a run of messages: "Today 3:42 PM", "Tue 9:05 AM", "Nov 3, 9:05 AM". */
function stamp(at: string) {
  const d = new Date(at);
  const now = new Date();
  if (sameDay(d, now)) return `Today ${clock(d)}`;
  const yesterday = new Date(now.getTime() - 86400_000);
  if (sameDay(d, yesterday)) return `Yesterday ${clock(d)}`;
  if (now.getTime() - d.getTime() < 6 * 86400_000) return `${d.toLocaleDateString([], { weekday: 'long' })} ${clock(d)}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })}, ${clock(d)}`;
}
/** The same, short, for the list of chats. */
function when(at: string) {
  const d = new Date(at);
  const now = new Date();
  if (sameDay(d, now)) return clock(d);
  if (now.getTime() - d.getTime() < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
/** A stamp goes above a line when this much time has gone by since the one before. */
const GAP_MS = 30 * 60_000;
/** How long "is typing" stays up after the last word that someone is. */
const TYPING_MS = 5000;
const touch = () => window.matchMedia('(pointer: coarse)').matches;

/** Choosing people, from the same groups a message can be written to. */
function PeoplePicker({ groups, picked, onChange, skip }: { groups: ToGroup[] | null; picked: ToPerson[]; onChange: (p: ToPerson[]) => void; skip?: Set<number> }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const has = (id: number) => picked.some((p) => p.id === id);
  const toggle = (p: ToPerson) => onChange(has(p.id) ? picked.filter((x) => x.id !== p.id) : [...picked, p]);
  const word = q.trim().toLowerCase();
  const shown = (groups ?? [])
    .map((g) => ({ ...g, people: g.people.filter((p) => !skip?.has(p.id) && (!word || p.name.toLowerCase().includes(word))) }))
    .filter((g) => g.people.length > 0);
  return (
    <div className="chat-pick">
      {picked.length > 0 && (
        <div className="chips">
          {picked.map((p) => (
            <button key={p.id} type="button" className="chip toggle on" onClick={() => toggle(p)} title="Take off">
              {p.name}
            </button>
          ))}
        </div>
      )}
      <input className="input" aria-label="Find a person" placeholder="Type a name, or pick below" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chat-pick-list">
        {groups === null ? (
          <p className="muted small">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="muted small">{word ? 'Nobody by that name.' : 'There is nobody to add yet. People you share a team or a community with show up here.'}</p>
        ) : (
          shown.map((g) => {
            // Teams are laid open; a community's people are a press away, unless a name is being looked for.
            const folded = g.tier === 'community' && !word && !open.has(g.key);
            return (
              <div key={g.key} className="chat-pick-group">
                <button
                  type="button"
                  className="chat-pick-head"
                  aria-expanded={!folded}
                  onClick={() => g.tier === 'community' && setOpen((o) => (o.has(g.key) ? new Set([...o].filter((k) => k !== g.key)) : new Set([...o, g.key])))}
                >
                  <strong>{g.label}</strong>
                  <span className="muted small">
                    {g.sub}
                    {folded ? ` · ${g.people.length} ${g.people.length === 1 ? 'person' : 'people'}` : ''}
                  </span>
                </button>
                {!folded && (
                  <div className="chips">
                    {g.people.map((p) => (
                      <button key={p.id} type="button" className={`chip toggle ${has(p.id) ? 'on' : ''}`} aria-pressed={has(p.id)} onClick={() => toggle(p)}>
                        {p.name}
                        {p.role && <span className="muted small">{p.role}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Starting a chat: who with, and for more than one person a name if it is wanted. */
function NewChat({ onClose, onStarted }: { onClose: () => void; onStarted: (id: number) => void }) {
  const [groups, setGroups] = useState<ToGroup[] | null>(null);
  const [to, setTo] = useState<ToPerson[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.chatPeople().then(setGroups, (e) => setError((e as Error).message));
  }, []);
  const start = async () => {
    if (busy || to.length === 0) return;
    setBusy(true);
    try {
      onStarted((await api.chatStart(to.map((p) => p.id), to.length > 1 ? name : '')).id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title="New chat" onClose={onClose}>
      <div className="chat-new">
        <PeoplePicker groups={groups} picked={to} onChange={setTo} />
        {to.length > 1 && <input className="input" maxLength={60} aria-label="Name of the chat" placeholder="Name the chat (you can leave this empty)" value={name} onChange={(e) => setName(e.target.value)} />}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <span className="muted small compose-note">Only names are shown. Nobody sees anyone's email address.</span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || to.length === 0} onClick={start}>
            {to.length > 1 ? 'Start group chat' : 'Start chat'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Everything about one chat that is not the talking: who is in it, silencing it, its name, leaving. */
function ChatDetails({ chat, meId, onClose, onChanged, onLeft }: { chat: ChatRoom; meId: number; onClose: () => void; onChanged: (c: ChatRoom) => void; onLeft: () => void }) {
  const [name, setName] = useState(chat.name);
  const [adding, setAdding] = useState(false);
  const [groups, setGroups] = useState<ToGroup[] | null>(null);
  const [more, setMore] = useState<ToPerson[]>([]);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const run = async (work: () => Promise<ChatRoom>) => {
    setError('');
    try {
      onChanged(await work());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const inIt = useMemo(() => new Set(chat.members.map((p) => p.id)), [chat.members]);
  return (
    <Modal title={chatTitle(chat, meId)} onClose={onClose}>
      <div className="chat-details">
        {chat.kind === 'group' && (
          <form
            className="chat-rename"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.chatUpdate(chat.id, { name }));
            }}
          >
            <input className="input" maxLength={60} aria-label="Name of the chat" placeholder="Name the chat" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn" disabled={name.trim() === chat.name}>
              Save name
            </button>
          </form>
        )}
        <label className="check setting">
          <input type="checkbox" checked={!chat.muted} onChange={(e) => run(() => api.chatUpdate(chat.id, { muted: !e.target.checked }))} />
          <span>
            <strong>Notify me about this chat</strong>
            <span className="muted small">With this off, what is said here still shows in the chat, without a notification or a count beside Chat.</span>
          </span>
        </label>
        {chat.kind === 'team' && chat.can_run && (
          <label className="check setting">
            <input type="checkbox" checked={chat.families} onChange={(e) => run(() => api.chatUpdate(chat.id, { families: e.target.checked }))} />
            <span>
              <strong>Parents, family and friends are in this chat</strong>
              <span className="muted small">With this off, the team's chat is for its coaches only.</span>
            </span>
          </label>
        )}
        <h3 className="chat-details-h">
          {chat.members.length} {chat.members.length === 1 ? 'person' : 'people'}
        </h3>
        <ul className="chat-members">
          {chat.members.map((p) => (
            <li key={p.id}>
              <span className="chat-avatar small" aria-hidden="true">
                {initials(p.name)}
              </span>
              <span>{p.name}</span>
              {p.id === meId && <span className="kind">You</span>}
              {p.role && <span className="muted small">{p.role}</span>}
            </li>
          ))}
        </ul>
        {chat.kind === 'team' && <p className="muted small">Everyone on the team's lists who has an account is here. People join and leave the chat as they join and leave the team.</p>}
        {chat.kind === 'group' &&
          (adding ? (
            <div className="chat-add">
              <PeoplePicker groups={groups} picked={more} onChange={setMore} skip={inIt} />
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={more.length === 0}
                  onClick={() =>
                    run(() => api.chatAdd(chat.id, more.map((p) => p.id))).then(() => {
                      setAdding(false);
                      setMore([]);
                    })
                  }
                >
                  Add to chat
                </button>
              </div>
            </div>
          ) : (
            <div className="chat-details-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setAdding(true);
                  if (!groups) api.chatPeople().then(setGroups, (e) => setError((e as Error).message));
                }}
              >
                Add people
              </button>
              {leaving ? (
                <>
                  <span className="muted small">Leave this chat? You will stop seeing what is said in it.</span>
                  <button type="button" className="btn danger" onClick={() => api.chatLeave(chat.id).then(onLeft, (e) => setError((e as Error).message))}>
                    Leave
                  </button>
                  <button type="button" className="btn" onClick={() => setLeaving(false)}>
                    Stay
                  </button>
                </>
              ) : (
                <button type="button" className="btn" onClick={() => setLeaving(true)}>
                  Leave chat
                </button>
              )}
            </div>
          ))}
        {/* Deleting it is for this person alone: everyone else keeps the chat and all that was said. */}
        <div className="chat-details-actions">
          {deleting ? (
            <>
              <span className="muted small">
                {chat.kind === 'group'
                  ? 'Delete this chat from your list? What has been said is gone for you only. Everyone else keeps it, and it comes back if someone writes in it again.'
                  : 'Clear this chat for you? What has been said is gone for you only. Everyone else keeps it, and the team’s chat stays in your list.'}
              </span>
              <button type="button" className="btn danger" onClick={() => api.chatDelete(chat.id).then(onLeft, (e) => setError((e as Error).message))}>
                {chat.kind === 'group' ? 'Delete' : 'Clear'}
              </button>
              <button type="button" className="btn" onClick={() => setDeleting(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setDeleting(true)}>
              {chat.kind === 'group' ? 'Delete chat' : 'Clear chat'}
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}

/** One chat, open: what has been said, who is typing, and where to write. */
function Thread({ id, me, onBack, onRead, onGone }: { id: number; me: User; onBack: () => void; onRead: (unread: number) => void; onGone: () => void }) {
  const [chat, setChat] = useState<ChatRoom | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [more, setMore] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(0);
  const [details, setDetails] = useState(false);
  /** What the emoji panel is open for: the line being written, or a line said earlier (its number). */
  const [emojiFor, setEmojiFor] = useState<'write' | number | null>(null);
  /** Who is typing: each name, and when to stop saying so. */
  const [typing, setTyping] = useState<Record<number, { name: string; until: number }>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  /** Whether the newest line was in view, so that a new one keeps it there and reading further back is left alone. */
  const atEnd = useRef(true);
  const toldTyping = useRef(0);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  const toEnd = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  const seen = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    api.chatRead(id).then((r) => onReadRef.current(r.unread), () => {});
  }, [id]);
  /** Reads the newest again, keeping what was fetched from further back. */
  const load = useCallback(async () => {
    try {
      const r = await api.chatMessages(id);
      setChat(r.chat);
      setLines((old) => {
        const from = r.messages[0]?.id ?? Infinity;
        const earlier = old.filter((m) => m.id < from);
        // Nothing earlier was fetched yet: whether there is more is what the server just said.
        if (earlier.length === 0) setMore(r.more);
        return [...earlier, ...r.messages];
      });
      seen();
    } catch {
      // Taken out of it, or it is gone.
      onGoneRef.current();
    }
  }, [id, seen]);

  useEffect(() => {
    setChat(null);
    setLines([]);
    setTyping({});
    setText('');
    setPicked(0);
    atEnd.current = true;
    load();
    if (!touch()) box.current?.focus();
    const offChat = onLive<{ chat_id: number; id: number; line?: ChatLine }>('chat', (d) => {
      if (d.chat_id !== id) return;
      // An emoji put on a line, or taken off: only that line changed.
      if (d.line) setLines((old) => old.map((m) => (m.id === d.line!.id ? d.line! : m)));
      else load();
    });
    const offTyping = onLive<{ chat_id: number; user_id: number; name: string }>('typing', (d) => {
      if (d.chat_id === id) setTyping((t) => ({ ...t, [d.user_id]: { name: d.name, until: Date.now() + TYPING_MS } }));
    });
    // "Is typing" goes away by itself when nothing more is heard.
    const tidy = window.setInterval(() => setTyping((t) => (Object.values(t).some((p) => p.until < Date.now()) ? Object.fromEntries(Object.entries(t).filter(([, p]) => p.until >= Date.now())) : t)), 1000);
    // While the chat is in front of the person the server is told so, and holds back notifications about it.
    const beat = window.setInterval(seen, 20_000);
    document.addEventListener('visibilitychange', seen);
    return () => {
      offChat();
      offTyping();
      window.clearInterval(tidy);
      window.clearInterval(beat);
      document.removeEventListener('visibilitychange', seen);
      api.chatAway().catch(() => {});
    };
  }, [id, load, seen]);

  // A new line keeps the end in view, for someone who was at the end.
  const newest = lines[lines.length - 1]?.id ?? 0;
  const someoneTyping = Object.keys(typing).length > 0;
  const reacted = lines.reduce((n, m) => n + m.reactions.length, 0);
  useEffect(() => {
    if (atEnd.current) toEnd();
  }, [newest, someoneTyping, chat?.id, reacted, picked, emojiFor]);
  // Someone who has spoken is no longer typing.
  useEffect(() => {
    const last = lines[lines.length - 1];
    if (last?.user_id) setTyping((t) => (t[last.user_id!] ? Object.fromEntries(Object.entries(t).filter(([k]) => Number(k) !== last.user_id)) : t));
  }, [newest]); // eslint-disable-line react-hooks/exhaustive-deps

  const earlier = async () => {
    const el = scroller.current;
    const before = el ? el.scrollHeight : 0;
    try {
      const r = await api.chatMessages(id, lines[0]?.id ?? 0);
      setMore(r.more);
      setLines((old) => [...r.messages.filter((m) => !old.some((o) => o.id === m.id)), ...old]);
      // What was being read stays where it was while the older lines go in above it.
      requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - before));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const grow = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };
  useEffect(grow, [text]);
  const wrote = (value: string) => {
    setText(value);
    // The others are told now and then while the writing goes on, not at every letter.
    if (value.trim() && Date.now() - toldTyping.current > 2500) {
      toldTyping.current = Date.now();
      api.chatTyping(id).catch(() => {});
    }
  };
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const line = await api.chatSay(id, body);
      setText('');
      setEmojiFor(null);
      toldTyping.current = 0;
      atEnd.current = true;
      setLines((old) => (old.some((m) => m.id === line.id) ? old : [...old, line]));
    } catch (e) {
      setError((e as Error).message);
    }
    setSending(false);
    box.current?.focus();
  };
  /** Puts an emoji on a line, or takes this person's own off it. */
  const react = async (line: ChatLine, emoji: string) => {
    setPicked(0);
    setEmojiFor(null);
    setError('');
    try {
      const now = await api.chatReact(id, line.id, emoji);
      if (now.reactions.some((r) => r.emoji === emoji && r.users.some((u) => u.id === me.id))) rememberEmoji(emoji);
      setLines((old) => old.map((m) => (m.id === now.id ? now : m)));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** Puts an emoji into what is being written, where the caret is. */
  const insert = (emoji: string) => {
    rememberEmoji(emoji);
    const el = box.current;
    const from = el ? el.selectionStart : text.length;
    const to = el ? el.selectionEnd : text.length;
    wrote((text.slice(0, from) + emoji + text.slice(to)).slice(0, 4000));
    requestAnimationFrame(() => {
      if (!el) return;
      el.selectionStart = el.selectionEnd = from + emoji.length;
      // On a phone the caret is left alone: focusing would bring the keyboard up over the emoji.
      if (!touch()) el.focus();
    });
  };
  const unsay = async (line: ChatLine) => {
    setPicked(0);
    try {
      await api.chatUnsay(id, line.id);
      setLines((old) => old.filter((m) => m.id !== line.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const names = Object.values(typing).map((p) => first(p.name));
  const typingText = names.length === 0 ? '' : names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : `${names.length} people are typing`;
  // In a chat of two there is no need to say who each bubble is from.
  const showNames = (chat?.members.length ?? 0) > 2;

  return (
    <section className="chat-thread" aria-label={chat ? chatTitle(chat, me.id) : 'Chat'}>
      <header className="chat-head">
        <button type="button" className="btn ghost chat-back" onClick={onBack} aria-label="Back to all chats">
          ‹
        </button>
        <button type="button" className="chat-head-title" onClick={() => chat && setDetails(true)} disabled={!chat} title="Who is in this chat, and its settings">
          <strong>{chat ? chatTitle(chat, me.id) : ' '}</strong>
          {chat && (
            <span className="muted small">
              {chat.kind === 'team' ? 'Team chat · ' : ''}
              {chat.members.length} {chat.members.length === 1 ? 'person' : 'people'}
              {chat.muted ? ' · notifications off' : ''}
            </span>
          )}
        </button>
        <button type="button" className="btn small" onClick={() => setDetails(true)} disabled={!chat}>
          Details
        </button>
      </header>
      <div
        className="chat-lines"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {more && (
          <button type="button" className="btn small chat-earlier" onClick={earlier}>
            Earlier messages
          </button>
        )}
        {chat && lines.length === 0 && <p className="chat-empty muted">Nothing has been said here yet. Say hello.</p>}
        {lines.map((m, i) => {
          const prev = lines[i - 1];
          const next = lines[i + 1];
          const gap = !prev || new Date(m.at).getTime() - new Date(prev.at).getTime() > GAP_MS;
          if (m.kind === 'note')
            return (
              <div key={m.id} className="chat-note">
                {gap && <span className="chat-stamp">{stamp(m.at)}</span>}
                <span>{m.body}</span>
              </div>
            );
          const mine = m.user_id === me.id;
          const startsRun = gap || !prev || prev.kind !== 'text' || prev.user_id !== m.user_id;
          const endsRun = !next || next.kind !== 'text' || next.user_id !== m.user_id || new Date(next.at).getTime() - new Date(m.at).getTime() > GAP_MS;
          const canTake = mine || !!chat?.can_run;
          return (
            <div key={m.id} className={`chat-line ${mine ? 'mine' : 'theirs'} ${startsRun ? 'starts' : ''} ${endsRun ? 'ends' : ''}`}>
              {gap && <span className="chat-stamp">{stamp(m.at)}</span>}
              {!mine && showNames && startsRun && <span className="chat-by">{m.by}</span>}
              <button type="button" className={`chat-bubble ${onlyEmoji(m.body) ? 'big' : ''}`} aria-expanded={picked === m.id} title="Add an emoji" onClick={() => setPicked(picked === m.id ? 0 : m.id)}>
                {m.body}
              </button>
              {m.reactions.length > 0 && (
                <span className="chat-reactions">
                  {m.reactions.map((r) => {
                    const own = r.users.some((u) => u.id === me.id);
                    const who = r.users.map((u) => (u.id === me.id ? 'You' : u.name)).join(', ');
                    return (
                      <button key={r.emoji} type="button" className={`chat-reaction ${own ? 'on' : ''}`} aria-pressed={own} title={who} aria-label={`${r.emoji} from ${who}. ${own ? 'Take yours off' : 'Add yours'}`} onClick={() => react(m, r.emoji)}>
                        <span aria-hidden="true">{r.emoji}</span>
                        {r.users.length > 1 && <span className="chat-reaction-n">{r.users.length}</span>}
                      </button>
                    );
                  })}
                </span>
              )}
              {picked === m.id && (
                <span className="chat-line-more">
                  <span className="chat-react-row" role="group" aria-label="Add an emoji to this">
                    {QUICK_EMOJI.map((e) => (
                      <button key={e} type="button" className={m.reactions.some((r) => r.emoji === e && r.users.some((u) => u.id === me.id)) ? 'on' : ''} onClick={() => react(m, e)}>
                        {e}
                      </button>
                    ))}
                    <button type="button" className="chat-react-more" aria-label="More emoji" title="More emoji" onClick={() => setEmojiFor(m.id)}>
                      +
                    </button>
                  </span>
                  <span className="chat-line-meta muted small">
                    {clock(new Date(m.at))}
                    {canTake && (
                      <button type="button" className="link danger" onClick={() => unsay(m)}>
                        Delete
                      </button>
                    )}
                  </span>
                </span>
              )}
            </div>
          );
        })}
        {typingText && (
          <div className="chat-typing" role="status" aria-live="polite">
            <span className="chat-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="muted small">{typingText}</span>
          </div>
        )}
      </div>
      {error && <p className="error chat-error">{error}</p>}
      {emojiFor !== null && (
        <EmojiPanel
          title={emojiFor === 'write' ? 'Add emoji to your message' : 'Pick an emoji to put on the message'}
          onClose={() => setEmojiFor(null)}
          onPick={(e) => {
            if (emojiFor === 'write') return insert(e);
            const line = lines.find((m) => m.id === emojiFor);
            if (line) react(line, e);
          }}
        />
      )}
      <form
        className="chat-write"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <button type="button" className="btn ghost chat-emoji" aria-label="Emoji" title="Emoji" aria-expanded={emojiFor === 'write'} onClick={() => setEmojiFor(emojiFor === 'write' ? null : 'write')}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
          </svg>
        </button>
        <textarea
          ref={box}
          className="input"
          rows={1}
          maxLength={4000}
          aria-label="Message"
          placeholder="Message"
          value={text}
          onChange={(e) => wrote(e.target.value)}
          onKeyDown={(e) => {
            // At a keyboard Enter sends and Shift+Enter starts a new line. On a phone Enter is a new line, and the button sends.
            if (e.key === 'Enter' && !e.shiftKey && !touch() && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn primary chat-send" disabled={!text.trim() || sending} aria-label="Send">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      </form>
      {details && chat && (
        <ChatDetails
          chat={chat}
          meId={me.id}
          onClose={() => setDetails(false)}
          onChanged={(c) => {
            setChat(c);
            load();
          }}
          onLeft={() => {
            setDetails(false);
            onGone();
          }}
        />
      )}
    </section>
  );
}

/** How many unread chat lines a person has, kept up as they arrive. For the count in the menu. */
export function useChatUnread() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const look = () => api.chats().then((l) => setUnread(l.unread), () => {});
    look();
    const off = onLive('chat', look);
    const told = (e: Event) => setUnread((e as CustomEvent<number>).detail);
    window.addEventListener('dime:chat-unread', told);
    const timer = window.setInterval(look, 60_000);
    return () => {
      off();
      window.removeEventListener('dime:chat-unread', told);
      window.clearInterval(timer);
    };
  }, []);
  return unread;
}

/**
 * The chats a person is in and the one that is open. Which one is open is the caller's to keep
 * (it is in the address), so a notification can open the very chat it is about.
 */
export default function Chat({ me, openId, onOpen }: { me: User; openId: number; onOpen: (id: number) => void }) {
  const [chats, setChats] = useState<ChatRoom[] | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const tellUnread = (n: number) => window.dispatchEvent(new CustomEvent('dime:chat-unread', { detail: n }));
  const load = useCallback(() => {
    api.chats().then(
      (l) => {
        setChats(l.chats);
        setError('');
      },
      (e) => setError((e as Error).message),
    );
  }, []);
  useEffect(() => {
    load();
    return onLive('chat', load);
  }, [load]);
  // On a wide screen a chat is always open beside the list: the one talked in last.
  useEffect(() => {
    if (!openId && chats && chats.length > 0 && window.matchMedia('(min-width: 801px)').matches) onOpen(chats[0].id);
  }, [openId, chats, onOpen]);

  return (
    <div className={`chat ${openId ? 'has-open' : ''}`}>
      <aside className="chat-list" aria-label="Your chats">
        <div className="chat-list-head">
          <strong>Chats</strong>
          <button type="button" className="btn small primary" onClick={() => setStarting(true)}>
            + New chat
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {chats === null ? (
          <p className="muted small chat-list-note">Loading…</p>
        ) : chats.length === 0 ? (
          <p className="muted small chat-list-note">No chats yet. Start one with "New chat".</p>
        ) : (
          <ul>
            {chats.map((c) => {
              const title = chatTitle(c, me.id);
              const last = c.last;
              return (
                <li key={c.id}>
                  <button type="button" className={`chat-row ${openId === c.id ? 'on' : ''} ${c.unread > 0 ? 'unread' : ''}`} aria-current={openId === c.id ? 'true' : undefined} onClick={() => onOpen(c.id)}>
                    <span className={`chat-avatar ${c.kind === 'team' ? 'team' : ''}`} aria-hidden="true">
                      {initials(title)}
                    </span>
                    <span className="chat-row-text">
                      <span className="chat-row-top">
                        <strong>{title}</strong>
                        {last && <span className="muted small">{when(last.at)}</span>}
                      </span>
                      <span className="chat-row-last muted small">
                        {last ? (last.kind === 'note' ? last.body : `${last.user_id === me.id ? 'You' : first(last.by)}: ${last.body}`) : c.kind === 'team' ? 'The whole team, in one chat' : 'Nothing said yet'}
                      </span>
                    </span>
                    {c.unread > 0 && !c.muted && (
                      <span className="nav-badge" title={`${c.unread} unread`}>
                        {c.unread > 9 ? '9+' : c.unread}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
      {openId ? (
        <Thread
          key={openId}
          id={openId}
          me={me}
          onBack={() => onOpen(0)}
          onRead={(n) => {
            tellUnread(n);
            setChats((list) => list && list.map((c) => (c.id === openId ? { ...c, unread: 0 } : c)));
          }}
          onGone={() => {
            onOpen(0);
            load();
          }}
        />
      ) : (
        <section className="chat-thread chat-none">
          <p className="muted">Pick a chat, or start a new one.</p>
        </section>
      )}
      {starting && (
        <NewChat
          onClose={() => setStarting(false)}
          onStarted={(id) => {
            setStarting(false);
            load();
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}
