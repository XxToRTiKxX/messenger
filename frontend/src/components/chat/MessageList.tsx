import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { Message } from '../../types/chat';
import { useChatStore } from '../../store/chatStore';
import { MessageItem } from './MessageItem';
import { useI18n } from '../../i18n';

const EMPTY_MESSAGES: Message[] = [];

const dayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

export function MessageList() {
  const chatMode = useChatStore((state) => state.chatMode);
  const users = useChatStore((state) => state.users);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const setAtBottom = useChatStore((state) => state.setAtBottom);
  const markRead = useChatStore((state) => state.markRead);
  const currentChannelId = useChatStore((state) => state.currentChannelId);
  const messages = useChatStore((state) => {
    const id = currentChannelId;
    if (!id) return EMPTY_MESSAGES;
    return state.messagesByChannel[id] ?? EMPTY_MESSAGES;
  });

  const unread = useChatStore((state) =>
    currentChannelId ? state.unreadByChannel[currentChannelId] ?? 0 : 0
  );

  const atBottom = useChatStore((state) =>
    currentChannelId ? state.atBottomByChannel[currentChannelId] ?? true : true
  );
  const { t, formatDayLabel } = useI18n();

  const parentRef = useRef<HTMLDivElement | null>(null);
  const byId = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  useEffect(() => {
    if (!currentChannelId) return;
    const element = parentRef.current;
    if (!element) return;

    element.scrollTop = element.scrollHeight;
    setAtBottom(currentChannelId, true);
    markRead(currentChannelId);
  }, [currentChannelId, markRead, setAtBottom]);

  useEffect(() => {
    if (!currentChannelId) return;
    const el = parentRef.current;
    if (!el) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [atBottom, currentChannelId, messages.length]);

  useEffect(() => {
    if (!currentChannelId) return;
    const element = parentRef.current;
    if (!element) return;

    const onScroll = () => {
      const el = parentRef.current;
      if (!el || !currentChannelId) return;

      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
      setAtBottom(currentChannelId, nearBottom);
      if (nearBottom) {
        markRead(currentChannelId);
      }
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [currentChannelId, markRead, setAtBottom]);

  if (!currentChannelId) {
    return (
      <div className="flex-1 px-4 py-3 text-sm text-textMuted">
        {chatMode === 'server' ? t('select_channel') : t('select_friend')}
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      {!atBottom && unread > 0 && (
        <button
          type="button"
          onClick={() => {
            const element = parentRef.current;
            if (element) {
              element.scrollTop = element.scrollHeight;
            }
            setAtBottom(currentChannelId, true);
            markRead(currentChannelId);
          }}
          className="absolute right-4 top-3 z-10 rounded-full border border-accent/50 bg-panel px-3 py-1 text-xs text-accent shadow-neon"
        >
          {t('unread_messages', { count: unread })}
        </button>
      )}

      <div ref={parentRef} className="h-full overflow-auto px-2 pb-2">
        {messages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center py-8 text-sm text-textMuted/80">
            {t('no_messages')}
          </div>
        ) : (
          <div className="space-y-1">
            {(() => {
              const elements: ReactNode[] = [];
              let previousMessage: Message | undefined;
              let previousDay = '';

              messages.forEach((message) => {
                const currentDay = dayKey(message.createdAt);
                if (currentDay !== previousDay) {
                  previousDay = currentDay;
                  elements.push(
                    <div key={`day-${currentDay}`} className="py-2 text-center text-xs uppercase tracking-[0.18em] text-textMuted/70">
                      {t('day_label', { day: formatDayLabel(message.createdAt) })}
                    </div>
                  );
                }

                elements.push(
                  <MessageItem
                    key={message.id}
                    message={message}
                    previous={previousMessage}
                    author={byId.get(message.authorId)}
                    isOwn={message.authorId === currentUserId}
                  />
                );
                previousMessage = message;
              });

              return elements;
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
