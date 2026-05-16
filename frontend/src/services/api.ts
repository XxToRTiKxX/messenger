import { wsJsonRequest } from './wsRequest';
import type { MediaAttachment } from '../types/chat';

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const rpc = await wsJsonRequest<T>(url, options);
  const { status, ok, data, error } = rpc;

  if (status === 401) {
    window.location.href = '/auth/';
    throw new Error('Unauthorized');
  }

  if (!ok) {
    throw new Error(error || `HTTP ${status}`);
  }

  if (status === 204) {
    return null as T;
  }

  return (data ?? null) as T;
}

export async function logout(): Promise<void> {
  await apiFetch<null>('/auth/logout', { method: 'POST' });
  window.location.href = '/auth/';
}

export async function uploadMediaBinary(
  file: File,
  context:
    | { mode: 'server'; serverId: string; channelId: string }
    | { mode: 'dm'; friendUserId: string },
  onProgress?: (progress: number) => void
): Promise<MediaAttachment> {
  const params = new URLSearchParams({ mode: context.mode });
  if (context.mode === 'server') {
    params.set('serverId', context.serverId);
    params.set('channelId', context.channelId);
  } else {
    params.set('friendUserId', context.friendUserId);
  }

  return new Promise<MediaAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/media/upload?${params.toString()}`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'media.bin'));
    xhr.setRequestHeader('X-File-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Size', String(file.size));

    xhr.upload.onprogress = (event: ProgressEvent<EventTarget>) => {
      if (!event.lengthComputable || !onProgress) return;
      const next = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress(next);
    };

    xhr.onerror = () => {
      reject(new Error('Network error during media upload'));
    };

    xhr.onload = () => {
      const status = Number(xhr.status || 0);
      let payload: { media?: MediaAttachment; error?: string } = {};
      try {
        payload = (JSON.parse(xhr.responseText || '{}') as { media?: MediaAttachment; error?: string }) || {};
      } catch {
        payload = {};
      }
      if (status < 200 || status >= 300 || !payload.media) {
        reject(new Error(payload.error || `HTTP ${status || 500}`));
        return;
      }
      if (onProgress) onProgress(100);
      resolve(payload.media);
    };

    xhr.send(file);
  });
}
