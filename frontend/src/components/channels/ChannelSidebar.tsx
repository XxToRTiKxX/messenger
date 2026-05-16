import { useState } from 'react';
import { useChatStore } from '../../store/chatStore';
import { useI18n } from '../../i18n';
import { ChannelSidebarFriends } from './ChannelSidebarFriends';
import { ChannelSidebarServers } from './ChannelSidebarServers';

export function ChannelSidebar() {
  const [username, setUsername] = useState('');
  const servers = useChatStore((state) => state.servers);
  const currentServerId = useChatStore((state) => state.currentServerId);
  const chatMode = useChatStore((state) => state.chatMode);
  const friends = useChatStore((state) => state.friends);
  const incoming = useChatStore((state) => state.incomingFriendRequests);
  const outgoing = useChatStore((state) => state.outgoingFriendRequests);
  const activeFriendChatId = useChatStore((state) => state.activeFriendChatId);
  const channels = useChatStore((state) => state.channels);
  const currentChannelId = useChatStore((state) => state.currentChannelId);
  const unreadByChannel = useChatStore((state) => state.unreadByChannel);
  const selectChannel = useChatStore((state) => state.selectChannel);
  const openFriendChat = useChatStore((state) => state.openFriendChat);
  const sendFriendRequest = useChatStore((state) => state.sendFriendRequest);
  const respondToFriendRequest = useChatStore((state) => state.respondToFriendRequest);
  const createChannel = useChatStore((state) => state.createChannel);
  const { t } = useI18n();

  const inServerMode = chatMode === 'server';
  const currentServerName = servers.find((server) => server.id === currentServerId)?.name ?? t('server_unknown');

  return (
    <aside className="h-full w-72 border-r border-borderGlow bg-panelSoft/90 p-4 backdrop-blur-sm">
      {!inServerMode && (
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-textMuted">{t('friends')}</h2>
        </div>
      )}

      <div className="space-y-4">
        {!inServerMode && (
          <ChannelSidebarFriends
            username={username}
            setUsername={setUsername}
            friends={friends}
            incoming={incoming}
            outgoing={outgoing}
            activeFriendChatId={activeFriendChatId}
            chatMode={chatMode}
            openFriendChat={openFriendChat}
            sendFriendRequest={sendFriendRequest}
            respondToFriendRequest={respondToFriendRequest}
          />
        )}

        {inServerMode && (
          <ChannelSidebarServers
            channels={channels}
            serverName={currentServerName}
            currentServerId={currentServerId}
            currentChannelId={currentChannelId}
            unreadByChannel={unreadByChannel}
            selectChannel={selectChannel}
            createChannel={createChannel}
          />
        )}
      </div>
    </aside>
  );
}
