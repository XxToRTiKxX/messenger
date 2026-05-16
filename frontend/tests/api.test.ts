import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../src/services/wsRequest', () => ({
  wsJsonRequest: vi.fn()
}));

import { wsJsonRequest } from '../src/services/wsRequest';
import { apiFetch } from '../src/services/api';

const wsJsonRequestMock = vi.mocked(wsJsonRequest);

describe('frontend apiFetch', () => {
  beforeEach(() => {
    wsJsonRequestMock.mockReset();
  });

  test('returns data on successful response', async () => {
    wsJsonRequestMock.mockResolvedValueOnce({ status: 200, ok: true, data: { a: 1 }, error: null });

    await expect(apiFetch<{ a: number }>('/ok')).resolves.toEqual({ a: 1 });
  });

  test('returns null on HTTP 204', async () => {
    wsJsonRequestMock.mockResolvedValueOnce({ status: 204, ok: true, data: null, error: null });

    await expect(apiFetch<null>('/no-content')).resolves.toBeNull();
  });

  test('throws backend error text when request fails', async () => {
    wsJsonRequestMock.mockResolvedValueOnce({ status: 500, ok: false, data: null, error: 'Server exploded' });

    await expect(apiFetch('/boom')).rejects.toThrow('Server exploded');
  });

  test('throws Unauthorized on 401', async () => {
    wsJsonRequestMock.mockResolvedValueOnce({ status: 401, ok: false, data: null, error: 'Unauthorized' });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(apiFetch('/unauthorized')).rejects.toThrow('Unauthorized');
    consoleErrorSpy.mockRestore();
  });
});
