import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Message, User } from '../../types/chat';
import { shouldGroupWithPrevious } from '../../utils/helpers';
import { useChatStore } from '../../store/chatStore';
import { useI18n } from '../../i18n';
import { apiFetch } from '../../services/api';
import type { MessageLinkPayload } from '../../store/chatStore/types';

interface Props {
  message: Message;
  previous?: Message;
  author?: User;
  isOwn: boolean;
}

const quickReactions = ['🟢', '⚡', '💾'];
const URL_PATTERN = /(https?:\/\/[^\s]+)/gi;
const IS_URL_PATTERN = /^https?:\/\/[^\s]+$/i;

type ParsedPart =
  | { type: 'text'; value: string }
  | { type: 'link'; url: string; internal: boolean; inviteCode?: string; messageId?: string };

type InvitePreviewPayload = {
  serverName?: string;
};

const inviteServerNameCache = new Map<string, string>();
const inviteUnavailableCache = new Set<string>();
const messageLinkPreviewCache = new Map<string, MessageLinkPayload>();
const messageLinkUnavailableCache = new Set<string>();

const parseLinkPart = (rawUrl: string): ParsedPart => {
  try {
    const parsed = new URL(rawUrl);
    const internal = parsed.origin === window.location.origin;

    const inviteFromQuery = parsed.searchParams.get('invite');
    if (inviteFromQuery) {
      return { type: 'link', url: rawUrl, internal, inviteCode: inviteFromQuery };
    }

    const inviteFromPath = parsed.pathname.match(/^\/invite\/([^/?#]+)/);
    if (inviteFromPath?.[1]) {
      return { type: 'link', url: rawUrl, internal, inviteCode: decodeURIComponent(inviteFromPath[1]) };
    }

    const messageId = parsed.searchParams.get('m');
    if (messageId) {
      return { type: 'link', url: rawUrl, internal, messageId };
    }

    return { type: 'link', url: rawUrl, internal: true };
  } catch {
    return { type: 'link', url: rawUrl, internal: false };
  }
};

const parseMessageContent = (text: string): ParsedPart[] =>
  text.split(URL_PATTERN).flatMap((part) => {
    if (!part) return [];
    if (!IS_URL_PATTERN.test(part)) {
      return [{ type: 'text', value: part }];
    }
    return [parseLinkPart(part)];
  });

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export const MessageItem = ({ message, previous, author, isOwn }: Props) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [mediaLoaded, setMediaLoaded] = useState(true);
  const [menu, setMenu] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
  const [menuStatus, setMenuStatus] = useState('');
  const [inviteServerNames, setInviteServerNames] = useState<Record<string, string>>({});
  const [messageLinkPreviews, setMessageLinkPreviews] = useState<Record<string, MessageLinkPayload>>({});
  const editMessage = useChatStore((state) => state.editMessage);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const toggleReaction = useChatStore((state) => state.toggleReaction);
  const resolveMessageLink = useChatStore((state) => state.resolveMessageLink);
  const openInviteDialog = useChatStore((state) => state.openInviteDialog);
  const setReplyTarget = useChatStore((state) => state.setReplyTarget);
  const chatMode = useChatStore((state) => state.chatMode);
  const servers = useChatStore((state) => state.servers);
  const channels = useChatStore((state) => state.channels);
  const currentServerId = useChatStore((state) => state.currentServerId);
  const currentChannelId = useChatStore((state) => state.currentChannelId);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const autoLoadMedia = useChatStore((state) => state.autoLoadMedia);
  const focusedMessageId = useChatStore((state) => state.focusedMessageId);
  const focusedMessageAnimated = useChatStore((state) => state.focusedMessageAnimated);
  const { t, formatTime, formatDayTime } = useI18n();
  const itemRef = useRef<HTMLElement | null>(null);

  const grouped = useMemo(() => shouldGroupWithPrevious(previous, message), [previous, message]);
  const isPendingUpload = Boolean(message.localOnly);
  const isFocused = focusedMessageId === message.id;
  const linkedParts = useMemo(() => parseMessageContent(message.content), [message.content]);
  const inviteCodes = useMemo(
    () =>
      [...new Set(linkedParts.flatMap((part) => (part.type === 'link' && part.inviteCode ? [part.inviteCode] : [])))].filter(
        (code) => !inviteUnavailableCache.has(code)
      ),
    [linkedParts]
  );
  const messageLinkIds = useMemo(
    () =>
      [...new Set(linkedParts.flatMap((part) => (part.type === 'link' && part.messageId ? [part.messageId] : [])))].filter(
        (messageId) => !messageLinkUnavailableCache.has(messageId)
      ),
    [linkedParts]
  );
  const serverNamesById = useMemo(
    () => new Map(servers.map((server) => [server.id, server.name])),
    [servers]
  );
  const channelNamesById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel.name])),
    [channels]
  );
  const missingQuickReactions = useMemo(
    () => quickReactions.filter((emoji) => !message.reactions.some((reaction) => reaction.emoji === emoji)),
    [message.reactions]
  );
  const currentServer = useMemo(
    () => servers.find((server) => server.id === currentServerId),
    [currentServerId, servers]
  );
  const currentChannel = useMemo(
    () => channels.find((channel) => channel.id === currentChannelId),
    [channels, currentChannelId]
  );
  const replyDisabledForCurrentContext = useMemo(() => {
    if (!currentServer || !currentChannel) return false;
    if (currentServer.name !== 'Adaptivity') return false;
    return currentChannel.type === 'text' && currentChannel.position === 0;
  }, [currentChannel, currentServer]);

  useEffect(() => {
    setDraft(message.content);
  }, [message.content]);

  useEffect(() => {
    setMediaLoaded(autoLoadMedia);
  }, [autoLoadMedia, message.id]);

  useEffect(() => {
    if (!isFocused || !itemRef.current) return;
    itemRef.current.scrollIntoView({ block: 'center', behavior: focusedMessageAnimated ? 'smooth' : 'auto' });
  }, [focusedMessageAnimated, isFocused]);

  useEffect(() => {
    if (!inviteCodes.length) return;

    const initial: Record<string, string> = {};
    inviteCodes.forEach((code) => {
      const cachedName = inviteServerNameCache.get(code);
      if (cachedName) {
        initial[code] = cachedName;
      }
    });
    if (Object.keys(initial).length > 0) {
      setInviteServerNames((prev) => ({ ...initial, ...prev }));
    }

    const missingCodes = inviteCodes.filter((code) => !inviteServerNameCache.has(code));
    if (missingCodes.length === 0) return;

    let cancelled = false;
    const loadPreviews = async () => {
      await Promise.all(
        missingCodes.map(async (code) => {
          try {
            const payload = await apiFetch<InvitePreviewPayload>(`/api/invites/${encodeURIComponent(code)}`);
            const serverName = String(payload.serverName || '').trim();
            if (!serverName) {
              inviteUnavailableCache.add(code);
              return;
            }
            inviteServerNameCache.set(code, serverName);
            if (!cancelled) {
              setInviteServerNames((prev) => ({ ...prev, [code]: serverName }));
            }
          } catch {
            inviteUnavailableCache.add(code);
          }
        })
      );
    };
    void loadPreviews();

    return () => {
      cancelled = true;
    };
  }, [inviteCodes]);

  useEffect(() => {
    if (!messageLinkIds.length) return;

    const initial: Record<string, MessageLinkPayload> = {};
    messageLinkIds.forEach((messageId) => {
      const cached = messageLinkPreviewCache.get(messageId);
      if (cached) {
        initial[messageId] = cached;
      }
    });
    if (Object.keys(initial).length > 0) {
      setMessageLinkPreviews((prev) => ({ ...initial, ...prev }));
    }

    const missing = messageLinkIds.filter((messageId) => !messageLinkPreviewCache.has(messageId));
    if (missing.length === 0) return;

    let cancelled = false;
    const loadPreviews = async () => {
      await Promise.all(
        missing.map(async (messageId) => {
          try {
            const payload = await apiFetch<MessageLinkPayload>(`/api/message-links/${encodeURIComponent(messageId)}`);
            messageLinkPreviewCache.set(messageId, payload);
            if (!cancelled) {
              setMessageLinkPreviews((prev) => ({ ...prev, [messageId]: payload }));
            }
          } catch {
            messageLinkUnavailableCache.add(messageId);
          }
        })
      );
    };
    void loadPreviews();

    return () => {
      cancelled = true;
    };
  }, [messageLinkIds]);

  useEffect(() => {
    if (!menu.open) return;
    const close = () => setMenu((prev) => ({ ...prev, open: false }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu.open]);

  const handleSave = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.content) {
      setEditing(false);
      return;
    }
    await editMessage(message.id, trimmed);
    setEditing(false);
  };

  const closeMenu = () => setMenu((prev) => ({ ...prev, open: false }));

  const copyMessageLink = async () => {
    if (chatMode === 'friend') return;
    const url = `${window.location.origin}/app/?m=${encodeURIComponent(message.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setMenuStatus(t('invite_copied'));
    } catch {
      setMenuStatus('Не удалось скопировать ссылку');
    }
    closeMenu();
  };

  const handleReply = () => {
    if (replyDisabledForCurrentContext) return;
    setReplyTarget(message.channelId, {
      id: message.id,
      username: author?.displayName || t('unknown_user'),
      content: message.content
    });
    closeMenu();
  };

  return (
    <article
      ref={itemRef}
      id={`message-${message.id}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ open: true, x: event.clientX, y: event.clientY });
        setMenuStatus('');
      }}
      className={`group rounded-lg border-l px-3 py-2 transition hover:bg-panel/50 ${
        grouped ? 'border-transparent' : 'border-borderGlow'
      } ${isFocused ? 'ring-1 ring-accent/80 bg-accent/5' : ''}`}
    >
      <div className="flex gap-3">
        <div className="w-10 shrink-0 pt-0.5">
          {!grouped && <div className="grid h-11 w-11 place-items-center rounded-full border border-borderGlow bg-panel text-xs">{author?.avatar ?? '?'}</div>}
        </div>

        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="mb-0.5 flex items-center gap-2">
              <span className="text-sm font-semibold text-text">{author?.displayName ?? t('unknown_user')}</span>
              <time className="text-[11px] text-textMuted" title={formatDayTime(message.createdAt)}>
                {formatTime(message.createdAt)}
              </time>
              {message.editedAt && <span className="text-[10px] uppercase text-textMuted/80">{t('edited')}</span>}
            </div>
          )}

          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSave();
                  if (event.key === 'Escape') setEditing(false);
                }}
                className="w-full rounded border border-accent/50 bg-panel px-2 py-1 text-sm text-text outline-none"
                autoFocus
              />
              <button type="button" onClick={() => void handleSave()} className="rounded border border-borderGlow px-2 py-1 text-xs hover:border-accent">
                {t('save')}
              </button>
            </div>
          ) : (
            <div>
              {message.replyTo && (
                <button
                  type="button"
                  onClick={() => void resolveMessageLink(message.replyTo?.id || '', { animateInCurrentChat: true })}
                  className="mb-1 inline-flex max-w-full items-center gap-1 rounded-md border border-borderGlow/60 bg-panel/70 px-2 py-0.5 text-xs text-textMuted hover:border-accent/60 hover:text-accent"
                >
                  <span className="truncate">↪ {message.replyTo.username}: {message.replyTo.content}</span>
                </button>
              )}
              {Boolean(message.content) && (
                <p className={`whitespace-pre-wrap break-words text-sm leading-6 ${message.deletedAt ? 'italic text-textMuted/60' : 'text-text'}`}>
                  {linkedParts.map((part, index) => {
                    if (part.type === 'text') {
                      return <span key={`text-${message.id}-${index}`}>{part.value}</span>;
                    }

                    if (part.inviteCode) {
                      const serverName = inviteServerNames[part.inviteCode] || inviteServerNameCache.get(part.inviteCode);
                      return (
                        <button
                          key={`invite-${message.id}-${index}`}
                          type="button"
                          onClick={() => openInviteDialog(part.inviteCode || '')}
                          className="mx-0.5 rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-left text-xs font-medium text-accent hover:border-accent/70"
                        >
                          {serverName ? t('invite_inline_server', { server: serverName }) : t('invite_inline_generic')}
                        </button>
                      );
                    }

                    if (part.messageId) {
                      const preview = messageLinkPreviews[part.messageId] || messageLinkPreviewCache.get(part.messageId);
                      if (preview?.kind === 'friend') {
                        return null;
                      }
                      if (!preview) {
                        return (
                          <span key={`message-link-raw-${message.id}-${index}`} className="text-textMuted/80">
                            {part.url}
                          </span>
                        );
                      }

                      const serverName =
                        preview.serverName ||
                        (preview.serverId ? serverNamesById.get(preview.serverId) : undefined) ||
                        t('server_unknown');
                      const channelName =
                        preview.channelName ||
                        (preview.channelId ? channelNamesById.get(preview.channelId) : undefined) ||
                        'channel';

                      return (
                        <button
                          key={`message-link-${message.id}-${index}`}
                          type="button"
                          onClick={() => void resolveMessageLink(part.messageId || '', { animateInCurrentChat: true })}
                          className="mx-0.5 rounded border border-borderGlow/50 bg-panel/70 px-2 py-0.5 text-xs text-textMuted hover:border-accent/60 hover:text-accent"
                        >
                          {`${serverName} > ${channelName} > 💬`}
                        </button>
                      );
                    }

                    return (
                      <a
                        key={`link-${message.id}-${index}`}
                        href={part.url}
                        className="underline decoration-accent/60 underline-offset-2 hover:text-accent"
                        target={part.internal ? '_self' : '_blank'}
                        rel="noreferrer"
                      >
                        {part.url}
                      </a>
                    );
                  })}
                </p>
              )}
              {message.media && (
                <div className="mt-2 max-w-[420px] rounded-lg border border-borderGlow/70 bg-panel/70 p-2">
                  {!mediaLoaded && !isPendingUpload ? (
                    <div className="space-y-2">
                      <p className="text-xs text-textMuted">Медиа скрыто. Размер: {formatBytes(message.media.sizeBytes)}</p>
                      <button
                        type="button"
                        onClick={() => setMediaLoaded(true)}
                        className="rounded-md border border-accent/60 bg-accent/10 px-3 py-1 text-xs uppercase tracking-[0.12em] text-accent"
                      >
                        Загрузить медиа
                      </button>
                    </div>
                  ) : (
                    <>
                      {message.media.mimeType.startsWith('image/') && (
                        <img src={message.media.url} alt={message.media.fileName} className="max-h-72 w-full rounded object-cover" loading="lazy" />
                      )}
                      {message.media.mimeType.startsWith('video/') && (
                        <video src={message.media.url} controls={!isPendingUpload} className="max-h-72 w-full rounded" preload={autoLoadMedia ? 'metadata' : 'none'} />
                      )}
                      {message.media.mimeType.startsWith('audio/') && (
                        <audio src={message.media.url} controls={!isPendingUpload} className="w-full" preload={autoLoadMedia ? 'metadata' : 'none'} />
                      )}
                    </>
                  )}
                </div>
              )}
              {isPendingUpload && (
                <div className="mt-2 max-w-[420px] rounded-lg border border-borderGlow/70 bg-panel/70 p-2">
                  <div className="flex items-center justify-between text-xs text-textMuted">
                    <span>
                      {message.uploadStatus === 'failed'
                        ? 'Ошибка отправки медиа'
                        : `Отправка: ${Math.max(0, Math.min(100, Math.round(message.uploadProgress || 0)))}%`}
                    </span>
                    <span>{message.media ? formatBytes(message.media.sizeBytes) : ''}</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded bg-borderGlow/50">
                    <div
                      className={`h-full transition-all ${message.uploadStatus === 'failed' ? 'bg-red-400/80' : 'bg-accent/80'}`}
                      style={{
                        width: `${Math.max(2, Math.min(100, Math.round(message.uploadProgress || 0)))}%`
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {!isPendingUpload && <div className="mt-1 flex flex-wrap gap-1.5">
            {message.reactions.map((reaction) => {
              const active = reaction.userIds.includes(currentUserId);
              return (
                <button
                  key={`${message.id}-${reaction.emoji}`}
                  type="button"
                  onClick={() => void toggleReaction(message.id, reaction.emoji)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    active ? 'border-accent bg-accent/15 text-accent' : 'border-borderGlow text-textMuted hover:border-accent/60'
                  }`}
                >
                  {reaction.emoji} {reaction.userIds.length}
                </button>
              );
            })}
            <div className="opacity-0 transition group-hover:opacity-100">
              {missingQuickReactions.map((emoji) => (
                <button
                  key={`${message.id}-quick-${emoji}`}
                  type="button"
                  onClick={() => void toggleReaction(message.id, emoji)}
                  className="mr-1 rounded border border-borderGlow px-1.5 py-0.5 text-[11px] text-textMuted hover:border-accent"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>}
          {menuStatus && <p className="mt-1 text-xs text-accent">{menuStatus}</p>}
        </div>

      </div>

      {menu.open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[120] w-56 rounded-lg border border-borderGlow bg-panel p-1.5 shadow-neon"
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {!replyDisabledForCurrentContext && (
            <button
              type="button"
              onClick={handleReply}
              className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-textMuted hover:border-borderGlow hover:bg-panelSoft hover:text-text"
            >
              Ответить
            </button>
          )}
          {isOwn && !message.deletedAt && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                closeMenu();
              }}
              className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-textMuted hover:border-borderGlow hover:bg-panelSoft hover:text-text"
            >
              {t('edit')}
            </button>
          )}
          {chatMode !== 'friend' && (
            <button
              type="button"
              onClick={() => void copyMessageLink()}
              className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-textMuted hover:border-borderGlow hover:bg-panelSoft hover:text-text"
            >
              Поделиться
            </button>
          )}
          {isOwn && !message.deletedAt && (
            <button
              type="button"
              onClick={() => {
                void deleteMessage(message.id);
                closeMenu();
              }}
              className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-red-300 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200"
            >
              {t('del')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMenuStatus('Жалобы: coming soon');
              closeMenu();
            }}
            className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-textMuted hover:border-borderGlow hover:bg-panelSoft hover:text-text"
          >
            Пожаловаться
          </button>
        </div>,
        document.body
      )}
    </article>
  );
};
