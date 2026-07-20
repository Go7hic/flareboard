import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Bar, BarChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { DataViewState } from '../components/DataViewState';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Panel } from '../components/ui/panel';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { useChartColors } from '../lib/useChartColors';

export default function RevenuePage() {
  const chartColors = useChartColors();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');

  const revenueQuery = useQuery({
    queryKey: ['revenue-page', websiteId, range.startAt, range.endAt],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<{
        byDay: Array<{ date: string; currency: string; total: number; transactions: number }>;
        byEvent: Array<{ eventName: string; currency: string; total: number; transactions: number }>;
      }>(`/api/reports/revenue?websiteId=${websiteId}&${rangeQs}`),
  });

  const chartData = useMemo(() => {
    const byDay = revenueQuery.data?.byDay ?? [];
    const byDate = new Map<string, number>();
    for (const row of byDay) {
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.total);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }));
  }, [revenueQuery.data?.byDay]);

  const byEvent = revenueQuery.data?.byEvent ?? [];
  const isEmpty = !revenueQuery.isLoading && chartData.length === 0 && byEvent.length === 0;

  return (
    <div className="page">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />
        }
      />

      <Panel>
        <p className="section-lead">{t('revenuePageLead')}</p>

        <DataViewState
          loading={revenueQuery.isLoading}
          error={revenueQuery.isError ? revenueQuery.error : null}
          onRetry={() => revenueQuery.refetch()}
          isEmpty={isEmpty}
          emptyTitle={t('noDataInPeriod')}
        >
          <>
            {chartData.length > 0 ? (
              <div className="chart-wrap chart-wrap-compact section-gap">
                <AnalyticsChart Chart={BarChart} data={chartData} xAxis={{ dataKey: 'date' }}>
                  <Bar dataKey="total" fill={chartColors.accent} radius={[4, 4, 0, 0]} />
                </AnalyticsChart>
              </div>
            ) : null}

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('revenueEvent')}</th>
                    <th>{t('revenueCurrency')}</th>
                    <th className="num">{t('revenueTotal')}</th>
                    <th className="num">{t('revenueTransactions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {byEvent.map((row) => (
                    <tr key={`${row.eventName}-${row.currency}`}>
                      <td>{row.eventName}</td>
                      <td>{row.currency}</td>
                      <td className="num">{formatNumber(row.total, { maximumFractionDigits: 2 })}</td>
                      <td className="num">{formatNumber(row.transactions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        </DataViewState>
      </Panel>
    </div>
  );
}
