import type { LogEvent } from '../../lib/api';
import { getLocale, t } from '../../lib/i18n';
import { cn } from '../../lib/utils';

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

/**
 * Severity label: a square key in the severity's status color (the histogram's color) and the
 * level name in text color, on a light wash of the same hue.
 */
export function LevelBadge({ level }: { level: string }) {
  return (
    <span className="q-level" data-level={level}>
      {level}
    </span>
  );
}

/** Log lines as a dense table (fixed columns, one-line messages); a row opens the detail. */
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
      <table className={cn('data-table data-table--interactive q-log-table', compact && 'is-compact')}>
        <colgroup>
          <col className="q-log-col-time" />
          <col className="q-log-col-level" />
          <col className="q-log-col-service" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>{t('logsTime')}</th>
            <th>{t('logsLevel')}</th>
            <th>{t('logAlertService')}</th>
            <th>{t('message')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.id === selectedId;
            return (
              <tr
                key={`${row.source}:${row.id}`}
                className={selected ? 'is-selected' : undefined}
                tabIndex={0}
                aria-selected={selected}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(row);
                  }
                }}
              >
                <td className="q-log-time">{formatLogTime(row.timeUs, timezone)}</td>
                <td>
                  <LevelBadge level={row.level} />
                </td>
                <td className="q-log-service" title={row.service ?? undefined}>
                  {row.service ?? (row.source === 'browser' ? t('logsSourceBrowser') : '-')}
                </td>
                <td className="q-log-message" title={row.message ?? undefined}>
                  {row.message ?? '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
