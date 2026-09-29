import { Link } from 'react-router-dom';
import { ExternalLink, Filter, GitBranch, X } from 'lucide-react';
import type { LogAttributeFilter, LogEvent } from '../../lib/api';
import { t } from '../../lib/i18n';
import { Button } from '../ui/button';
import { MasterDetailSidePane } from '../master-detail';
import { attributeValueText } from './log-filters';
import { formatLogTime, LevelBadge } from './LogTable';

/** Key/value rows with a "filter on this" action per row. */
export function AttributeTable({
  values,
  onFilter,
  label,
}: {
  values: Record<string, unknown> | null;
  onFilter?: (filter: LogAttributeFilter) => void;
  label: string;
}) {
  const entries = Object.entries(values ?? {});
  if (!entries.length) return null;
  return (
    <section className="log-detail-section">
      <h4 className="log-detail-heading">{label}</h4>
      <table className="data-table log-attr-table">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <th scope="row" className="mono">
                {key}
              </th>
              <td className="mono log-attr-value">{attributeValueText(value)}</td>
              {onFilter ? (
                <td className="log-attr-action">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('logsFilterOnAttribute')}: ${key}`}
                    title={t('logsFilterOnAttribute')}
                    onClick={() => onFilter({ key, value: attributeValueText(value) })}
                  >
                    <Filter size={14} strokeWidth={2} aria-hidden />
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Log line detail: fields, links to its trace and session (with replay), attributes. */
export function LogDetail({
  log,
  websiteId,
  timezone,
  onClose,
  onOpenTrace,
  onFilterAttribute,
}: {
  log: LogEvent;
  websiteId: string;
  timezone?: string;
  onClose: () => void;
  onOpenTrace: (traceId: string) => void;
  onFilterAttribute: (filter: LogAttributeFilter) => void;
}) {
  const fields: Array<[string, string | null]> = [
    [t('logsTime'), formatLogTime(log.timeUs, timezone)],
    [t('logsSource'), log.source === 'otlp' ? t('logsSourceOtlp') : t('logsSourceBrowser')],
    [t('logAlertService'), log.service],
    [t('environment'), log.environment],
    [t('release'), log.release],
    [t('logsSeverityText'), log.severityText],
    [t('logsScope'), log.scope],
    [t('page'), log.urlPath],
    [t('logsTraceId'), log.traceId],
    [t('logsTraceSpan'), log.spanId],
    [t('session'), log.sessionId],
  ];
  // Tracker logs keep their fields in the properties; show only the extra ones.
  const attributes =
    log.source === 'browser' && log.attributes
      ? Object.fromEntries(
          Object.entries(log.attributes).filter(
            ([key]) => !['level', 'message', 'release', 'environment', 'service', 'traceId', 'spanId'].includes(key),
          ),
        )
      : log.attributes;

  return (
    <MasterDetailSidePane
      className="log-detail"
      title={
        <span className="log-detail-title">
          <LevelBadge level={log.level} /> {t('logsDetail')}
        </span>
      }
      actions={
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label={t('close')}>
          <X size={16} strokeWidth={2} aria-hidden />
        </Button>
      }
    >
      <pre className="log-detail-body">{log.message ?? '-'}</pre>

      <div className="log-detail-actions">
        {log.traceId ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpenTrace(log.traceId!)}>
            <GitBranch size={14} strokeWidth={2} aria-hidden />
            {t('logsViewTrace')}
          </Button>
        ) : null}
        {log.sessionId ? (
          <Link className="inline-link" to={`/websites/${websiteId}/sessions/${encodeURIComponent(log.sessionId)}`}>
            {t('logsOpenSession')}
            <ExternalLink size={12} strokeWidth={2} aria-hidden />
          </Link>
        ) : null}
      </div>

      <dl className="log-detail-fields">
        {fields
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="log-detail-field">
              <dt className="text-muted">{label}</dt>
              <dd className="mono">{value}</dd>
            </div>
          ))}
      </dl>

      <AttributeTable label={t('logsAttributes')} values={attributes} onFilter={onFilterAttribute} />
      <AttributeTable label={t('logsResource')} values={log.resource} onFilter={onFilterAttribute} />
    </MasterDetailSidePane>
  );
}
