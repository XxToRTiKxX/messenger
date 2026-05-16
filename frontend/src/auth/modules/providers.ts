import type { AuthProviders } from './types';
import type { AuthUI } from './ui';
import { wsJsonRequest } from '../../services/wsRequest';

export function renderTelegramWidget(ui: AuthUI, botUsername: string): void {
  ui.telegramContainer.innerHTML = `
    <span class="telegram-button-shell">Войти через Telegram</span>
    <div id="telegram-widget-hitbox" class="telegram-widget-hitbox" aria-hidden="true"></div>
  `;
  ui.telegramContainer.title = `Вход через @${botUsername}`;
  const hitbox = ui.telegramContainer.querySelector<HTMLDivElement>('#telegram-widget-hitbox');
  if (!hitbox) return;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://telegram.org/js/telegram-widget.js?22';
  script.setAttribute('data-telegram-login', botUsername);
  script.setAttribute('data-size', 'large');
  script.setAttribute('data-auth-url', '/auth/telegram/callback');
  script.setAttribute('data-request-access', 'write');
  script.setAttribute('data-radius', '10');
  hitbox.appendChild(script);
}

export async function initProviders(ui: AuthUI): Promise<void> {
  try {
    const response = await wsJsonRequest<AuthProviders>('/auth/providers');
    if (!response.ok || !response.data) {
      throw new Error(response.error || `HTTP ${response.status}`);
    }
    const providers = response.data;

    if (!providers.yandex?.enabled) {
      ui.loginButton.disabled = true;
      ui.loginButton.title = 'Yandex OAuth не настроен';
    }

    if (!providers.google?.enabled) {
      ui.googleButton.disabled = true;
      ui.googleButton.title = 'Google OAuth не настроен';
    }

    if (providers.telegram?.enabled && providers.telegram.botUsername) {
      renderTelegramWidget(ui, providers.telegram.botUsername);
    } else {
      ui.telegramContainer.textContent = 'Telegram вход не настроен';
    }
  } catch {
    ui.telegramContainer.textContent = 'Не удалось загрузить настройки авторизации';
  }
}
