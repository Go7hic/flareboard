import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { AiContentViewer } from '../components/llm/AiContentViewer';
import { aiKindLabel, formatMs, formatUsd } from '../components/llm/llm-format';
import { StatCard } from '../components/ui/stat-card';
import { api, ApiError, type AiTraceDetail, type AiTraceNode } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';

type Row = { node: AiTraceNode; hasChildren: boolean };

function visibleRows(root: AiTraceNode, collapsed: ReadonlySet<string>): Row[] {
  const out: Row[] = [];
  const walk = (node: AiTraceNode) => {
    out.push({ node, hasChildren: node.children.length > 0 });
    if (!collapsed.has(node.id)) node.children.forEach(walk);
  };
  walk(root);
  return out;
}

function findNode(root: AiTraceNode, id: string | null): AiTraceNode | null {
  if (!id) return null;
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function firstGeneration(root: AiTraceNode): AiTraceNode | null {
  if (root.event && (root.event.kind === 'generation' || root.event.kind === 'embedding')) return root;
  for (const child of root.children) {
    const found = firstGeneration(child);
    if (found) return found;
  }
  return null;
}

function NodeDetail({ node }: { node: AiTraceNode }) {
  const event = node.event;
  if (!event) {
    return (
      <div className="detail-stats">
        <div>
          <span className="stat-label">{t('aiCost')}</span>
          <strong className="stat-value">{formatUsd(node.totals.costUsd)}</strong>
        </div>
        <div>
          <span className="stat-label">{t('aiTokens')}</span>
          <strong className="stat-value">{formatNumber(node.totals.tokens)}</strong>
        </div>
      </div>
    );
  }
  const call = event.kind === 'generation' || event.kind === 'embedding';
  const facts: Array<[string, string | null]> = [
    [t('aiModel'), event.model],
    [t('aiProvider'), event.provider],
    [t('aiLatency'), formatMs(event.latencyMs ?? node.endMs - node.startMs)],
    [t('status'), event.status],
    [t('aiHttpStatus'), event.httpStatus != null ? String(event.httpStatus) : null],
    [t('aiInputTokens'), call ? formatNumber(event.inputTokens) : null],
    [t('aiOutputTokens'), call ? formatNumber(event.outputTokens) : null],
    [t('aiCacheReadTokens'), event.cacheReadTokens ? formatNumber(event.cacheReadTokens) : null],
    [t('aiCacheWriteTokens'), event.cacheWriteTokens ? formatNumber(event.cacheWriteTokens) : null],
    [
      t('aiCost'),
      call
        ? event.costUsd == null
          ? t('aiUnpriced')
          : `${formatUsd(event.costUsd)}${event.costSource ? ` · ${t(`aiPriceSource_${event.costSource}`)}` : ''}`
        : node.totals.costUsd
          ? formatUsd(node.totals.costUsd)
          : null,
    ],
    [t('created'), formatDateTime(event.createdAt)],
  ];
  const properties = Object.entries(event.properties);

  return (
    <>
      <dl className="llm-facts">
        {facts
          .filter(([, value]) => value != null && value !== '')
          .map(([label, value]) => (
            <div key={label}>
              <dt className="stat-label">{label}</dt>
              <dd className={label === t('aiModel') ? 'mono' : undefined}>{value}</dd>
            </div>
          ))}
      </dl>
      {event.error ? <pre className="llm-error">{event.error}</pre> : null}
      <AiContentViewer label={t('aiInput')} value={event.input} truncated={event.inputTruncated} omitted={event.contentOmitted} />
      <AiContentViewer label={t('aiOutput')} value={event.output} truncated={event.outputTruncated} omitted={event.contentOmitted} />
      {properties.length ? (
        <details className="llm-content">
          <summary className="llm-content-summary">
            <span className="llm-content-label">{t('aiProperties')}</span>
          </summary>
          <div className="llm-content-body">
            <table className="data-table">
              <tbody>
                {properties.map(([key, value]) => (
                  <tr key={key}>
                    <td className="mono">{key}</td>
                    <td className="mono llm-break">{value == null ? '—' : String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </>
  );
}

export default function WebsiteAiTracePage() {
  const { websiteId = '', traceId = '' } = useParams<{ websiteId: string; traceId: string }>();
  const [searchParams] = useSearchParams();
  const at = searchParams.get('at');
  const query = useQuery({
    queryKey: ['ai-trace', websiteId, traceId, at],
    enabled: Boolean(websiteId && traceId),
    retry: false,
    queryFn: () =>
      api<AiTraceDetail>(
        `/api/websites/${websiteId}/ai-observability/traces/${encodeURIComponent(traceId)}${at ? `?at=${encodeURIComponent(at)}` : ''}`,
      ),
  });
  const trace = query.data;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => (trace ? visibleRows(trace.tree, collapsed) : []), [trace, collapsed]);
  const selected = trace ? (findNode(trace.tree, selectedId) ?? firstGeneration(trace.tree) ?? trace.tree) : null;
  const span = trace ? Math.max(1, trace.tree.endMs - trace.tree.startMs) : 1;

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const back = `/websites/${websiteId}/ai-observability?tab=traces`;

  return (
    <Page className="page-ai-trace">
      <PageHeader
        title={trace?.name ?? t('aiTraceDetail')}
        lead={traceId}
        actions={
          <Link className="inline-link" to={back}>
            {t('aiBackToTraces')}
          </Link>
        }
      />
      <PageBody>
        <DataViewState
          loading={query.isLoading}
          error={query.error instanceof ApiError && query.error.status === 404 ? null : query.error}
          onRetry={() => void query.refetch()}
        >
          {!trace ? (
            <EmptyState title={t('aiTraceNotFound')} />
          ) : (
            <>
              <section className="analytics-hero-stats section-gap" aria-label={t('aiTraceDetail')}>
                <StatCard label={t('aiLatency')} value={formatMs(trace.latencyMs)} hint={formatDateTime(trace.startedAt)} />
                <StatCard
                  label={t('aiCost')}
                  value={formatUsd(trace.costUsd)}
                  hint={trace.unpricedCalls ? `${t('aiUnpriced')}: ${formatNumber(trace.unpricedCalls)}` : undefined}
                />
                <StatCard label={t('aiTokens')} value={formatNumber(trace.tokens)} />
                <StatCard label={t('aiGenerations')} value={formatNumber(trace.generations)} hint={`${t('aiErrors')}: ${formatNumber(trace.errors)}`} />
                <StatCard
                  label={t('aiDistinctId')}
                  value={
                    <Link className="inline-link" to={`/websites/${websiteId}/sessions/${trace.sessionId}`}>
                      {trace.distinctId ?? t('aiAnonymous')}
                    </Link>
                  }
                />
              </section>
              {trace.truncated ? <p className="text-muted section-gap">{t('aiTraceTruncated')}</p> : null}

              <div className="llm-trace-layout section-gap">
                <section className="panel llm-waterfall" aria-label={t('aiWaterfall')}>
                  <header className="compact-panel-header">
                    <h2 className="section-title">{t('aiWaterfall')}</h2>
                  </header>
                  <ol className="llm-waterfall-rows">
                    {rows.map(({ node, hasChildren }) => {
                      const event = node.event;
                      const kind = event?.kind ?? 'trace';
                      const left = ((node.startMs - trace.tree.startMs) / span) * 100;
                      const width = Math.max(0.5, ((node.endMs - node.startMs) / span) * 100);
                      const isSelected = selected?.id === node.id;
                      return (
                        <li key={node.id}>
                          <div
                            role="button"
                            tabIndex={0}
                            className={`llm-waterfall-row${isSelected ? ' is-selected' : ''}`}
                            onClick={() => setSelectedId(node.id)}
                            onKeyDown={(keyEvent) => {
                              if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                                keyEvent.preventDefault();
                                setSelectedId(node.id);
                              }
                            }}
                          >
                            <div className="llm-waterfall-label" style={{ paddingLeft: `${node.depth * 1}rem` }}>
                              {hasChildren ? (
                                <button
                                  type="button"
                                  className="llm-waterfall-toggle"
                                  aria-label={collapsed.has(node.id) ? t('aiShowAll') : t('aiShowLess')}
                                  onClick={(clickEvent) => {
                                    clickEvent.stopPropagation();
                                    toggle(node.id);
                                  }}
                                >
                                  {collapsed.has(node.id) ? (
                                    <ChevronRight size={14} strokeWidth={2} aria-hidden />
                                  ) : (
                                    <ChevronDown size={14} strokeWidth={2} aria-hidden />
                                  )}
                                </button>
                              ) : (
                                <span className="llm-waterfall-toggle" aria-hidden />
                              )}
                              <span className={`badge llm-kind llm-kind--${kind}`}>{aiKindLabel(kind)}</span>
                              <span className="llm-waterfall-name">{event?.name ?? trace.name ?? node.id}</span>
                              {event?.isError ? <span className="badge log-level-error">{t('aiErrors')}</span> : null}
                            </div>
                            <div className="llm-waterfall-track" aria-hidden>
                              <span
                                className={`llm-waterfall-bar llm-kind-bar--${kind}${event?.isError ? ' is-error' : ''}`}
                                style={{ left: `${Math.min(left, 99.5)}%`, width: `${Math.min(width, 100 - Math.min(left, 99.5))}%` }}
                              />
                            </div>
                            <div className="llm-waterfall-meta">
                              <span>{formatMs(node.endMs - node.startMs)}</span>
                              {node.totals.costUsd ? <span className="text-muted">{formatUsd(node.totals.costUsd)}</span> : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>

                <section className="panel llm-node-detail" aria-live="polite">
                  {selected ? (
                    <>
                      <header className="compact-panel-header">
                        <h2 className="section-title">
                          {selected.event?.name ?? trace.name ?? selected.id}{' '}
                          <span className="badge">{aiKindLabel(selected.event?.kind ?? 'trace')}</span>
                        </h2>
                      </header>
                      <NodeDetail node={selected} />
                    </>
                  ) : (
                    <p className="text-muted">{t('aiSelectSpan')}</p>
                  )}
                </section>
              </div>
            </>
          )}
        </DataViewState>
      </PageBody>
    </Page>
  );
}
