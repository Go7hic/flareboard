import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { SectionDataSkeleton } from './ReportSection';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { api, type Segment } from '../lib/api';
import { t } from '../lib/i18n';

type SegmentField =
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

type SegmentCondition = {
  field: SegmentField;
  operator: 'equals' | 'contains';
  value: string;
};

const FIELD_OPTIONS: SegmentField[] = [
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

function conditionsToParams(conditions: SegmentCondition[]): Record<string, unknown> {
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

function paramsToConditions(params: Record<string, unknown>): SegmentCondition[] {
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
    } else if (FIELD_OPTIONS.includes(key as SegmentField)) {
      conditions.push({ field: key as SegmentField, operator: 'equals', value });
    }
  }
  return conditions.length
    ? conditions
    : [{ field: 'country', operator: 'equals', value: '' }];
}

export function SegmentsPanel({ websiteId }: { websiteId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState('filter');
  const [showJson, setShowJson] = useState(false);
  const [conditions, setConditions] = useState<SegmentCondition[]>([
    { field: 'country', operator: 'equals', value: '' },
  ]);

  const paramsPreview = useMemo(() => conditionsToParams(conditions), [conditions]);
  const paramsJson = useMemo(() => JSON.stringify(paramsPreview, null, 2), [paramsPreview]);

  const { data, isLoading } = useQuery({
    queryKey: ['segments', websiteId],
    queryFn: () => api<Segment[]>(`/api/websites/${websiteId}/segments`),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!Object.keys(paramsPreview).length) {
        throw new Error(t('segmentNoConditions'));
      }
      return api<Segment>(`/api/websites/${websiteId}/segments`, {
        method: 'POST',
        body: JSON.stringify({ name, type, parameters: paramsPreview }),
      });
    },
    onSuccess: () => {
      setName('');
      setConditions([{ field: 'country', operator: 'equals', value: '' }]);
      queryClient.invalidateQueries({ queryKey: ['segments', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (segmentId: string) =>
      api(`/api/websites/${websiteId}/segments/${segmentId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segments', websiteId] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate();
  }

  return (
    <section className="panel section-gap-lg">
      <h2 className="section-title">{t('segments')}</h2>
      <p className="section-lead">{t('segmentsBuilderLead')}</p>

      <form onSubmit={onSubmit}>
        <div className="field">
          <Input placeholder={t('name')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <Input placeholder={t('type')} value={type} onChange={(e) => setType(e.target.value)} />
        </div>

        <p className="text-muted">{t('segmentConditions')}</p>
        {conditions.map((cond, idx) => (
          <div key={idx} className="stats-toolbar segment-condition-row">
            <select
              className="select"
              value={cond.field}
              onChange={(e) => {
                const next = [...conditions];
                next[idx] = { ...cond, field: e.target.value as SegmentField };
                setConditions(next);
              }}
            >
              {FIELD_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {t(`segmentField_${f}`)}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={cond.operator}
              onChange={(e) => {
                const next = [...conditions];
                next[idx] = { ...cond, operator: e.target.value as 'equals' | 'contains' };
                setConditions(next);
              }}
              disabled={cond.field !== 'path'}
            >
              <option value="equals">{t('cohortEquals')}</option>
              <option value="contains">{t('cohortContains')}</option>
            </select>
            <Input
              value={cond.value}
              onChange={(e) => {
                const next = [...conditions];
                next[idx] = { ...cond, value: e.target.value };
                setConditions(next);
              }}
              placeholder={t('segmentValuePlaceholder')}
            />
            {conditions.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConditions(conditions.filter((_, i) => i !== idx))}
              >
                {t('cohortRemoveCondition')}
              </Button>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setConditions([...conditions, { field: 'country', operator: 'equals', value: '' }])
          }
        >
          {t('cohortAddCondition')}
        </Button>

        <div className="field" style={{ marginTop: '0.75rem' }}>
          <Label>{t('segmentJsonPreview')}</Label>
          <pre className="code-block" style={{ fontSize: '0.75rem' }}>
            {paramsJson}
          </pre>
        </div>

        <Button type="button" variant="secondary" size="sm" onClick={() => setShowJson(!showJson)}>
          {showJson ? t('segmentHideAdvanced') : t('segmentShowAdvanced')}
        </Button>
        {showJson ? (
          <div className="field">
            <Textarea
              className="textarea-mono"
              value={paramsJson}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
                  setConditions(paramsToConditions(parsed));
                } catch {
                  /* ignore while typing */
                }
              }}
            />
          </div>
        ) : null}

        <div style={{ marginTop: '0.75rem' }}>
          <Button type="submit" variant="primary" disabled={createMutation.isPending}>
            {t('addSegment')}
          </Button>
        </div>
      </form>

      {createMutation.error ? (
        <p className="text-danger">{(createMutation.error as Error).message}</p>
      ) : null}
      {isLoading ? (
        <SectionDataSkeleton />
      ) : (
        <ul className="list-plain section-gap">
          {(data ?? []).map((s) => (
            <li key={s.id} className="list-item segment-list-item">
              <div style={{ flex: 1 }}>
                <strong>{s.name}</strong> <span className="badge">{s.type}</span>
                <pre className="code-block" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                  {JSON.stringify(s.parameters, null, 2)}
                </pre>
              </div>
              <Button type="button" variant="danger" size="sm" onClick={() => deleteMutation.mutate(s.id)}>
                {t('delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
