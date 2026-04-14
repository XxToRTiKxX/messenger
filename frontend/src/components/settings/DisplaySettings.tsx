import { useEffect, useState } from 'react';
import { useChatStore } from '../../store/chatStore';
import { logout } from '../../services/api';
import { useI18n } from '../../i18n';

export function DisplaySettings() {
  const show = useChatStore((state) => state.showSettings);
  const theme = useChatStore((state) => state.theme);
  const locale = useChatStore((state) => state.locale);
  const setTheme = useChatStore((state) => state.setTheme);
  const setLocale = useChatStore((state) => state.setLocale);
  const toggleSettings = useChatStore((state) => state.toggleSettings);
  const { t } = useI18n();
  const [section, setSection] = useState<'account' | 'appearance' | 'effects'>('appearance');

  useEffect(() => {
    if (!show) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        toggleSettings(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [show, toggleSettings]);

  if (!show) return null;

  return (
    <>
      <button type="button" aria-label={t('close_settings')} onClick={() => toggleSettings(false)} className="fixed inset-0 z-30 bg-black/30" />
      <aside
        className="fixed inset-0 z-40 grid place-items-center p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            toggleSettings(false);
          }
        }}
      >
        <div className="flex w-full max-w-3xl overflow-hidden rounded-xl border border-borderGlow bg-panel shadow-neon">
          <nav className="w-52 border-r border-borderGlow bg-panelSoft/90 p-3">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-textMuted">{t('settings')}</h3>
            <div className="space-y-1">
              {[
                { id: 'appearance', label: t('theme') },
                { id: 'effects', label: t('effects') },
                { id: 'account', label: t('account') }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id as 'account' | 'appearance' | 'effects')}
                  className={`w-full rounded-md border px-3 py-2 text-left text-xs uppercase tracking-wider ${
                    section === item.id
                      ? 'border-accent bg-accent/15 text-text'
                      : 'border-transparent text-textMuted hover:border-borderGlow hover:bg-panel'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </nav>

          <div className="flex-1 p-5">
            <div className="mb-4 flex items-center justify-end">
              <button
                type="button"
                onClick={() => toggleSettings(false)}
                className="rounded-md border border-borderGlow px-3 py-1 text-[11px] uppercase tracking-wider text-textMuted hover:border-accent hover:text-accent"
              >
                {t('close')}
              </button>
            </div>
            {section === 'appearance' && (
              <div className="space-y-3 text-sm">
                <h4 className="text-sm font-semibold uppercase tracking-[0.15em] text-text">{t('theme')}</h4>
                <label className="flex items-center justify-between gap-2">
                  <span>{t('language')}</span>
                  <select
                    value={locale}
                    onChange={(event) => setLocale(event.target.value as 'ru' | 'en')}
                    className="rounded border border-borderGlow bg-panelSoft px-2 py-1"
                  >
                    <option value="ru">{t('language_option_ru')}</option>
                    <option value="en">{t('language_option_en')}</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>{t('theme_mode')}</span>
                  <select
                    value={theme.mode}
                    onChange={(event) => setTheme({ mode: event.target.value as 'matrix' | 'dark' })}
                    className="rounded border border-borderGlow bg-panelSoft px-2 py-1"
                  >
                    <option value="matrix">{t('theme_matrix')}</option>
                    <option value="dark">{t('theme_dark')}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block">{t('glow_intensity', { value: theme.glowIntensity.toFixed(2) })}</span>
                  <input
                    type="range"
                    min={0.2}
                    max={1.4}
                    step={0.05}
                    value={theme.glowIntensity}
                    onChange={(event) => setTheme({ glowIntensity: Number(event.target.value) })}
                    className="w-full"
                  />
                </label>
              </div>
            )}

            {section === 'effects' && (
              <div className="space-y-3 text-sm">
                <h4 className="text-sm font-semibold uppercase tracking-[0.15em] text-text">{t('visual_effects')}</h4>
                <label className="flex items-center justify-between gap-2">
                  <span>{t('background_fx_enabled')}</span>
                  <input
                    type="checkbox"
                    checked={theme.backgroundFxEnabled}
                    onChange={(event) => setTheme({ backgroundFxEnabled: event.target.checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>{t('background_fx_mode')}</span>
                  <select
                    value={theme.backgroundFxMode}
                    onChange={(event) =>
                      setTheme({
                        backgroundFxMode: event.target.value as 'matrix_rain' | 'points_ambient' | 'points_server'
                      })
                    }
                    className="rounded border border-borderGlow bg-panelSoft px-2 py-1"
                  >
                    <option value="matrix_rain">{t('matrix_rain')}</option>
                    <option value="points_ambient">{t('points_ambient')}</option>
                    <option value="points_server">{t('points_server')}</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>{t('crt_effect')}</span>
                  <input type="checkbox" checked={theme.crt} onChange={(event) => setTheme({ crt: event.target.checked })} />
                </label>
              </div>
            )}

            {section === 'account' && (
              <div className="space-y-3 text-sm">
                <h4 className="text-sm font-semibold uppercase tracking-[0.15em] text-text">{t('account')}</h4>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="w-full rounded-md border border-red-500/40 px-3 py-2 text-xs uppercase tracking-wider text-red-300 hover:border-red-400"
                >
                  {t('logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
