import { useMemo } from 'react';
import { useChatStore } from '../../store/chatStore';
import { User } from '../../types/chat';
import { useI18n } from '../../i18n';

const ROLE_OPTIONS = ['member', 'moderator', 'admin', 'owner', 'muted', 'creator'] as const;

const canManageRole = (role: string): boolean => role === 'creator' || role === 'admin';

export function MemberSidebar() {
  const users = useChatStore((state) => state.users);
  const chatMode = useChatStore((state) => state.chatMode);
  const currentChannelId = useChatStore((state) => state.currentChannelId);
  const currentServerRole = useChatStore((state) => state.currentServerRole);
  const channelParticipantsByChannel = useChatStore((state) => state.channelParticipantsByChannel);
  const setChannelParticipantRole = useChatStore((state) => state.setChannelParticipantRole);
  const { t } = useI18n();

  const currentChannelParticipants = useMemo(() => {
    const ids = channelParticipantsByChannel[currentChannelId] || [];
    return ids
      .map((id) => users.find((user) => user.id === id))
      .filter((user): user is User => Boolean(user));
  }, [channelParticipantsByChannel, currentChannelId, users]);

  const canEditRoles = canManageRole(currentServerRole);
  const showServerMembers = chatMode === 'server' && currentChannelParticipants.length > 0;

  if (!showServerMembers) return null;

  return (
    <aside className="hidden h-full w-72 overflow-auto border-l border-borderGlow bg-panelSoft/90 p-4 xl:block">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-textMuted">{t('channel_members')}</h2>
      <section className="mb-2">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-textMuted/70">{t('roles')}</h3>
        <div className="space-y-1.5">
          {currentChannelParticipants.map((user) => (
            <div key={user.id} className="rounded-md border border-borderGlow/50 px-2 py-1.5">
              <div className="mb-1 flex items-center gap-2 text-sm text-text">
                <span className="grid h-6 w-6 place-items-center rounded-full border border-borderGlow bg-panel text-[10px]">
                  {user.avatar}
                </span>
                <span className="truncate">{user.displayName}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded border border-borderGlow px-1.5 py-0.5 text-[10px] uppercase text-textMuted">
                  {user.role || t('role_member')}
                </span>
                {canEditRoles && (
                  <select
                    value={user.role || 'creator'}
                    onChange={(event) => {
                      void setChannelParticipantRole(user.id, event.target.value);
                    }}
                    className="rounded border border-borderGlow bg-panel px-1.5 py-0.5 text-[10px] text-text"
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
