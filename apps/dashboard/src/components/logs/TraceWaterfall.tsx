import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, X } from 'lucide-react';
import type { LogAttributeFilter, LogEvent, LogTraceDetail, LogTraceSpan } from '../../lib/api';
import { t } from '../../lib/i18n';
import { MasterDetailSidePane } from '../master-detail';
import { Button } from '../ui/button';
import { AttributeTable } from './LogDetail';
import { waterfallRows } from './trace-tree';
import { formatLogTime, LevelBadge } from './LogTable';

export function formatSpanDuration(us: number) {
  if (us < 1000) return `${us}µs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(us < 10_000 ? 2 : 1)}ms`;
  return `${(us / 1_000_000).toFixed(2)}s`;
}

/** Trace view: span waterfall, the selected span's details, the trace's log lines, its session. */
export function TraceWaterfall({
  trace,
  websiteId,
  timezone,
  onClose,
  onSelectLog,
  onFilterAttribute,
}: {
  trace: LogTraceDetail;
  websiteId: string;
  timezone?: string;
  onClose: () => void;
  onSelectLog: (log: LogEvent) => void;
  onFilterAttribute: (filter: LogAttributeFilter) => void;
}) {
  const rows = useMemo(() => waterfallRows(trace.spans), [trace.spans]);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const selected = trace.spans.find((span) => span.spanId === selectedSpanId) ?? null;
  const startUs = Math.min(...trace.spans.map((span) => span.startUs), (trace.startedAt ?? 0) * 1000);
  const endUs = Math.max(...trace.spans.map((span) => span.startUs + span.durationUs), (trace.endedAt ?? 0) * 1000);
  const totalUs = Math.max(endUs - startUs, 1);

  return (
    <MasterDetailSidePane
      className="trace-detail"
      title={t('logsTraceDetail')}
      description={
        <span className="mono">
          {trace.traceId} · {formatSpanDuration(Math.round(totalUs))} · {trace.spans.length} {t('logsTraceSpans').toLowerCase()}
        </span>
      }
      actions={
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label={t('close')}>
          <X size={16} strokeWidth={2} aria-hidden />
        </Button>
      }
    >
      {trace.sessionId ? (
        <p className="trace-session-link">
          <Link className="inline-link" to={`/websites/${websiteId}/sessions/${encodeURIComponent(trace.sessionId)}`}>
            {t('logsOpenSession')}
            <ExternalLink size={12} strokeWidth={2} aria-hidden />
          </Link>
        </p>
      ) : null}

      {rows.length ? (
        <div className="trace-waterfall" role="list" aria-label={t('logsWaterfall')}>
          {rows.map(({ span, depth }) => {
            const left = ((span.startUs - startUs) / totalUs) * 100;
            const width = Math.max((span.durationUs / totalUs) * 100, 0.4);
            return (
              <button
                key={`${span.source}:${span.spanId}`}
                type="button"
                role="listitem"
                className={`trace-row${span.spanId === selectedSpanId ? ' is-selected' : ''}`}
                aria-pressed={span.spanId === selectedSpanId}
                onClick={() => setSelectedSpanId(span.spanId === selectedSpanId ? null : span.spanId)}
              >
                <span className="trace-row-label" style={{ paddingLeft: `${Math.min(depth, 12) * 0.75}rem` }}>
                  <span className="trace-row-name">{span.name}</span>
                  <span className="text-muted trace-row-service">{span.service ?? ''}</span>
                </span>
                <span className="trace-bar-track" aria-hidden>
                  <span
                    className={`trace-bar${span.status === 'error' ? ' trace-bar--error' : ''}`}
                    style={{ left: `${Math.min(left, 99.6)}%`, width: `${Math.min(width, 100 - Math.min(left, 99.6))}%` }}
                  />
                </span>
                <span className="mono text-muted trace-row-duration">{formatSpanDuration(span.durationUs)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-muted">{t('logsTraceNoSpans')}</p>
      )}

      {selected ? (
        <section className="log-detail-section trace-span-detail">
          <h4 className="log-detail-heading">
            {selected.name}{' '}
            <span className={`badge ${selected.status === 'error' ? 'log-level-error' : 'log-level-info'}`}>{selected.status}</span>
          </h4>
          <dl className="log-detail-fields">
            {(
              [
                [t('logsTraceSpan'), selected.spanId],
                [t('logsParentSpan'), selected.parentSpanId],
                [t('logsSpanKind'), selected.kind],
                [t('logAlertService'), selected.service],
                [t('logsTraceDuration'), formatSpanDuration(selected.durationUs)],
                [t('logsStatusMessage'), selected.statusMessage],
              ] as Array<[string, string | null]>
            )
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="log-detail-field">
                  <dt className="text-muted">{label}</dt>
                  <dd className="mono">{value}</dd>
                </div>
              ))}
          </dl>
          <AttributeTable label={t('logsAttributes')} values={selected.attributes} onFilter={onFilterAttribute} />
          {selected.events.length ? (
            <section className="log-detail-section">
              <h4 className="log-detail-heading">{t('logsSpanEvents')}</h4>
              <ul className="trace-events">
                {selected.events.map((event, index) => (
                  <li key={`${event.name}-${index}`}>
                    <span className="mono text-muted">+{formatSpanDuration(Math.max(0, event.timeUs - selected.startUs))}</span>{' '}
                    <strong>{event.name}</strong>
                    {Object.keys(event.attributes ?? {}).length ? (
                      <span className="mono text-muted"> {JSON.stringify(event.attributes)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      ) : null}

      <section className="log-detail-section">
        <h4 className="log-detail-heading">{t('logsTraceLogs')}</h4>
        {trace.logs.length ? (
          <ul className="trace-logs">
            {trace.logs.map((log) => (
              <li key={`${log.source}:${log.id}`}>
                <button type="button" className="trace-log-button" onClick={() => onSelectLog(log)}>
                  <span className="mono text-muted">{formatLogTime(log.timeUs, timezone)}</span>
                  <LevelBadge level={log.level} />
                  <span className="logs-message">{log.message ?? '-'}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t('logsTraceNoLogs')}</p>
        )}
      </section>
    </MasterDetailSidePane>
  );
}
