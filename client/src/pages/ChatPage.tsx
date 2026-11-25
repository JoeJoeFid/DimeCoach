import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import { useApp } from '../App';
import Chat from '../components/Chat';

/** A coach's chats: the team's own, and the ones started with other people. The open one is in the address. */
export default function ChatPage() {
  const app = useApp();
  const navigate = useNavigate();
  const openId = Number(useParams().id) || 0;
  const onOpen = useCallback((id: number) => navigate(id ? `/chat/${id}` : '/chat', { replace: true }), [navigate]);
  return (
    <div className="page chat-page">
      <div className="page-head">
        <div>
          <PageTitle
            about={{
              lead: 'Talk with your team and with other coaches.',
              points: ['The team’s chat is there for everyone on it.', 'Start a chat of your own with one person or a few.'],
            }}
          >
            Chat
          </PageTitle>
        </div>
      </div>
      <Chat me={app.user} openId={openId} onOpen={onOpen} />
    </div>
  );
}
