import { Link } from 'react-router-dom';
import { useRealtimeData } from '../hooks/useRealtimeData';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { Skeleton } from './ui/skeleton';

/** Compact live visitor count for the overview filter row. */
export function RealtimeOnlineKpi({ websiteId }: { websiteId: string }) {
  const { data, isLoading } = useRealtimeData(websiteId);
  const count = data ? formatNumber(data.visitors) : '—';
  const label = isLoading ? null : t('realtimeOnlineCount').replace('{count}', count);

  return (
    <Link
      to={`/websites/${websiteId}/realtime`}
      className="realtime-online-badge"
      aria-live="polite"
      aria-label={isLoading ? t('realtimeOnline') : label ?? undefined}
    >
      {/* Pulses only while someone is online; a quiet gray dot otherwise. */}
      <span className={data && data.visitors > 0 ? 'live-dot' : 'live-dot is-idle'} aria-hidden="true" />
      {isLoading ? (
        <Skeleton className="realtime-online-badge-skeleton" aria-hidden />
      ) : (
        <span className="realtime-online-badge-text">{label}</span>
      )}
    </Link>
  );
}
