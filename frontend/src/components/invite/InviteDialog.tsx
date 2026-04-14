import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../services/api';
import { useChatStore } from '../../store/chatStore';
import { makeAvatar } from '../../store/chatStore/helpers';
import { useI18n } from '../../i18n';

type InvitePreview = {
  serverId: string;
  serverName: string;
  isExpired: boolean;
  canAccept: boolean;
  wrongUser: boolean;
};

type InviteAcceptResult = {
  alreadyMember: boolean;
  server: {
    id: string;
    name: string;
  };
};

type Props = {
  inviteCode: string;
  onClose: () => void;
};

export function InviteDialog({ inviteCode, onClose }: Props) {
  const { t, locale } = useI18n();
  const servers = useChatStore((state) => state.servers);
  const selectServer = useChatStore((state) => state.selectServer);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptResult, setAcceptResult] = useState<InviteAcceptResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<InvitePreview>(`/api/invites/${encodeURIComponent(inviteCode)}`);
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('invite_failed_load'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [inviteCode, locale]);

  const currentServerId = acceptResult?.server.id ?? preview?.serverId ?? '';
  const currentServerName = acceptResult?.server.name ?? preview?.serverName ?? t('server_unknown');

  const alreadyMember = useMemo(() => {
    if (acceptResult?.alreadyMember) return true;
    return servers.some((server) => server.id === currentServerId);
  }, [acceptResult, servers, currentServerId]);

  const openServer = async () => {
    if (!currentServerId) return;

    if (!servers.some((server) => server.id === currentServerId)) {
      useChatStore.setState((state) => ({
        servers: [...state.servers, { id: currentServerId, name: currentServerName, icon: makeAvatar(currentServerName), role: 'member' }]
      }));
    }

    await selectServer(currentServerId);
    onClose();
  };

  const acceptInvite = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<InviteAcceptResult>(`/api/invites/${encodeURIComponent(inviteCode)}/accept`, {
        method: 'POST'
      });
      setAcceptResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invite_failed_accept'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" aria-label={t('close')} onClick={onClose} className="fixed inset-0 z-30 bg-black/40" />
      <aside
        className="fixed inset-0 z-40 grid place-items-center p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="w-full max-w-lg rounded-xl border border-borderGlow bg-panel p-5 shadow-neon">
          <h3 className="mb-2 text-lg font-semibold text-text">{t('invite_title')}</h3>

          {loading && <p className="text-sm text-textMuted">{t('app_loading')}</p>}

          {!loading && error && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}

          {!loading && !error && (
            <div className="space-y-3">
              <p className="text-sm text-textMuted">
                {t('invite_server_label')}: <span className="font-semibold text-text">{currentServerName}</span>
              </p>

              {preview && preview.isExpired && <p className="text-sm text-red-300">{t('invite_expired')}</p>}
              {preview && preview.wrongUser && <p className="text-sm text-red-300">{t('invite_wrong_user')}</p>}

              {(alreadyMember || acceptResult?.alreadyMember) && (
                <p className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">{t('invite_already_member')}</p>
              )}

              {acceptResult && !acceptResult.alreadyMember && (
                <p className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">{t('invite_joined')}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-borderGlow px-3 py-1.5 text-xs uppercase tracking-wider text-textMuted hover:border-accent"
                >
                  {t('close')}
                </button>

                {!acceptResult && preview?.canAccept && !alreadyMember && (
                  <button
                    type="button"
                    onClick={() => void acceptInvite()}
                    disabled={busy}
                    className="rounded-md border border-accent bg-accent/20 px-3 py-1.5 text-xs uppercase tracking-wider text-text hover:bg-accent/30 disabled:opacity-60"
                  >
                    {t('invite_join_server')}
                  </button>
                )}

                {(alreadyMember || !!acceptResult) && (
                  <button
                    type="button"
                    onClick={() => void openServer()}
                    className="rounded-md border border-accent bg-accent/20 px-3 py-1.5 text-xs uppercase tracking-wider text-text hover:bg-accent/30"
                  >
                    {t('invite_open_server')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
