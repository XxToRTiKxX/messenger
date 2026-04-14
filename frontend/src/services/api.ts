export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    window.location.href = '/auth/';
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    let errorText = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        errorText = payload.error;
      }
    } catch {
      const text = await response.text();
      if (text) errorText = text;
    }
    throw new Error(errorText);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'include'
  });
  window.location.href = '/auth/';
}
