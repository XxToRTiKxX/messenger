import type { AuthUI } from './ui';

export function showError(ui: AuthUI, message: string): void {
  ui.errorContainer.textContent = message;
  ui.errorContainer.classList.add('show');
  ui.statusContainer.classList.remove('show');
}

export function showStatus(ui: AuthUI, message: string, type: 'info' | 'success' = 'info'): void {
  ui.statusContainer.textContent = message;
  ui.statusContainer.classList.add('show');
  ui.errorContainer.classList.remove('show');
  ui.statusContainer.style.color = type === 'success' ? '#97ffb7' : '#9bffb5';
}
