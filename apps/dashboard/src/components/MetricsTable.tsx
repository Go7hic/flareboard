import { useMemo, useState } from 'react';
import type { MetricRow } from '../lib/api';
import { formatDurationSeconds, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { Skeleton } from './ui/skeleton';
import { BreakdownList, type BreakdownColumn, type BreakdownItem } from './BreakdownList';
import { EmptyState } from './EmptyState';
import { SectionCard } from './SectionCard';

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

  const sortColumnFor = (column: SortColumn) =>
    sortable
      ? { onSort: () => handleSort(column), sort: sortAriaValue(column, sortColumn, sortDirection) }
      : {};

  const columns: BreakdownColumn[] = showPageStats
    ? [
        { label: t('pagesSort_views'), ...sortColumnFor('views') },
        { label: t('pagesSort_visitors'), ...sortColumnFor('visitors') },
        { label: t('pagesSort_time'), ...sortColumnFor('time') },
      ]
    : [
        {
          label: primaryMetric === 'visitors' ? t('visitors') : t('views'),
          ...sortColumnFor(primaryMetric === 'visitors' ? 'visitors' : 'views'),
        },
      ];

  const items: BreakdownItem[] = displayRows.map((row) => {
    const value = rowValue(row);
    return {
      id: `${title}-${row.x}`,
      label: row.x,
      title: row.x,
      mono: row.x.startsWith('/'),
      share: value / maxY,
      values: showPageStats
        ? [formatNumber(row.y), formatNumber(row.visitors ?? 0), formatDurationSeconds(row.avgTime)]
        : [formatNumber(value)],
    };
  });

  const body = (
    <>
      {loading ? (
        <div className="metrics-table-skeleton" aria-busy>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="mt-2 h-6 w-3/4" />
          <Skeleton className="mt-2 h-6 w-1/2" />
        </div>
      ) : null}
      {!loading && displayRows.length > 0 ? (
        <BreakdownList
          items={items}
          columns={columns}
          labelHeader={sortable ? (
            <button type="button" className="breakdown-sort" onClick={() => handleSort('name')}>
              {t('metricName')}
            </button>
          ) : t('metricName')}
        />
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
    <SectionCard title={title}>
      {body}
    </SectionCard>
  );
}
