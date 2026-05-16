import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../store/chatStore';
import { EmojiPicker } from './EmojiPicker';
import { useI18n } from '../../i18n';
import type { Message } from '../../types/chat';

const typingDelayMs = 1200;

export function MessageComposer() {
  const currentChannelId = useChatStore((state) => state.currentChannelId);
  const currentServerId = useChatStore((state) => state.currentServerId);
  const currentServerRole = useChatStore((state) => state.currentServerRole);
  const channels = useChatStore((state) => state.channels);
  const servers = useChatStore((state) => state.servers);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const uploadMedia = useChatStore((state) => state.uploadMedia);
  const upsertMessage = useChatStore((state) => state.upsertMessage);
  const removeMessageById = useChatStore((state) => state.removeMessageById);
  const setTyping = useChatStore((state) => state.setTyping);
  const clearReplyTarget = useChatStore((state) => state.clearReplyTarget);
  const replyTarget = useChatStore((state) => (currentChannelId ? state.replyTargetByChannel[currentChannelId] : null));
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const disabled = !currentChannelId;

  const currentChannel = useMemo(() => channels.find((channel) => channel.id === currentChannelId), [channels, currentChannelId]);
  const currentServer = useMemo(() => servers.find((server) => server.id === currentServerId), [servers, currentServerId]);

  const isAdaptivityMainChannel = useMemo(() => {
    if (!currentChannel || !currentServer) return false;
    if (currentServer.name !== 'Adaptivity') return false;
    return currentChannel.type === 'text' && currentChannel.position === 0;
  }, [currentChannel, currentServer]);

  const isAdaptivityReadOnlyChannel = useMemo(() => {
    if (!isAdaptivityMainChannel) return false;
    return currentServerRole !== 'creator' && currentServerRole !== 'admin';
  }, [isAdaptivityMainChannel, currentServerRole]);

  const placeholder = useMemo(() => {
    if (!currentChannelId) return t('select_chat_first');
    if (isAdaptivityReadOnlyChannel) return 'Только администраторы могут писать в этом канале';
    return currentChannelId.startsWith('dm:') ? t('direct_message') : t('message_channel');
  }, [currentChannelId, isAdaptivityReadOnlyChannel, t]);

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

  useEffect(() => {
    if (!currentChannelId) return;
    if (!isAdaptivityMainChannel) return;
    if (!replyTarget) return;
    clearReplyTarget(currentChannelId);
  }, [clearReplyTarget, currentChannelId, isAdaptivityMainChannel, replyTarget]);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (disabled || isUploading || isAdaptivityReadOnlyChannel || !value.trim()) return;
    void sendMessage(value, undefined, isAdaptivityMainChannel ? null : replyTarget?.id || null);
    setValue('');
    setTyping({ channelId: currentChannelId, userId: currentUserId, isTyping: false });
  };

  const onSelectMedia = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled || isUploading || isAdaptivityReadOnlyChannel || !currentChannelId || !currentUserId) return;

    const previewUrl = URL.createObjectURL(file);
    const pendingMessageId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `upload:${crypto.randomUUID()}`
        : `upload:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const basePendingMessage: Message = {
      id: pendingMessageId,
      channelId: currentChannelId,
      authorId: currentUserId,
      content: value.trim(),
      media: {
        id: pendingMessageId,
        fileName: file.name || 'media.bin',
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        url: previewUrl
      },
      localOnly: true,
      uploadProgress: 0,
      uploadStatus: 'uploading',
      createdAt: Date.now(),
      reactions: []
    };

    try {
      setUploadError('');
      setIsUploading(true);
      upsertMessage(basePendingMessage);
      const uploaded = await uploadMedia(file, (progress) => {
        upsertMessage({
          ...basePendingMessage,
          uploadProgress: progress,
          uploadStatus: 'uploading'
        });
      });
      await sendMessage(value, uploaded.id, isAdaptivityMainChannel ? null : replyTarget?.id || null);
      removeMessageById(currentChannelId, pendingMessageId);
      URL.revokeObjectURL(previewUrl);
      setValue('');
      setTyping({ channelId: currentChannelId, userId: currentUserId, isTyping: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media upload failed';
      setUploadError(message);
      upsertMessage({
        ...basePendingMessage,
        uploadStatus: 'failed'
      });
    } finally {
      setIsUploading(false);
    }
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
      {replyTarget && !isAdaptivityMainChannel && (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-lg border border-borderGlow bg-panel/85 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-textMuted">Ответ на сообщение</p>
            <p className="truncate text-xs text-textMuted/90">{replyTarget.username}: {replyTarget.content}</p>
          </div>
          <button
            type="button"
            onClick={() => currentChannelId && clearReplyTarget(currentChannelId)}
            className="rounded-md border border-borderGlow px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-textMuted hover:border-accent hover:text-accent"
          >
            X
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-xl border border-borderGlow bg-panel/85 px-2 py-2 shadow-[0_0_0_1px_rgba(0,255,130,0.08)]">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            void onSelectMedia(event);
          }}
          accept="image/*,video/*,audio/*"
        />
        <button
          type="button"
          onClick={() => setShowPicker((prev) => !prev)}
          className="grid h-9 w-9 place-items-center rounded-md border border-borderGlow text-textMuted hover:border-accent hover:text-accent"
        >
          😀
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isUploading || isAdaptivityReadOnlyChannel}
          className="grid h-9 w-9 place-items-center rounded-md border border-borderGlow text-textMuted hover:border-accent hover:text-accent"
        >
          📎
        </button>

        <div className="relative flex-1">
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={disabled || isAdaptivityReadOnlyChannel}
            className="w-full bg-transparent px-2 py-2 pr-6 text-sm text-text outline-none placeholder:text-textMuted/70"
            placeholder={placeholder}
          />
          <span className="absolute right-2 top-1/2 h-4 w-[1px] -translate-y-1/2 bg-accent/80 animate-blink" />
        </div>

        <button
          type="submit"
          disabled={disabled || isUploading || isAdaptivityReadOnlyChannel}
          className="rounded-md border border-accent/60 bg-accent/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUploading ? 'upload...' : t('send')}
        </button>
      </form>
      {uploadError && <p className="mt-2 text-xs text-red-300">{uploadError}</p>}
    </div>
  );
}
