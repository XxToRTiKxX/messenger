import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../src/services/api', () => ({
  apiFetch: vi.fn()
}));

import { apiFetch } from '../src/services/api';
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
  readInitialLocale,
  readInitialTheme,
  upsertUsers,
  writeThemeToCookie
} from '../src/store/chatStore/helpers';

const apiFetchMock = vi.mocked(apiFetch);

describe('frontend chatStore/helpers', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.localStorage.clear();
    document.cookie = 'ui_theme=; Max-Age=0; Path=/';
  });

  test('makeAvatar/mapServer/mapChannel mapping basics', () => {
    expect(makeAvatar('alice')).toBe('AL');
    expect(makeAvatar('')).toBe('?');

    expect(mapServer({ id: 's1', name: 'My Server', role: 'admin' })).toEqual({
      id: 's1',
      name: 'My Server',
      icon: 'MY',
      iconUrl: undefined,
      role: 'admin'
    });

    expect(
      mapChannel({
        id: 'c1',
        serverId: 's1',
        name: 'dev-chat',
        description: 'x',
        type: 'text'
      })
    ).toMatchObject({ id: 'c1', category: 'DEV' });
  });

  test('normalizeReactions deduplicates user ids by emoji', () => {
    const normalized = normalizeReactions([
      { emoji: '🔥', userIds: ['u1', 'u2'] },
      { emoji: '🔥', userIds: ['u2', 'u3'] },
      { emoji: '👍', userIds: ['u1'] }
    ]);

    expect(normalized).toEqual(
      expect.arrayContaining([
        { emoji: '🔥', userIds: expect.arrayContaining(['u1', 'u2', 'u3']) },
        { emoji: '👍', userIds: ['u1'] }
      ])
    );
  });

  test('mapMessage/mapDirectMessage and dmChannelId', () => {
    const payload = {
      id: 'm1',
      channelId: 'c1',
      userId: 'u1',
      username: 'alice',
      content: 'hello',
      timestamp: '2026-01-01T00:00:00.000Z',
      reactions: []
    };

    const mapped = mapMessage(payload);
    const mappedDm = mapDirectMessage(
      {
        ...payload,
        senderId: 'u1',
        senderUsername: 'alice',
        recipientId: 'u2',
        recipientUsername: 'bob'
      },
      'u2'
    );

    expect(mapped.authorId).toBe('u1');
    expect(mappedDm.channelId).toBe(dmChannelId('u2'));
  });

  test('readInitialLocale from storage and navigator fallback', () => {
    window.localStorage.setItem('ui.locale', 'ru');
    expect(readInitialLocale()).toBe('ru');

    window.localStorage.removeItem('ui.locale');
    const langGetter = vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('en-US');
    expect(readInitialLocale()).toBe('en');
    langGetter.mockRestore();
  });

  test('readInitialTheme defaults and cookie roundtrip', () => {
    const fallback = readInitialTheme();
    expect(fallback).toMatchObject({ mode: 'matrix', backgroundFxEnabled: true });

    writeThemeToCookie({
      mode: 'dark',
      backgroundFxEnabled: false,
      backgroundFxMode: 'matrix_rain',
      crt: false,
      glowIntensity: 1.2
    });

    const fromCookie = readInitialTheme();
    expect(fromCookie).toEqual({
      mode: 'dark',
      backgroundFxEnabled: false,
      backgroundFxMode: 'matrix_rain',
      crt: false,
      glowIntensity: 1.2
    });
  });

  test('upsertUsers keeps reference when ids are unchanged in same order', () => {
    const current = [{ id: 'u1', displayName: 'Alice', avatar: 'AL', presence: 'online' as const }];
    const next = [{ id: 'u1', displayName: 'Alice updated', avatar: 'AL', presence: 'online' as const }];

    const result = upsertUsers(current, next);
    expect(result).toBe(current);
  });

  test('channelMessageUpsert updates only selected channel', () => {
    const initial = {
      c1: [{ id: 'm1', channelId: 'c1', authorId: 'u1', content: 'x', createdAt: 1, reactions: [] }],
      c2: [{ id: 'm2', channelId: 'c2', authorId: 'u2', content: 'y', createdAt: 2, reactions: [] }]
    };

    const result = channelMessageUpsert(initial, 'c1', (messages) => [...messages, { ...messages[0]!, id: 'm3' }]);

    expect(result.c1).toHaveLength(2);
    expect(result.c2).toHaveLength(1);
  });

  test('parseChannelPayload validates shape', () => {
    expect(
      parseChannelPayload({
        serverRole: 'member',
        channels: [
          {
            id: 'c1',
            serverId: 's1',
            name: 'general',
            type: 'text'
          }
        ]
      })
    ).toEqual({
      serverRole: 'member',
      roleLabels: [],
      channels: [{ id: 'c1', serverId: 's1', name: 'general', categoryName: undefined, description: undefined, type: 'text', position: 0, visibleRoles: [] }]
    });

    expect(() => parseChannelPayload({ serverRole: 'member', channels: [{ id: 'c1', serverId: 's1', name: 'g', type: 'unknown' }] })).toThrow(
      /неизвестный тип канала/
    );
  });

  test('loadBootstrapPayload combines API payloads', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ userId: 'u1', username: 'Alice', email: 'alice@test' })
      .mockResolvedValueOnce({ friends: [], incoming: [], outgoing: [] })
      .mockResolvedValueOnce([{ id: 's1', name: 'Server 1', role: 'member' }]);

    const result = await loadBootstrapPayload();

    expect(result.profile.userId).toBe('u1');
    expect(result.serverPayload[0]?.id).toBe('s1');
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
  });
});
