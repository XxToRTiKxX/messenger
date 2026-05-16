import { useEffect, useMemo, useRef } from 'react';
import { ChannelSidebar } from './components/channels/ChannelSidebar';
import { ChatHeader } from './components/chat/ChatHeader';
import { MessageComposer } from './components/chat/MessageComposer';
import { MessageList } from './components/chat/MessageList';
import { TypingIndicator } from './components/chat/TypingIndicator';
import { CrtOverlay } from './components/background/CrtOverlay';
import { MatrixRainCanvas } from './components/background/MatrixRainCanvas';
import { InviteDialog } from './components/invite/InviteDialog';
import { MemberSidebar } from './components/members/MemberSidebar';
import { ServerSidebar } from './components/servers/ServerSidebar';
import { DisplaySettings } from './components/settings/DisplaySettings';
import { useChatStore } from './store/chatStore';
import { mapDirectMessage, mapMessage } from './store/chatStore/helpers';
import type { ApiMessagePayload, DirectMessagePayload, ReactionTogglePayload } from './store/chatStore/types';
import { clamp } from './utils/helpers';
import { useI18n } from './i18n';
import { wsClient } from './services/wsClient';

function App() {
  const currentChannelId = useChatStore((state) => state.currentChannelId);
  const users = useChatStore((state) => state.users);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const loading = useChatStore((state) => state.loading);
  const error = useChatStore((state) => state.error);
  const bootstrap = useChatStore((state) => state.bootstrap);
  const resolveMessageLink = useChatStore((state) => state.resolveMessageLink);
  const clearError = useChatStore((state) => state.clearError);
  const refreshFriends = useChatStore((state) => state.refreshFriends);
  const upsertMessage = useChatStore((state) => state.upsertMessage);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const updateMessageReactions = useChatStore((state) => state.updateMessageReactions);
  const activeInviteCode = useChatStore((state) => state.activeInviteCode);
  const openInviteDialog = useChatStore((state) => state.openInviteDialog);
  const closeInviteDialogStore = useChatStore((state) => state.closeInviteDialog);
  //const typingSet = useChatStore((state) => state.typingByChannel[state.currentChannelId]);
  //const typingSet = useChatStore((state) => state.typingByChannel[currentChannelId]);
  const typingSet = useChatStore((state) => currentChannelId ? state.typingByChannel[currentChannelId] : undefined );
  const theme = useChatStore((state) => state.theme);
  const { t } = useI18n();

  const bootstrappedRef = useRef(false);
  const linkResolvedRef = useRef(false);

/*  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    void useChatStore.getState().bootstrap();
  }, []);*/

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    void useChatStore.getState().bootstrap();
  }, []);

  useEffect(() => {
    if (loading) return;
    if (linkResolvedRef.current) return;
    linkResolvedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const pendingInviteCode = params.get('invite');
    if (pendingInviteCode) {
      openInviteDialog(pendingInviteCode);
    }

    const messageId = params.get('m');
    if (!messageId) return;
    void resolveMessageLink(messageId);
  }, [loading, openInviteDialog, resolveMessageLink]);

  const closeInviteDialog = () => {
    closeInviteDialogStore();
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme.mode;
    document.documentElement.style.setProperty('--glow', clamp(theme.glowIntensity, 0.2, 1.4).toString());
  }, [theme]);

  useEffect(() => {
    const unsubscribe = wsClient.subscribe((payload) => {
      if (!payload || typeof payload !== 'object') return;
      const typed = payload as { type?: string };
      if (!typed.type) return;

      if (typed.type === 'new_message') {
        const messagePayload = (payload as { message?: ApiMessagePayload }).message;
        if (!messagePayload) return;
        upsertMessage(mapMessage(messagePayload));
        return;
      }

      if (typed.type === 'message_updated' || typed.type === 'message_deleted') {
        const messagePayload = (payload as { message?: ApiMessagePayload }).message;
        if (!messagePayload) return;
        updateMessage(mapMessage(messagePayload));
        return;
      }

      if (typed.type === 'message_reactions_updated') {
        const reactionPayload = payload as unknown as { channelId?: string; messageId?: string } & ReactionTogglePayload;
        if (!reactionPayload.channelId || !reactionPayload.messageId) return;
        updateMessageReactions(reactionPayload.channelId, reactionPayload.messageId, reactionPayload.reactions ?? []);
        return;
      }

      if (typed.type === 'direct_message_new') {
        const messagePayload = (payload as { message?: DirectMessagePayload }).message;
        if (!messagePayload || !currentUserId) return;
        const friendUserId = messagePayload.senderId === currentUserId ? messagePayload.recipientId : messagePayload.senderId;
        upsertMessage(mapDirectMessage(messagePayload, friendUserId));
        return;
      }

      if (typed.type === 'direct_message_updated' || typed.type === 'direct_message_deleted') {
        const messagePayload = (payload as { message?: DirectMessagePayload }).message;
        if (!messagePayload || !currentUserId) return;
        const friendUserId = messagePayload.senderId === currentUserId ? messagePayload.recipientId : messagePayload.senderId;
        updateMessage(mapDirectMessage(messagePayload, friendUserId));
        return;
      }

      if (typed.type === 'direct_message_reactions_updated') {
        const reactionPayload = payload as {
          messageId?: string;
          senderId?: string;
          recipientId?: string;
          reactions?: ReactionTogglePayload['reactions'];
        };
        if (!reactionPayload.messageId || !reactionPayload.senderId || !reactionPayload.recipientId || !currentUserId) return;
        const friendUserId = reactionPayload.senderId === currentUserId ? reactionPayload.recipientId : reactionPayload.senderId;
        updateMessageReactions(`dm:${friendUserId}`, reactionPayload.messageId, reactionPayload.reactions ?? []);
        return;
      }

      if (typed.type === 'friends_updated') {
        void refreshFriends();
      }
    });

    void wsClient.connect().catch(() => {
      // apiFetch will retry through websocket RPC.
    });

    return () => {
      unsubscribe();
    };
  }, [currentUserId, refreshFriends, updateMessage, updateMessageReactions, upsertMessage]);
  const typingNames = useMemo(() => {
    if (!typingSet || !users.length) return [];

    return [...typingSet]
      .filter((id) => id !== currentUserId)
      .map((id) => users.find((u) => u.id === id)?.displayName)
      .filter(Boolean) as string[];
  }, [typingSet, users, currentUserId]);

  const connectedServerUsers = useMemo(
    () => users.filter((user) => user.presence !== 'offline').length,
    [users]
  );
  const backgroundMode = useMemo(() => theme.backgroundFxMode, [theme.backgroundFxMode]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg font-mono text-text">
      <MatrixRainCanvas enabled={theme.backgroundFxEnabled} mode={backgroundMode} activeNodes={connectedServerUsers} />
      <CrtOverlay enabled={theme.crt} />
      <div className="relative z-10 flex h-screen">
        <ServerSidebar />
        <ChannelSidebar />
        <main className="flex min-w-0 flex-1 flex-col bg-[linear-gradient(to_bottom,rgba(0,255,130,0.03),transparent_30%)]">
          <ChatHeader />
          {loading && <div className="border-b border-borderGlow px-4 py-2 text-xs text-textMuted">{t('app_loading')}</div>}
          {error && !loading && (
            <button
              type="button"
              onClick={() => {
                clearError();
                void bootstrap();
              }}
              className="border-b border-red-500/30 px-4 py-2 text-left text-xs text-red-300 hover:bg-red-500/5"
            >
              {error} {t('app_retry')}
            </button>
          )}
          <MessageList />
          <TypingIndicator names={typingNames} />
          <MessageComposer />
        </main>
        <MemberSidebar />
      </div>
      <DisplaySettings />
      {activeInviteCode && <InviteDialog inviteCode={activeInviteCode} onClose={closeInviteDialog} />}
    </div>
  );
}

export default App;
