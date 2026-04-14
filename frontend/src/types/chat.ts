export type ThemeMode = 'matrix' | 'dark';
export type BackgroundEffectMode = 'matrix_rain' | 'points_ambient' | 'points_server';
export type Presence = 'online' | 'idle' | 'offline';
export type ChannelType = 'text' | 'voice';
export type ChatMode = 'server' | 'friends' | 'friend';
export type Locale = 'ru' | 'en';

export interface ThemeSettings {
  mode: ThemeMode;
  backgroundFxEnabled: boolean;
  backgroundFxMode: BackgroundEffectMode;
  crt: boolean;
  glowIntensity: number;
}

export interface User {
  id: string;
  displayName: string;
  avatar: string;
  presence: Presence;
  email?: string;
  isBot?: boolean;
  role?: string;
  hasChannelRole?: boolean;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: number;
  editedAt?: number;
  deletedAt?: number;
  reactions: Reaction[];
}

export interface Channel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  category: 'INFO' | 'GENERAL' | 'DEV' | 'VOICE';
}

export interface Server {
  id: string;
  name: string;
  icon: string;
  channels?: string[];
  role?: string;
}

export interface FriendItem {
  id: string;
  userId: string;
  username: string;
  email?: string;
}

export interface UserProfile {
  userId: string;
  username: string;
  email?: string;
}

export interface TypingEvent {
  channelId: string;
  userId: string;
  isTyping: boolean;
}

export interface IncomingMessage {
  channelId: string;
  message: Message;
}
