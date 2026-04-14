import { useI18n } from '../../i18n';

const emojis = ['😀', '😎', '🤖', '🚀', '💾', '⚡', '🛰️', '🟢', '🧠', '🔥'];

interface Props {
  open: boolean;
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ open, onSelect }: Props) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="absolute bottom-16 left-4 z-30 w-60 rounded-lg border border-borderGlow bg-panel p-3 shadow-neon">
      <div className="mb-2 text-[11px] uppercase tracking-[0.15em] text-textMuted">{t('emoji_picker')}</div>
      <div className="grid grid-cols-5 gap-2">
        {emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onSelect(emoji)}
            className="grid h-9 w-9 place-items-center rounded-md border border-borderGlow bg-panelSoft text-lg hover:border-accent hover:bg-accent/10"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
