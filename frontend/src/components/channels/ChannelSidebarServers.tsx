import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Channel } from '../../types/chat';
import { useI18n } from '../../i18n';
import { apiFetch } from '../../services/api';
import { useChatStore } from '../../store/chatStore';

const MAX_ICON_SIZE = 1024 * 1024 * 2;

type Props = {
  channels: Channel[];
  serverName: string;
  currentServerId: string;
  currentChannelId: string;
  unreadByChannel: Record<string, number>;
  selectChannel: (channelId: string) => Promise<void>;
  createChannel: (name: string, type?: 'text' | 'voice', categoryName?: string) => Promise<void>;
};

type ServerSettingsSection =
  | 'general'
  | 'appearance'
  | 'channels'
  | 'members'
  | 'roles'
  | 'security'
  | 'webhooks'
  | 'integrations';

type ServerRole = {
  id: string;
  name: string;
  permissions: Record<string, boolean>;
};

type ServerMember = {
  id: string;
  username: string;
  email?: string;
  serverRole: string;
  roleIds: string[];
};

const DEFAULT_PERMISSIONS: Record<string, boolean> = {
  sendMessages: true,
  editMessages: false,
  deleteMessages: false,
  manageChannels: false,
  manageRoles: false,
  manageServer: false
};

export function ChannelSidebarServers({
  channels,
  serverName,
  currentServerId,
  currentChannelId,
  unreadByChannel,
  selectChannel,
  createChannel
}: Props) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text');
  const [newChannelCategory, setNewChannelCategory] = useState('Общие');
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [serverSettingsSection, setServerSettingsSection] = useState<ServerSettingsSection>('general');
  const [serverNameDraft, setServerNameDraft] = useState('');
  const [categoryCreateOpen, setCategoryCreateOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categories, setCategories] = useState<string[]>(['Общие']);
  const [serverIconError, setServerIconError] = useState('');
  const [settingsStatus, setSettingsStatus] = useState('');
  const [roles, setRoles] = useState<ServerRole[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [baseRoles, setBaseRoles] = useState<string[]>(['creator', 'admin', 'moderator', 'member']);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePermissions, setNewRolePermissions] = useState<Record<string, boolean>>(DEFAULT_PERMISSIONS);
  const [selectedChannelVisibility, setSelectedChannelVisibility] = useState<string>('');
  const [visibilityRoles, setVisibilityRoles] = useState<string[]>([]);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const servers = useChatStore((state) => state.servers);
  const updateServerLocal = useChatStore((state) => state.updateServerLocal);
  const currentServerRole = useChatStore((state) => state.currentServerRole);

  const canManageServer = currentServerRole === 'creator' || currentServerRole === 'admin';

  const currentServer = useMemo(
    () => servers.find((server) => server.id === currentServerId),
    [servers, currentServerId]
  );

  const groupedChannels = useMemo(() => {
    const relevant = channels
      .filter((channel) => channel.serverId === currentServerId)
      .sort((a, b) => a.position - b.position);

    const grouped = new Map<string, Channel[]>();
    relevant.forEach((channel) => {
      const key = channel.category || 'Общие';
      const list = grouped.get(key) || [];
      list.push(channel);
      grouped.set(key, list);
    });

    return [...grouped.entries()].map(([category, channelsList]) => ({ category, channels: channelsList }));
  }, [channels, currentServerId]);

  const allRoleLabels = useMemo(() => {
    return [...new Set([...baseRoles, ...roles.map((role) => role.name)])];
  }, [baseRoles, roles]);

  const serverChannels = useMemo(
    () => channels.filter((channel) => channel.serverId === currentServerId),
    [channels, currentServerId]
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setShareOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setShareStatus('');
  }, [currentServerId]);

  useEffect(() => {
    if (!createOpen && !serverSettingsOpen && !categoryCreateOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCreateOpen(false);
        setServerSettingsOpen(false);
        setCategoryCreateOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen, serverSettingsOpen, categoryCreateOpen]);

  useEffect(() => {
    setServerNameDraft(currentServer?.name || serverName);
  }, [currentServer?.name, serverName]);

  const loadCategories = async () => {
    if (!currentServerId) return;
    try {
      const payload = await apiFetch<{ categories: Array<{ name: string }> }>(
        `/api/servers/${encodeURIComponent(currentServerId)}/categories`
      );
      const next = payload.categories.map((item) => item.name).filter(Boolean);
      setCategories(next.length ? next : ['Общие']);
      setNewChannelCategory((prev) => (next.includes(prev) ? prev : (next[0] || 'Общие')));
    } catch {
      setCategories(['Общие']);
    }
  };

  const loadRoles = async () => {
    if (!currentServerId || !canManageServer) return;
    try {
      const payload = await apiFetch<{ baseRoles: string[]; roles: ServerRole[] }>(
        `/api/servers/${encodeURIComponent(currentServerId)}/roles`
      );
      setBaseRoles(payload.baseRoles || ['creator', 'admin', 'moderator', 'member']);
      setRoles(payload.roles || []);
    } catch {
      setRoles([]);
    }
  };

  const loadMembers = async () => {
    if (!currentServerId || !canManageServer) return;
    try {
      const payload = await apiFetch<{ members: ServerMember[] }>(
        `/api/servers/${encodeURIComponent(currentServerId)}/members`
      );
      setMembers(payload.members || []);
    } catch {
      setMembers([]);
    }
  };

  useEffect(() => {
    void loadCategories();
  }, [currentServerId]);

  useEffect(() => {
    if (!serverSettingsOpen || !canManageServer) return;
    void loadRoles();
    void loadMembers();
  }, [canManageServer, currentServerId, serverSettingsOpen]);

  useEffect(() => {
    if (!selectedChannelVisibility) {
      setVisibilityRoles([]);
      return;
    }

    const loadVisibility = async () => {
      try {
        const payload = await apiFetch<{ roles: string[] }>(
          `/api/servers/${encodeURIComponent(currentServerId)}/channels/${encodeURIComponent(selectedChannelVisibility)}/visibility`
        );
        setVisibilityRoles(payload.roles || []);
      } catch {
        setVisibilityRoles([]);
      }
    };

    void loadVisibility();
  }, [currentServerId, selectedChannelVisibility]);

  const openCreateModal = () => {
    setCreateOpen(true);
    setMenuOpen(false);
    setShareOpen(false);
    setNewChannelName('');
    setNewChannelType('text');
    setNewChannelCategory(categories[0] || 'Общие');
  };

  const openServerSettings = () => {
    if (!canManageServer) return;
    if (currentServer?.name === 'Adaptivity') return;
    setServerSettingsOpen(true);
    setServerSettingsSection('general');
    setMenuOpen(false);
    setShareOpen(false);
    setSettingsStatus('');
  };

  const submitCreateChannel = async () => {
    const trimmed = newChannelName.trim();
    if (!trimmed) return;
    await createChannel(trimmed, newChannelType, newChannelCategory);
    setCreateOpen(false);
  };

  const shareInvite = async (kind: 'permanent' | 'temporary') => {
    if (!currentServerId) return;
    setShareBusy(true);
    setShareStatus('');
    try {
      const payload = await apiFetch<{ inviteUrl: string }>(
        `/api/servers/${encodeURIComponent(currentServerId)}/invite-links`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: kind === 'permanent' ? 'long_term' : 'one_time' })
        }
      );
      const link = payload.inviteUrl;
      try {
        await navigator.clipboard.writeText(link);
        setShareStatus(t('invite_copied'));
      } catch {
        setShareStatus(`Ссылка: ${link}`);
      }
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : t('invite_create_failed'));
    } finally {
      setShareBusy(false);
    }
  };

  const saveServerGeneral = async () => {
    if (!currentServerId) return;
    const trimmed = serverNameDraft.trim();
    if (!trimmed) return;
    try {
      const payload = await apiFetch<{ server: { name: string; iconUrl?: string } }>(
        `/api/servers/${encodeURIComponent(currentServerId)}/settings`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed })
        }
      );
      updateServerLocal(currentServerId, { name: payload.server.name, iconUrl: payload.server.iconUrl });
      setSettingsStatus('Сохранено');
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Ошибка сохранения');
    }
  };

  const onSelectServerImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setServerIconError('Нужен файл изображения (PNG/JPG/WebP).');
      return;
    }
    if (file.size > MAX_ICON_SIZE) {
      setServerIconError('Файл слишком большой. Максимум 2 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        setServerIconError('Не удалось прочитать файл.');
        return;
      }
      const image = new Image();
      image.onload = async () => {
        if (image.width !== 512 || image.height !== 512) {
          setServerIconError(`Текущий размер ${image.width}x${image.height}. Рекомендуется 512x512.`);
        } else {
          setServerIconError('');
        }
        if (currentServerId) {
          try {
            const payload = await apiFetch<{ server: { name: string; iconUrl?: string } }>(
              `/api/servers/${encodeURIComponent(currentServerId)}/settings`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ iconUrl: result })
              }
            );
            updateServerLocal(currentServerId, { name: payload.server.name, iconUrl: payload.server.iconUrl });
            setSettingsStatus('Изображение сервера обновлено.');
          } catch (error) {
            setSettingsStatus(error instanceof Error ? error.message : 'Ошибка обновления иконки');
          }
        }
      };
      image.onerror = () => setServerIconError('Не удалось обработать изображение.');
      image.src = result;
    };
    reader.onerror = () => setServerIconError('Ошибка чтения файла.');
    reader.readAsDataURL(file);
  };

  const addCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed || !currentServerId) return;
    try {
      await apiFetch(`/api/servers/${encodeURIComponent(currentServerId)}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      await loadCategories();
      setNewCategoryName('');
      setCategoryCreateOpen(false);
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Не удалось добавить категорию');
    }
  };

  const createRole = async () => {
    const name = newRoleName.trim();
    if (!name || !currentServerId) return;
    try {
      await apiFetch(`/api/servers/${encodeURIComponent(currentServerId)}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, permissions: newRolePermissions })
      });
      setNewRoleName('');
      setNewRolePermissions(DEFAULT_PERMISSIONS);
      await loadRoles();
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Ошибка создания роли');
    }
  };

  const updateRole = async (role: ServerRole) => {
    if (!currentServerId) return;
    try {
      await apiFetch(`/api/servers/${encodeURIComponent(currentServerId)}/roles/${encodeURIComponent(role.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: role.name, permissions: role.permissions })
      });
      await loadRoles();
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Ошибка обновления роли');
    }
  };

  const deleteRole = async (roleId: string) => {
    if (!currentServerId) return;
    try {
      await apiFetch(`/api/servers/${encodeURIComponent(currentServerId)}/roles/${encodeURIComponent(roleId)}`, {
        method: 'DELETE'
      });
      await loadRoles();
      await loadMembers();
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Ошибка удаления роли');
    }
  };

  const assignRolesToMember = async (memberId: string, roleIds: string[]) => {
    if (!currentServerId) return;
    await apiFetch(`/api/servers/${encodeURIComponent(currentServerId)}/members/${encodeURIComponent(memberId)}/roles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleIds })
    });
    await loadMembers();
  };

  const toggleVisibilityRole = async (roleName: string) => {
    if (!currentServerId || !selectedChannelVisibility) return;
    const next = visibilityRoles.includes(roleName)
      ? visibilityRoles.filter((role) => role !== roleName)
      : [...visibilityRoles, roleName];
    setVisibilityRoles(next);
    try {
      await apiFetch(`/api/servers/${encodeURIComponent(currentServerId)}/channels/${encodeURIComponent(selectedChannelVisibility)}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: next })
      });
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : 'Ошибка обновления видимости');
    }
  };

  return (
    <>
      <section className="relative rounded-xl border border-borderGlow bg-panel/70 p-2.5" ref={menuRef}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-textMuted/70">{t('server_label')}</p>
            <p className="truncate text-sm font-semibold text-text">{serverName}</p>
          </div>
          <button
            type="button"
            disabled={!currentServerId}
            onClick={() => {
              setMenuOpen((prev) => !prev);
              setShareOpen(false);
            }}
            className="h-8 w-8 rounded-md border border-borderGlow text-lg leading-none text-textMuted transition hover:border-accent/70 hover:text-text disabled:opacity-40"
            title={t('server_actions')}
          >
            ...
          </button>
        </div>

        {menuOpen && (
          <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-64 rounded-lg border border-borderGlow bg-panel p-2 shadow-neon">
            {!shareOpen && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => void shareInvite('permanent')}
                  className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-textMuted transition hover:border-borderGlow hover:bg-panelSoft hover:text-text"
                >
                  Пригласить
                </button>
                {canManageServer && (
                  <>
                    <button
                      type="button"
                      onClick={openCreateModal}
                      className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-textMuted transition hover:border-borderGlow hover:bg-panelSoft hover:text-text"
                    >
                      Добавить канал
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCategoryCreateOpen(true);
                        setMenuOpen(false);
                        setShareOpen(false);
                      }}
                      className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-textMuted transition hover:border-borderGlow hover:bg-panelSoft hover:text-text"
                    >
                      Добавить категорию
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-textMuted transition hover:border-borderGlow hover:bg-panelSoft hover:text-text"
                >
                  Поделиться
                </button>
                {canManageServer && currentServer?.name !== 'Adaptivity' && (
                  <button
                    type="button"
                    onClick={openServerSettings}
                    className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-textMuted transition hover:border-borderGlow hover:bg-panelSoft hover:text-text"
                  >
                    Настройки сервера
                  </button>
                )}
                {currentServerRole !== 'creator' && (
                  <button
                    type="button"
                    onClick={() => {
                      setShareStatus('Покинуть сервер: coming soon');
                      setShareOpen(true);
                    }}
                    className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-red-300 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200"
                  >
                    Покинуть сервер
                  </button>
                )}
              </div>
            )}
            {shareOpen && (
              <div className="space-y-2 rounded-md border border-borderGlow bg-panelSoft p-2">
                <p className="text-[11px] uppercase tracking-[0.15em] text-textMuted/75">{t('invite_type')}</p>
                <button
                  type="button"
                  disabled={shareBusy}
                  onClick={() => void shareInvite('permanent')}
                  className="w-full rounded-md border border-borderGlow px-3 py-2 text-left text-sm text-textMuted transition hover:border-accent/60 hover:text-text"
                >
                  {t('invite_permanent')}
                </button>
                <button
                  type="button"
                  disabled={shareBusy}
                  onClick={() => void shareInvite('temporary')}
                  className="w-full rounded-md border border-borderGlow px-3 py-2 text-left text-sm text-textMuted transition hover:border-accent/60 hover:text-text"
                >
                  {t('invite_temporary')}
                </button>
                {shareStatus && <p className="px-1 text-xs text-accent">{shareStatus}</p>}
              </div>
            )}
          </div>
        )}
      </section>

      <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-textMuted">{t('channels')}</h2>

      {groupedChannels.map((group) => (
        <section key={group.category}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-textMuted/70">{group.category}</h3>
          <div className="space-y-1.5">
            {group.channels.map((channel) => {
              const active = channel.id === currentChannelId;
              const unread = unreadByChannel[channel.id] ?? 0;
              return (
                <button
                  key={channel.id}
                  onClick={() => void selectChannel(channel.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                    active
                      ? 'border-accent bg-accent/15 text-text shadow-neon'
                      : 'border-transparent text-textMuted hover:border-borderGlow hover:bg-panel'
                  }`}
                >
                  <span className="truncate">{channel.type === 'voice' ? `🔊 ${channel.name}` : `# ${channel.name}`}</span>
                  {unread > 0 && channel.type === 'text' && (
                    <span className="rounded-full border border-accent/60 px-2 py-0.5 text-[11px] text-accent">{unread}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {createOpen && typeof document !== 'undefined' && createPortal(
        <>
          <button
            type="button"
            aria-label={t('close')}
            onClick={() => setCreateOpen(false)}
            className="fixed inset-0 z-[90] bg-black/35"
          />
          <aside className="fixed inset-0 z-[100] grid place-items-center p-4">
            <div className="w-full max-w-lg rounded-xl border border-borderGlow bg-panel p-5 shadow-neon">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-text">Создать канал</h3>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-md border border-borderGlow px-3 py-1 text-[11px] uppercase tracking-wider text-textMuted hover:border-accent hover:text-accent"
                >
                  {t('close')}
                </button>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-[0.14em] text-textMuted">{t('channel_name')}</span>
                  <input
                    autoFocus
                    value={newChannelName}
                    onChange={(event) => setNewChannelName(event.target.value)}
                    placeholder={t('add_channel')}
                    className="w-full rounded-md border border-borderGlow bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/80"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-[0.14em] text-textMuted">Категория</span>
                  <select
                    value={newChannelCategory}
                    onChange={(event) => setNewChannelCategory(event.target.value)}
                    className="w-full rounded-md border border-borderGlow bg-panelSoft px-3 py-2 text-sm text-text"
                  >
                    {categories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </label>

                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.14em] text-textMuted">{t('channel_type')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewChannelType('text')}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        newChannelType === 'text'
                          ? 'border-accent bg-accent/15 text-text'
                          : 'border-borderGlow bg-panelSoft text-textMuted hover:border-accent/60 hover:text-text'
                      }`}
                    >
                      {t('channel_type_text')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewChannelType('voice')}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        newChannelType === 'voice'
                          ? 'border-accent bg-accent/15 text-text'
                          : 'border-borderGlow bg-panelSoft text-textMuted hover:border-accent/60 hover:text-text'
                      }`}
                    >
                      {t('channel_type_voice')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-md border border-borderGlow px-3 py-2 text-xs uppercase tracking-[0.14em] text-textMuted hover:border-accent/60 hover:text-text"
                >
                  {t('close')}
                </button>
                <button
                  type="button"
                  onClick={() => void submitCreateChannel()}
                  disabled={!newChannelName.trim()}
                  className="rounded-md border border-accent/70 bg-accent/15 px-3 py-2 text-xs uppercase tracking-[0.14em] text-text disabled:opacity-40"
                >
                  {t('add')}
                </button>
              </div>
            </div>
          </aside>
        </>,
        document.body
      )}

      {categoryCreateOpen && typeof document !== 'undefined' && createPortal(
        <>
          <button type="button" onClick={() => setCategoryCreateOpen(false)} className="fixed inset-0 z-[90] bg-black/35" />
          <aside className="fixed inset-0 z-[100] grid place-items-center p-4">
            <div className="w-full max-w-md rounded-xl border border-borderGlow bg-panel p-4 shadow-neon">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-text">Добавить категорию</h3>
              <input
                autoFocus
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="Название категории"
                className="w-full rounded-md border border-borderGlow bg-panelSoft px-3 py-2 text-sm text-text outline-none"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryCreateOpen(false)}
                  className="rounded-md border border-borderGlow px-3 py-2 text-xs uppercase tracking-[0.14em] text-textMuted"
                >
                  {t('close')}
                </button>
                <button
                  type="button"
                  onClick={() => void addCategory()}
                  disabled={!newCategoryName.trim()}
                  className="rounded-md border border-accent/70 bg-accent/15 px-3 py-2 text-xs uppercase tracking-[0.14em] text-text disabled:opacity-40"
                >
                  Добавить
                </button>
              </div>
            </div>
          </aside>
        </>,
        document.body
      )}

      {serverSettingsOpen && typeof document !== 'undefined' && createPortal(
        <>
          <button type="button" onClick={() => setServerSettingsOpen(false)} className="fixed inset-0 z-[90] bg-black/35" />
          <aside className="fixed inset-0 z-[100] grid place-items-center p-4">
            <div className="flex h-[min(88vh,740px)] w-full max-w-5xl overflow-hidden rounded-xl border border-borderGlow bg-panel shadow-neon">
              <nav className="w-60 border-r border-borderGlow bg-panelSoft/90 p-3">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-text">Настройки сервера</h3>
                <div className="space-y-1">
                  {[
                    { id: 'general', label: 'Общие' },
                    { id: 'appearance', label: 'Внешний вид' },
                    { id: 'channels', label: 'Каналы' },
                    { id: 'members', label: 'Участники' },
                    { id: 'roles', label: 'Права и роли' },
                    { id: 'security', label: 'Безопасность' },
                    { id: 'webhooks', label: 'Вебхуки' },
                    { id: 'integrations', label: 'Интеграции' }
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setServerSettingsSection(item.id as ServerSettingsSection)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-xs uppercase tracking-wider ${
                        serverSettingsSection === item.id
                          ? 'border-accent bg-accent/15 text-text'
                          : 'border-transparent text-textMuted hover:border-borderGlow hover:bg-panel'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </nav>

              <section className="flex-1 overflow-auto p-5">
                <div className="mb-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setServerSettingsOpen(false)}
                    className="rounded-md border border-borderGlow px-3 py-1 text-[11px] uppercase tracking-wider text-textMuted hover:border-accent hover:text-accent"
                  >
                    {t('close')}
                  </button>
                </div>

                {serverSettingsSection === 'general' && (
                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-1 block text-xs uppercase tracking-[0.14em] text-textMuted">Название сервера</span>
                      <input
                        value={serverNameDraft}
                        onChange={(event) => setServerNameDraft(event.target.value)}
                        className="w-full max-w-lg rounded-md border border-borderGlow bg-panelSoft px-3 py-2 text-sm text-text outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void saveServerGeneral()}
                      className="rounded-md border border-accent/70 bg-accent/15 px-3 py-2 text-xs uppercase tracking-[0.14em] text-text"
                    >
                      Сохранить
                    </button>
                    {settingsStatus && <p className="text-xs text-accent">{settingsStatus}</p>}
                  </div>
                )}

                {serverSettingsSection === 'appearance' && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-borderGlow bg-panelSoft p-3">
                      <p className="mb-1 text-xs uppercase tracking-[0.14em] text-textMuted">Иконка сервера</p>
                      <p className="mb-2 text-xs text-textMuted/80">Загрузка изображения 512x512</p>
                      <div className="mb-2 flex items-center gap-3">
                        <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl border border-borderGlow bg-panel text-xs">
                          {currentServer?.iconUrl ? <img src={currentServer.iconUrl} alt={currentServer.name} className="h-full w-full object-cover" /> : currentServer?.icon || 'IC'}
                        </div>
                        <label className="cursor-pointer rounded-md border border-borderGlow px-3 py-2 text-xs uppercase tracking-[0.14em] text-textMuted hover:border-accent hover:text-text">
                          Загрузить
                          <input type="file" accept="image/*" className="hidden" onChange={onSelectServerImage} />
                        </label>
                      </div>
                      {serverIconError && <p className="text-xs text-red-300">{serverIconError}</p>}
                    </div>
                  </div>
                )}

                {serverSettingsSection === 'channels' && (
                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-1 block text-xs uppercase tracking-[0.14em] text-textMuted">Канал</span>
                      <select
                        value={selectedChannelVisibility}
                        onChange={(event) => setSelectedChannelVisibility(event.target.value)}
                        className="w-full max-w-lg rounded-md border border-borderGlow bg-panelSoft px-3 py-2 text-sm text-text"
                      >
                        <option value="">Выберите канал</option>
                        {serverChannels.map((channel) => (
                          <option key={channel.id} value={channel.id}>{channel.type === 'voice' ? `🔊 ${channel.name}` : `# ${channel.name}`}</option>
                        ))}
                      </select>
                    </label>

                    {selectedChannelVisibility && (
                      <div className="rounded-lg border border-borderGlow bg-panelSoft p-3">
                        <p className="mb-2 text-xs uppercase tracking-[0.14em] text-textMuted">Видимость по ролям</p>
                        <div className="grid gap-1">
                          {allRoleLabels.map((roleName) => (
                            <label key={roleName} className="flex items-center justify-between rounded px-2 py-1 text-xs text-textMuted hover:bg-panel">
                              <span>{roleName}</span>
                              <input
                                type="checkbox"
                                checked={visibilityRoles.includes(roleName)}
                                onChange={() => void toggleVisibilityRole(roleName)}
                              />
                            </label>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-textMuted/80">Если список пустой, канал виден всем.</p>
                      </div>
                    )}
                  </div>
                )}

                {serverSettingsSection === 'members' && (
                  <div className="space-y-2">
                    {members.map((member) => (
                      <div key={member.id} className="rounded-md border border-borderGlow/70 bg-panelSoft px-3 py-2">
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span>{member.username}</span>
                          <span className="text-xs uppercase tracking-[0.12em] text-textMuted">{member.serverRole}</span>
                        </div>
                        <div className="grid gap-1">
                          {roles.map((role) => (
                            <label key={`${member.id}-${role.id}`} className="flex items-center justify-between text-xs text-textMuted">
                              <span>{role.name}</span>
                              <input
                                type="checkbox"
                                checked={member.roleIds.includes(role.id)}
                                onChange={() => {
                                  const next = member.roleIds.includes(role.id)
                                    ? member.roleIds.filter((id) => id !== role.id)
                                    : [...member.roleIds, role.id];
                                  void assignRolesToMember(member.id, next).catch(() => undefined);
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {serverSettingsSection === 'roles' && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-borderGlow bg-panelSoft p-3">
                      <p className="mb-2 text-xs uppercase tracking-[0.14em] text-textMuted">Создать роль</p>
                      <input
                        value={newRoleName}
                        onChange={(event) => setNewRoleName(event.target.value)}
                        placeholder="Название роли"
                        className="mb-2 w-full rounded-md border border-borderGlow bg-panel px-3 py-2 text-sm text-text outline-none"
                      />
                      <div className="grid gap-1">
                        {Object.keys(newRolePermissions).map((key) => (
                          <label key={key} className="flex items-center justify-between text-xs text-textMuted">
                            <span>{key}</span>
                            <input
                              type="checkbox"
                              checked={Boolean(newRolePermissions[key])}
                              onChange={() =>
                                setNewRolePermissions((prev) => ({
                                  ...prev,
                                  [key]: !prev[key]
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => void createRole()}
                        className="mt-3 rounded-md border border-accent/70 bg-accent/15 px-3 py-2 text-xs uppercase tracking-[0.14em] text-text"
                      >
                        Создать роль
                      </button>
                    </div>

                    <div className="space-y-2">
                      {roles.map((role) => (
                        <div key={role.id} className="rounded-md border border-borderGlow/70 bg-panelSoft px-3 py-2">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <input
                              value={role.name}
                              onChange={(event) => {
                                setRoles((prev) => prev.map((item) => item.id === role.id ? { ...item, name: event.target.value } : item));
                              }}
                              className="w-full rounded-md border border-borderGlow bg-panel px-2 py-1 text-xs text-text"
                            />
                            <button
                              type="button"
                              onClick={() => void deleteRole(role.id)}
                              className="rounded-md border border-red-500/40 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-red-300"
                            >
                              Удалить
                            </button>
                          </div>
                          <div className="grid gap-1">
                            {Object.keys(DEFAULT_PERMISSIONS).map((key) => (
                              <label key={`${role.id}-${key}`} className="flex items-center justify-between text-xs text-textMuted">
                                <span>{key}</span>
                                <input
                                  type="checkbox"
                                  checked={Boolean(role.permissions?.[key])}
                                  onChange={() => {
                                    setRoles((prev) =>
                                      prev.map((item) =>
                                        item.id === role.id
                                          ? {
                                              ...item,
                                              permissions: {
                                                ...(item.permissions || {}),
                                                [key]: !item.permissions?.[key]
                                              }
                                            }
                                          : item
                                      )
                                    );
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => void updateRole(role)}
                            className="mt-2 rounded-md border border-accent/70 bg-accent/15 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-text"
                          >
                            Сохранить
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(serverSettingsSection === 'security' || serverSettingsSection === 'webhooks' || serverSettingsSection === 'integrations') && (
                  <div className="flex h-full min-h-[280px] items-end justify-center pb-4">
                    <p className="text-xs text-textMuted/70">coming soon...</p>
                  </div>
                )}
              </section>
            </div>
          </aside>
        </>,
        document.body
      )}
    </>
  );
}
