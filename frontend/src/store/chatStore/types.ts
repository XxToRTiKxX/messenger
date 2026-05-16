import type {
  Channel,
  ChatMode,
  FriendItem,
  Locale,
  MediaAttachment,
  Message,
  Reaction,
  Server,
  ThemeSettings,
  TypingEvent,
  User,
  UserProfile
} from '../../types/chat';

export interface FriendPayload {
  friends: FriendItem[];
  incoming: FriendItem[];
  outgoing: FriendItem[];
}

export interface ServerPayload {
  id: string;
  name: string;
  role?: string;
  iconUrl?: string;
}

export interface ChannelPayload {
  id: string;
  serverId: string;
  name: string;
  categoryName?: string;
  description?: string;
  type: 'text' | 'voice';
  position?: number;
  visibleRoles?: string[];
}

export interface ChannelListPayload {
  serverRole: string;
  roleLabels?: string[];
  channels: ChannelPayload[];
}

export interface ApiMessagePayload {
  id: string;
  userId: string;
  username: string;
  channelId: string;
  content: string;
  media?: MediaAttachment | null;
  replyTo?: {
    id: string;
    username: string;
    content: string;
  } | null;
  timestamp: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  reactions?: Reaction[];
}

export interface DirectMessagePayload {
  id: string;
  senderId: string;
  senderUsername: string;
  recipientId: string;
  recipientUsername: string;
  content: string;
  media?: MediaAttachment | null;
  timestamp: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  reactions?: Reaction[];
}

export interface MediaUploadPayload {
  media: MediaAttachment;
}

export interface ReactionTogglePayload {
  reactions: Reaction[];
}

export interface MessageLinkPayload {
  messageId: string;
  kind: 'server' | 'friend';
  serverId?: string;
  channelId?: string;
  friendUserId?: string;
  serverName?: string;
  channelName?: string;
}

export interface ResolveMessageLinkOptions {
  animateInCurrentChat?: boolean;
}

export interface ChatState {
  profile: UserProfile | null;
  servers: Server[];
  channels: Channel[];
  channelsByServer: Record<string, Channel[]>;
  users: User[];
  currentServerId: string;
  currentChannelId: string;
  currentUserId: string;
  currentServerRole: string;
  currentServerRoleLabels: string[];
  chatMode: ChatMode;
  activeFriendChatId: string | null;
  friends: FriendItem[];
  incomingFriendRequests: FriendItem[];
  outgoingFriendRequests: FriendItem[];
  messagesByChannel: Record<string, Message[]>;
  unreadByChannel: Record<string, number>;
  typingByChannel: Record<string, string[]>;
  atBottomByChannel: Record<string, boolean>;
  historyLimitReached: Record<string, boolean>;
  channelParticipantsByChannel: Record<string, string[]>;
  focusedMessageId: string | null;
  focusedMessageAnimated: boolean;
  activeInviteCode: string | null;
  locale: Locale;
  theme: ThemeSettings;
  showSettings: boolean;
  autoLoadMedia: boolean;
  replyTargetByChannel: Record<string, { id: string; username: string; content: string } | null>;
  loading: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  openFriendsHub: () => void;
  selectServer: (serverId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  openFriendChat: (friendUserId: string) => Promise<void>;
  sendMessage: (content: string, mediaId?: string, replyToMessageId?: string | null) => Promise<void>;
  uploadMedia: (file: File, onProgress?: (progress: number) => void) => Promise<MediaAttachment>;
  createServer: (name: string, iconUrl?: string) => Promise<void>;
  createChannel: (name: string, type?: 'text' | 'voice', categoryName?: string) => Promise<void>;
  updateServerLocal: (serverId: string, patch: { name?: string; iconUrl?: string }) => void;
  sendFriendRequest: (username: string) => Promise<void>;
  respondToFriendRequest: (friendshipId: string, action: 'accept' | 'reject') => Promise<void>;
  refreshFriends: () => Promise<void>;
  setChannelParticipantRole: (userId: string, role: string) => Promise<void>;
  receiveMessage: (message: Message) => void;
  upsertMessage: (message: Message) => void;
  removeMessageById: (channelId: string, messageId: string) => void;
  updateMessage: (message: Message) => void;
  updateMessageReactions: (channelId: string, messageId: string, reactions: Reaction[]) => void;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  resolveMessageLink: (messageId: string, options?: ResolveMessageLinkOptions) => Promise<void>;
  setReplyTarget: (channelId: string, reply: { id: string; username: string; content: string } | null) => void;
  clearReplyTarget: (channelId: string) => void;
  openInviteDialog: (inviteCode: string) => void;
  closeInviteDialog: () => void;
  setTyping: (event: TypingEvent) => void;
  setAtBottom: (channelId: string, atBottom: boolean) => void;
  markRead: (channelId: string) => void;
  loadOlderMessages: (channelId: string) => void;
  setTheme: (themePatch: Partial<ThemeSettings>) => void;
  setLocale: (locale: Locale) => void;
  toggleSettings: (value?: boolean) => void;
  setAutoLoadMedia: (value: boolean) => void;
  clearError: () => void;
}
