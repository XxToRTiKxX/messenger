import './style.css';
import { startMatrixRain } from '../shared/matrixRain';
import { ui } from './modules/ui';
import { showError, showStatus } from './modules/status';
import { initProviders } from './modules/providers';
import { enterOnboardingMode, submitCredentials, submitProfile } from './modules/onboarding';
import { wsJsonRequest } from '../services/wsRequest';

const urlParams = new URLSearchParams(window.location.search);
const queryError = urlParams.get('error');
const pending = urlParams.get('pending');
const rejected = urlParams.get('rejected');
const stage = urlParams.get('stage');
const onboardingToken = urlParams.get('onboarding');

initMatrixBackground();
void initProviders(ui);
void checkAuthStatus();

if (queryError) {
  showError(ui, decodeURIComponent(queryError));
  window.history.replaceState({}, document.title, '/auth/');
}

if (pending === '1') {
  showStatus(ui, 'Ожидание подтверждения администратора.', 'success');
}

if (rejected === '1') {
  showError(ui, 'Заявка отклонена администратором. Свяжитесь с администратором сервиса.');
}

if (onboardingToken) {
  enterOnboardingMode(ui, stage || 'credentials');
}

ui.localLoginButton.addEventListener('click', () => {
  showPasswordLoginMode();
});

ui.backToOauth.addEventListener('click', () => {
  showOauthMode();
});

ui.loginButton.addEventListener('click', () => {
  showStatus(ui, 'Перенаправление на Яндекс...');
  ui.loginButton.disabled = true;
  window.location.href = '/auth/yandex';
});

ui.googleButton.addEventListener('click', () => {
  showStatus(ui, 'Перенаправление в Google...');
  ui.googleButton.disabled = true;
  window.location.href = '/auth/google';
});

ui.credentialsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitCredentials(ui, onboardingToken);
});

ui.profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitProfile(ui, onboardingToken);
});

ui.passwordLoginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitPasswordLogin();
});

async function checkAuthStatus(): Promise<void> {
  try {
    const response = await wsJsonRequest<{ authenticated?: boolean; user?: { username?: string } }>('/auth/status');
    if (!response.ok || !response.data) return;
    const data = response.data;
    if (data.authenticated && data.user?.username) {
      showStatus(ui, `Вы уже вошли как: ${data.user.username}`, 'success');
    }
  } catch {
    // no-op
  }
}

function showPasswordLoginMode(): void {
  ui.oauthBox.classList.add('hidden');
  ui.passwordLoginForm.classList.remove('hidden');
  ui.passwordLoginUsername.focus();
}

function showOauthMode(): void {
  ui.passwordLoginForm.classList.add('hidden');
  ui.oauthBox.classList.remove('hidden');
  ui.localLoginButton.focus();
}

async function submitPasswordLogin(): Promise<void> {
  const username = ui.passwordLoginUsername.value.trim();
  const password = ui.passwordLoginPassword.value;
  if (!username || !password) {
    showError(ui, 'Укажите логин и пароль');
    return;
  }

  try {
    showStatus(ui, 'Проверяю логин и пароль...');
    ui.passwordLoginSubmit.disabled = true;

    const response = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }

    showStatus(ui, 'Успешный вход. Перехожу в приложение...', 'success');
    window.location.href = '/app/';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось выполнить вход';
    showError(ui, message);
  } finally {
    ui.passwordLoginSubmit.disabled = false;
  }
}

function initMatrixBackground(): void {
  const controller = startMatrixRain(ui.matrixCanvas);
  window.addEventListener('beforeunload', () => {
    controller.stop();
  });
}
