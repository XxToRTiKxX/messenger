import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useChatStore } from '../../store/chatStore';
import { EmojiPicker } from './EmojiPicker';
import { useI18n } from '../../i18n';

const typingDelayMs = 1200;

export function MessageComposer() {
  const currentChannelId = useChatStore((state) => state.currentChannelId);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const setTyping = useChatStore((state) => state.setTyping);
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const disabled = !currentChannelId;

  const placeholder = useMemo(() => {
    if (!currentChannelId) return t('select_chat_first');
    return currentChannelId.startsWith('dm:') ? t('direct_message') : t('message_channel');
  }, [currentChannelId, t]);

  useEffect(() => {
    if (!currentChannelId || !currentUserId) return;

    if (!value.trim()) {
      setTyping({ channelId: currentChannelId, userId: currentUserId, isTyping: false });
      return;
    }

    setTyping({ channelId: currentChannelId, userId: currentUserId, isTyping: true });
    const timer = window.setTimeout(() => {
      setTyping({ channelId: currentChannelId, userId: currentUserId, isTyping: false });
    }, typingDelayMs);

    return () => window.clearTimeout(timer);
  }, [value, currentChannelId, currentUserId, setTyping]);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (disabled || !value.trim()) return;
    void sendMessage(value);
    setValue('');
    setTyping({ channelId: currentChannelId, userId: currentUserId, isTyping: false });
  };

  return (
    <div className="relative border-t border-borderGlow bg-panel/60 p-3 backdrop-blur-sm">
      <EmojiPicker
        open={showPicker}
        onSelect={(emoji) => {
          setValue((prev) => `${prev}${emoji}`);
          setShowPicker(false);
        }}
      />
      <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-xl border border-borderGlow bg-panel/85 px-2 py-2 shadow-[0_0_0_1px_rgba(0,255,130,0.08)]">
        <button
          type="button"
          onClick={() => setShowPicker((prev) => !prev)}
          className="grid h-9 w-9 place-items-center rounded-md border border-borderGlow text-textMuted hover:border-accent hover:text-accent"
        >
          😀
        </button>

        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-md border border-borderGlow text-textMuted hover:border-accent hover:text-accent"
        >
          📎
        </button>

        <div className="relative flex-1">
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={disabled}
            className="w-full bg-transparent px-2 py-2 pr-6 text-sm text-text outline-none placeholder:text-textMuted/70"
            placeholder={placeholder}
          />
          <span className="absolute right-2 top-1/2 h-4 w-[1px] -translate-y-1/2 bg-accent/80 animate-blink" />
        </div>

        <button
          type="submit"
          disabled={disabled}
          className="rounded-md border border-accent/60 bg-accent/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('send')}
        </button>
      </form>
    </div>
  );
}
