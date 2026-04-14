import { useChatStore } from '../../store/chatStore';
import { useI18n } from '../../i18n';

export function ChatHeader() {
  const chatMode = useChatStore((state) => state.chatMode);
  const currentServerRole = useChatStore((state) => state.currentServerRole);
  const activeFriendChatId = useChatStore((state) => state.activeFriendChatId);
  const friends = useChatStore((state) => state.friends);
  const { t } = useI18n();
  const channel = useChatStore((state) => state.channels.find((item) => item.id === state.currentChannelId));
  const title = chatMode === 'server'
    ? `# ${channel?.name ?? '--'}`
    : chatMode === 'friend'
      ? `@ ${friends.find((item) => item.userId === activeFriendChatId)?.username ?? t('chat_direct_fallback')}`
      : t('chat_friends');
  const subtitle = chatMode === 'server'
    ? t('chat_subtitle_server_role', { role: currentServerRole })
    : chatMode === 'friend'
      ? t('chat_subtitle_direct')
      : t('chat_subtitle_choose_friend');
  const modeLabel = chatMode === 'server' ? 'SERVER' : chatMode === 'friend' ? 'DM' : t('friends').toUpperCase();

  return (
    <header className="flex h-14 items-center justify-between border-b border-borderGlow bg-panel/70 px-4 backdrop-blur-sm">
      <div>
        <div className="text-base font-semibold text-text">{title}</div>
        <div className="text-xs text-textMuted">{subtitle}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-borderGlow px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-textMuted">{modeLabel}</span>
        <span className="text-xs uppercase tracking-wider text-textMuted">{t('secure_channel')}</span>
      </div>
    </header>
  );
}
