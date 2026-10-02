import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, Waypoints } from 'lucide-react';
import { ChartLegend } from '../components/ChartLegend';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { KvList, type KvItem } from '../components/KvList';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { AiContentViewer } from '../components/llm/AiContentViewer';
import { aiKindLabel, formatMs, formatMsTick, formatUsd } from '../components/llm/llm-format';
import { CopyButton } from '../components/quality/CopyButton';
import { RelativeTime } from '../components/quality/RelativeTime';
import { api, ApiError, type AiTraceDetail, type AiTraceNode } from '../lib/api';
import { formatNumber, formatShortDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';

type Row = { node: AiTraceNode; hasChildren: boolean };

/** Bar color per span kind (categorical slots); failed spans use the error status color. */
const KIND_COLORS: Record<string, string> = {
  trace: 'var(--chart-5)',
  generation: 'var(--chart-1)',
  embedding: 'var(--chart-3)',
  span: 'var(--chart-4)',
};
const kindColor = (kind: string) => KIND_COLORS[kind] ?? 'var(--chart-6)';

/** Three ticks: the track is narrow beside the detail card. */
const AXIS_STEPS = [0, 0.5, 1];

function visibleRows(root: AiTraceNode, collapsed: ReadonlySet<string>): Row[] {
  const out: Row[] = [];
  const walk = (node: AiTraceNode) => {
    out.push({ node, hasChildren: node.children.length > 0 });
    if (!collapsed.has(node.id)) node.children.forEach(walk);
  };
  walk(root);
  return out;
}

function allNodes(root: AiTraceNode): AiTraceNode[] {
  const out: AiTraceNode[] = [];
  const walk = (node: AiTraceNode) => {
    out.push(node);
    node.children.forEach(walk);
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
      <KvList
        compact
        className="q-kv-narrow"
        items={[
          { key: 'cost', label: t('aiCost'), value: formatUsd(node.totals.costUsd) },
          { key: 'tokens', label: t('aiTokens'), value: formatNumber(node.totals.tokens) },
          { key: 'latency', label: t('aiLatency'), value: formatMs(node.endMs - node.startMs) },
        ]}
      />
    );
  }
  const call = event.kind === 'generation' || event.kind === 'embedding';
  const facts: Array<[string, string, ReactNode]> = [
    ['model', t('aiModel'), event.model ? <span className="mono">{event.model}</span> : null],
    ['provider', t('aiProvider'), event.provider],
    ['latency', t('aiLatency'), formatMs(event.latencyMs ?? node.endMs - node.startMs)],
    ['status', t('status'), event.status],
    ['http', t('aiHttpStatus'), event.httpStatus != null ? String(event.httpStatus) : null],
    ['input', t('aiInputTokens'), call ? formatNumber(event.inputTokens) : null],
    ['output', t('aiOutputTokens'), call ? formatNumber(event.outputTokens) : null],
    ['cacheRead', t('aiCacheReadTokens'), event.cacheReadTokens ? formatNumber(event.cacheReadTokens) : null],
    ['cacheWrite', t('aiCacheWriteTokens'), event.cacheWriteTokens ? formatNumber(event.cacheWriteTokens) : null],
    [
      'cost',
      t('aiCost'),
      call
        ? event.costUsd == null
          ? t('aiUnpriced')
          : `${formatUsd(event.costUsd)}${event.costSource ? ` · ${t(`aiPriceSource_${event.costSource}`)}` : ''}`
        : node.totals.costUsd
          ? formatUsd(node.totals.costUsd)
          : null,
    ],
    ['created', t('created'), formatShortDateTime(event.createdAt)],
  ];
  const properties = Object.entries(event.properties);
  const items: KvItem[] = facts
    .filter(([, , value]) => value != null && value !== '')
    .map(([key, label, value]) => ({ key, label, value }));

  return (
    <div className="q-ai-node">
      <KvList compact className="q-kv-narrow" items={items} />
      {event.error ? <pre className="q-error-block">{event.error}</pre> : null}
      <AiContentViewer label={t('aiInput')} value={event.input} truncated={event.inputTruncated} omitted={event.contentOmitted} />
      <AiContentViewer label={t('aiOutput')} value={event.output} truncated={event.outputTruncated} omitted={event.contentOmitted} />
      {properties.length ? (
        <section className="q-detail-section">
          <h4 className="q-detail-section-title">{t('aiProperties')}</h4>
          <KvList
            compact
            className="q-kv-narrow q-kv-mono q-attr-list"
            items={properties.map(([key, value]) => ({
              key,
              label: <span className="mono">{key}</span>,
              value: value == null ? '—' : String(value),
            }))}
          />
        </section>
      ) : null}
    </div>
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
  const nodes = useMemo(() => (trace ? allNodes(trace.tree) : []), [trace]);
  const kinds = useMemo(() => [...new Set(nodes.map((node) => node.event?.kind ?? 'trace'))], [nodes]);
  const selected = trace ? (findNode(trace.tree, selectedId) ?? firstGeneration(trace.tree) ?? trace.tree) : null;
  const span = trace ? Math.max(1, trace.tree.endMs - trace.tree.startMs) : 1;
  const notFound = query.error instanceof ApiError && query.error.status === 404;

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const back = `/websites/${websiteId}/ai-observability?tab=traces`;
  const sessionHref = trace ? `/websites/${websiteId}/sessions/${trace.sessionId}` : '';
  const selectedEvent = selected?.event ?? null;

  return (
    <Page className="q-page q-page--ai-trace">
      <PageHeader
        className="q-detail-header"
        backTo={back}
        backLabel={t('aiBackToTraces')}
        title={trace?.name ?? t('aiTraceDetail')}
        meta={
          <div className="meta-line q-detail-meta">
            <span className="q-inline-copy">
              <span className="mono">{traceId}</span>
              <CopyButton value={traceId} iconOnly size="xs" />
            </span>
            {trace ? <RelativeTime value={trace.startedAt} short /> : null}
            {trace ? (
              <Link to={sessionHref} className="q-row-link">
                {trace.distinctId ? <span className="mono">{trace.distinctId}</span> : t('aiAnonymous')}
              </Link>
            ) : null}
          </div>
        }
        actions={
          trace ? (
            <Button asChild variant="outline" size="sm">
              <Link to={sessionHref}>{t('viewSession')}</Link>
            </Button>
          ) : null
        }
      />
      <PageBody className="stack">
        <DataViewState
          loading={query.isLoading}
          error={notFound ? null : query.error}
          onRetry={() => void query.refetch()}
          loadingFallback={
            <div className="stack">
              <KpiStripSkeleton cells={5} />
              <div className="q-trace-layout">
                <SectionCard title={t('aiWaterfall')}>
                  <Skeleton className="h-48 w-full" />
                </SectionCard>
                <SectionCard title={t('aiTraceDetail')}>
                  <Skeleton className="h-48 w-full" />
                </SectionCard>
              </div>
            </div>
          }
        >
          {!trace ? (
            <EmptyState
              variant="rich"
              icon={<Waypoints />}
              title={t('aiTraceNotFound')}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to={back}>{t('aiBackToTraces')}</Link>
                </Button>
              }
            />
          ) : (
            <>
              <KpiStrip columns={5}>
                <KpiCell label={t('aiLatency')} value={formatMs(trace.latencyMs)} />
                <KpiCell
                  label={t('aiCost')}
                  value={formatUsd(trace.costUsd)}
                  hint={trace.unpricedCalls ? `${t('aiUnpriced')}: ${formatNumber(trace.unpricedCalls)}` : undefined}
                />
                <KpiCell label={t('aiTokens')} value={formatNumber(trace.tokens)} />
                <KpiCell
                  label={t('aiGenerations')}
                  value={formatNumber(trace.generations)}
                  hint={t('qualitySpanCount').replace('{count}', formatNumber(nodes.length))}
                />
                <KpiCell label={t('aiErrors')} value={formatNumber(trace.errors)} />
              </KpiStrip>
              {trace.truncated ? <p className="q-view-only">{t('aiTraceTruncated')}</p> : null}

              <div className="q-trace-layout">
                <SectionCard
                  flush
                  title={t('aiWaterfall')}
                  actions={<ChartLegend items={kinds.map((kind) => ({ label: aiKindLabel(kind), color: kindColor(kind), shape: 'box' }))} />}
                >
                  <div className="q-waterfall q-ai-waterfall" role="tree" aria-label={t('aiWaterfall')}>
                    <div className="q-waterfall-axis" aria-hidden>
                      <span />
                      <span className="q-waterfall-ticks">
                        {AXIS_STEPS.map((step) => (
                          <span key={step} style={{ left: `${step * 100}%` }}>
                            {formatMsTick(span * step)}
                          </span>
                        ))}
                      </span>
                      <span />
                    </div>
                    {rows.map(({ node, hasChildren }) => {
                      const event = node.event;
                      const kind = event?.kind ?? 'trace';
                      const left = Math.min(((node.startMs - trace.tree.startMs) / span) * 100, 99.5);
                      const width = Math.min(Math.max(0.5, ((node.endMs - node.startMs) / span) * 100), 100 - left);
                      const isSelected = selected?.id === node.id;
                      return (
                        <div
                          key={node.id}
                          role="treeitem"
                          aria-selected={isSelected}
                          aria-expanded={hasChildren ? !collapsed.has(node.id) : undefined}
                          tabIndex={0}
                          className={cn('q-waterfall-row', isSelected && 'is-selected')}
                          onClick={() => setSelectedId(node.id)}
                          onKeyDown={(keyEvent) => {
                            if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                              keyEvent.preventDefault();
                              setSelectedId(node.id);
                            }
                          }}
                        >
                          <span className="q-waterfall-label" style={{ paddingLeft: `${Math.min(node.depth, 10) * 0.9}rem` }}>
                            {hasChildren ? (
                              <button
                                type="button"
                                className="q-tree-toggle"
                                aria-label={collapsed.has(node.id) ? t('aiShowAll') : t('aiShowLess')}
                                onClick={(clickEvent) => {
                                  clickEvent.stopPropagation();
                                  toggle(node.id);
                                }}
                              >
                                <ChevronRight className={cn('q-stack-chevron', !collapsed.has(node.id) && 'is-open')} size={14} strokeWidth={2} aria-hidden />
                              </button>
                            ) : (
                              <span className="q-tree-toggle" aria-hidden />
                            )}
                            <span className="q-waterfall-name" title={event?.name ?? trace.name ?? node.id}>
                              {event?.name ?? trace.name ?? node.id}
                            </span>
                            <span className="q-waterfall-kind">{aiKindLabel(kind)}</span>
                            {event?.isError ? <span className="q-waterfall-error">{t('aiErrors')}</span> : null}
                          </span>
                          <span className="q-waterfall-track" aria-hidden>
                            <span
                              className={cn('q-waterfall-bar', event?.isError && 'is-error')}
                              style={{ left: `${left}%`, width: `${width}%`, '--q-bar': kindColor(kind) } as CSSProperties}
                            />
                          </span>
                          <span className="q-waterfall-duration">
                            {formatMs(node.endMs - node.startMs)}
                            {node.totals.costUsd ? <span className="q-waterfall-cost">{formatUsd(node.totals.costUsd)}</span> : null}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>

                <SectionCard
                  className="q-trace-detail-card"
                  title={selected ? (selectedEvent?.name ?? trace.name ?? selected.id) : t('aiTraceDetail')}
                  actions={
                    selected ? (
                      <span className="q-header-badges">
                        <StatusBadge dot={false}>{aiKindLabel(selectedEvent?.kind ?? 'trace')}</StatusBadge>
                        {selectedEvent?.isError ? <StatusBadge tone="danger">{t('aiErrors')}</StatusBadge> : null}
                      </span>
                    ) : null
                  }
                >
                  {selected ? <NodeDetail node={selected} /> : <p className="q-muted-line">{t('aiSelectSpan')}</p>}
                </SectionCard>
              </div>
            </>
          )}
        </DataViewState>
      </PageBody>
    </Page>
  );
}
