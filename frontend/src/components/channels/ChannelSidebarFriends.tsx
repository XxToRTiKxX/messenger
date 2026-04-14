import { FormEvent } from 'react';
import type { FriendItem } from '../../types/chat';
import { useI18n } from '../../i18n';

type Props = {
  username: string;
  setUsername: (value: string) => void;
  friends: FriendItem[];
  incoming: FriendItem[];
  outgoing: FriendItem[];
  activeFriendChatId: string | null;
  chatMode: 'server' | 'friends' | 'friend';
  openFriendChat: (friendUserId: string) => Promise<void>;
  sendFriendRequest: (username: string) => Promise<void>;
  respondToFriendRequest: (friendshipId: string, action: 'accept' | 'reject') => Promise<void>;
};

export function ChannelSidebarFriends({
  username,
  setUsername,
  friends,
  incoming,
  outgoing,
  activeFriendChatId,
  chatMode,
  openFriendChat,
  sendFriendRequest,
  respondToFriendRequest
}: Props) {
  const { t } = useI18n();

  const submitFriendRequest = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = username.trim();
    if (!value) return;
    void sendFriendRequest(value);
    setUsername('');
  };

  return (
    <section>
      <form onSubmit={submitFriendRequest} className="mb-3 flex gap-2">
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="username"
          className="min-w-0 flex-1 rounded border border-borderGlow bg-panel px-2 py-1.5 text-xs text-text outline-none"
        />
        <button type="submit" className="rounded border border-accent/60 px-2 py-1.5 text-xs text-accent">
          {t('add')}
        </button>
      </form>

      {incoming.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-textMuted/70">{t('incoming')}</h3>
          {incoming.map((friend) => (
            <div key={friend.id} className="rounded-md border border-borderGlow/60 px-2 py-1.5 text-xs">
              <div className="mb-1 truncate text-text">{friend.username}</div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => void respondToFriendRequest(friend.id, 'accept')}
                  className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-emerald-300"
                >
                  {t('accept')}
                </button>
                <button
                  type="button"
                  onClick={() => void respondToFriendRequest(friend.id, 'reject')}
                  className="rounded border border-red-500/40 px-1.5 py-0.5 text-red-300"
                >
                  {t('reject')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-textMuted/70">{t('outgoing')}</h3>
          {outgoing.map((friend) => (
            <div key={friend.id} className="truncate rounded-md border border-borderGlow/40 px-2 py-1.5 text-xs text-textMuted">
              {friend.username}
            </div>
          ))}
        </div>
      )}

      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-textMuted/70">{t('direct')}</h3>
      <div className="space-y-1.5">
        {friends.length === 0 && <div className="px-2 text-xs text-textMuted/70">{t('no_friends')}</div>}
        {friends.map((friend) => {
          const active = chatMode === 'friend' && activeFriendChatId === friend.userId;
          return (
            <button
              key={friend.userId}
              onClick={() => void openFriendChat(friend.userId)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                active
                  ? 'border-accent bg-accent/15 text-text shadow-neon'
                  : 'border-transparent text-textMuted hover:border-borderGlow hover:bg-panel'
              }`}
            >
              <span className="truncate">@ {friend.username}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
