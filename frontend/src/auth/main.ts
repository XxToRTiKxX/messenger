import './style.css';
import { initClientLogger } from '../shared/clientLogger';
import { startMatrixRain } from '../shared/matrixRain';
import { ui } from './modules/ui';
import { showError, showStatus } from './modules/status';
import { initProviders } from './modules/providers';
import { enterOnboardingMode, submitCredentials, submitProfile } from './modules/onboarding';

initClientLogger({
  app: 'auth',
  endpoint: '/api/client-log'
});

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

async function checkAuthStatus(): Promise<void> {
  try {
    const response = await fetch('/auth/status', {
      headers: { Accept: 'application/json' }
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return;

    const data = (await response.json()) as { authenticated?: boolean; user?: { username?: string } };
    if (data.authenticated && data.user?.username) {
      showStatus(ui, `Вы уже вошли как: ${data.user.username}`, 'success');
    }
  } catch {
    // no-op
  }
}

function initMatrixBackground(): void {
  const controller = startMatrixRain(ui.matrixCanvas);
  window.addEventListener('beforeunload', () => {
    controller.stop();
  });
}
