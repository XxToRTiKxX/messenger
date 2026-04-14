import { useChatStore } from '../../store/chatStore';
import { useI18n } from '../../i18n';

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

  return (
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
              className={`h-12 w-12 rounded-2xl border text-xs font-semibold tracking-wider transition ${
                active
                  ? 'border-accent bg-accent/20 text-accent shadow-neon'
                  : 'border-borderGlow bg-panelSoft text-textMuted hover:border-accent/70 hover:text-text'
              }`}
              title={`${server.name}${server.role ? ` (${server.role})` : ''}`}
            >
              {server.icon}
            </button>
          );
        })}
        <button
          onClick={() => {
            const name = window.prompt(t('add_server'));
            if (name) void createServer(name);
          }}
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
  );
}
