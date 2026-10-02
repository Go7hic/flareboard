import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { PlayCircle } from 'lucide-react';
import type { LogAttributeFilter, LogEvent, LogTraceDetail } from '../../lib/api';
import { chartSeriesColor } from '../../lib/chart-colors';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { ChartLegend } from '../ChartLegend';
import { KvList } from '../KvList';
import { StatusBadge } from '../StatusBadge';
import { CopyButton } from '../quality/CopyButton';
import { Button } from '../ui/button';
import { AttributeTable } from './LogDetail';
import { formatLogTime, LevelBadge } from './LogTable';
import { waterfallRows } from './trace-tree';

export function formatSpanDuration(us: number) {
  if (us < 1000) return `${us}µs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(us < 10_000 ? 2 : 1)}ms`;
  return `${(us / 1_000_000).toFixed(2)}s`;
}

const AXIS_STEPS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Trace view (rendered in a sheet): a span waterfall on a time axis, colored by service (status
 * red for failed spans), the selected span's details, the trace's log lines and its session.
 */
export function TraceWaterfall({
  trace,
  websiteId,
  timezone,
  onSelectLog,
  onFilterAttribute,
}: {
  trace: LogTraceDetail;
  websiteId: string;
  timezone?: string;
  onSelectLog: (log: LogEvent) => void;
  onFilterAttribute: (filter: LogAttributeFilter) => void;
}) {
  const rows = useMemo(() => waterfallRows(trace.spans), [trace.spans]);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const selected = trace.spans.find((span) => span.spanId === selectedSpanId) ?? null;
  const startUs = Math.min(...trace.spans.map((span) => span.startUs), (trace.startedAt ?? Infinity) * 1000);
  const endUs = Math.max(...trace.spans.map((span) => span.startUs + span.durationUs), (trace.endedAt ?? 0) * 1000);
  const totalUs = Math.max(endUs - startUs, 1);
  const services = useMemo(() => {
    const seen: string[] = [];
    for (const { span } of rows) {
      const name = span.service ?? '-';
      if (!seen.includes(name)) seen.push(name);
    }
    return seen;
  }, [rows]);
  const serviceColor = (service: string | null) => chartSeriesColor(Math.max(0, services.indexOf(service ?? '-')));

  return (
    <div className="q-trace">
      <div className="q-trace-summary">
        <div className="meta-line">
          <span className="q-inline-copy">
            <span className="mono">{trace.traceId}</span>
            <CopyButton value={trace.traceId} iconOnly size="xs" />
          </span>
          <span className="num">{formatSpanDuration(Math.round(totalUs))}</span>
          <span>{t('qualitySpanCount').replace('{count}', String(trace.spans.length))}</span>
        </div>
        {trace.sessionId ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/websites/${websiteId}/sessions/${encodeURIComponent(trace.sessionId)}`}>
              <PlayCircle aria-hidden />
              {t('logsOpenSession')}
            </Link>
          </Button>
        ) : null}
      </div>

      {rows.length ? (
        <section className="q-detail-section">
          <div className="q-detail-section-head">
            <h4 className="q-detail-section-title">{t('logsWaterfall')}</h4>
            <ChartLegend items={services.map((service, index) => ({ label: service, color: chartSeriesColor(index), shape: 'box' }))} />
          </div>
          <div className="q-waterfall" role="list" aria-label={t('logsWaterfall')}>
            <div className="q-waterfall-axis" aria-hidden>
              <span />
              <span className="q-waterfall-ticks">
                {AXIS_STEPS.map((step) => (
                  <span key={step} style={{ left: `${step * 100}%` }}>
                    {formatSpanDuration(Math.round(totalUs * step))}
                  </span>
                ))}
              </span>
              <span />
            </div>
            {rows.map(({ span, depth }) => {
              const left = Math.min(((span.startUs - startUs) / totalUs) * 100, 99.6);
              const width = Math.min(Math.max((span.durationUs / totalUs) * 100, 0.4), 100 - left);
              const failed = span.status === 'error';
              const isSelected = span.spanId === selectedSpanId;
              return (
                <button
                  key={`${span.source}:${span.spanId}`}
                  type="button"
                  role="listitem"
                  className={cn('q-waterfall-row', isSelected && 'is-selected')}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedSpanId(isSelected ? null : span.spanId)}
                >
                  <span className="q-waterfall-label" style={{ paddingLeft: `${Math.min(depth, 10) * 0.85}rem` }}>
                    <span className="q-waterfall-name" title={span.name}>
                      {span.name}
                    </span>
                    {failed ? <span className="q-waterfall-error">{t('logsTraceStatusError')}</span> : null}
                  </span>
                  <span className="q-waterfall-track" aria-hidden>
                    <span
                      className={cn('q-waterfall-bar', failed && 'is-error')}
                      style={{ left: `${left}%`, width: `${width}%`, '--q-bar': serviceColor(span.service) } as CSSProperties}
                    />
                  </span>
                  <span className="q-waterfall-duration">{formatSpanDuration(span.durationUs)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <p className="q-muted-line">{t('logsTraceNoSpans')}</p>
      )}

      {selected ? (
        <section className="q-detail-section">
          <div className="q-detail-section-head">
            <h4 className="q-detail-section-title">{selected.name}</h4>
            <StatusBadge tone={selected.status === 'error' ? 'danger' : selected.status === 'ok' ? 'success' : 'neutral'}>
              {selected.status}
            </StatusBadge>
          </div>
          <KvList
            compact
            className="q-kv-narrow q-kv-mono"
            items={(
              [
                [t('logAlertService'), selected.service],
                [t('logsTraceDuration'), formatSpanDuration(selected.durationUs)],
                [t('logsSpanKind'), selected.kind],
                [t('logsTraceSpan'), selected.spanId],
                [t('logsParentSpan'), selected.parentSpanId],
                [t('logsStatusMessage'), selected.statusMessage],
              ] as Array<[string, string | null]>
            )
              .filter(([, value]) => value)
              .map(([label, value]) => ({ key: label, label, value }))}
          />
          <AttributeTable label={t('logsAttributes')} values={selected.attributes} onFilter={onFilterAttribute} />
          {selected.events.length ? (
            <div className="q-detail-subsection">
              <h5 className="q-detail-subtitle">{t('logsSpanEvents')}</h5>
              <ul className="q-trace-events">
                {selected.events.map((event, index) => (
                  <li key={`${event.name}-${index}`}>
                    <span className="q-trace-event-time">+{formatSpanDuration(Math.max(0, event.timeUs - selected.startUs))}</span>
                    <span className="q-trace-event-name">{event.name}</span>
                    {Object.keys(event.attributes ?? {}).length ? (
                      <span className="q-trace-event-attrs">{JSON.stringify(event.attributes)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : rows.length ? (
        <p className="q-muted-line">{t('qualitySelectSpanHint')}</p>
      ) : null}

      <section className="q-detail-section">
        <h4 className="q-detail-section-title">{t('logsTraceLogs')}</h4>
        {trace.logs.length ? (
          <ul className="q-trace-logs">
            {trace.logs.map((log) => (
              <li key={`${log.source}:${log.id}`}>
                <button type="button" className="q-trace-log" onClick={() => onSelectLog(log)}>
                  <span className="q-log-time">{formatLogTime(log.timeUs, timezone)}</span>
                  <LevelBadge level={log.level} />
                  <span className="q-trace-log-message">{log.message ?? '-'}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="q-muted-line">{t('logsTraceNoLogs')}</p>
        )}
      </section>
    </div>
  );
}
