import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState } from '../components/EmptyState';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { Input } from '../components/ui/input';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

export default function WebsiteFunnelPage() {
  const chartColors = useChartColors();
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl } =
    useWebsiteReportContext('30d');
  const [funnelSteps, setFunnelSteps] = useState('signup,purchase');

  const funnelQuery = useQuery({
    queryKey: ['reports-funnel', websiteId, funnelSteps, range, segmentId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<{ steps: Array<{ step: string; count: number; rate: number }>; conversion: number }>(
        reportUrl('funnel', `&steps=${encodeURIComponent(funnelSteps)}`),
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
          />
        }
      />
      <section className="panel section-gap">
        <div className="field" style={{ maxWidth: '28rem' }}>
          <Input
            value={funnelSteps}
            onChange={(e) => setFunnelSteps(e.target.value)}
            placeholder={t('funnelStepsPlaceholder')}
            aria-label={t('funnel')}
          />
        </div>
        {funnelQuery.isLoading ? (
          <div className="skeleton skeleton-block section-gap" aria-busy />
        ) : funnelChartData.length === 0 || !funnelHasData ? (
          <EmptyState
            title={t('noDataInPeriod')}
            description={funnelChartData.length > 0 ? t('funnelNoDataHint') : t('noDataInPeriodHint')}
          />
        ) : (
          <>
            <div className="chart-wrap chart-wrap-compact">
              <ResponsiveContainer>
                <BarChart data={funnelChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    tick={{ fontSize: 11, fill: chartColors.muted }}
                    stroke={chartColors.border}
                  />
                  <Tooltip
                    contentStyle={{
                      background: chartColors.panel,
                      border: `1px solid ${chartColors.border}`,
                      borderRadius: 8,
                      fontSize: 13,
                      color: chartColors.text,
                    }}
                  />
                  <Bar dataKey="count" fill={chartColors.accent} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="list-plain">
              {(funnelQuery.data?.steps ?? []).map((s) => (
                <li key={s.step} className="list-item list-row">
                  <span>{s.step}</span>
                  <span className="list-row-value">
                    {s.count} ({s.rate}%)
                  </span>
                </li>
              ))}
            </ul>
            {funnelQuery.data ? (
              <p className="text-muted reports-funnel-conversion">
                {t('overallConversion')}: {funnelQuery.data.conversion}%
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
