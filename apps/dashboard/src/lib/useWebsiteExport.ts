import { useCallback, useState } from 'react';
import { downloadCsv } from './downloadCsv';
import { formatNumber } from './format';
import { t } from './i18n';

/**
 * CSV export of a website's events or pageviews. `filterQs`: range plus any segment / cohort
 * params, as sent to the stats endpoints. `notice` says what went wrong, or that the export
 * stopped at its row cap, for the page to show inline.
 */
export function useWebsiteExport(websiteId: string | undefined, filterQs: string) {
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const exportCsv = useCallback(
    (type: 'events' | 'pageviews') => {
      if (!websiteId) return;
      setNotice(null);
      downloadCsv(`/api/websites/${websiteId}/export?type=${type}&${filterQs}`, `${websiteId}-${type}.csv`)
        .then((outcome) => {
          if (outcome.truncated) {
            setNotice({ tone: 'info', text: t('exportTruncated').replace('{count}', formatNumber(outcome.rowCap ?? 0)) });
          }
        })
        .catch((err: unknown) => setNotice({ tone: 'error', text: err instanceof Error ? err.message : t('exportFailed') }));
    },
    [websiteId, filterQs],
  );
  return { exportCsv, exportNotice: notice, dismissExportNotice: () => setNotice(null) };
}
