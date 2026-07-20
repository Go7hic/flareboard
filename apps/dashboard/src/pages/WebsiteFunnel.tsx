import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Bar, BarChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { DataViewState } from '../components/DataViewState';
import { EventCatalogPicker } from '../components/EventCatalogPicker';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

export default function WebsiteFunnelPage() {
  const chartColors = useChartColors();
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone } =
    useWebsiteReportContext('30d');
  const [funnelSteps, setFunnelSteps] = useState(['signup', 'purchase']);

  const funnelStepsParam = funnelSteps.join(',');

  const funnelQuery = useQuery({
    queryKey: ['reports-funnel', websiteId, funnelStepsParam, range, segmentId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<{ steps: Array<{ step: string; count: number; rate: number }>; conversion: number }>(
        reportUrl('funnel', `&steps=${encodeURIComponent(funnelStepsParam)}`),
      ),
  });

  const funnelChartData = useMemo(
    () => (funnelQuery.data?.steps ?? []).map((s) => ({ name: s.step, count: s.count })),
    [funnelQuery.data?.steps],
  );

  const funnelHasData = useMemo(
    () => (funnelQuery.data?.steps ?? []).some((s) => s.count > 0),
    [funnelQuery.data?.steps],
  );

  return (
    <div className="page page-funnel">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteReportControls
            range={range}
            onRangeChange={setRange}
            segmentId={segmentId}
            onSegmentChange={setSegmentId}
            segments={segments}
            timezone={timezone}
          />
        }
      />
      <section className="panel section-gap">
        <div className="field" style={{ maxWidth: '28rem' }}>
          <EventCatalogPicker
            mode="multi"
            websiteId={websiteId}
            value={funnelSteps}
            onChange={setFunnelSteps}
            placeholder={t('funnelStepsPlaceholder')}
            aria-label={t('funnel')}
          />
        </div>
        <DataViewState
          loading={funnelQuery.isLoading}
          error={funnelQuery.isError ? funnelQuery.error : null}
          onRetry={() => funnelQuery.refetch()}
          isEmpty={!funnelQuery.isLoading && (funnelChartData.length === 0 || !funnelHasData)}
          emptyTitle={t('noDataInPeriod')}
          emptyDescription={
            funnelChartData.length > 0 ? t('funnelNoDataHint') : t('noDataInPeriodHint')
          }
        >
          <>
            <div className="chart-wrap chart-wrap-compact">
              <AnalyticsChart
                Chart={BarChart}
                data={funnelChartData}
                layout="vertical"
                margin={{ left: 8, right: 16 }}
                grid={{ horizontal: false }}
                xAxis={{ type: 'number' }}
                yAxis={{ type: 'category', dataKey: 'name', width: 100 }}
              >
                <Bar dataKey="count" fill={chartColors.accent} radius={[0, 4, 4, 0]} />
              </AnalyticsChart>
            </div>
            <ul className="list-plain">
              {(funnelQuery.data?.steps ?? []).map((s) => (
                <li key={s.step} className="list-item list-row">
                  <span>{s.step}</span>
                  <span className="list-row-value">
                    {formatNumber(s.count)} ({formatPercent(s.rate)})
                  </span>
                </li>
              ))}
            </ul>
            {funnelQuery.data ? (
              <p className="text-muted reports-funnel-conversion">
                {t('overallConversion')}: {formatPercent(funnelQuery.data.conversion)}
              </p>
            ) : null}
          </>
        </DataViewState>
      </section>
    </div>
  );
}
