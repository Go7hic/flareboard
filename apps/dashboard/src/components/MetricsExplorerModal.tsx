import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MetricsTable } from './MetricsTable';
import { SegmentTabs } from './SegmentTabs';
import {
  METRIC_GROUPS,
  isMetricTab,
  metricTabLabel,
  metricTabTableTitle,
  type MetricTab,
} from '../lib/breakdown-dimensions';
import { useBreakdownMetrics, type PathSortBy } from '../hooks/useBreakdownMetrics';
import type { MetricRow } from '../lib/api';
import { t } from '../lib/i18n';

function exportMetricsCsv(rows: MetricRow[], filename: string, showPageStats: boolean) {
  const escape = (value: string | number) => {
    const str = String(value);
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const headers = showPageStats
    ? [t('metricName'), t('pagesSort_views'), t('pagesSort_visitors'), t('pagesSort_time')]
    : [t('metricName'), t('views')];

  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => {
      if (showPageStats) {
        return [row.x, row.y, row.visitors ?? 0, row.avgTime ?? ''].map(escape).join(',');
      }
      return [row.x, row.y].map(escape).join(',');
    }),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MetricsExplorerModal({
  open,
  onClose,
  websiteId,
  rangeQs,
  segmentQs = '',
  initialType = 'path',
}: {
  open: boolean;
  onClose: () => void;
  websiteId: string;
  rangeQs: string;
  segmentQs?: string;
  initialType?: string;
}) {
  const resolvedInitial = isMetricTab(initialType) ? initialType : 'path';
  const [metricTab, setMetricTab] = useState<MetricTab>(resolvedInitial);
  const [pathSortBy, setPathSortBy] = useState<PathSortBy>('views');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) {
      setMetricTab(isMetricTab(initialType) ? initialType : 'path');
      setSearch('');
    }
  }, [open, initialType]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const { rows, isLoading } = useBreakdownMetrics({
    websiteId,
    rangeQs,
    segmentQs,
    metricTab,
    pathSortBy,
    enabled: open,
  });

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => row.x.toLowerCase().includes(query));
  }, [rows, search]);

  const handleExport = useCallback(() => {
    if (!filteredRows.length) return;
    const filename = `${websiteId}-${metricTab}.csv`;
    exportMetricsCsv(filteredRows, filename, metricTab === 'path');
  }, [filteredRows, metricTab, websiteId]);

  if (!open) return null;

  return createPortal(
    <div className="metrics-explorer-backdrop" onClick={onClose}>
      <div
        className="metrics-explorer"
        role="dialog"
        aria-modal="true"
        aria-label={t('metricsExplorerTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="metrics-explorer-sidebar">
          <nav className="metrics-explorer-nav" aria-label={t('breakdownMetrics')}>
            {METRIC_GROUPS.map((group) => (
              <div key={group.labelKey} className="metrics-explorer-nav-group">
                <div className="metrics-explorer-nav-group-label">{t(group.labelKey)}</div>
                <ul className="metrics-explorer-nav-list">
                  {group.items.map((tab) => (
                    <li key={tab}>
                      <button
                        type="button"
                        className={`metrics-explorer-nav-item${metricTab === tab ? ' is-active' : ''}`}
                        aria-current={metricTab === tab ? 'page' : undefined}
                        onClick={() => setMetricTab(tab)}
                      >
                        {metricTabLabel(tab)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <div className="metrics-explorer-main">
          <header className="metrics-explorer-header">
            <div className="metrics-explorer-search-wrap">
              <svg
                className="metrics-explorer-search-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3-3" />
              </svg>
              <input
                type="search"
                className="input metrics-explorer-search"
                placeholder={t('metricsExplorerSearch')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={t('metricsExplorerSearch')}
              />
            </div>
            <div className="metrics-explorer-header-actions">
              <button
                type="button"
                className="metrics-explorer-icon-btn"
                onClick={handleExport}
                disabled={!filteredRows.length}
                aria-label={t('exportCsv')}
                title={t('exportCsv')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M12 3v12" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
              </button>
              <button
                type="button"
                className="metrics-explorer-icon-btn"
                onClick={onClose}
                aria-label={t('metricsExplorerClose')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </header>

          <div className="metrics-explorer-body">
            <h2 className="metrics-explorer-title">{metricTabTableTitle(metricTab)}</h2>
            {metricTab === 'path' ? (
              <div className="path-sort-toolbar" role="group" aria-label={t('pagesSortBy')}>
                <span className="path-sort-toolbar-label">{t('pagesSortBy')}:</span>
                <SegmentTabs
                  tabs={(['views', 'visitors', 'time'] as PathSortBy[]).map((sort) => ({
                    id: sort,
                    label: t(`pagesSort_${sort}`),
                  }))}
                  value={pathSortBy}
                  onChange={(id) => setPathSortBy(id as PathSortBy)}
                  aria-label={t('pagesSortBy')}
                />
              </div>
            ) : null}
            <div className="metrics-explorer-table-wrap">
              <MetricsTable
                embedded
                title={metricTabTableTitle(metricTab)}
                rows={filteredRows}
                loading={isLoading}
                showPageStats={metricTab === 'path'}
              />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
