import { describe, expect, test, vi } from 'vitest';

vi.mock('../src/services/wsClient', () => ({
  wsClient: {
    request: vi.fn()
  }
}));

import { wsClient } from '../src/services/wsClient';
import { wsJsonRequest } from '../src/services/wsRequest';

const requestMock = vi.mocked(wsClient.request);

describe('frontend wsRequest', () => {
  test('sends normalized request and maps successful RPC response', async () => {
    requestMock.mockResolvedValueOnce({ type: 'rpc_response', id: '1', status: 200, ok: true, data: { value: 1 } });

    const response = await wsJsonRequest<{ value: number }>('/api/test', {
      method: 'post',
      headers: new Headers({ 'X-Test': '1' }),
      body: JSON.stringify({ x: 1 })
    });

    expect(requestMock).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/test',
      headers: {
        Accept: 'application/json',
        'x-test': '1'
      },
      body: { x: 1 }
    });

    expect(response).toEqual({
      status: 200,
      ok: true,
      data: { value: 1 },
      error: null
    });
  });

  test('maps error object/string and fallback HTTP error text', async () => {
    requestMock.mockResolvedValueOnce({ type: 'rpc_response', id: '2', status: 400, ok: false, error: { error: 'Bad request' } });
    await expect(wsJsonRequest('/x')).resolves.toEqual({ status: 400, ok: false, data: null, error: 'Bad request' });

    requestMock.mockResolvedValueOnce({ type: 'rpc_response', id: '3', status: 401, ok: false, error: 'Unauthorized' });
    await expect(wsJsonRequest('/x')).resolves.toEqual({ status: 401, ok: false, data: null, error: 'Unauthorized' });

    requestMock.mockResolvedValueOnce({ type: 'rpc_response', id: '4', status: 500, ok: false });
    await expect(wsJsonRequest('/x')).resolves.toEqual({ status: 500, ok: false, data: null, error: 'HTTP 500' });
  });
});
