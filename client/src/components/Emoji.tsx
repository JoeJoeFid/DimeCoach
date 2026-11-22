// Emoji for the chat: the handful offered as a quick reaction, and a panel of the rest to pick from.
import { useEffect, useState } from 'react';

/** The reactions offered straight away when a bubble is pressed. */
export const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

const GROUPS: { key: string; label: string; icon: string; emoji: string }[] = [
  {
    key: 'faces',
    label: 'Faces',
    icon: '😀',
    emoji:
      '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 😶 😐 😑 😬 🙄 😯 😮 😲 🥱 😴 🤤 😵 🤐 🤢 🤮 🤧 😷 🤒 🤕 😈 👻 💀 🤡 💩 🙈 🙉 🙊',
  },
  {
    key: 'people',
    label: 'Hands and people',
    icon: '👍',
    emoji: '👍 👎 👏 🙌 👐 🤝 🙏 ✌️ 🤞 🤟 🤘 👌 🤏 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 👋 🤙 💪 ✊ 👊 🤛 🤜 👀 🧠 🗣️ 👤 👥 🤷 🤦 🙋 🙅 🙆 💁 🏃 🚶 🧍 👶 🧒 👦 👧 👨‍👩‍👧 👨‍👩‍👧‍👦',
  },
  {
    key: 'sports',
    label: 'Sports',
    icon: '🏀',
    emoji: '🏀 ⚽ 🏈 ⚾ 🥎 🎾 🏐 🏉 🥍 🏒 🏑 🏏 ⛳ 🏓 🏸 🥊 🥋 🤼 🤸 ⛹️ 🤾 🏋️ 🏊 🚴 🤽 🏌️ ⛸️ 🎿 🏂 🛹 🥅 🎽 👟 🧢 🏆 🥇 🥈 🥉 🏅 🎖️ 🎯 🚩 🏁 🏟️ 📋 📝 📊 📈 💦 🩹 🧊 🚌 🚗',
  },
  {
    key: 'symbols',
    label: 'Hearts and signs',
    icon: '❤️',
    emoji: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 ✅ ❌ ❓ ❗ ‼️ ⚠️ ⭐ 🌟 ✨ 🔥 💥 💫 🎉 🎊 🎈 🎁 👑 💤 💬 🔔 🔕 📣 📢 ⏰ ⏱️ 📅 📍 🆗 🆒 🔝',
  },
  {
    key: 'food',
    label: 'Food and drink',
    icon: '🍕',
    emoji: '🍎 🍌 🍊 🍇 🍓 🍉 🥕 🌽 🥪 🍕 🍔 🌭 🍟 🌮 🌯 🥗 🍝 🍗 🥓 🥚 🥞 🧇 🥨 🍩 🍪 🎂 🍰 🧁 🍦 🍫 🍬 🍿 🥜 💧 🥛 ☕ 🍵 🥤 🧃',
  },
  {
    key: 'nature',
    label: 'Weather and animals',
    icon: '☀️',
    emoji: '☀️ 🌤️ ⛅ ☁️ 🌧️ ⛈️ 🌩️ ❄️ ☃️ 🌬️ 🌈 🌙 ⚡ 🌊 🌡️ 🌳 🌲 🌴 🍀 🌸 🌻 🍁 🍂 🐶 🐱 🐻 🦁 🐯 🐺 🦊 🦅 🦈 🐝 🐢 🐎 🐂 🐐',
  },
  {
    key: 'things',
    label: 'Things and places',
    icon: '💡',
    emoji: '📱 💻 📷 🎥 📹 🎬 🎵 🎶 🎧 📚 ✏️ 📎 📌 🔗 🔒 🔑 💡 🛠️ 💰 💵 🧾 🎟️ 🏠 🏫 🏥 🚑 ✈️ 🗺️ ⏳ 🧳 👕 🧦 🧴 🧼',
  },
];

const RECENT_KEY = 'dime.emojiRecent';
function recent(): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(kept) ? kept.filter((e) => typeof e === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}
/** Keeps an emoji among the ones this person used last, on this device. */
export function rememberEmoji(emoji: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recent().filter((e) => e !== emoji)].slice(0, 24)));
  } catch {
    // Nowhere to keep it: the panel just has no "recent".
  }
}

const PICTURE = /\p{Extended_Pictographic}/gu;
/** Whether a line is nothing but one to three emoji, which is shown large and without a bubble. */
export function onlyEmoji(body: string) {
  const s = body.replace(/\s+/g, '');
  if (!s || s.length > 40 || !/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[‍️⃣\u{1f3fb}-\u{1f3ff}])+$/u.test(s)) return false;
  const count = (s.match(PICTURE)?.length ?? 0) - (s.match(/‍/g)?.length ?? 0) + (s.match(/\p{Regional_Indicator}/gu)?.length ?? 0) / 2;
  return count >= 1 && count <= 3;
}

/** The panel of emoji. It opens above the line to write on, the way a phone's keyboard does. */
export function EmojiPanel({ title, onPick, onClose }: { title: string; onPick: (emoji: string) => void; onClose: () => void }) {
  const [used] = useState(recent);
  const [tab, setTab] = useState(used.length > 0 ? 'recent' : GROUPS[0].key);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const shown = tab === 'recent' ? used : GROUPS.find((g) => g.key === tab)!.emoji.split(' ');
  return (
    <div className="emoji-panel" role="dialog" aria-label={title}>
      <div className="emoji-head">
        <div className="emoji-tabs" role="tablist" aria-label="Kinds of emoji">
          {used.length > 0 && (
            <button type="button" role="tab" aria-selected={tab === 'recent'} className={tab === 'recent' ? 'on' : ''} title="Used lately" aria-label="Used lately" onClick={() => setTab('recent')}>
              🕘
            </button>
          )}
          {GROUPS.map((g) => (
            <button key={g.key} type="button" role="tab" aria-selected={tab === g.key} className={tab === g.key ? 'on' : ''} title={g.label} aria-label={g.label} onClick={() => setTab(g.key)}>
              {g.icon}
            </button>
          ))}
        </div>
        <button type="button" className="btn ghost small emoji-close" onClick={onClose} aria-label="Close emoji">
          ✕
        </button>
      </div>
      <p className="emoji-title muted small">{title}</p>
      <div className="emoji-grid">
        {shown.map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
