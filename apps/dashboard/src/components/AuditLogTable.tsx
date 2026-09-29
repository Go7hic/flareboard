import type { AuditLogEntry } from '../lib/api';
import { auditActionLabel, auditDetail } from '../lib/audit-labels';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';

/** Compact audit list shared by account activity and team activity. */
export function AuditLogTable({ entries, showActor = false }: { entries: AuditLogEntry[]; showActor?: boolean }) {
  return (
    <div className="table-scroll">
      <table className="data-table audit-log-table">
        <thead>
          <tr>
            <th>{t('when')}</th>
            {showActor ? <th>{t('operator')}</th> : null}
            <th>{t('action')}</th>
            <th>{t('metadata')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const failed = entry.action === 'login_failed';
            return (
              <tr key={entry.id}>
                <td className="text-muted whitespace-nowrap">{formatDateTime(entry.createdAt)}</td>
                {showActor ? <td>{entry.username ?? t('unknown')}</td> : null}
                <td className={failed ? 'text-danger' : undefined}>{auditActionLabel(entry)}</td>
                <td className="text-muted">{auditDetail(entry) || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
