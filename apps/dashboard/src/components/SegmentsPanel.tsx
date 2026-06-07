import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { SectionDataSkeleton } from './ReportSection';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { api, type Segment } from '../lib/api';
import { t } from '../lib/i18n';

export function SegmentsPanel({ websiteId }: { websiteId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState('filter');
  const [paramsJson, setParamsJson] = useState('{"country":"US"}');

  const presets: Array<{ label: string; params: Record<string, unknown> }> = [
    { label: 'Country US', params: { country: 'US' } },
    { label: 'Browser Chrome', params: { browser: 'Chrome' } },
    { label: 'Path /', params: { path: '/' } },
    { label: 'Path contains blog', params: { pathContains: '/blog' } },
    { label: 'UTM google', params: { utmSource: 'google' } },
    { label: 'Device mobile', params: { device: 'mobile' } },
    { label: 'OS macOS', params: { os: 'macOS' } },
  ];

  const { data, isLoading } = useQuery({
    queryKey: ['segments', websiteId],
    queryFn: () => api<Segment[]>(`/api/websites/${websiteId}/segments`),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      let parameters: Record<string, unknown> = {};
      try {
        parameters = JSON.parse(paramsJson) as Record<string, unknown>;
      } catch {
        throw new Error(t('invalidSegmentJson'));
      }
      return api<Segment>(`/api/websites/${websiteId}/segments`, {
        method: 'POST',
        body: JSON.stringify({ name, type, parameters }),
      });
    },
    onSuccess: () => {
      setName('');
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
      <p className="section-lead">{t('segmentsLead')}</p>
      <div className="segment-presets">
        {presets.map((p) => (
          <Button
            key={p.label}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setParamsJson(JSON.stringify(p.params, null, 2))}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <form onSubmit={onSubmit}>
        <div className="field">
          <Input placeholder={t('name')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <Input placeholder={t('type')} value={type} onChange={(e) => setType(e.target.value)} />
        </div>
        <div className="field">
          <Textarea
            className="textarea-mono"
            value={paramsJson}
            onChange={(e) => setParamsJson(e.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" disabled={createMutation.isPending}>
          {t('addSegment')}
        </Button>
      </form>
      {createMutation.error ? <p className="text-danger">{(createMutation.error as Error).message}</p> : null}
      {isLoading ? (
        <SectionDataSkeleton />
      ) : (
        <ul className="list-plain section-gap">
          {(data ?? []).map((s) => (
          <li key={s.id} className="list-item" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
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
