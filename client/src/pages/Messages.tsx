import PageTitle from '../components/PageTitle';
import { useNavigate } from 'react-router-dom';
import type { CommunityNewsItem } from '../api';
import { useApp } from '../App';
import Inbox from '../components/Inbox';

/**
 * Everything sent to you, as an inbox: messages from other people, messages from the app itself
 * (added to a team, mentioned, something approved), and what is new in your communities. Unread
 * ones light up Messages in the menu until they are opened.
 */
export default function Messages() {
  const app = useApp();
  const navigate = useNavigate();
  /** Goes to what a message from the app or a community is about, when there is somewhere to go. */
  const go = (n: CommunityNewsItem) => {
    if (n.kind === 'notice') {
      // A shared link leads off the site, and opens beside it.
      if (/^https?:\/\//.test(n.link || '')) window.open(n.link, '_blank', 'noopener');
      else if (n.link) navigate(n.link);
    } else navigate(n.kind === 'invite' ? '/communities' : `/communities/${n.community_id}`);
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle>Messages</PageTitle>
          <p className="muted">Messages from the people you coach and work with, and what has happened that involves you.</p>
        </div>
      </div>
      <Inbox user={app.user} go={go} onUnread={app.setCommunityUnread} onUserChanged={app.reload} />
    </div>
  );
}
