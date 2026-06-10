import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '../components/EmptyState';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Panel } from '../components/ui/panel';
import { api, getToken } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { useChartColors } from '../lib/useChartColors';

export default function RevenuePage() {
  const chartColors = useChartColors();
  const { websiteId } = useParams<{ websiteId: string }>();
  const navigate = useNavigate();
  const { range, setRange, rangeQs } = useWebsiteRange(websiteId, '24h');

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

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

  return (
    <div className="page">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteDateExportControls range={range} onRangeChange={setRange} />
        }
      />

      <Panel>
        <p className="section-lead">{t('revenuePageLead')}</p>

        {revenueQuery.isLoading ? (
          <p className="text-muted">{t('loading')}</p>
        ) : chartData.length === 0 && !(revenueQuery.data?.byEvent ?? []).length ? (
          <EmptyState title={t('noDataInPeriod')} />
        ) : (
          <>
            {chartData.length > 0 ? (
              <div className="chart-wrap chart-wrap-compact section-gap">
                <ResponsiveContainer>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                    <YAxis tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                    <Tooltip
                      contentStyle={{
                        background: chartColors.panel,
                        border: `1px solid ${chartColors.border}`,
                        borderRadius: 8,
                        fontSize: 13,
                        color: chartColors.text,
                      }}
                    />
                    <Bar dataKey="total" fill={chartColors.accent} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
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
                  {(revenueQuery.data?.byEvent ?? []).map((row) => (
                    <tr key={`${row.eventName}-${row.currency}`}>
                      <td>{row.eventName}</td>
                      <td>{row.currency}</td>
                      <td className="num">{row.total.toFixed(2)}</td>
                      <td className="num">{row.transactions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
