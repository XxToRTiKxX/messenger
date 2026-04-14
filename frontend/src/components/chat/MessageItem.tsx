import { useEffect, useMemo, useRef, useState } from 'react';
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

export const MessageItem = ({ message, previous, author, isOwn }: Props) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [inviteServerNames, setInviteServerNames] = useState<Record<string, string>>({});
  const [messageLinkPreviews, setMessageLinkPreviews] = useState<Record<string, MessageLinkPayload>>({});
  const editMessage = useChatStore((state) => state.editMessage);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const toggleReaction = useChatStore((state) => state.toggleReaction);
  const resolveMessageLink = useChatStore((state) => state.resolveMessageLink);
  const openInviteDialog = useChatStore((state) => state.openInviteDialog);
  const chatMode = useChatStore((state) => state.chatMode);
  const servers = useChatStore((state) => state.servers);
  const channels = useChatStore((state) => state.channels);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const focusedMessageId = useChatStore((state) => state.focusedMessageId);
  const focusedMessageAnimated = useChatStore((state) => state.focusedMessageAnimated);
  const { t, formatTime, formatDayTime } = useI18n();
  const itemRef = useRef<HTMLElement | null>(null);

  const grouped = useMemo(() => shouldGroupWithPrevious(previous, message), [previous, message]);
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

  useEffect(() => {
    setDraft(message.content);
  }, [message.content]);

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

  const handleSave = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.content) {
      setEditing(false);
      return;
    }
    await editMessage(message.id, trimmed);
    setEditing(false);
  };

  return (
    <article
      ref={itemRef}
      id={`message-${message.id}`}
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

          <div className="mt-1 flex flex-wrap gap-1.5">
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
          </div>
        </div>

        <div className="flex w-35 justify-end gap-1 rounded-md border border-borderGlow/40 bg-panel/80 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
          {chatMode !== 'friend' && (
            <button
              type="button"
              onClick={() => {
                const url = `${window.location.origin}/app/?m=${encodeURIComponent(message.id)}`;
                void navigator.clipboard.writeText(url);
              }}
              className="rounded px-1.5 py-0.5 text-[11px] text-textMuted hover:text-accent"
            >
              {t('link')}
            </button>
          )}
          {isOwn && !message.deletedAt && (
            <>
              <button
                type="button"
                onClick={() => setEditing((prev) => !prev)}
                className="rounded px-1.5 py-0.5 text-[11px] text-textMuted hover:text-accent"
              >
                {t('edit')}
              </button>
              <button
                type="button"
                onClick={() => void deleteMessage(message.id)}
                className="rounded px-1.5 py-0.5 text-[11px] text-red-300 hover:text-red-200"
              >
                {t('del')}
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
};
