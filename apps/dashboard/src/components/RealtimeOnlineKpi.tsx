import { Link } from 'react-router-dom';
import { useRealtimeData } from '../hooks/useRealtimeData';
import { t } from '../lib/i18n';
import { Skeleton } from './ui/skeleton';

/** Compact live visitor count for the overview filter row. */
export function RealtimeOnlineKpi({ websiteId }: { websiteId: string }) {
  const { data, isLoading } = useRealtimeData(websiteId);
  const count = data?.visitors.toLocaleString() ?? '—';
  const label = isLoading ? null : t('realtimeOnlineCount').replace('{count}', count);

  return (
    <Link
      to={`/websites/${websiteId}/realtime`}
      className="realtime-online-badge"
      aria-live="polite"
      aria-label={isLoading ? t('realtimeOnline') : label ?? undefined}
    >
      <span className="live-dot" aria-hidden="true" />
      {isLoading ? (
        <Skeleton className="realtime-online-badge-skeleton" aria-hidden />
      ) : (
        <span className="realtime-online-badge-text">{label}</span>
      )}
    </Link>
  );
}
