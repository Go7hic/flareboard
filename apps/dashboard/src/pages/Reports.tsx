import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DateRangePicker } from '../components/DateRangePicker';
import { DataViewState } from '../components/DataViewState';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type Website } from '../lib/api';
import { type DateRangePreset, presetToRange } from '../lib/dateRange';
import { t } from '../lib/i18n';

type SavedReport = {
  id: string;
  name: string;
  type: string;
  websiteId: string;
  parameters: Record<string, unknown>;
  parameterSummary?: Array<{ label: string; value: string }>;
};

type ReportTemplate = {
  type: string;
  name: string;
  description: string;
  defaultParameters: Record<string, unknown>;
};

const REPORT_HUB_SECTIONS = [
  { id: 'funnel', labelKey: 'funnel' as const, route: 'funnel', descriptionKey: 'funnelNoDataHint' as const },
  { id: 'retention', labelKey: 'retentionCohorts' as const, route: 'retention', descriptionKey: 'retention' as const },
  { id: 'journey', labelKey: 'userJourneys' as const, route: 'journeys', descriptionKey: 'navJourneys' as const },
  { id: 'attribution', labelKey: 'attribution' as const, route: 'attribution', descriptionKey: 'attributionLead' as const },
  { id: 'breakdown', labelKey: 'breakdownCountry' as const, route: 'breakdown', descriptionKey: 'breakdown' as const },
  { id: 'performance', labelKey: 'webVitals' as const, route: 'performance', descriptionKey: 'performance' as const },
  { id: 'utm', labelKey: 'utmBreakdown' as const, route: 'utm', descriptionKey: 'navUtm' as const },
  { id: 'revenue', labelKey: 'revenue' as const, route: 'revenue', descriptionKey: 'revenue' as const },
  { id: 'cohorts', labelKey: 'cohorts' as const, route: 'cohorts', descriptionKey: 'cohorts' as const },
  { id: 'goals', labelKey: 'goals' as const, route: 'goals', descriptionKey: 'goals' as const },
] as const;

function reportTypeLabel(type: string) {
  switch (type) {
    case 'funnel':
      return t('funnel');
    case 'retention':
      return t('retention');
    case 'journey':
      return t('journey');
    case 'attribution':
      return t('attribution');
    case 'breakdown':
      return t('breakdown');
    case 'performance':
      return t('webVitals');
    case 'utm':
      return t('utmBreakdown');
    case 'revenue':
      return t('revenue');
    case 'goals':
      return t('goals');
    case 'cohorts':
      return t('cohorts');
    default:
      return type;
  }
}

function reportDestination(
  websiteId: string,
  type: string,
  parameters: Record<string, unknown> = {},
  segmentId = '',
) {
  const section = REPORT_HUB_SECTIONS.find((item) => item.id === type);
  const route = section?.route ?? type;
  const search = new URLSearchParams();
  const segment = typeof parameters.segmentId === 'string' ? parameters.segmentId : segmentId;
  if (segment) search.set('segmentId', segment);

  if (type === 'attribution') {
    if (parameters.model === 'first' || parameters.model === 'last') search.set('model', parameters.model);
    if (parameters.attributionType === 'path' || parameters.attributionType === 'event') {
      search.set('type', parameters.attributionType);
    }
    if (typeof parameters.step === 'string' && parameters.step.trim()) search.set('step', parameters.step.trim());
  }

  const qs = search.toString();
  return qs ? `/websites/${websiteId}/${route}?${qs}` : `/websites/${websiteId}/${route}`;
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [websiteId, setWebsiteId] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [funnelSteps, setFunnelSteps] = useState('signup,purchase');
  const [savedName, setSavedName] = useState('');
  const [savedType, setSavedType] = useState('funnel');
  const [range, setRange] = useState({
    preset: '30d' as DateRangePreset,
    ...presetToRange('30d'),
  });

  const websitesQuery = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
  });

  useEffect(() => {
    if (websitesQuery.data?.length && !websiteId) {
      setWebsiteId(websitesQuery.data[0].id);
    }
  }, [websitesQuery.data, websiteId]);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
  });

  const timezone = websiteQuery.data?.timezone ?? 'UTC';

  useEffect(() => {
    setRange((prev) => {
      if (prev.preset === 'custom') return prev;
      return { preset: prev.preset, ...presetToRange(prev.preset, undefined, undefined, timezone) };
    });
  }, [timezone]);

  const segmentsQuery = useQuery({
    queryKey: ['segments', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Array<{ id: string; name: string }>>(`/api/websites/${websiteId}/segments`),
  });

  const savedReportsQuery = useQuery({
    queryKey: ['saved-reports'],
    queryFn: () => api<SavedReport[]>('/api/reports'),
  });

  const reportTemplatesQuery = useQuery({
    queryKey: ['report-templates'],
    queryFn: () => api<ReportTemplate[]>('/api/reports/templates'),
  });

  const saveReportMutation = useMutation({
    mutationFn: () => {
      if (!savedName.trim() || !websiteId) throw new Error(t('reportName'));
      return api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          websiteId,
          type: savedType,
          name: savedName.trim(),
          description: selectedTemplate?.description ?? '',
          parameters: buildSavedReportParameters(savedType),
        }),
      });
    },
    onSuccess: () => {
      setSavedName('');
      queryClient.invalidateQueries({ queryKey: ['saved-reports'] });
    },
  });

  const deleteReportMutation = useMutation({
    mutationFn: (reportId: string) => api(`/api/reports/${reportId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-reports'] }),
  });

  const noWebsite = !websitesQuery.isLoading && !(websitesQuery.data ?? []).length;
  const reportTemplates = reportTemplatesQuery.data ?? [
    { type: 'funnel', name: reportTypeLabel('funnel'), description: '', defaultParameters: {} },
    { type: 'retention', name: reportTypeLabel('retention'), description: '', defaultParameters: {} },
    { type: 'journey', name: reportTypeLabel('journey'), description: '', defaultParameters: {} },
  ];
  const selectedTemplate = reportTemplates.find((template) => template.type === savedType);
  const savedReportsForWebsite = (savedReportsQuery.data ?? []).filter((r) => r.websiteId === websiteId);

  const hubLinks = useMemo(
    () =>
      REPORT_HUB_SECTIONS.map((section) => ({
        ...section,
        to: websiteId ? reportDestination(websiteId, section.id, {}, segmentId) : '',
      })),
    [websiteId, segmentId],
  );

  function buildSavedReportParameters(type: string) {
    const base = {
      ...(selectedTemplate?.defaultParameters ?? {}),
      segmentId: segmentId || null,
    };
    if (type === 'funnel') {
      return { ...base, steps: funnelSteps.split(',').map((step) => step.trim()).filter(Boolean) };
    }
    if (type === 'attribution') {
      return { ...base, model: 'last', attributionType: 'path', step: '/' };
    }
    if (type === 'breakdown') {
      return { ...base, dimension: 'country' };
    }
    return base;
  }

  function loadSavedReport(report: SavedReport) {
    navigate(reportDestination(report.websiteId, report.type, report.parameters, segmentId));
  }

  return (
    <div className="page page-reports">
      <PageHeader
        title={t('reports')}
        subtitle={t('reportsSubtitle')}
        backTo="/websites"
        backLabel={t('websites')}
      />

      {noWebsite ? (
        <div className="panel empty-state-rich section-gap">
          <h3>{t('noWebsites')}</h3>
          <p className="text-muted">{t('noWebsitesHint')}</p>
        </div>
      ) : (
        <div className="reports-layout">
          <aside className="reports-sidebar">
            <section className="panel reports-sidebar-panel">
              <h2 className="section-title">{t('reportConfig')}</h2>
              <div className="field">
                <Label>{t('dateRange')}</Label>
                <DateRangePicker value={range} onChange={setRange} popover timezone={timezone} />
              </div>
              <div className="field">
                <Label htmlFor="report-website">{t('website')}</Label>
                <select
                  id="report-website"
                  className="select"
                  value={websiteId}
                  onChange={(e) => setWebsiteId(e.target.value)}
                >
                  {(websitesQuery.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              {(segmentsQuery.data ?? []).length ? (
                <div className="field">
                  <Label htmlFor="report-segment">{t('segment')}</Label>
                  <select
                    id="report-segment"
                    className="select"
                    value={segmentId}
                    onChange={(e) => setSegmentId(e.target.value)}
                  >
                    <option value="">{t('allVisitors')}</option>
                    {(segmentsQuery.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <h3 className="reports-sidebar-subtitle">{t('savedReports')}</h3>
              <form
                className="reports-sidebar-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveReportMutation.mutate();
                }}
              >
                <Input
                  placeholder={t('reportName')}
                  value={savedName}
                  onChange={(e) => setSavedName(e.target.value)}
                />
                <select className="select" value={savedType} onChange={(e) => setSavedType(e.target.value)}>
                  {reportTemplates.map((template) => (
                    <option key={template.type} value={template.type}>
                      {template.name || reportTypeLabel(template.type)}
                    </option>
                  ))}
                </select>
                {selectedTemplate?.description ? (
                  <p className="text-muted reports-template-desc">{selectedTemplate.description}</p>
                ) : null}
                {savedType === 'funnel' ? (
                  <Input
                    value={funnelSteps}
                    onChange={(e) => setFunnelSteps(e.target.value)}
                    placeholder={t('funnelStepsPlaceholder')}
                    aria-label={t('funnel')}
                  />
                ) : null}
                <Button type="submit" variant="primary" size="sm" disabled={saveReportMutation.isPending}>
                  {t('save')}
                </Button>
              </form>
              <div className="section-gap">
                <DataViewState
                  loading={savedReportsQuery.isLoading}
                  isEmpty={!savedReportsQuery.isLoading && savedReportsForWebsite.length === 0}
                  emptyTitle={t('noSavedReports')}
                >
                  <ul className="list-plain">
                    {savedReportsForWebsite.map((r) => (
                      <li key={r.id} className="list-item reports-saved-row">
                        <div className="reports-saved-main">
                          <strong>{r.name}</strong>
                          <span className="badge">{reportTypeLabel(r.type)}</span>
                          {r.parameterSummary?.length ? (
                            <div className="reports-saved-summary">
                              {r.parameterSummary.map((item) => (
                                <span key={`${r.id}-${item.label}`} className="text-muted">
                                  {item.label}: {item.value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <Button type="button" variant="ghost" size="sm" onClick={() => loadSavedReport(r)}>
                          {t('load')}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={deleteReportMutation.isPending}
                          onClick={() => deleteReportMutation.mutate(r.id)}
                        >
                          {t('delete')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </DataViewState>
              </div>
            </section>
          </aside>

          <div className="reports-main">
            <section className="panel section-gap">
              <h2 className="section-title">{t('reportSections')}</h2>
              <p className="text-muted reports-meta">{t('reportsSubtitle')}</p>
            </section>
            <div className="reports-hub-grid">
              {hubLinks.map((section) => (
                <section key={section.id} className="panel reports-hub-card">
                  <h3 className="reports-hub-card-title">{t(section.labelKey)}</h3>
                  <p className="text-muted reports-hub-card-desc">{t(section.descriptionKey)}</p>
                  {websiteId ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link to={section.to}>{t('overviewMore')}</Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      {t('overviewMore')}
                    </Button>
                  )}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
