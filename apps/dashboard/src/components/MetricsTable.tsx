import { useMemo, useState } from 'react';
import type { MetricRow } from '../lib/api';
import { formatDurationSeconds, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { Skeleton } from './ui/skeleton';
import { EmptyState } from './EmptyState';

type SortColumn = 'name' | 'views' | 'visitors' | 'time';
type SortDirection = 'asc' | 'desc';

function sortAriaValue(
  column: SortColumn,
  active: SortColumn | null,
  direction: SortDirection,
): 'none' | 'ascending' | 'descending' {
  if (active !== column) return 'none';
  return direction === 'asc' ? 'ascending' : 'descending';
}

function compareRows(a: MetricRow, b: MetricRow, column: SortColumn): number {
  switch (column) {
    case 'name':
      return a.x.localeCompare(b.x, undefined, { sensitivity: 'base' });
    case 'views':
      return a.y - b.y;
    case 'visitors':
      return (a.visitors ?? 0) - (b.visitors ?? 0);
    case 'time':
      return (a.avgTime ?? -1) - (b.avgTime ?? -1);
  }
}

export function MetricsTable({
  title,
  rows,
  loading,
  embedded = false,
  showPageStats = false,
  hideTitle = false,
  maxRows,
  primaryMetric = 'views',
  sortable = true,
}: {
  title: string;
  rows: MetricRow[];
  loading?: boolean;
  embedded?: boolean;
  showPageStats?: boolean;
  hideTitle?: boolean;
  maxRows?: number;
  primaryMetric?: 'views' | 'visitors';
  sortable?: boolean;
}) {
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(column);
    setSortDirection('desc');
  };

  const sortedRows = useMemo(() => {
    if (!sortable || sortColumn == null) return rows;
    const next = [...rows];
    next.sort((a, b) => {
      const cmp = compareRows(a, b, sortColumn);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return next;
  }, [rows, sortable, sortColumn, sortDirection]);

  const displayRows = maxRows != null ? sortedRows.slice(0, maxRows) : sortedRows;
  const rowValue = (row: MetricRow) =>
    primaryMetric === 'visitors' ? (row.visitors ?? row.y) : row.y;
  const maxY = displayRows.length ? Math.max(...displayRows.map(rowValue), 1) : 1;

  const renderHeader = (label: string, column: SortColumn, className?: string) => {
    if (!sortable) {
      return <th className={className}>{label}</th>;
    }
    return (
      <th className={className} aria-sort={sortAriaValue(column, sortColumn, sortDirection)}>
        <button type="button" className="metrics-table-sort-btn" onClick={() => handleSort(column)}>
          {label}
        </button>
      </th>
    );
  };

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
              {renderHeader(t('metricName'), 'name')}
              {showPageStats ? (
                <>
                  {renderHeader(t('pagesSort_views'), 'views', 'num')}
                  {renderHeader(t('pagesSort_visitors'), 'visitors', 'num')}
                  {renderHeader(t('pagesSort_time'), 'time', 'num')}
                </>
              ) : (
                renderHeader(
                  primaryMetric === 'visitors' ? t('visitors') : t('views'),
                  primaryMetric === 'visitors' ? 'visitors' : 'views',
                  'num',
                )
              )}
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
                  {showPageStats ? (
                    <>
                      <td className="num">{formatNumber(row.y)}</td>
                      <td className="num">{formatNumber(row.visitors ?? 0)}</td>
                      <td className="num">{formatDurationSeconds(row.avgTime)}</td>
                    </>
                  ) : (
                    <td className="num">{formatNumber(value)}</td>
                  )}
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
