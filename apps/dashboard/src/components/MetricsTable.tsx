import type { MetricRow } from '../lib/api';
import { t } from '../lib/i18n';
import { Skeleton } from './ui/skeleton';
import { EmptyState } from './EmptyState';

export function MetricsTable({
  title,
  rows,
  loading,
  embedded = false,
  showPageStats = false,
  hideTitle = false,
  maxRows,
  primaryMetric = 'views',
}: {
  title: string;
  rows: MetricRow[];
  loading?: boolean;
  embedded?: boolean;
  showPageStats?: boolean;
  hideTitle?: boolean;
  maxRows?: number;
  primaryMetric?: 'views' | 'visitors';
}) {
  const displayRows = maxRows != null ? rows.slice(0, maxRows) : rows;
  const rowValue = (row: MetricRow) =>
    primaryMetric === 'visitors' ? (row.visitors ?? row.y) : row.y;
  const maxY = displayRows.length ? Math.max(...displayRows.map(rowValue), 1) : 1;

  const body = (
    <>
      {loading ? (
        <div className="metrics-table-skeleton" aria-busy>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="mt-2 h-6 w-3/4" />
        </div>
      ) : null}
      {!loading && displayRows.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('metricName')}</th>
              <th className="num">
                {showPageStats
                  ? t('pagesSort_views')
                  : primaryMetric === 'visitors'
                    ? t('visitors')
                    : t('views')}
              </th>
              {showPageStats ? (
                <>
                  <th className="num">{t('pagesSort_visitors')}</th>
                  <th className="num">{t('pagesSort_time')}</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const value = rowValue(row);
              return (
              <tr key={`${title}-${row.x}`}>
                <td>
                  <div>{row.x}</div>
                  <div className="metrics-table-bar" aria-hidden>
                    <div className="metrics-table-bar-fill">
                      <div
                        className="metrics-table-bar-inner"
                        style={{ width: `${Math.round((value / maxY) * 100)}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="num">{value.toLocaleString()}</td>
                {showPageStats ? (
                  <>
                    <td className="num">{(row.visitors ?? 0).toLocaleString()}</td>
                    <td className="num">{row.avgTime != null ? `${row.avgTime}s` : '—'}</td>
                  </>
                ) : null}
              </tr>
            );
            })}
          </tbody>
        </table>
      ) : null}
      {!loading && displayRows.length === 0 ? (
        <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <div className="metrics-table-embedded">
        {hideTitle ? null : <h3 className="metrics-table-embedded-title">{title}</h3>}
        {body}
      </div>
    );
  }

  return (
    <section className="panel-flush">
      <div className="panel-header">{title}</div>
      <div className="panel-body">{body}</div>
    </section>
  );
}
