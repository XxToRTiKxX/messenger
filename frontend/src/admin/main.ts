import './style.css';
import { wsJsonRequest } from '../services/wsRequest';

type AdminRequest = {
  id: string;
  requestedUsername?: string;
  status?: string;
  createdAt?: string;
  email?: string;
  about?: string;
};

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
};

const loginPanel = byId<HTMLElement>('login-panel');
const requestsPanel = byId<HTMLElement>('requests-panel');
const loginForm = byId<HTMLFormElement>('admin-login-form');
const loginError = byId<HTMLDivElement>('login-error');
const requestsList = byId<HTMLDivElement>('requests-list');
const refreshBtn = byId<HTMLButtonElement>('refresh-btn');
const logoutBtn = byId<HTMLButtonElement>('logout-btn');
const loginInput = byId<HTMLInputElement>('admin-login');
const passwordInput = byId<HTMLInputElement>('admin-password');
const updatesNotes = byId<HTMLTextAreaElement>('updates-notes');
const broadcastMessageInput = byId<HTMLTextAreaElement>('broadcast-message');
const broadcastSendBtn = byId<HTMLButtonElement>('broadcast-send-btn');
const broadcastStatus = byId<HTMLDivElement>('broadcast-status');
const UPDATES_KEY = 'admin.updates.notes';

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void adminLogin();
});
refreshBtn.addEventListener('click', () => {
  void loadRequests();
});
logoutBtn.addEventListener('click', () => {
  void adminLogout();
});
broadcastSendBtn.addEventListener('click', () => {
  void sendBroadcast();
});

void checkSession();
updatesNotes.value = window.localStorage.getItem(UPDATES_KEY) || '';
updatesNotes.addEventListener('input', () => {
  window.localStorage.setItem(UPDATES_KEY, updatesNotes.value);
});

async function checkSession(): Promise<void> {
  try {
    const response = await wsJsonRequest<{ authenticated?: boolean }>('/admin/api/session', { headers: { Accept: 'application/json' } });
    if (response.ok) {
      showRequestsPanel();
      await loadRequests();
      return;
    }
    showLoginPanel();
  } catch {
    showLoginPanel();
  }
}

async function adminLogin(): Promise<void> {
  loginError.textContent = '';
  const login = loginInput.value.trim();
  const password = passwordInput.value;

  try {
    const response = await wsJsonRequest<{ error?: string }>('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ login, password })
    });

    if (!response.ok) {
      throw new Error(response.error || `HTTP ${response.status}`);
    }

    showRequestsPanel();
    await loadRequests();
  } catch (error) {
    loginError.textContent = error instanceof Error ? error.message : 'Ошибка авторизации';
  }
}

async function adminLogout(): Promise<void> {
  await wsJsonRequest('/admin/api/logout', { method: 'POST' });
  showLoginPanel();
}

async function loadRequests(): Promise<void> {
  requestsList.innerHTML = '<div class="info">Загрузка...</div>';

  try {
    const response = await wsJsonRequest<{ requests?: AdminRequest[] }>('/admin/api/requests', {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        showLoginPanel();
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    renderRequests(response.data?.requests || []);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    requestsList.innerHTML = `<div class="error">Ошибка загрузки: ${escapeHtml(message)}</div>`;
  }
}

async function sendBroadcast(): Promise<void> {
  const content = broadcastMessageInput.value.trim();
  if (!content) {
    broadcastStatus.textContent = 'Введите текст сообщения';
    return;
  }

  broadcastStatus.textContent = 'Отправка...';
  try {
    const response = await wsJsonRequest<{ error?: string }>('/admin/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!response.ok) {
      throw new Error(response.error || `HTTP ${response.status}`);
    }
    broadcastMessageInput.value = '';
    broadcastStatus.textContent = 'Сообщение отправлено в Adaptivity';
  } catch (error) {
    broadcastStatus.textContent = error instanceof Error ? error.message : 'Ошибка отправки';
  }
}

function renderRequests(requests: AdminRequest[]): void {
  if (!requests.length) {
    requestsList.innerHTML = '<div class="info">Нет заявок для модерации.</div>';
    return;
  }

  requestsList.innerHTML = requests
    .map((item) => {
      const created = item.createdAt ? new Date(item.createdAt).toLocaleString('ru-RU') : '-';
      return `
        <article class="request" data-id="${escapeHtml(item.id)}">
          <div><strong>${escapeHtml(item.requestedUsername || '-')}</strong> <span class="status-pill">${escapeHtml(item.status || '-')}</span></div>
          <div class="request-meta">Создано: ${escapeHtml(created)}</div>
          <div>Email: ${escapeHtml(item.email || 'не указан')}</div>
          <div>О себе: ${escapeHtml(item.about || 'не указано')}</div>
          <div class="request-actions">
            <button type="button" data-action="approve">Одобрить</button>
            <button type="button" data-action="reject" class="danger">Отклонить</button>
          </div>
        </article>
      `;
    })
    .join('');

  requestsList.querySelectorAll<HTMLButtonElement>('[data-action="approve"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.closest<HTMLElement>('.request')?.dataset.id;
      if (id) void moderate(id, 'approve');
    });
  });
  requestsList.querySelectorAll<HTMLButtonElement>('[data-action="reject"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.closest<HTMLElement>('.request')?.dataset.id;
      if (id) void moderate(id, 'reject');
    });
  });
}

async function moderate(id: string, action: 'approve' | 'reject'): Promise<void> {
  const response = await wsJsonRequest<{ error?: string }>(`/admin/api/requests/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    window.alert(response.error || `Ошибка ${response.status}`);
    return;
  }

  await loadRequests();
}

function showLoginPanel(): void {
  loginPanel.classList.remove('hidden');
  requestsPanel.classList.add('hidden');
}

function showRequestsPanel(): void {
  requestsPanel.classList.remove('hidden');
  loginPanel.classList.add('hidden');
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
