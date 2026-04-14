import { Message } from '../types/chat';

export const formatTime = (timestamp: number): string =>
  new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp);

export const formatDayTime = (timestamp: number): string =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp);

export const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const shouldGroupWithPrevious = (previous?: Message, current?: Message): boolean => {
  if (!previous || !current) return false;
  if (previous.authorId !== current.authorId) return false;
  return Math.abs(current.createdAt - previous.createdAt) < 5 * 60 * 1000;
};

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
