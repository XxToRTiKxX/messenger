import { useI18n } from '../../i18n';

export function TypingIndicator({ names }: { names: string[] }) {
  const { t } = useI18n();
  if (names.length === 0) return null;
  const firstName = names[0] ?? t('someone');

  const label =
    names.length === 1
      ? t('typing_single', { name: firstName })
      : t('typing_many', {
          names: names.slice(0, 2).join(', '),
          extra: names.length > 2 ? ` +${names.length - 2}` : ''
        });

  return (
    <div className="px-4 pt-1 text-xs text-textMuted">
      <span className="inline-flex items-center gap-2">
        <span>{label}</span>
        <span className="inline-flex gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:220ms]" />
        </span>
      </span>
    </div>
  );
}
