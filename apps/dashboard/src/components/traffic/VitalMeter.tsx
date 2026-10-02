import { formatPercent } from '../../lib/format';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import type { VitalDistribution } from './vitals';

/**
 * Share of page loads rated good / needs improvement / poor as one thin segmented bar.
 * Status colors carry meaning here (rating), and the label spells the split out.
 */
export function VitalMeter({
  dist,
  className,
}: {
  dist: VitalDistribution | null | undefined;
  className?: string;
}) {
  const total = dist?.total ?? 0;
  if (!dist || !total) return <span className={cn('traffic-meter is-empty', className)} aria-hidden />;
  const segments = [
    { key: 'good', value: dist.good, label: t('cwvGood') },
    { key: 'ni', value: dist.needsImprovement, label: t('cwvNeedsImprovement') },
    { key: 'poor', value: dist.poor, label: t('cwvPoor') },
  ];
  const description = segments
    .map((segment) => `${segment.label} ${formatPercent((segment.value / total) * 100)}`)
    .join(' · ');
  return (
    <span className={cn('traffic-meter', className)} role="img" aria-label={description} title={description}>
      {segments.map((segment) =>
        segment.value > 0 ? (
          <span
            key={segment.key}
            className={`traffic-meter-segment is-${segment.key}`}
            style={{ flexGrow: segment.value }}
          />
        ) : null,
      )}
    </span>
  );
}
