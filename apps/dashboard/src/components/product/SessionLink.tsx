import { Link } from 'react-router-dom';
import { t } from '../../lib/i18n';

/** Short mono session id linking to the session page; full id on hover. */
export function SessionLink({ websiteId, sessionId }: { websiteId: string; sessionId: string | null | undefined }) {
  if (!sessionId) return <span className="text-muted">–</span>;
  return (
    <Link
      to={`/websites/${websiteId}/sessions/${sessionId}`}
      className="product-id-link mono"
      title={`${t('session')} ${sessionId}`}
    >
      {sessionId.slice(0, 8)}
    </Link>
  );
}
