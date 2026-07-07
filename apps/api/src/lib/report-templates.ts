export const REPORT_TEMPLATES = [
  {
    type: 'funnel',
    name: 'Funnel',
    description: 'Track conversion across ordered product events.',
    defaultParameters: { steps: ['signup', 'purchase'], segmentId: null },
  },
  {
    type: 'retention',
    name: 'Retention',
    description: 'See whether users return after their first active week.',
    defaultParameters: { segmentId: null },
  },
  {
    type: 'journey',
    name: 'Journeys',
    description: 'Review common user paths through the product.',
    defaultParameters: { segmentId: null },
  },
  {
    type: 'attribution',
    name: 'Attribution',
    description: 'Explain which source or path contributed to a conversion.',
    defaultParameters: { model: 'last', attributionType: 'path', step: '/', segmentId: null },
  },
  {
    type: 'breakdown',
    name: 'Breakdown',
    description: 'Group activity by a dimension such as country.',
    defaultParameters: { dimension: 'country', segmentId: null },
  },
  {
    type: 'performance',
    name: 'Web vitals',
    description: 'Monitor LCP, INP, CLS, FCP, and TTFB samples.',
    defaultParameters: { segmentId: null },
  },
  {
    type: 'utm',
    name: 'UTM traffic',
    description: 'Analyze campaigns, sources, media, content, and terms.',
    defaultParameters: { segmentId: null },
  },
  {
    type: 'revenue',
    name: 'Revenue',
    description: 'Track revenue events, currencies, and transaction counts.',
    defaultParameters: { segmentId: null },
  },
  {
    type: 'goals',
    name: 'Goals',
    description: 'Track event targets over a daily, weekly, or monthly period.',
    defaultParameters: { event: '', target: null, period: 'monthly', segmentId: null },
  },
  {
    type: 'cohorts',
    name: 'Cohorts',
    description: 'Save a cohort report or comparison setup.',
    defaultParameters: { cohortId: null, compareCohortId: null },
  },
];

export function readReportParams(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function summarizeReport(type: string, params: Record<string, unknown>) {
  const items: Array<{ label: string; value: string }> = [];
  const segmentId = typeof params.segmentId === 'string' && params.segmentId ? params.segmentId : null;
  if (type === 'funnel') {
    const steps = Array.isArray(params.steps) ? params.steps.filter((step) => typeof step === 'string') : [];
    if (steps.length) items.push({ label: 'Steps', value: steps.join(' -> ') });
  }
  if (type === 'attribution') {
    if (typeof params.model === 'string') items.push({ label: 'Model', value: params.model });
    if (typeof params.attributionType === 'string') items.push({ label: 'Type', value: params.attributionType });
    if (typeof params.step === 'string') items.push({ label: 'Step', value: params.step });
  }
  if (type === 'breakdown' && typeof params.dimension === 'string') {
    items.push({ label: 'Dimension', value: params.dimension });
  }
  if (type === 'goals') {
    if (typeof params.event === 'string' && params.event) items.push({ label: 'Event', value: params.event });
    if (typeof params.target === 'number') items.push({ label: 'Target', value: String(params.target) });
    if (typeof params.period === 'string') items.push({ label: 'Period', value: params.period });
  }
  if (type === 'cohorts') {
    if (typeof params.cohortId === 'string' && params.cohortId) {
      items.push({ label: 'Cohort', value: params.cohortId });
    }
    if (typeof params.compareCohortId === 'string' && params.compareCohortId) {
      items.push({ label: 'Compare', value: params.compareCohortId });
    }
  }
  if (segmentId) items.push({ label: 'Segment', value: segmentId });
  return items;
}
