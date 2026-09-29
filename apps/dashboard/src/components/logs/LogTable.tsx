import type { LogEvent } from '../../lib/api';
import { getLocale, t } from '../../lib/i18n';

/** `Sep 29, 14:03:07.123` in the website's timezone. */
export function formatLogTime(timeUs: number, timezone?: string) {
  const date = new Date(Math.floor(timeUs / 1000));
  const base = date.toLocaleString(getLocale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: timezone,
  });
  return `${base}.${String(date.getUTCMilliseconds()).padStart(3, '0')}`;
}

export function LevelBadge({ level }: { level: string }) {
  return <span className={`badge log-level-${level}`}>{level}</span>;
}

/** Log lines as a dense table; a row opens the detail pane. */
export function LogTable({
  rows,
  selectedId,
  onSelect,
  timezone,
  compact = false,
}: {
  rows: LogEvent[];
  selectedId: string | null;
  onSelect: (row: LogEvent) => void;
  timezone?: string;
  compact?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table className={`data-table logs-table${compact ? ' logs-table--compact' : ''}`}>
        <thead>
          <tr>
            <th className="logs-col-time">{t('logsTime')}</th>
            <th className="logs-col-level">{t('logsLevel')}</th>
            <th className="logs-col-service">{t('logAlertService')}</th>
            <th>{t('message')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.source}:${row.id}`}
              className={`logs-row${row.id === selectedId ? ' active-row' : ''}`}
              tabIndex={0}
              aria-selected={row.id === selectedId}
              onClick={() => onSelect(row)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(row);
                }
              }}
            >
              <td className="mono text-muted logs-col-time">{formatLogTime(row.timeUs, timezone)}</td>
              <td className="logs-col-level">
                <LevelBadge level={row.level} />
              </td>
              <td className="logs-col-service text-muted">
                {row.service ?? (row.source === 'browser' ? t('logsSourceBrowser') : '-')}
              </td>
              <td className="logs-message-cell">
                <span className="logs-message">{row.message ?? '-'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
