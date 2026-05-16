import { create } from 'zustand';
import type { Message, User } from '../types/chat';
import { generateId } from '../utils/helpers';
import { apiFetch, uploadMediaBinary } from '../services/api';
import {
  channelMessageUpsert,
  dmChannelId,
  loadBootstrapPayload,
  makeAvatar,
  mapChannel,
  mapDirectMessage,
  mapMessage,
  mapServer,
  normalizeReactions,
  parseChannelPayload,
  readInitialAutoLoadMedia,
  readInitialLocale,
  readInitialTheme,
  upsertUsers,
  writeAutoLoadMedia,
  writeThemeToCookie
} from './chatStore/helpers';
import type {
  ApiMessagePayload,
  ChannelListPayload,
  ChannelPayload,
  ChatState,
  DirectMessagePayload,
  FriendPayload,
  MessageLinkPayload,
  ResolveMessageLinkOptions,
  ReactionTogglePayload,
  ServerPayload
} from './chatStore/types';

const SERVER_CUSTOMIZATION_KEY = 'ui.serverCustomizations.v1';

type ServerCustomization = {
  name?: string;
  iconUrl?: string;
};

const readServerCustomizations = (): Record<string, ServerCustomization> => {
  try {
    const raw = window.localStorage.getItem(SERVER_CUSTOMIZATION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ServerCustomization>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
};

const writeServerCustomizations = (value: Record<string, ServerCustomization>): void => {
  window.localStorage.setItem(SERVER_CUSTOMIZATION_KEY, JSON.stringify(value));
};

const applyServerCustomizations = (servers: ReturnType<typeof mapServer>[]): ReturnType<typeof mapServer>[] => {
  const overrides = readServerCustomizations();
  return servers.map((server) => {
    const override = overrides[server.id];
    if (!override) return server;
    const nextName = String(override.name || server.name).trim() || server.name;
    const nextIconUrl = String(override.iconUrl || '').trim() || server.iconUrl;
    return {
      ...server,
      name: nextName,
      icon: makeAvatar(nextName),
      iconUrl: nextIconUrl
    };
  });
};

export const useChatStore = create<ChatState>((set, get) => ({
  profile: null,
  servers: [],
  channels: [],
  channelsByServer: {},
  users: [],
  currentServerId: '',
  currentChannelId: '',
  currentUserId: '',
  currentServerRole: 'member',
  currentServerRoleLabels: ['member'],
  chatMode: 'server',
  activeFriendChatId: null,
  friends: [],
  incomingFriendRequests: [],
  outgoingFriendRequests: [],
  messagesByChannel: {},
  unreadByChannel: {},
  typingByChannel: {},
  atBottomByChannel: {},
  historyLimitReached: {},
  channelParticipantsByChannel: {},
  focusedMessageId: null,
  focusedMessageAnimated: false,
  activeInviteCode: null,
  locale: readInitialLocale(),
  theme: readInitialTheme(),
  showSettings: false,
  autoLoadMedia: readInitialAutoLoadMedia(),
  replyTargetByChannel: {},
  loading: true,
  error: null,

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const { profile, friendsPayload, serverPayload } = await loadBootstrapPayload();

      const servers = applyServerCustomizations(serverPayload.map(mapServer));
      if (servers.length === 0) {
        throw new Error('API не вернуло ни одного сервера для инициализации');
      }
      const currentServerId = servers[0]?.id ?? '';

      const initialUsers: User[] = [
        {
          id: profile.userId,
          displayName: profile.username,
          email: profile.email,
          avatar: makeAvatar(profile.username),
          presence: 'online'
        },
        ...friendsPayload.friends.map<User>((friend) => ({
          id: friend.userId,
          displayName: friend.username,
          email: friend.email,
          avatar: makeAvatar(friend.username),
          presence: 'online'
        }))
      ];

      set({
        profile,
        currentUserId: profile.userId,
        users: upsertUsers([], initialUsers),
        friends: friendsPayload.friends,
        incomingFriendRequests: friendsPayload.incoming,
        outgoingFriendRequests: friendsPayload.outgoing,
        servers,
        currentServerId,
        chatMode: 'server',
        activeFriendChatId: null
      });

      if (!currentServerId) {
        set({ loading: false });
        return;
      }

      const channelRaw = await apiFetch<unknown>(`/api/servers/${encodeURIComponent(currentServerId)}/channels`);
      const channelPayload = parseChannelPayload(channelRaw);
      const channels = channelPayload.channels.map(mapChannel);
      if (channels.length === 0) {
        throw new Error('API не вернуло каналы выбранного сервера');
      }
      const currentChannelId = channels[0]?.id ?? '';
      const channelsByServer = {
        ...get().channelsByServer,
        [currentServerId]: channels
      };

      set({
        currentServerRole: channelPayload.serverRole,
        currentServerRoleLabels: channelPayload.roleLabels || [channelPayload.serverRole],
        channelsByServer,
        channels: Object.values(channelsByServer).flat(),
        currentChannelId
      });

      if (currentChannelId) {
        await get().selectChannel(currentChannelId);
      }

      set({ loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize app';
      set({ loading: false, error: message });
    }
  },

  openFriendsHub: () => {
    set({
      chatMode: 'friends',
      activeFriendChatId: null,
      currentChannelId: '',
      error: null
    });
  },

  selectServer: async (serverId) => {
    if (!serverId) return;

    const state = get();
    set({ currentServerId: serverId, chatMode: 'server', activeFriendChatId: null, error: null });

    try {
      let channels = state.channelsByServer[serverId] ?? [];
      let serverRole = state.currentServerRole;
      let roleLabels = state.currentServerRoleLabels;

      if (channels.length === 0) {
        const payload = await apiFetch<ChannelListPayload>(`/api/servers/${encodeURIComponent(serverId)}/channels`);
        channels = payload.channels.map(mapChannel);
        serverRole = payload.serverRole;
        roleLabels = payload.roleLabels || [payload.serverRole];

        const channelsByServer = {
          ...get().channelsByServer,
          [serverId]: channels
        };

        set({
          channelsByServer,
          channels: Object.values(channelsByServer).flat(),
          currentServerRole: serverRole,
          currentServerRoleLabels: roleLabels
        });
      }

      const channelId = channels[0]?.id ?? '';
      set({ currentChannelId: channelId });

      if (channelId) {
        await get().selectChannel(channelId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to switch server';
      set({ error: message });
    }
  },

  selectChannel: async (channelId) => {
    const state = get();
    if (!channelId || !state.currentServerId) return;
    // 💥 защита от повторного вызова
    if (state.currentChannelId === channelId && state.messagesByChannel[channelId]) {
      return;
    }
    set({ currentChannelId: channelId, chatMode: 'server', activeFriendChatId: null, error: null });

    try {
      const response = await apiFetch<ApiMessagePayload[]>(
        `/api/messages?serverId=${encodeURIComponent(state.currentServerId)}&channelId=${encodeURIComponent(channelId)}`
      );

      const mappedMessages = response.map(mapMessage);
      const participantPayload = await apiFetch<{
        participants: Array<{ id: string; username: string; email?: string; role?: string; hasChannelRole?: boolean }>;
      }>(`/api/channels/${encodeURIComponent(channelId)}/participants`);

      const participantUsers: User[] = participantPayload.participants.map((participant) => ({
        id: participant.id,
        displayName: participant.username,
        email: participant.email,
        avatar: makeAvatar(participant.username),
        presence: 'online',
        role: participant.role || 'member',
        hasChannelRole: Boolean(participant.hasChannelRole)
      }));

      const authorUsers: User[] = response.map((item) => ({
        id: item.userId,
        displayName: item.username,
        avatar: makeAvatar(item.username),
        presence: 'online'
      }));

      set({
        users: upsertUsers(get().users, [...participantUsers, ...authorUsers]),
        messagesByChannel: {
          ...get().messagesByChannel,
          [channelId]: mappedMessages
        },
        historyLimitReached: {
          ...get().historyLimitReached,
          [channelId]: true
        },
        unreadByChannel: {
          ...get().unreadByChannel,
          [channelId]: 0
        },
        atBottomByChannel: {
          ...get().atBottomByChannel,
          [channelId]: true
        },
        channelParticipantsByChannel: {
          ...get().channelParticipantsByChannel,
          [channelId]: participantPayload.participants.map((participant) => participant.id)
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load channel messages';
      set({ error: message });
    }
  },

  openFriendChat: async (friendUserId) => {
    const friend = get().friends.find((entry) => entry.userId === friendUserId);
    if (!friend) return;

    const channelId = dmChannelId(friendUserId);
    set({
      chatMode: 'friend',
      activeFriendChatId: friendUserId,
      currentChannelId: channelId,
      error: null,
      users: upsertUsers(get().users, [
        {
          id: friend.userId,
          displayName: friend.username,
          email: friend.email,
          avatar: makeAvatar(friend.username),
          presence: 'online'
        }
      ])
    });

    try {
      const response = await apiFetch<DirectMessagePayload[]>(`/api/friends/${encodeURIComponent(friendUserId)}/messages`);
      const mappedMessages = response.map((item) => mapDirectMessage(item, friendUserId));

      set({
        messagesByChannel: {
          ...get().messagesByChannel,
          [channelId]: mappedMessages
        },
        historyLimitReached: {
          ...get().historyLimitReached,
          [channelId]: true
        },
        unreadByChannel: {
          ...get().unreadByChannel,
          [channelId]: 0
        },
        atBottomByChannel: {
          ...get().atBottomByChannel,
          [channelId]: true
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load direct messages';
      set({ error: message });
    }
  },

  sendMessage: async (content, mediaId, replyToMessageId) => {
    const trimmed = content.trim();
    if (!trimmed && !mediaId) return;

    const state = get();
    set({ error: null });

    try {
      if (state.chatMode === 'friend') {
        if (!state.activeFriendChatId) return;

        const response = await apiFetch<{ message: DirectMessagePayload }>(
          `/api/friends/${encodeURIComponent(state.activeFriendChatId)}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: trimmed,
              mediaId: mediaId || null
            })
          }
        );

        const channelId = dmChannelId(state.activeFriendChatId);
        const message = mapDirectMessage(response.message, state.activeFriendChatId);
        get().upsertMessage({ ...message, channelId });
        get().clearReplyTarget(channelId);
        return;
      }

      if (!state.currentServerId || !state.currentChannelId) return;

      const response = await apiFetch<{ message: ApiMessagePayload }>('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: state.currentServerId,
          channelId: state.currentChannelId,
          content: trimmed,
          mediaId: mediaId || null,
          replyToMessageId: replyToMessageId || null
        })
      });

      const message = mapMessage(response.message);
      const authorUser: User = {
        id: response.message.userId,
        displayName: response.message.username,
        avatar: makeAvatar(response.message.username),
        presence: 'online'
      };

      set({
        users: upsertUsers(get().users, [authorUser])
      });
      get().upsertMessage(message);
      get().clearReplyTarget(state.currentChannelId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      set({ error: message });
    }
  },

  uploadMedia: async (file, onProgress) => {
    if (!file) {
      throw new Error('Media file required');
    }
    if (file.size <= 0) {
      throw new Error('Empty media file');
    }
    const maxBytes = 1610612736;
    if (file.size > maxBytes) {
      throw new Error('Максимальный размер файла: 1.5 GB');
    }

    const state = get();
    if (state.chatMode === 'friend') {
      if (!state.activeFriendChatId) {
        throw new Error('Выберите личный чат для загрузки медиа');
      }
      const payload = await uploadMediaBinary(file, {
        mode: 'dm',
        friendUserId: state.activeFriendChatId
      }, onProgress);
      return payload;
    }

    if (!state.currentServerId || !state.currentChannelId) {
      throw new Error('Выберите канал перед загрузкой медиа');
    }

    const payload = await uploadMediaBinary(file, {
      mode: 'server',
      serverId: state.currentServerId,
      channelId: state.currentChannelId
    }, onProgress);
    return payload;
  },

  createServer: async (name, iconUrl) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      const created = await apiFetch<ServerPayload>('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, iconUrl: iconUrl || null })
      });

      const server = mapServer(created);
      set({
        servers: [...get().servers, server]
      });
      await get().selectServer(server.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create server';
      set({ error: message });
    }
  },

  createChannel: async (name, type = 'text', categoryName = 'Общие') => {
    const trimmed = name.trim();
    const state = get();
    if (!trimmed || !state.currentServerId) return;

    try {
      await apiFetch<ChannelPayload>(`/api/servers/${encodeURIComponent(state.currentServerId)}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          type: type === 'voice' ? 'voice' : 'text',
          categoryName
        })
      });

      const payload = await apiFetch<ChannelListPayload>(`/api/servers/${encodeURIComponent(state.currentServerId)}/channels`);
      const channels = payload.channels.map(mapChannel);
      const channelsByServer = {
        ...get().channelsByServer,
        [state.currentServerId]: channels
      };

      set({
        currentServerRole: payload.serverRole,
        currentServerRoleLabels: payload.roleLabels || [payload.serverRole],
        channelsByServer,
        channels: Object.values(channelsByServer).flat()
      });

      const lastChannel = channels[channels.length - 1];
      if (lastChannel) {
        await get().selectChannel(lastChannel.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create channel';
      set({ error: message });
    }
  },

  updateServerLocal: (serverId, patch) => {
    const id = String(serverId || '').trim();
    if (!id) return;
    const namePatch = typeof patch.name === 'string' ? patch.name.trim() : undefined;
    const iconUrlPatch = typeof patch.iconUrl === 'string' ? patch.iconUrl.trim() : undefined;
    set((state) => {
      const nextServers = state.servers.map((server) => {
        if (server.id !== id) return server;
        const nextName = namePatch || server.name;
        return {
          ...server,
          name: nextName,
          icon: makeAvatar(nextName),
          iconUrl: iconUrlPatch || server.iconUrl
        };
      });
      const stored = readServerCustomizations();
      const current = stored[id] || {};
      stored[id] = {
        ...current,
        ...(namePatch ? { name: namePatch } : {}),
        ...(iconUrlPatch ? { iconUrl: iconUrlPatch } : {})
      };
      writeServerCustomizations(stored);
      return { servers: nextServers };
    });
  },

  sendFriendRequest: async (username) => {
    const trimmed = username.trim();
    if (!trimmed) return;

    try {
      await apiFetch<{ success: boolean }>('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed })
      });
      await get().refreshFriends();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send friend request';
      set({ error: message });
    }
  },

  respondToFriendRequest: async (friendshipId, action) => {
    if (!friendshipId) return;

    try {
      await apiFetch<{ success: boolean }>(`/api/friends/${encodeURIComponent(friendshipId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      await get().refreshFriends();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process friend request';
      set({ error: message });
    }
  },

  refreshFriends: async () => {
    try {
      const payload = await apiFetch<FriendPayload>('/api/friends');
      const friendUsers: User[] = payload.friends.map((friend) => ({
        id: friend.userId,
        displayName: friend.username,
        email: friend.email,
        avatar: makeAvatar(friend.username),
        presence: 'online'
      }));

      set({
        friends: payload.friends,
        incomingFriendRequests: payload.incoming,
        outgoingFriendRequests: payload.outgoing,
        users: upsertUsers(get().users, friendUsers)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load friends';
      set({ error: message });
    }
  },

  setChannelParticipantRole: async (userId, role) => {
    const state = get();
    if (!userId || !role || !state.currentChannelId || state.chatMode !== 'server') return;

    try {
      await apiFetch<{ success: boolean; role: string }>(
        `/api/channels/${encodeURIComponent(state.currentChannelId)}/participants/${encodeURIComponent(userId)}/role`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role })
        }
      );

      set({
        users: state.users.map((user) =>
          user.id === userId
            ? {
                ...user,
                role,
                hasChannelRole: true
              }
            : user
        )
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update participant role';
      set({ error: message });
    }
  },

  receiveMessage: (message) => {
    get().upsertMessage(message);
  },

  upsertMessage: (message) => {
    const state = get();
    const existing = state.messagesByChannel[message.channelId]?.some((item) => item.id === message.id) ?? false;
    const isCurrent = state.currentChannelId === message.channelId;
    const atBottom = state.atBottomByChannel[message.channelId] ?? true;
    const shouldIncreaseUnread = !existing && !isCurrent && message.authorId !== state.currentUserId;

    set({
      messagesByChannel: channelMessageUpsert(state.messagesByChannel, message.channelId, (messages) =>
        existing ? messages.map((item) => (item.id === message.id ? { ...item, ...message } : item)) : [...messages, message]
      ),
      unreadByChannel: shouldIncreaseUnread
        ? {
            ...state.unreadByChannel,
            [message.channelId]: (state.unreadByChannel[message.channelId] ?? 0) + 1
          }
        : {
            ...state.unreadByChannel,
            [message.channelId]: isCurrent && atBottom ? 0 : state.unreadByChannel[message.channelId] ?? 0
          }
    });
  },

  removeMessageById: (channelId, messageId) => {
    if (!channelId || !messageId) return;
    const state = get();
    set({
      messagesByChannel: channelMessageUpsert(state.messagesByChannel, channelId, (messages) =>
        messages.filter((message) => message.id !== messageId)
      )
    });
  },

  updateMessage: (message) => {
    const state = get();
    set({
      messagesByChannel: channelMessageUpsert(state.messagesByChannel, message.channelId, (messages) => {
        const hasTarget = messages.some((item) => item.id === message.id);
        if (!hasTarget) return messages;
        return messages.map((item) => (item.id === message.id ? { ...item, ...message } : item));
      })
    });
  },

  updateMessageReactions: (channelId, messageId, reactions) => {
    const state = get();
    set({
      messagesByChannel: channelMessageUpsert(state.messagesByChannel, channelId, (messages) =>
        messages.map((message) => (message.id === messageId ? { ...message, reactions: normalizeReactions(reactions) } : message))
      )
    });
  },

  editMessage: async (messageId, content) => {
    const state = get();
    const channelId = state.currentChannelId;
    if (!channelId) return;

    const trimmed = content.trim();
    if (!trimmed) return;

    try {
      if (state.chatMode === 'friend') {
        if (!state.activeFriendChatId) return;
        const response = await apiFetch<{ message: DirectMessagePayload }>(
          `/api/friends/${encodeURIComponent(state.activeFriendChatId)}/messages/${encodeURIComponent(messageId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: trimmed })
          }
        );

        const mapped = mapDirectMessage(response.message, state.activeFriendChatId);
        set({
          messagesByChannel: channelMessageUpsert(get().messagesByChannel, channelId, (messages) =>
            messages.map((message) => (message.id === messageId ? { ...message, ...mapped } : message))
          )
        });
        return;
      }

      const response = await apiFetch<{ message: ApiMessagePayload }>(
        `/api/messages/${encodeURIComponent(messageId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed })
        }
      );
      const mapped = mapMessage(response.message);

      set({
        messagesByChannel: channelMessageUpsert(get().messagesByChannel, channelId, (messages) =>
          messages.map((message) => (message.id === messageId ? { ...message, ...mapped } : message))
        )
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to edit message';
      set({ error: message });
    }
  },

  deleteMessage: async (messageId) => {
    const state = get();
    const channelId = state.currentChannelId;
    if (!channelId) return;

    try {
      if (state.chatMode === 'friend') {
        if (!state.activeFriendChatId) return;
        const response = await apiFetch<{ message: DirectMessagePayload }>(
          `/api/friends/${encodeURIComponent(state.activeFriendChatId)}/messages/${encodeURIComponent(messageId)}`,
          {
            method: 'DELETE'
          }
        );
        const mapped = mapDirectMessage(response.message, state.activeFriendChatId);
        set({
          messagesByChannel: channelMessageUpsert(get().messagesByChannel, channelId, (messages) =>
            messages.map((message) => (message.id === messageId ? { ...message, ...mapped } : message))
          )
        });
        return;
      }

      const response = await apiFetch<{ message: ApiMessagePayload }>(
        `/api/messages/${encodeURIComponent(messageId)}`,
        {
          method: 'DELETE'
        }
      );
      const mapped = mapMessage(response.message);
      set({
        messagesByChannel: channelMessageUpsert(get().messagesByChannel, channelId, (messages) =>
          messages.map((message) => (message.id === messageId ? { ...message, ...mapped } : message))
        )
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete message';
      set({ error: message });
    }
  },

  toggleReaction: async (messageId, emoji) => {
    const state = get();
    const channelId = state.currentChannelId;
    if (!channelId) return;
    const normalizedEmoji = String(emoji || '').trim();
    if (!normalizedEmoji) return;

    try {
      if (state.chatMode === 'friend') {
        if (!state.activeFriendChatId) return;
        const response = await apiFetch<ReactionTogglePayload>(
          `/api/friends/${encodeURIComponent(state.activeFriendChatId)}/messages/${encodeURIComponent(messageId)}/reactions`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji: normalizedEmoji })
          }
        );

        set({
          messagesByChannel: channelMessageUpsert(get().messagesByChannel, channelId, (messages) =>
            messages.map((message) =>
              message.id === messageId
                ? { ...message, reactions: normalizeReactions(response.reactions) }
                : message
            )
          )
        });
        return;
      }

      const response = await apiFetch<ReactionTogglePayload>(`/api/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji: normalizedEmoji })
      });

      set({
        messagesByChannel: channelMessageUpsert(get().messagesByChannel, channelId, (messages) =>
          messages.map((message) =>
            message.id === messageId
              ? { ...message, reactions: normalizeReactions(response.reactions) }
              : message
          )
        )
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update reaction';
      set({ error: message });
    }
  },

  resolveMessageLink: async (messageId, options: ResolveMessageLinkOptions = {}) => {
    const trimmed = String(messageId || '').trim();
    if (!trimmed) return;

    try {
      const stateBefore = get();
      const payload = await apiFetch<MessageLinkPayload>(`/api/message-links/${encodeURIComponent(trimmed)}`);
      let shouldAnimateFocus = false;

      if (payload.kind === 'server') {
        if (!payload.serverId || !payload.channelId) {
          throw new Error('Invalid server message link payload');
        }

        const inCurrentServerChat =
          stateBefore.chatMode === 'server' &&
          stateBefore.currentServerId === payload.serverId &&
          stateBefore.currentChannelId === payload.channelId;

        shouldAnimateFocus = Boolean(options.animateInCurrentChat) && inCurrentServerChat;
        if (!inCurrentServerChat) {
          await get().selectServer(payload.serverId);
          await get().selectChannel(payload.channelId);
        }
      } else if (payload.kind === 'friend') {
        if (!payload.friendUserId) {
          throw new Error('Invalid direct message link payload');
        }

        const friendChannelId = dmChannelId(payload.friendUserId);
        const inCurrentDirectChat =
          stateBefore.chatMode === 'friend' &&
          stateBefore.activeFriendChatId === payload.friendUserId &&
          stateBefore.currentChannelId === friendChannelId;

        shouldAnimateFocus = Boolean(options.animateInCurrentChat) && inCurrentDirectChat;
        if (!inCurrentDirectChat) {
          await get().openFriendChat(payload.friendUserId);
        }
      }

      set({ focusedMessageId: trimmed, focusedMessageAnimated: shouldAnimateFocus });
      window.setTimeout(() => {
        if (get().focusedMessageId === trimmed) {
          set({ focusedMessageId: null, focusedMessageAnimated: false });
        }
      }, 6000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open message link';
      set({ error: message });
    }
  },

  setTyping: ({ channelId, userId, isTyping }) => {
    set((state) => {
      const prev = state.typingByChannel[channelId] ?? [];
      const hasUser = prev.includes(userId);

      let next = prev;

      if (isTyping && !hasUser) {
        next = [...prev, userId];
      }

      if (!isTyping && hasUser) {
        next = prev.filter((id) => id !== userId);
      }

      if (next.length === prev.length) {
        return state;
      }

      return {
        typingByChannel: {
          ...state.typingByChannel,
          [channelId]: next
        }
      };
    });
  },

  setAtBottom: (channelId, atBottom) => {
    const current = get().atBottomByChannel[channelId] ?? true;
    if (current === atBottom) return;

    set((state) => ({
      atBottomByChannel: {
        ...state.atBottomByChannel,
        [channelId]: atBottom
      }
    }));
    if (atBottom) get().markRead(channelId);
  },

  markRead: (channelId) => {
    const currentUnread = get().unreadByChannel[channelId] ?? 0;
    if (currentUnread === 0) return;

    if (!channelId) return;

    set((state) => ({
      unreadByChannel: {
        ...state.unreadByChannel,
        [channelId]: 0
      }
    }));
  },

  loadOlderMessages: (channelId) => {
    set((state) => ({
      historyLimitReached: {
        ...state.historyLimitReached,
        [channelId]: true
      }
    }));
  },

  setTheme: (themePatch) => {
    set((state) => {
      const nextTheme = {
        ...state.theme,
        ...themePatch
      };
      writeThemeToCookie(nextTheme);
      return { theme: nextTheme };
    });
  },

  setLocale: (locale) => {
    if (locale !== 'ru' && locale !== 'en') return;
    window.localStorage.setItem('ui.locale', locale);
    set({ locale });
  },

  toggleSettings: (value) => {
    set((state) => ({
      showSettings: value ?? !state.showSettings
    }));
  },

  setAutoLoadMedia: (value) => {
    const next = Boolean(value);
    writeAutoLoadMedia(next);
    set({ autoLoadMedia: next });
  },

  setReplyTarget: (channelId, reply) => {
    const id = String(channelId || '').trim();
    if (!id) return;
    set((state) => ({
      replyTargetByChannel: {
        ...state.replyTargetByChannel,
        [id]: reply
      }
    }));
  },

  clearReplyTarget: (channelId) => {
    const id = String(channelId || '').trim();
    if (!id) return;
    set((state) => ({
      replyTargetByChannel: {
        ...state.replyTargetByChannel,
        [id]: null
      }
    }));
  },

  clearError: () => {
    set({ error: null });
  },

  openInviteDialog: (inviteCode) => {
    const code = String(inviteCode || '').trim();
    if (!code) return;
    set({ activeInviteCode: code });
  },

  closeInviteDialog: () => {
    set({ activeInviteCode: null });
  }
}));

export const createIncomingBotMessage = (channelId: string, authorId: string, content: string): Message => ({
  id: generateId(),
  channelId,
  authorId,
  content,
  createdAt: Date.now(),
  reactions: []
});
