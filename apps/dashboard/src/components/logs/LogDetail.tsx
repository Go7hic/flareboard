import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Filter, GitBranch, PlayCircle } from 'lucide-react';
import type { LogAttributeFilter, LogEvent } from '../../lib/api';
import { t } from '../../lib/i18n';
import { KvList } from '../KvList';
import { CodeBlock } from '../quality/CodeBlock';
import { Button } from '../ui/button';
import { attributeValueText } from './log-filters';
import { formatLogTime } from './LogTable';

/** Key/value rows (mono) with a "filter on this value" action per row. */
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
    <section className="q-detail-section">
      <h4 className="q-detail-section-title">{label}</h4>
      <dl className="kv-list kv-list--compact q-attr-list">
        {entries.map(([key, value]) => {
          const text = attributeValueText(value);
          return (
            <Fragment key={key}>
              <dt className="mono" title={key}>
                {key}
              </dt>
              <dd>
                <span className="mono q-attr-value">{text}</span>
                {onFilter ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="q-attr-filter"
                    aria-label={`${t('logsFilterOnAttribute')}: ${key}`}
                    title={t('logsFilterOnAttribute')}
                    onClick={() => onFilter({ key, value: text })}
                  >
                    <Filter aria-hidden />
                  </Button>
                ) : null}
              </dd>
            </Fragment>
          );
        })}
      </dl>
    </section>
  );
}

/**
 * Log line detail without its container (the page puts it in a side pane or a sheet): the
 * message, links to its trace and session (with replay), its fields and attributes.
 */
export function LogDetail({
  log,
  websiteId,
  timezone,
  onOpenTrace,
  onFilterAttribute,
}: {
  log: LogEvent;
  websiteId: string;
  timezone?: string;
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
    <div className="q-log-detail">
      <CodeBlock code={log.message ?? '-'} wrap maxHeight="14rem" />

      {log.traceId || log.sessionId ? (
        <div className="q-log-detail-actions">
          {log.traceId ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenTrace(log.traceId!)}>
              <GitBranch aria-hidden />
              {t('logsViewTrace')}
            </Button>
          ) : null}
          {log.sessionId ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/websites/${websiteId}/sessions/${encodeURIComponent(log.sessionId)}`}>
                <PlayCircle aria-hidden />
                {t('logsOpenSession')}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <KvList
        compact
        className="q-kv-narrow q-kv-mono"
        items={fields
          .filter(([, value]) => value)
          .map(([label, value]) => ({ key: label, label, value }))}
      />

      <AttributeTable label={t('logsAttributes')} values={attributes} onFilter={onFilterAttribute} />
      <AttributeTable label={t('logsResource')} values={log.resource} onFilter={onFilterAttribute} />
    </div>
  );
}
