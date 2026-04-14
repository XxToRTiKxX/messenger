const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
};

export const ui = {
  loginButton: byId<HTMLButtonElement>('yandex-login'),
  googleButton: byId<HTMLButtonElement>('google-login'),
  telegramContainer: byId<HTMLDivElement>('telegram-login-container'),
  errorContainer: byId<HTMLDivElement>('error-container'),
  statusContainer: byId<HTMLDivElement>('status-container'),
  matrixCanvas: byId<HTMLCanvasElement>('matrix-bg'),
  oauthBox: byId<HTMLDivElement>('oauth-box'),
  credentialsForm: byId<HTMLFormElement>('credentials-form'),
  profileForm: byId<HTMLFormElement>('profile-form'),
  credentialsUsername: byId<HTMLInputElement>('credentials-username'),
  credentialsPassword: byId<HTMLInputElement>('credentials-password'),
  credentialsConfirmPassword: byId<HTMLInputElement>('credentials-confirm-password'),
  profileAbout: byId<HTMLTextAreaElement>('profile-about')
};

export type AuthUI = typeof ui;
