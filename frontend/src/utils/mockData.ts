import { Channel, Message, Server, User } from '../types/chat';
import { generateId } from './helpers';

const names = ['Trinity', 'Morpheus', 'Neo', 'Switch', 'Tank', 'Cypher', 'Oracle', 'Dozer'];
const snippets = [
  'Signal looks stable.',
  'Routing packets through relay node.',
  'Encryption keys rotated.',
  'Building deployed to production.',
  'Need review on matrix-parser module.',
  'Patch merged, watching logs.',
  'Latency dropped after cache warmup.',
  'Can someone verify auth token flow?'
];
const DEFAULT_SNIPPET = 'Signal looks stable.';

export const SELF_USER_ID = 'user-self';

export const users: User[] = [
  { id: SELF_USER_ID, displayName: 'You', avatar: 'YU', presence: 'online' },
  ...names.map((name, idx): User => ({
    id: `user-${idx + 1}`,
    displayName: name,
    avatar: name.slice(0, 2).toUpperCase(),
    presence: idx % 3 === 0 ? 'online' : idx % 3 === 1 ? 'idle' : 'offline',
    isBot: idx > 5
  }))
];

export const channels: Channel[] = [
  { id: 'ch-announcements', serverId: 'srv-zion', name: 'announcements', type: 'text', category: 'INFO', position: 0 },
  { id: 'ch-general', serverId: 'srv-zion', name: 'general', type: 'text', category: 'GENERAL', position: 1 },
  { id: 'ch-ops', serverId: 'srv-zion', name: 'ops-war-room', type: 'text', category: 'DEV', position: 2 },
  { id: 'ch-deploy', serverId: 'srv-zion', name: 'deployments', type: 'text', category: 'DEV', position: 3 },
  { id: 'ch-voice-briefing', serverId: 'srv-zion', name: 'briefing-room', type: 'voice', category: 'VOICE', position: 4 },
  { id: 'ch-voice-matrix', serverId: 'srv-zion', name: 'matrix-live', type: 'voice', category: 'VOICE', position: 5 },
  { id: 'ch-lobby', serverId: 'srv-construct', name: 'lobby', type: 'text', category: 'GENERAL', position: 0 },
  { id: 'ch-build', serverId: 'srv-construct', name: 'build-stream', type: 'text', category: 'DEV', position: 1 },
  { id: 'ch-voice-lab', serverId: 'srv-construct', name: 'lab-voice', type: 'voice', category: 'VOICE', position: 2 }
];

export const servers: Server[] = [
  {
    id: 'srv-zion',
    name: 'Zion Core',
    icon: 'ZC',
    channels: channels.filter((channel) => channel.serverId === 'srv-zion').map((channel) => channel.id)
  },
  {
    id: 'srv-construct',
    name: 'Construct',
    icon: 'CT',
    channels: channels.filter((channel) => channel.serverId === 'srv-construct').map((channel) => channel.id)
  },
  {
    id: 'srv-nexus',
    name: 'Nexus',
    icon: 'NX',
    channels: ['ch-general']
  }
];

export const createMessage = (
  channelId: string,
  authorId: string,
  content: string,
  createdAt: number
): Message => ({
  id: generateId(),
  channelId,
  authorId,
  content,
  createdAt,
  reactions: []
});

export const generateInitialMessages = (channelId: string, count = 300): Message[] => {
  const result: Message[] = [];
  let cursor = Date.now() - 1000 * 60 * count;
  const fallbackUser = users[0];
  if (!fallbackUser) return result;

  for (let i = 0; i < count; i += 1) {
    const author = users[(i % (users.length - 1)) + 1] ?? fallbackUser;
    const content = snippets[i % snippets.length] ?? DEFAULT_SNIPPET;
    result.push(createMessage(channelId, author.id, content, cursor));
    cursor += 1000 * 60;
  }

  return result;
};

export const generateOlderMessages = (channelId: string, before: number, count = 60): Message[] => {
  const result: Message[] = [];
  const fallbackUser = users[0];
  if (!fallbackUser) return result;

  for (let i = count; i > 0; i -= 1) {
    const author = users[(i % (users.length - 1)) + 1] ?? fallbackUser;
    const content = snippets[(i + 2) % snippets.length] ?? DEFAULT_SNIPPET;
    result.push({
      id: generateId(),
      channelId,
      authorId: author.id,
      content,
      createdAt: before - i * 1000 * 60,
      reactions: []
    });
  }

  return result;
};

export const pickRandomBotLine = (): string =>
  snippets[Math.floor(Math.random() * snippets.length)] ?? DEFAULT_SNIPPET;
