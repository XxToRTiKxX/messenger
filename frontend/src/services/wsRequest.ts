import { wsClient } from './wsClient';

export type WsJsonResponse<T> = {
  status: number;
  ok: boolean;
  data: T | null;
  error: string | null;
};

function toHeadersRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {});
  }
  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value == null) return acc;
    acc[key] = String(value);
    return acc;
  }, {});
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export async function wsJsonRequest<T = unknown>(url: string, options: RequestInit = {}): Promise<WsJsonResponse<T>> {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    Accept: 'application/json',
    ...toHeadersRecord(options.headers)
  };
  const rpc = (await wsClient.request({
    method,
    path: url,
    headers,
    body: parseBody(options.body)
  })) as {
    status?: number;
    ok?: boolean;
    data?: unknown;
    error?: unknown;
  };

  const status = Number(rpc.status || 500);
  const ok = Boolean(rpc.ok);
  const data = (rpc.data ?? null) as T | null;

  let error: string | null = null;
  if (typeof rpc.error === 'string' && rpc.error.trim()) {
    error = rpc.error;
  } else if (rpc.error && typeof rpc.error === 'object' && typeof (rpc.error as { error?: unknown }).error === 'string') {
    error = (rpc.error as { error: string }).error;
  } else if (!ok) {
    error = `HTTP ${status}`;
  }

  return { status, ok, data, error };
}
