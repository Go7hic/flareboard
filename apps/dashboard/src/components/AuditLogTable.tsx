import type { AuditLogEntry } from '../lib/api';
import { auditActionLabel, auditDetail } from '../lib/audit-labels';
import { formatDateTime, formatShortDateTime, shortId } from '../lib/format';
import { t } from '../lib/i18n';
import { StatusBadge } from './StatusBadge';

/** Compact audit list shared by account activity, team activity and the admin audit log. */
export function AuditLogTable({
  entries,
  showActor = false,
  showEntity = false,
}: {
  entries: AuditLogEntry[];
  showActor?: boolean;
  /** Adds the affected record's id (admin log). */
  showEntity?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table ws-compact-table ws-audit-table">
        <thead>
          <tr>
            <th>{t('when')}</th>
            {showActor ? <th>{t('operator')}</th> : null}
            <th>{t('action')}</th>
            <th>{t('metadata')}</th>
            {showEntity ? <th>{t('workspaceAuditEntity')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const failed = entry.action === 'login_failed';
            const label = auditActionLabel(entry);
            return (
              <tr key={entry.id}>
                <td className="text-muted ws-nowrap" title={formatDateTime(entry.createdAt)}>
                  {formatShortDateTime(entry.createdAt)}
                </td>
                {showActor ? <td>{entry.username ?? t('unknown')}</td> : null}
                <td>{failed ? <StatusBadge tone="danger">{label}</StatusBadge> : label}</td>
                <td className="text-muted">{auditDetail(entry) || '–'}</td>
                {showEntity ? (
                  <td className="ws-nowrap" title={entry.entityId ?? undefined}>
                    {entry.entityId ? <code className="ws-mono-value">{shortId(entry.entityId)}</code> : '–'}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
