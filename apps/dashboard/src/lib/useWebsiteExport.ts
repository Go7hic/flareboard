import { useCallback } from 'react';
import { authenticatedFetch } from './api';

export function useWebsiteExport(websiteId: string | undefined, rangeQs: string) {
  return useCallback(
    (type: 'events' | 'pageviews') => {
      if (!websiteId) return;
      const path = `/api/websites/${websiteId}/export?type=${type}&${rangeQs}`;
      authenticatedFetch(path)
        .then((r) => r.blob())
        .then((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${websiteId}-${type}.csv`;
          a.click();
        });
    },
    [websiteId, rangeQs],
  );
}
