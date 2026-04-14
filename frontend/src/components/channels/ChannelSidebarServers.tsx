import { useEffect, useMemo, useRef, useState } from 'react';
import type { Channel } from '../../types/chat';
import { useI18n } from '../../i18n';
import { apiFetch } from '../../services/api';

const categoryOrder: Array<'INFO' | 'GENERAL' | 'DEV' | 'VOICE'> = ['INFO', 'GENERAL', 'DEV', 'VOICE'];
const categoryLabelKey: Record<'INFO' | 'GENERAL' | 'DEV' | 'VOICE', string> = {
  INFO: 'cat_info',
  GENERAL: 'cat_general',
  DEV: 'cat_dev',
  VOICE: 'cat_voice'
};

type Props = {
  channels: Channel[];
  serverName: string;
  currentServerId: string;
  currentChannelId: string;
  unreadByChannel: Record<string, number>;
  selectChannel: (channelId: string) => Promise<void>;
  createChannel: (name: string) => Promise<void>;
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
  const menuRef = useRef<HTMLDivElement | null>(null);

  const groupedChannels = useMemo(() => {
    const relevant = channels.filter((channel) => channel.serverId === currentServerId);
    return categoryOrder
      .map((category) => ({
        category,
        channels: relevant.filter((channel) => channel.category === category)
      }))
      .filter((entry) => entry.channels.length > 0);
  }, [channels, currentServerId]);

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
        window.prompt(t('invite_copy_manual'), link);
        setShareStatus(t('invite_copy_prompt_opened'));
      }
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : t('invite_create_failed'));
    } finally {
      setShareBusy(false);
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
              const name = window.prompt(t('add_channel'));
              if (name) void createChannel(name);
            }}
            className="rounded-md border border-borderGlow px-2 py-1 text-[11px] text-textMuted transition hover:border-accent/70 hover:text-text disabled:opacity-40"
            title={t('add_channel')}
          >
            + {t('add')}
          </button>
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
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="w-full rounded-md border border-transparent px-3 py-2 text-left text-sm text-textMuted transition hover:border-borderGlow hover:bg-panelSoft hover:text-text"
              >
                {t('server_share')}
              </button>
            )}
            {shareOpen && (
              <div className="space-y-2 rounded-md border border-borderGlow bg-panelSoft/80 p-2">
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

      {groupedChannels.map((group) => (
        <section key={group.category}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-textMuted/70">{t(categoryLabelKey[group.category])}</h3>
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
    </>
  );
}
