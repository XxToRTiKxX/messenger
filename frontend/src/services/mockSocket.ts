import { io, Socket } from 'socket.io-client';
import { createIncomingBotMessage, useChatStore } from '../store/chatStore';
import { pickRandomBotLine, users } from '../utils/mockData';
import { Presence, TypingEvent } from '../types/chat';

interface MockSocketHandlers {
  onMessage: (message: ReturnType<typeof createIncomingBotMessage>) => void;
  onTyping: (event: TypingEvent) => void;
  onPresence: (userId: string, presence: Presence) => void;
}

class MockSocketService {
  private socket: Socket;

  private messageTimer?: number;

  private presenceTimer?: number;

  private handlers?: MockSocketHandlers;

  constructor() {
    // Kept for API compatibility with a real Socket.io client.
    this.socket = io('ws://mock-socket.local', {
      autoConnect: false,
      transports: ['websocket']
    });
  }

  connect(handlers: MockSocketHandlers): void {
    this.handlers = handlers;
    this.startMessageLoop();
    this.startPresenceLoop();
  }

  disconnect(): void {
    if (this.messageTimer) window.clearInterval(this.messageTimer);
    if (this.presenceTimer) window.clearInterval(this.presenceTimer);
    this.messageTimer = undefined;
    this.presenceTimer = undefined;
    this.handlers = undefined;
  }

  emitTyping(channelId: string, userId: string, isTyping: boolean): void {
    if (!this.handlers) return;
    this.socket.emit('typing', { channelId, userId, isTyping });
    this.handlers.onTyping({ channelId, userId, isTyping });
  }

  private startMessageLoop(): void {
    this.messageTimer = window.setInterval(() => {
      if (!this.handlers) return;
      const state = useChatStore.getState();
      const textChannels = state.channels.filter((channel) => channel.type === 'text');
      if (textChannels.length === 0) return;
      const randomChannel = textChannels[Math.floor(Math.random() * textChannels.length)];
      if (!randomChannel) return;
      const availableAuthors = users.filter((user) => user.id !== state.currentUserId);
      if (availableAuthors.length === 0) return;
      const randomAuthor = availableAuthors[Math.floor(Math.random() * availableAuthors.length)];
      if (!randomAuthor) return;

      this.handlers.onTyping({ channelId: randomChannel.id, userId: randomAuthor.id, isTyping: true });

      window.setTimeout(() => {
        this.handlers?.onTyping({ channelId: randomChannel.id, userId: randomAuthor.id, isTyping: false });
        const message = createIncomingBotMessage(randomChannel.id, randomAuthor.id, pickRandomBotLine());
        this.handlers?.onMessage(message);
      }, 700 + Math.random() * 1200);
    }, 2500);
  }

  private startPresenceLoop(): void {
    const statuses: Presence[] = ['online', 'idle', 'offline'];
    this.presenceTimer = window.setInterval(() => {
      if (!this.handlers) return;
      const bots = users.filter((user) => user.id !== 'user-self');
      if (bots.length === 0) return;
      const randomBot = bots[Math.floor(Math.random() * bots.length)];
      if (!randomBot) return;
      const nextPresence = statuses[Math.floor(Math.random() * statuses.length)] ?? 'online';
      this.handlers.onPresence(randomBot.id, nextPresence);
    }, 8000);
  }
}

export const mockSocketService = new MockSocketService();
