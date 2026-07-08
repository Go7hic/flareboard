import { useCallback } from 'react';
import { authenticatedFetch } from './api';
import { t } from './i18n';

export function useWebsiteExport(websiteId: string | undefined, rangeQs: string) {
  return useCallback(
    (type: 'events' | 'pageviews') => {
      if (!websiteId) return;
      const path = `/api/websites/${websiteId}/export?type=${type}&${rangeQs}`;
      authenticatedFetch(path)
        .then(async (r) => {
          if (!r.ok) {
            const err = await r.json().catch(() => ({ message: r.statusText }));
            throw new Error((err as { message?: string }).message || t('exportFailed'));
          }
          return r.blob();
        })
        .then((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${websiteId}-${type}.csv`;
          a.click();
        })
        .catch((err) => {
          window.alert(err instanceof Error ? err.message : t('exportFailed'));
        });
    },
    [websiteId, rangeQs],
  );
}
