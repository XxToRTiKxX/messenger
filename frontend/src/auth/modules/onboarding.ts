import type { AuthUI } from './ui';
import { showError, showStatus } from './status';

export function enterOnboardingMode(ui: AuthUI, activeStage: string): void {
  ui.oauthBox.classList.add('hidden');
  ui.credentialsForm.classList.add('hidden');
  ui.profileForm.classList.add('hidden');

  if (activeStage === 'profile') {
    ui.profileForm.classList.remove('hidden');
    showStatus(ui, 'Шаг 2/2: заполните информацию о себе.', 'success');
    return;
  }

  ui.credentialsForm.classList.remove('hidden');
  showStatus(ui, 'Шаг 1/2: задайте логин и пароль.', 'success');
}

export async function submitCredentials(ui: AuthUI, onboardingToken: string | null): Promise<void> {
  const username = ui.credentialsUsername.value.trim();
  const password = ui.credentialsPassword.value;
  const confirmPassword = ui.credentialsConfirmPassword.value;

  try {
    showStatus(ui, 'Сохраняю логин и пароль...');
    const response = await fetch('/auth/onboarding/credentials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        token: onboardingToken,
        username,
        password,
        confirmPassword
      })
    });

    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    showStatus(ui, 'Логин и пароль сохранены. Заполните информацию о себе.', 'success');
    enterOnboardingMode(ui, 'profile');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка сохранения логина/пароля';
    showError(ui, message);
  }
}

export async function submitProfile(ui: AuthUI, onboardingToken: string | null): Promise<void> {
  const about = ui.profileAbout.value.trim();

  try {
    showStatus(ui, 'Отправляю данные на модерацию...');
    const response = await fetch('/auth/onboarding/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        token: onboardingToken,
        about
      })
    });

    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    window.location.href = '/auth/?pending=1';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка отправки информации';
    showError(ui, message);
  }
}
