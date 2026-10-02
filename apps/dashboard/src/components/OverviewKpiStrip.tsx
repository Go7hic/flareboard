import { formatDurationSeconds, formatNumber, formatPercent } from '../lib/format';
import type { WebsiteStats } from '../lib/api';
import { t } from '../lib/i18n';
import { KpiCell, KpiStrip } from './KpiStrip';
import { StatChangeDelta } from './StatChangeDelta';

type StatValue = { value: number; change?: number };

/** The previous period's value implied by a value and its % change (undefined when unknown). */
function previousValue(stat: StatValue | undefined): number | undefined {
  if (!stat || stat.change === undefined) return undefined;
  const factor = 1 + stat.change / 100;
  return factor > 0 ? stat.value / factor : undefined;
}

function percentChange(current: number, previous: number | undefined): number | undefined {
  if (previous === undefined || !Number.isFinite(previous) || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

/**
 * Headline metrics for the KPI strip. Bounce rate and average visit duration are derived from
 * counts (bounces ÷ visits, total time ÷ visits): the raw totals mean little on their own.
 */
function overviewMetrics(stats: WebsiteStats) {
  const visits = stats.visits.value;
  const bounceRate = visits > 0 ? (stats.bounces.value / visits) * 100 : 0;
  const avgDuration = visits > 0 ? stats.totaltime.value / visits : 0;
  const prevVisits = previousValue(stats.visits);
  const prevBounces = previousValue(stats.bounces);
  const prevTotal = previousValue(stats.totaltime);
  const prevBounceRate =
    prevVisits && prevBounces !== undefined ? (prevBounces / prevVisits) * 100 : undefined;
  const prevAvgDuration = prevVisits && prevTotal !== undefined ? prevTotal / prevVisits : undefined;
  return {
    bounceRate,
    bounceRateChange: percentChange(bounceRate, prevBounceRate),
    avgDuration,
    avgDurationChange: percentChange(avgDuration, prevAvgDuration),
  };
}

function compareHint(label: string, value: string) {
  return `${label} ${value}`;
}

/**
 * Overview headline numbers (website overview, public demo, shared dashboards): visitors,
 * visits, pageviews, bounce rate and average visit duration, with deltas and an optional
 * comparison-period hint under each value.
 */
export function OverviewKpiStrip({
  stats,
  compare,
  compareLabel,
  pageviewsColor,
  visitorsColor,
}: {
  stats: WebsiteStats;
  compare?: WebsiteStats;
  compareLabel: string;
  pageviewsColor: string;
  visitorsColor: string;
}) {
  const derived = overviewMetrics(stats);
  const compareDerived = compare ? overviewMetrics(compare) : undefined;
  const delta = (change: number | undefined, invert = false) =>
    change === undefined ? undefined : <StatChangeDelta change={change} invertColors={invert} />;
  const hint = (value: string | undefined) => (value === undefined ? undefined : compareHint(compareLabel, value));

  return (
    <KpiStrip columns={5}>
      <KpiCell
        label={t('visitors')}
        keyColor={visitorsColor}
        value={formatNumber(stats.visitors.value)}
        delta={delta(stats.visitors.change)}
        hint={hint(compare ? formatNumber(compare.visitors.value) : undefined)}
      />
      <KpiCell
        label={t('visits')}
        value={formatNumber(stats.visits.value)}
        delta={delta(stats.visits.change)}
        hint={hint(compare ? formatNumber(compare.visits.value) : undefined)}
      />
      <KpiCell
        label={t('pageviews')}
        keyColor={pageviewsColor}
        value={formatNumber(stats.pageviews.value)}
        delta={delta(stats.pageviews.change)}
        hint={hint(compare ? formatNumber(compare.pageviews.value) : undefined)}
      />
      <KpiCell
        label={t('bounceRate')}
        value={formatPercent(derived.bounceRate, { digits: derived.bounceRate < 10 ? 1 : 0 })}
        delta={delta(derived.bounceRateChange, true)}
        hint={hint(compareDerived ? formatPercent(compareDerived.bounceRate) : undefined)}
      />
      <KpiCell
        label={t('avgDuration')}
        value={formatDurationSeconds(derived.avgDuration)}
        delta={delta(derived.avgDurationChange)}
        hint={hint(compareDerived ? formatDurationSeconds(compareDerived.avgDuration) : undefined)}
      />
    </KpiStrip>
  );
}
