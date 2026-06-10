export type SegmentField =
  | 'country'
  | 'region'
  | 'city'
  | 'browser'
  | 'os'
  | 'device'
  | 'language'
  | 'path'
  | 'referrer'
  | 'event_name'
  | 'utmSource'
  | 'utmMedium'
  | 'utmCampaign'
  | 'hostname'
  | 'tag';

export type SegmentCondition = {
  field: SegmentField;
  operator: 'equals' | 'contains';
  value: string;
};

export const SEGMENT_FIELD_OPTIONS: SegmentField[] = [
  'path',
  'referrer',
  'browser',
  'os',
  'device',
  'country',
  'region',
  'city',
  'language',
  'event_name',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'hostname',
  'tag',
];

export function defaultSegmentCondition(): SegmentCondition {
  return { field: 'country', operator: 'equals', value: '' };
}

export function conditionsToParams(conditions: SegmentCondition[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const c of conditions) {
    if (!c.value.trim()) continue;
    if (c.field === 'path' && c.operator === 'contains') {
      params.pathContains = c.value.trim();
    } else if (c.field === 'path') {
      params.path = c.value.trim();
    } else if (c.field === 'event_name') {
      params.eventName = c.value.trim();
    } else {
      params[c.field] = c.value.trim();
    }
  }
  return params;
}

export function paramsToConditions(params: Record<string, unknown>): SegmentCondition[] {
  const conditions: SegmentCondition[] = [];
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw);
    if (key === 'pathContains') {
      conditions.push({ field: 'path', operator: 'contains', value });
    } else if (key === 'path' || key === 'url') {
      conditions.push({ field: 'path', operator: 'equals', value });
    } else if (key === 'event' || key === 'eventName') {
      conditions.push({ field: 'event_name', operator: 'equals', value });
    } else if (SEGMENT_FIELD_OPTIONS.includes(key as SegmentField)) {
      conditions.push({ field: key as SegmentField, operator: 'equals', value });
    }
  }
  return conditions.length ? conditions : [defaultSegmentCondition()];
}
