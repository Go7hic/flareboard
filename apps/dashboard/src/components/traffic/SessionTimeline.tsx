import {
  ArrowUpRight,
  Eye,
  Flag,
  MessageSquareText,
  MousePointerClick,
  ScrollText,
  Sparkles,
  TriangleAlert,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { describeBuiltinEvent } from '../../lib/autocapture';
import { formatDateTime, formatDurationSeconds, formatShortDateTime } from '../../lib/format';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { countLabel, formatClockTime } from './format';

export type SessionContextItem = {
  id: string;
  kind:
    | 'pageview'
    | 'event'
    | 'feature_flag'
    | 'error'
    | 'log'
    | 'ai'
    | 'survey_response'
    | 'workflow_execution';
  title: string;
  detail: string | null;
  urlPath: string | null;
  createdAt: number;
  source?: {
    module: 'feature_flags' | 'errors' | 'logs' | 'ai_observability' | 'surveys' | 'workflows';
    id?: string | null;
  };
  properties?: Array<{ key: string; value: string | null }>;
};

export type SessionActivityRow = {
  id?: string;
  visitId?: string;
  urlPath: string;
  eventType?: number;
  eventName: string | null;
  createdAt: number;
};

export type VisitSummary = {
  id: string;
  index: number;
  start: number;
  end: number;
  pageviews: number;
};

/** Performance samples and heatmap clicks/scrolls: telemetry, not steps a person took. */
const TELEMETRY_TYPES = new Set([5, 6, 7]);

const KIND_META: Record<SessionContextItem['kind'], { icon: LucideIcon; label: string; tone?: 'danger' }> = {
  pageview: { icon: Eye, label: 'trafficKindPageview' },
  event: { icon: MousePointerClick, label: 'contextKindEvent' },
  feature_flag: { icon: Flag, label: 'contextKindFeatureFlag' },
  error: { icon: TriangleAlert, label: 'contextKindError', tone: 'danger' },
  log: { icon: ScrollText, label: 'contextKindLog' },
  ai: { icon: Sparkles, label: 'contextKindAi' },
  survey_response: { icon: MessageSquareText, label: 'contextKindSurvey' },
  workflow_execution: { icon: Workflow, label: 'contextKindWorkflow' },
};

/** Visits in order, from the raw activity (each event carries its visit id). */
export function summarizeVisits(activity: SessionActivityRow[] | undefined): VisitSummary[] {
  const byId = new Map<string, VisitSummary>();
  for (const row of activity ?? []) {
    const id = row.visitId ?? 'visit';
    const visit = byId.get(id) ?? { id, index: 0, start: row.createdAt, end: row.createdAt, pageviews: 0 };
    visit.start = Math.min(visit.start, row.createdAt);
    visit.end = Math.max(visit.end, row.createdAt);
    if (row.eventType === 1) visit.pageviews += 1;
    byId.set(id, visit);
  }
  return [...byId.values()]
    .sort((a, b) => a.start - b.start)
    .map((visit, index) => ({ ...visit, index: index + 1 }));
}

function sourcePath(websiteId: string, sessionId: string, source: SessionContextItem['source']) {
  if (!source) return null;
  const base = `/websites/${websiteId}`;
  const id = source.id ? encodeURIComponent(source.id) : '';
  switch (source.module) {
    case 'feature_flags':
      return `${base}/feature-flags${id ? `?flag=${id}` : ''}`;
    case 'errors':
      return `${base}/errors`;
    case 'logs':
      return `${base}/logs?sessionId=${encodeURIComponent(sessionId)}`;
    case 'ai_observability':
      return `${base}/ai-observability`;
    case 'surveys':
      return `${base}/surveys${id ? `?survey=${id}` : ''}`;
    case 'workflows':
      return `${base}/workflows${id ? `?workflow=${id}` : ''}`;
    default:
      return null;
  }
}

function describe(item: SessionContextItem): { title: string; mono: boolean; detail: string | null } {
  if (item.kind === 'pageview') return { title: item.title, mono: true, detail: null };
  if (item.kind === 'event') {
    const builtin = describeBuiltinEvent(item.title, item.properties);
    if (builtin) {
      const selector = item.properties?.find((p) => p.key === '$el_selector')?.value ?? null;
      return { title: builtin, mono: false, detail: selector };
    }
    const props = (item.properties ?? [])
      .filter((p) => p.value != null && p.value !== '' && !p.key.startsWith('$'))
      .map((p) => `${p.key}: ${p.value}`);
    return { title: item.title, mono: true, detail: props.length ? props.join(' · ') : null };
  }
  if (item.kind === 'feature_flag') {
    return { title: item.title, mono: true, detail: item.detail ? `→ ${item.detail}` : null };
  }
  return { title: item.title, mono: false, detail: item.detail };
}

/**
 * Everything that happened in a session, in order: pageviews, events and linked signals
 * (flags, errors, logs, AI calls, survey answers, workflow runs), grouped by visit when
 * there was more than one.
 */
export function SessionTimeline({
  websiteId,
  sessionId,
  items,
  activity,
  visits,
}: {
  websiteId: string;
  sessionId: string;
  items: SessionContextItem[];
  activity: SessionActivityRow[];
  visits: VisitSummary[];
}) {
  const typeById = new Map(activity.filter((row) => row.id).map((row) => [row.id!, row.eventType]));
  const visitById = new Map(activity.filter((row) => row.id).map((row) => [row.id!, row.visitId]));
  const shown = items
    .filter((item) => {
      const type = typeById.get(item.id);
      return type === undefined || !TELEMETRY_TYPES.has(type);
    })
    .sort((a, b) => a.createdAt - b.createdAt);

  const visitFor = (item: SessionContextItem) => {
    const id = visitById.get(item.id);
    if (id) return visits.find((visit) => visit.id === id) ?? null;
    // Signals without an event row (survey answers, workflow runs): the visit they fall in.
    let match: VisitSummary | null = visits[0] ?? null;
    for (const visit of visits) if (visit.start <= item.createdAt) match = visit;
    return match;
  };

  const grouped = visits.length > 1;
  let currentVisit: string | null = null;

  return (
    <ol className="traffic-timeline">
      {shown.map((item) => {
        const meta = KIND_META[item.kind] ?? KIND_META.event;
        const Icon = meta.icon;
        const text = describe(item);
        const href = sourcePath(websiteId, sessionId, item.source);
        const visit = grouped ? visitFor(item) : null;
        const header =
          visit && visit.id !== currentVisit ? (
            <li key={`visit-${visit.id}`} className="traffic-timeline-visit">
              <span className="meta-line">
                <span className="traffic-timeline-visit-title">
                  {t('trafficVisitN').replace('{n}', String(visit.index))}
                </span>
                <span title={formatDateTime(visit.start)}>{formatShortDateTime(visit.start)}</span>
                <span>{formatDurationSeconds((visit.end - visit.start) / 1000)}</span>
                <span>{countLabel('trafficPageviewsCount', visit.pageviews)}</span>
              </span>
            </li>
          ) : null;
        if (visit) currentVisit = visit.id;
        return [
          header,
          <li key={`${item.kind}-${item.id}`} className={cn('traffic-timeline-row', meta.tone && 'is-danger')}>
            <time className="traffic-timeline-time" dateTime={new Date(item.createdAt).toISOString()} title={formatDateTime(item.createdAt)}>
              {formatClockTime(item.createdAt)}
            </time>
            <span className="traffic-timeline-kind">
              <Icon aria-hidden size={14} strokeWidth={2} />
              {t(meta.label)}
            </span>
            <span className="traffic-timeline-main">
              <span className={cn('traffic-timeline-title', text.mono && 'mono')} title={text.title}>
                {text.title}
              </span>
              {text.detail ? (
                <span className="traffic-timeline-detail" title={text.detail}>
                  {text.detail}
                </span>
              ) : null}
            </span>
            {href ? (
              <Link to={href} className="traffic-timeline-source">
                {t('viewSource')}
                <ArrowUpRight aria-hidden size={13} strokeWidth={2} />
              </Link>
            ) : (
              <span />
            )}
          </li>,
        ];
      })}
    </ol>
  );
}
