import type { MetricRow } from '../lib/api';
import { t } from '../lib/i18n';
import { Skeleton } from './ui/skeleton';
import { EmptyState } from './EmptyState';

export function MetricsTable({
  title,
  rows,
  loading,
  embedded = false,
}: {
  title: string;
  rows: MetricRow[];
  loading?: boolean;
  embedded?: boolean;
}) {
  const maxY = rows.length ? Math.max(...rows.map((r) => r.y), 1) : 1;

  const body = (
    <>
      {loading ? (
        <div className="metrics-table-skeleton" aria-busy>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="mt-2 h-6 w-3/4" />
        </div>
      ) : null}
      {!loading && rows.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('metricName')}</th>
              <th className="num">{t('views')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${title}-${row.x}`}>
                <td>
                  <div>{row.x}</div>
                  <div className="metrics-table-bar" aria-hidden>
                    <div className="metrics-table-bar-fill">
                      <div
                        className="metrics-table-bar-inner"
                        style={{ width: `${Math.round((row.y / maxY) * 100)}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="num">{row.y.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {!loading && rows.length === 0 ? (
        <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <div className="metrics-table-embedded">
        <h3 className="metrics-table-embedded-title">{title}</h3>
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
