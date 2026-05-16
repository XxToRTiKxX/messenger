import type { Channel, Locale, Message, Reaction, Server, ThemeSettings, User, UserProfile } from '../../types/chat';
import { apiFetch } from '../../services/api';
import type {
  ApiMessagePayload,
  ChannelListPayload,
  ChannelPayload,
  DirectMessagePayload,
  FriendPayload,
  ServerPayload
} from './types';

class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
  }
}

const mapCategory = (channel: ChannelPayload): Channel['category'] => {
  const explicit = String(channel.categoryName || '').trim();
  if (explicit) return explicit;
  if (channel.type === 'voice') return 'VOICE';
  if (/(ann|news|rules|info)/i.test(channel.name)) return 'INFO';
  if (/(dev|code|tech)/i.test(channel.name)) return 'DEV';
  return 'GENERAL';
};

export const makeAvatar = (name: string): string => {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  return clean.slice(0, 2).toUpperCase();
};

const normalizeServerName = (name: string): string => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Server';
  if (trimmed === 'Main Server') return 'Adaptivity';
  return trimmed;
};

export const mapServer = (server: ServerPayload): Server => ({
  id: server.id,
  name: normalizeServerName(server.name),
  icon: makeAvatar(normalizeServerName(server.name)),
  iconUrl: server.iconUrl,
  role: server.role
});

export const mapChannel = (channel: ChannelPayload): Channel => ({
  id: channel.id,
  serverId: channel.serverId,
  name: channel.name,
  type: channel.type,
  category: mapCategory(channel),
  position: Number.isFinite(Number(channel.position)) ? Number(channel.position) : 0,
  visibleRoles: Array.isArray(channel.visibleRoles) ? channel.visibleRoles : []
});

export const normalizeReactions = (reactions: Reaction[] | undefined): Reaction[] => {
  if (!Array.isArray(reactions) || reactions.length === 0) return [];

  const deduped = new Map<string, Set<string>>();
  reactions.forEach((reaction) => {
    if (!reaction?.emoji) return;
    const set = deduped.get(reaction.emoji) ?? new Set<string>();
    (reaction.userIds || []).forEach((id) => {
      if (id) set.add(id);
    });
    deduped.set(reaction.emoji, set);
  });

  return [...deduped.entries()].map(([emoji, userIds]) => ({
    emoji,
    userIds: [...userIds]
  }));
};

export const mapMessage = (payload: ApiMessagePayload): Message => ({
  id: payload.id,
  channelId: payload.channelId,
  authorId: payload.userId,
  content: payload.content,
  media: payload.media ?? null,
  replyTo: payload.replyTo ?? null,
  createdAt: new Date(payload.timestamp).getTime(),
  editedAt: payload.editedAt ? new Date(payload.editedAt).getTime() : undefined,
  deletedAt: payload.deletedAt ? new Date(payload.deletedAt).getTime() : undefined,
  reactions: normalizeReactions(payload.reactions)
});

export const dmChannelId = (friendUserId: string): string => `dm:${friendUserId}`;

export const mapDirectMessage = (payload: DirectMessagePayload, friendUserId: string): Message => ({
  id: payload.id,
  channelId: dmChannelId(friendUserId),
  authorId: payload.senderId,
  content: payload.content,
  media: payload.media ?? null,
  createdAt: new Date(payload.timestamp).getTime(),
  editedAt: payload.editedAt ? new Date(payload.editedAt).getTime() : undefined,
  deletedAt: payload.deletedAt ? new Date(payload.deletedAt).getTime() : undefined,
  reactions: normalizeReactions(payload.reactions)
});

export const readInitialLocale = (): Locale => {
  const saved = window.localStorage.getItem('ui.locale');
  if (saved === 'ru' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
};

export const readInitialAutoLoadMedia = (): boolean => {
  const saved = window.localStorage.getItem('ui.autoLoadMedia');
  if (saved === '0') return false;
  if (saved === '1') return true;
  return true;
};

export const writeAutoLoadMedia = (value: boolean): void => {
  window.localStorage.setItem('ui.autoLoadMedia', value ? '1' : '0');
};

const DEFAULT_THEME: ThemeSettings = {
  mode: 'matrix',
  backgroundFxEnabled: true,
  backgroundFxMode: 'points_server',
  crt: true,
  glowIntensity: 0.85
};

const THEME_COOKIE_KEY = 'ui_theme';

const parseCookies = (): Record<string, string> =>
  document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const separator = entry.indexOf('=');
      if (separator <= 0) return acc;
      const key = entry.slice(0, separator);
      const value = entry.slice(separator + 1);
      acc[key] = value;
      return acc;
    }, {});

export const readInitialTheme = (): ThemeSettings => {
  const raw = parseCookies()[THEME_COOKIE_KEY];
  if (!raw) return DEFAULT_THEME;

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<ThemeSettings>;
    const mode = parsed.mode === 'dark' ? 'dark' : 'matrix';
    const backgroundFxMode =
      parsed.backgroundFxMode === 'matrix_rain' || parsed.backgroundFxMode === 'points_ambient' || parsed.backgroundFxMode === 'points_server'
        ? parsed.backgroundFxMode
        : DEFAULT_THEME.backgroundFxMode;
    const glowRaw = Number(parsed.glowIntensity);
    const glowIntensity = Number.isFinite(glowRaw) ? Math.min(1.4, Math.max(0.2, glowRaw)) : DEFAULT_THEME.glowIntensity;

    return {
      mode,
      backgroundFxEnabled: typeof parsed.backgroundFxEnabled === 'boolean' ? parsed.backgroundFxEnabled : DEFAULT_THEME.backgroundFxEnabled,
      backgroundFxMode,
      crt: typeof parsed.crt === 'boolean' ? parsed.crt : DEFAULT_THEME.crt,
      glowIntensity
    };
  } catch {
    return DEFAULT_THEME;
  }
};

export const writeThemeToCookie = (theme: ThemeSettings): void => {
  const encoded = encodeURIComponent(JSON.stringify(theme));
  document.cookie = `${THEME_COOKIE_KEY}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax`;
};

export const upsertUsers = (current: User[], next: User[]): User[] => {
  const merged = new Map(current.map((user) => [user.id, user]));
  next.forEach((user) => {
    const previous = merged.get(user.id);
    merged.set(user.id, { ...previous, ...user });
  });

  const result = [...merged.values()];
  if (result.length === current.length && result.every((user, index) => user.id === current[index]?.id)) {
    return current;
  }

  return result;
};

export const channelMessageUpsert = (
  messagesByChannel: Record<string, Message[]>,
  channelId: string,
  updater: (messages: Message[]) => Message[]
): Record<string, Message[]> => ({
  ...messagesByChannel,
  [channelId]: updater(messagesByChannel[channelId] ?? [])
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BootstrapError(`API вернуло пустое поле "${field}"`);
  }
  return value;
};

const readOptionalString = (value: unknown): string | undefined => {
  if (value == null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const readArray = (value: unknown, field: string): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    throw new BootstrapError(`API вернуло невалидный список "${field}"`);
  }
  return value.filter((item): item is Record<string, unknown> => isRecord(item));
};

const parseProfile = (payload: unknown): UserProfile => {
  if (!isRecord(payload)) {
    throw new BootstrapError('Профиль пользователя не получен');
  }

  return {
    userId: readString(payload.userId, 'profile.userId'),
    username: readString(payload.username, 'profile.username'),
    email: readOptionalString(payload.email)
  };
};

const parseFriendItem = (payload: Record<string, unknown>) => ({
  id: readString(payload.id, 'friend.id'),
  userId: readString(payload.userId, 'friend.userId'),
  username: readString(payload.username, 'friend.username'),
  email: readOptionalString(payload.email)
});

const parseFriendPayload = (payload: unknown): FriendPayload => {
  if (!isRecord(payload)) {
    throw new BootstrapError('Список друзей не получен');
  }

  return {
    friends: readArray(payload.friends, 'friends').map(parseFriendItem),
    incoming: readArray(payload.incoming, 'incoming').map(parseFriendItem),
    outgoing: readArray(payload.outgoing, 'outgoing').map(parseFriendItem)
  };
};

const parseServerPayload = (payload: unknown): ServerPayload[] => {
  const items = readArray(payload, 'servers');
  return items.map((item) => ({
    id: readString(item.id, 'server.id'),
    name: readString(item.name, 'server.name'),
    role: readOptionalString(item.role),
    iconUrl: readOptionalString(item.iconUrl)
  }));
};

export const parseChannelPayload = (payload: unknown): ChannelListPayload => {
  if (!isRecord(payload)) {
    throw new BootstrapError('Список каналов не получен');
  }

  const rawChannels = readArray(payload.channels, 'channels');
  const channels: ChannelPayload[] = rawChannels.map((item) => {
    const type = readString(item.type, 'channel.type');
    if (type !== 'text' && type !== 'voice') {
      throw new BootstrapError(`API вернуло неизвестный тип канала "${type}"`);
    }
    return {
      id: readString(item.id, 'channel.id'),
      serverId: readString(item.serverId, 'channel.serverId'),
      name: readString(item.name, 'channel.name'),
      categoryName: readOptionalString(item.categoryName),
      description: readOptionalString(item.description),
      type,
      position: typeof item.position === 'number' ? item.position : 0,
      visibleRoles: Array.isArray(item.visibleRoles)
        ? item.visibleRoles.filter((value): value is string => typeof value === 'string')
        : []
    };
  });

  return {
    serverRole: readString(payload.serverRole, 'serverRole'),
    roleLabels: Array.isArray(payload.roleLabels)
      ? payload.roleLabels.filter((value): value is string => typeof value === 'string')
      : [],
    channels
  };
};

export const loadBootstrapPayload = async (): Promise<{
  profile: UserProfile;
  friendsPayload: FriendPayload;
  serverPayload: ServerPayload[];
}> => {
  const [profileRaw, friendsRaw, serversRaw] = await Promise.all([
    apiFetch<unknown>('/api/user/profile'),
    apiFetch<unknown>('/api/friends'),
    apiFetch<unknown>('/api/servers')
  ]);

  return {
    profile: parseProfile(profileRaw),
    friendsPayload: parseFriendPayload(friendsRaw),
    serverPayload: parseServerPayload(serversRaw)
  };
};
