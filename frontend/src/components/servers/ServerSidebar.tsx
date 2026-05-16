import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '../../store/chatStore';
import { useI18n } from '../../i18n';

const MAX_ICON_SIZE = 1024 * 1024 * 2;

export function ServerSidebar() {
  const servers = useChatStore((state) => state.servers);
  const chatMode = useChatStore((state) => state.chatMode);
  const currentServerId = useChatStore((state) => state.currentServerId);
  const openFriendsHub = useChatStore((state) => state.openFriendsHub);
  const selectServer = useChatStore((state) => state.selectServer);
  const createServer = useChatStore((state) => state.createServer);
  const toggleSettings = useChatStore((state) => state.toggleSettings);
  const { t } = useI18n();
  const friendsHubActive = chatMode !== 'server';
  const [createOpen, setCreateOpen] = useState(false);
  const [serverName, setServerName] = useState('');
  const [iconPreview, setIconPreview] = useState('');
  const [iconError, setIconError] = useState('');

  useEffect(() => {
    if (!createOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCreateOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen]);

  const resetCreateForm = () => {
    setServerName('');
    setIconPreview('');
    setIconError('');
  };

  const openCreateModal = () => {
    resetCreateForm();
    setCreateOpen(true);
  };

  const onSelectIcon = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setIconError('Только изображение (PNG/JPG/WebP).');
      return;
    }
    if (file.size > MAX_ICON_SIZE) {
      setIconError('Файл слишком большой. До 2 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      if (!value) {
        setIconError('Не удалось прочитать изображение.');
        return;
      }
      setIconPreview(value);
      setIconError('');
    };
    reader.onerror = () => {
      setIconError('Ошибка чтения изображения.');
    };
    reader.readAsDataURL(file);
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = serverName.trim();
    if (!trimmed) return;
    await createServer(trimmed, iconPreview || undefined);
    setCreateOpen(false);
  };

  return (
    <>
      <aside className="flex h-full w-20 flex-col items-center gap-3 border-r border-borderGlow bg-panel/95 p-3 backdrop-blur-sm">
        <div className="flex w-full flex-1 flex-col items-center gap-3">
          <button
            type="button"
            onClick={openFriendsHub}
            className={`h-12 w-12 rounded-2xl border text-xs font-semibold tracking-wider transition ${
              friendsHubActive
                ? 'border-accent bg-accent/20 text-accent shadow-neon'
                : 'border-borderGlow bg-panelSoft text-textMuted hover:border-accent/70 hover:text-text'
            }`}
            title={t('friends')}
          >
            DM
          </button>

          {servers.map((server) => {
            const active = chatMode === 'server' && server.id === currentServerId;
            return (
              <button
                key={server.id}
                onClick={() => void selectServer(server.id)}
                className={`grid h-12 w-12 place-items-center overflow-hidden rounded-2xl border text-xs font-semibold tracking-wider transition ${
                  active
                    ? 'border-accent bg-accent/20 text-accent shadow-neon'
                    : 'border-borderGlow bg-panelSoft text-textMuted hover:border-accent/70 hover:text-text'
                }`}
                title={`${server.name}${server.role ? ` (${server.role})` : ''}`}
              >
                {server.iconUrl ? (
                  <img src={server.iconUrl} alt={server.name} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  server.icon
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-1 h-12 w-12 rounded-2xl border border-dashed border-borderGlow text-xl text-textMuted transition hover:border-accent hover:text-accent"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={() => toggleSettings(true)}
          className="mt-auto h-11 w-11 rounded-xl border border-borderGlow bg-panelSoft text-lg text-textMuted transition hover:border-accent hover:text-accent"
          title={t('settings')}
        >
          ⚙
        </button>
      </aside>

      {createOpen && typeof document !== 'undefined' && createPortal(
        <>
          <button
            type="button"
            aria-label={t('close')}
            onClick={() => setCreateOpen(false)}
            className="fixed inset-0 z-[90] bg-black/35"
          />
          <aside className="fixed inset-0 z-[100] grid place-items-center p-4">
            <form
              onSubmit={(event) => {
                void submitCreate(event);
              }}
              className="w-full max-w-lg rounded-xl border border-borderGlow bg-panel p-5 shadow-neon"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-text">Создание сервера</h3>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-md border border-borderGlow px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-textMuted hover:border-accent hover:text-accent"
                >
                  {t('close')}
                </button>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-[0.14em] text-textMuted">Название</span>
                <input
                  autoFocus
                  value={serverName}
                  onChange={(event) => setServerName(event.target.value)}
                  placeholder={t('add_server')}
                  className="w-full rounded-md border border-borderGlow bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/80"
                />
              </label>

              <div className="mt-4 rounded-lg border border-borderGlow bg-panelSoft p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.14em] text-textMuted">Картинка сервера</p>
                  <span className="text-[10px] text-textMuted/80">Рекомендуется 512x512</span>
                </div>

                <div className="mb-2 flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl border border-borderGlow bg-panel text-xs">
                    {iconPreview ? <img src={iconPreview} alt="Server icon" className="h-full w-full object-cover" /> : 'ICON'}
                  </div>
                  <label className="cursor-pointer rounded-md border border-borderGlow px-3 py-2 text-xs uppercase tracking-[0.14em] text-textMuted hover:border-accent hover:text-text">
                    Загрузить
                    <input type="file" accept="image/*" className="hidden" onChange={onSelectIcon} />
                  </label>
                </div>
                {iconError && <p className="text-xs text-red-300">{iconError}</p>}
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-md border border-borderGlow px-3 py-2 text-xs uppercase tracking-[0.14em] text-textMuted hover:border-accent/60 hover:text-text"
                >
                  {t('close')}
                </button>
                <button
                  type="submit"
                  disabled={!serverName.trim()}
                  className="rounded-md border border-accent/70 bg-accent/15 px-3 py-2 text-xs uppercase tracking-[0.14em] text-text disabled:opacity-40"
                >
                  Создать
                </button>
              </div>
            </form>
          </aside>
        </>,
        document.body
      )}
    </>
  );
}
