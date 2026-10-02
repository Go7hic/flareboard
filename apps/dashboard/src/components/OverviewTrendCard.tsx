import { Line, LineChart } from 'recharts';
import { lineMark } from '../lib/chartMarks';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { AnalyticsChart } from './AnalyticsChart';
import { ChartLegend } from './ChartLegend';
import { EmptyState } from './EmptyState';
import { SectionCard } from './SectionCard';
import { Skeleton } from './ui/skeleton';

export type OverviewTrendRow = { x: string; pageviews: number; visitors: number };

/** Visitors and pageviews over time (overview, public demo, shared dashboards). */
export function OverviewTrendCard({
  data,
  loading = false,
  hourly = false,
  height = 300,
  className,
}: {
  data: OverviewTrendRow[];
  loading?: boolean;
  hourly?: boolean;
  height?: number;
  className?: string;
}) {
  const chartColors = useChartColors();
  return (
    <SectionCard
      className={className}
      title={t('trafficOverTime')}
      actions={
        <ChartLegend
          items={[
            { label: t('visitors'), color: 'var(--chart-visitors)' },
            { label: t('pageviews'), color: 'var(--chart-pageviews)' },
          ]}
        />
      }
    >
      {loading ? (
        <Skeleton className="w-full" style={{ height }} />
      ) : data.length > 0 ? (
        <div className="overview-trend-chart">
          <AnalyticsChart
            Chart={LineChart}
            data={data}
            responsive={{ height }}
            xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: hourly ? 32 : 24 }}
          >
            <Line
              dataKey="pageviews"
              name={t('pageviews')}
              stroke={chartColors.series.pageviews}
              {...lineMark(chartColors.panel)}
            />
            <Line
              dataKey="visitors"
              name={t('visitors')}
              stroke={chartColors.series.visitors}
              {...lineMark(chartColors.panel)}
            />
          </AnalyticsChart>
        </div>
      ) : (
        <EmptyState title={t('chartNoData')} description={t('noDataInPeriodHint')} />
      )}
    </SectionCard>
  );
}
