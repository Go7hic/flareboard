import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { formatPercent } from '../lib/format';
import { t } from '../lib/i18n';

export function statChangeDeltaClass(change: number) {
  if (change > 0) return 'positive';
  if (change < 0) return 'negative';
  return 'neutral';
}

/**
 * Signed change vs the previous period as a small chip (console v2). Color is direction × whether
 * up is good (`invertColors` for metrics where lower is better: bounce rate, errors, latency);
 * the comparison period is in the tooltip so the chip stays short.
 */
export function StatChangeDelta({
  change,
  invertColors = false,
  label,
}: {
  change: number;
  invertColors?: boolean;
  /** Overrides the tooltip text ("vs previous period"). */
  label?: string;
}) {
  const direction = statChangeDeltaClass(invertColors ? -change : change);
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : null;
  const digits = Math.abs(change) < 10 && change !== 0 ? 1 : 0;
  const text = change === 0 ? '0%' : formatPercent(Math.abs(change), { digits });
  const description = `${formatPercent(change, { digits, signed: true })} ${label ?? t('vsPreviousPeriod')}`;
  return (
    <span className={`delta ${direction}`} title={description} aria-label={description}>
      {Icon ? <Icon strokeWidth={2.25} aria-hidden /> : null}
      {text}
    </span>
  );
}
