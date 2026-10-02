import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';

export type RangePresetOption = '24h' | '7d' | '30d' | '90d';

/** Short date-range toggle for a card or result header (24 hours / 7 days / 30 days / 90 days). */
export function RangeSegmented<T extends RangePresetOption>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('segmented', className)} role="group" aria-label={t('dateRange')}>
      {options.map((option) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>
          {t(`workspaceRangeShort_${option}`)}
        </button>
      ))}
    </div>
  );
}
