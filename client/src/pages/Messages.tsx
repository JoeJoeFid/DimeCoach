import PageTitle from '../components/PageTitle';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type CommunityNews, type CommunityNewsItem } from '../api';
import { useApp } from '../App';

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

/**
 * Everything sent to you: messages from the app itself (added to a team, something approved), and
 * what is new in your communities. Unread ones light up Messages in the menu until they are opened.
 */
export default function Messages() {
  const app = useApp();
  const navigate = useNavigate();
  const [news, setNews] = useState<CommunityNews | null>(null);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(20);
  /** Takes a fresh answer about what is new, and passes the count on to the menu. */
  const got = useCallback((n: CommunityNews) => {
    setNews(n);
    app.setCommunityUnread(n.unread);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const failed = (e: unknown) => setError((e as Error).message);
  useEffect(() => {
    api.messages().then(got, failed);
  }, [got]);

  /** Opening a message reads it, and goes to what it is about when there is somewhere to go. */
  const open = (n: CommunityNewsItem) => {
    if (n.kind === 'notice') {
      if (n.unread && n.id) api.markMessagesRead(n.id).then(got, failed);
      if (n.link) navigate(n.link);
    } else navigate(n.kind === 'invite' ? '/communities' : `/communities/${n.community_id}`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle>Messages</PageTitle>
          <p className="muted">What has happened that involves you: teams you were added to, and what is new in your communities.</p>
        </div>
        <div className="head-actions">
          {news && news.items.some((i) => i.unread && i.kind !== 'invite') && (
            <button className="btn" onClick={() => api.markMessagesRead().then(got, failed)}>
              Mark all as read
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card news">
        {news === null ? (
          <p className="muted small">Loading…</p>
        ) : news.items.length === 0 ? (
          <p className="muted small">No messages yet. You will get one when someone adds you to a team, invites you to a community, writes there or shares something.</p>
        ) : (
          <ul className="news-list">
            {news.items.slice(0, shown).map((n) => (
              <li key={n.key} className={n.unread ? 'unread' : ''}>
                <button type="button" className="news-item" onClick={() => open(n)}>
                  <span className={`news-dot ${n.unread ? 'on' : ''}`} aria-hidden="true" />
                  <span className="news-main">
                    <span className="news-line">
                      {n.kind === 'notice' ? (
                        <strong>{n.title}</strong>
                      ) : (
                        <>
                          <strong>{n.by}</strong> {newsVerb(n)} <strong>{n.community}</strong>
                        </>
                      )}
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
        {news && news.items.length > shown && (
          <button className="link small" onClick={() => setShown(news.items.length)}>
            Show {news.items.length - shown} older
          </button>
        )}
      </div>
    </div>
  );
}
