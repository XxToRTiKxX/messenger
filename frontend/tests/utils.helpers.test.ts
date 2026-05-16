import { describe, expect, test } from 'vitest';

import { clamp, formatDayTime, formatTime, generateId, shouldGroupWithPrevious } from '../src/utils/helpers';
import type { Message } from '../src/types/chat';

describe('frontend utils/helpers', () => {
  test('formatters return non-empty strings', () => {
    const timestamp = Date.UTC(2026, 0, 1, 12, 30, 0);

    expect(formatTime(timestamp)).toBeTruthy();
    expect(formatDayTime(timestamp)).toBeTruthy();
  });

  test('generateId returns unique-ish id strings', () => {
    const a = generateId();
    const b = generateId();

    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
    expect(a).not.toBe(b);
  });

  test('shouldGroupWithPrevious checks author and time threshold', () => {
    const base: Message = {
      id: 'm1',
      channelId: 'c1',
      authorId: 'u1',
      content: 'hello',
      createdAt: 1000,
      reactions: []
    };

    const close: Message = { ...base, id: 'm2', createdAt: base.createdAt + 4 * 60 * 1000 };
    const far: Message = { ...base, id: 'm3', createdAt: base.createdAt + 6 * 60 * 1000 };
    const otherUser: Message = { ...close, id: 'm4', authorId: 'u2' };

    expect(shouldGroupWithPrevious(base, close)).toBe(true);
    expect(shouldGroupWithPrevious(base, far)).toBe(false);
    expect(shouldGroupWithPrevious(base, otherUser)).toBe(false);
    expect(shouldGroupWithPrevious(undefined, close)).toBe(false);
  });

  test('clamp keeps value within bounds', () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(-1, 1, 10)).toBe(1);
    expect(clamp(99, 1, 10)).toBe(10);
  });
});
