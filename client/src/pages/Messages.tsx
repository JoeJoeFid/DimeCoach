import PageTitle from '../components/PageTitle';
import { useApp } from '../App';
import Inbox from '../components/Inbox';

/**
 * Everything sent to you, as an inbox: messages from other people, messages from the app itself
 * (added to a team, mentioned, something approved), and what is new in your communities. Unread
 * ones light up Messages in the menu until they are opened.
 */
export default function Messages() {
  const app = useApp();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle>Messages</PageTitle>
          <p className="muted">Messages from the people you coach and work with, and what has happened that involves you.</p>
        </div>
      </div>
      <Inbox user={app.user} onUnread={app.setCommunityUnread} onUserChanged={app.reload} />
    </div>
  );
}
