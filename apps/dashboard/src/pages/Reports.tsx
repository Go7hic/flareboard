import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  CircleDollarSign,
  FileText,
  Flag,
  Funnel,
  Gauge,
  Layers,
  Megaphone,
  Repeat,
  Route,
  Save,
  Target,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { DateRangePicker } from '../components/DateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { ModalDialog } from '../components/ModalDialog';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { api, type Website } from '../lib/api';
import { isMetricTab } from '../lib/breakdown-dimensions';
import { type DateRangePreset, presetToRange } from '../lib/dateRange';
import { t } from '../lib/i18n';
import { useDemoSession } from '../lib/useDemoSession';
import { saveWebsiteRange, type StoredRange } from '../lib/websiteRangeStorage';
import { pickWorkspaceWebsite, rememberWorkspaceWebsite } from '../components/workspace/workspaceWebsite';

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

type ReportKind = {
  id: string;
  route: string;
  icon: LucideIcon;
};

/** Report types in gallery order; titles and one-line descriptions are `workspaceReport_<id>`. */
const REPORT_KINDS: ReportKind[] = [
  { id: 'funnel', route: 'funnel', icon: Funnel },
  { id: 'retention', route: 'retention', icon: Repeat },
  { id: 'journey', route: 'journeys', icon: Route },
  { id: 'attribution', route: 'attribution', icon: Target },
  { id: 'breakdown', route: 'breakdown', icon: Layers },
  { id: 'performance', route: 'performance', icon: Gauge },
  { id: 'utm', route: 'utm', icon: Megaphone },
  { id: 'revenue', route: 'revenue', icon: CircleDollarSign },
  { id: 'cohorts', route: 'cohorts', icon: UsersRound },
  { id: 'goals', route: 'goals', icon: Flag },
];

function reportTypeLabel(type: string) {
  const key = `workspaceReport_${type}`;
  const label = t(key);
  return label === key ? type : label;
}

function reportDestination(
  websiteId: string,
  type: string,
  parameters: Record<string, unknown> = {},
  segmentId = '',
) {
  const kind = REPORT_KINDS.find((item) => item.id === type);
  const route = kind?.route ?? type;
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

  if (type === 'funnel' && Array.isArray(parameters.steps)) {
    const steps = parameters.steps.filter((step): step is string => typeof step === 'string' && step.trim() !== '');
    if (steps.length) search.set('steps', steps.map((step) => step.trim()).join(','));
  }

  if (type === 'breakdown' && typeof parameters.dimension === 'string' && isMetricTab(parameters.dimension)) {
    search.set('type', parameters.dimension);
  }

  const qs = search.toString();
  return qs ? `/websites/${websiteId}/${route}?${qs}` : `/websites/${websiteId}/${route}`;
}

export default function ReportsPage() {
  // The read-only demo runs reports but cannot save them.
  const { isDemo } = useDemoSession();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [websiteId, setWebsiteId] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [range, setRange] = useState<StoredRange>({
    preset: '30d' as DateRangePreset,
    ...presetToRange('30d'),
  });

  const websitesQuery = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
  });
  const websites = useMemo(() => websitesQuery.data ?? [], [websitesQuery.data]);

  useEffect(() => {
    if (websites.length && !websites.some((site) => site.id === websiteId)) {
      setWebsiteId(pickWorkspaceWebsite(websites));
    }
  }, [websites, websiteId]);

  const timezone = websites.find((site) => site.id === websiteId)?.timezone ?? 'UTC';

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
  const segments = segmentsQuery.data ?? [];

  useEffect(() => {
    // A segment belongs to one website.
    setSegmentId('');
  }, [websiteId]);

  const savedReportsQuery = useQuery({
    queryKey: ['saved-reports'],
    queryFn: () => api<SavedReport[]>('/api/reports'),
  });

  const deleteReportMutation = useMutation({
    mutationFn: (reportId: string) => api(`/api/reports/${reportId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-reports'] }),
  });

  const noWebsite = !websitesQuery.isLoading && !websites.length;
  const savedReports = (savedReportsQuery.data ?? []).filter((report) => report.websiteId === websiteId);

  /** The chosen range follows the visitor into the report (website pages read it on open). */
  function carryRange(targetWebsiteId: string) {
    saveWebsiteRange(targetWebsiteId, range);
  }

  function openSavedReport(report: SavedReport) {
    carryRange(report.websiteId);
    navigate(reportDestination(report.websiteId, report.type, report.parameters, segmentId));
  }

  const scopeControls = websites.length ? (
    <div className="ws-header-controls">
      <select
        className="select ws-header-select"
        aria-label={t('website')}
        value={websiteId}
        onChange={(event) => {
          setWebsiteId(event.target.value);
          rememberWorkspaceWebsite(event.target.value);
        }}
      >
        {websites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
      {segments.length ? (
        <select
          className="select ws-header-select"
          aria-label={t('segment')}
          value={segmentId}
          onChange={(event) => setSegmentId(event.target.value)}
        >
          <option value="">{t('allVisitors')}</option>
          {segments.map((segment) => (
            <option key={segment.id} value={segment.id}>
              {segment.name}
            </option>
          ))}
        </select>
      ) : null}
      <DateRangePicker value={range} onChange={setRange} popover timezone={timezone} />
      {isDemo ? null : (
        <Button variant="primary" onClick={() => setSaving(true)} disabled={!websiteId}>
          <Save aria-hidden />
          {t('workspaceSaveReport')}
        </Button>
      )}
    </div>
  ) : null;

  return (
    <Page className="ws-page-reports">
      <PageHeader title={t('reports')} lead={t('workspaceReportsLead')} actions={scopeControls} />

      <PageBody className="stack">
        {noWebsite ? (
          <EmptyState
            variant="rich"
            icon={<FileText />}
            title={t('noWebsites')}
            description={t('workspaceReportsNoWebsite')}
            action={
              <Button variant="primary" render={<Link to="/websites?new=1" />}>
                {t('addWebsite')}
              </Button>
            }
          />
        ) : (
          <>
            <section aria-labelledby="ws-report-gallery">
              <h2 id="ws-report-gallery" className="visually-hidden">
                {t('workspaceReportGallery')}
              </h2>
              <ul className="ws-template-grid">
                {REPORT_KINDS.map((kind) => {
                  const Icon = kind.icon;
                  const to = websiteId ? reportDestination(websiteId, kind.id, {}, segmentId) : '';
                  const body = (
                    <>
                      <span className="ws-template-icon" aria-hidden>
                        <Icon strokeWidth={2} />
                      </span>
                      <span className="ws-template-title">{reportTypeLabel(kind.id)}</span>
                      <span className="ws-template-desc">{t(`workspaceReportDesc_${kind.id}`)}</span>
                      <span className="ws-template-open">
                        {t('workspaceOpenReport')}
                        <ArrowRight aria-hidden />
                      </span>
                    </>
                  );
                  return (
                    <li key={kind.id}>
                      {websiteId ? (
                        <Link to={to} className="ws-template-card" onClick={() => carryRange(websiteId)}>
                          {body}
                        </Link>
                      ) : (
                        <span className="ws-template-card is-disabled">{body}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <SectionCard
              flush
              title={t('savedReports')}
              description={t('workspaceSavedReportsLead')}
              actions={
                savedReports.length && !isDemo ? (
                  <Button variant="outline" size="sm" onClick={() => setSaving(true)} disabled={!websiteId}>
                    {t('workspaceSaveReport')}
                  </Button>
                ) : undefined
              }
            >
              <DataViewState
                loading={savedReportsQuery.isLoading}
                error={savedReportsQuery.isError ? savedReportsQuery.error : null}
                onRetry={() => savedReportsQuery.refetch()}
                loadingFallback={
                  <div className="ws-table-skeleton">
                    <div className="ws-table-skeleton-row">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="ml-auto h-4 w-20" />
                    </div>
                  </div>
                }
              >
                {savedReports.length ? (
                  <div className="table-scroll">
                    <table className="data-table ws-saved-reports-table">
                      <thead>
                        <tr>
                          <th>{t('name')}</th>
                          <th>{t('type')}</th>
                          <th>{t('workspaceReportDetails')}</th>
                          <th className="ws-row-actions">
                            <span className="visually-hidden">{t('actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {savedReports.map((report) => (
                          <tr key={report.id}>
                            <td>
                              <button type="button" className="ws-link-button" onClick={() => openSavedReport(report)}>
                                {report.name}
                              </button>
                            </td>
                            <td>
                              <span className="ws-type-chip">{reportTypeLabel(report.type)}</span>
                            </td>
                            <td className="text-muted">
                              {report.parameterSummary?.length
                                ? report.parameterSummary.map((item) => `${item.label}: ${item.value}`).join(' · ')
                                : '–'}
                            </td>
                            <td className="ws-row-actions">
                              <Button type="button" variant="ghost" size="sm" onClick={() => openSavedReport(report)}>
                                {t('boardOpen')}
                                <ArrowUpRight aria-hidden />
                              </Button>
                              {isDemo ? null : (
                                <Button
                                  type="button"
                                  variant="destructive-ghost"
                                  size="sm"
                                  disabled={deleteReportMutation.isPending}
                                  onClick={() =>
                                    confirm({
                                      title: deleteTitle(report.name),
                                      onConfirm: () => deleteReportMutation.mutate(report.id),
                                    })
                                  }
                                >
                                  {t('delete')}
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Save />}
                    title={t('noSavedReports')}
                    description={t('workspaceSavedReportsEmpty')}
                    action={
                      isDemo || !websiteId ? undefined : (
                        <Button variant="outline" size="sm" onClick={() => setSaving(true)}>
                          {t('workspaceSaveReport')}
                        </Button>
                      )
                    }
                  />
                )}
              </DataViewState>
            </SectionCard>
          </>
        )}
      </PageBody>

      {saving && websiteId ? (
        <SaveReportDialog
          websiteId={websiteId}
          websiteName={websites.find((site) => site.id === websiteId)?.name ?? ''}
          segmentId={segmentId}
          onClose={() => setSaving(false)}
        />
      ) : null}
    </Page>
  );
}

function SaveReportDialog({
  websiteId,
  websiteName,
  segmentId,
  onClose,
}: {
  websiteId: string;
  websiteName: string;
  segmentId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState('funnel');
  const [funnelSteps, setFunnelSteps] = useState('signup,purchase');

  const templatesQuery = useQuery({
    queryKey: ['report-templates'],
    queryFn: () => api<ReportTemplate[]>('/api/reports/templates'),
  });
  const templates =
    templatesQuery.data ??
    REPORT_KINDS.slice(0, 3).map((kind) => ({ type: kind.id, name: kind.id, description: '', defaultParameters: {} }));
  const selectedTemplate = templates.find((template) => template.type === type);

  function buildParameters() {
    const base = { ...(selectedTemplate?.defaultParameters ?? {}), segmentId: segmentId || null };
    if (type === 'funnel') {
      return { ...base, steps: funnelSteps.split(',').map((step) => step.trim()).filter(Boolean) };
    }
    if (type === 'attribution') return { ...base, model: 'last', attributionType: 'path', step: '/' };
    if (type === 'breakdown') return { ...base, dimension: 'country' };
    return base;
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          websiteId,
          type,
          name: name.trim(),
          description: selectedTemplate?.description ?? '',
          parameters: buildParameters(),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-reports'] });
      onClose();
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) saveMutation.mutate();
  }

  return (
    <ModalDialog className="ws-dialog--sm" aria-label={t('workspaceSaveReport')} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <header className="dialog-header">
          <h2 className="dialog-title">{t('workspaceSaveReport')}</h2>
          <p>{t('workspaceSaveReportLead').replace('{website}', websiteName)}</p>
        </header>
        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="save-report-name">{t('reportName')}</Label>
            <Input id="save-report-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="field">
            <Label htmlFor="save-report-type">{t('type')}</Label>
            <select
              id="save-report-type"
              className="select"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {templates.map((template) => (
                <option key={template.type} value={template.type}>
                  {reportTypeLabel(template.type)}
                </option>
              ))}
            </select>
            <p className="field-hint">{t(`workspaceReportDesc_${type}`)}</p>
          </div>
          {type === 'funnel' ? (
            <div className="field">
              <Label htmlFor="save-report-steps">{t('workspaceFunnelSteps')}</Label>
              <Input
                id="save-report-steps"
                value={funnelSteps}
                onChange={(event) => setFunnelSteps(event.target.value)}
                placeholder="signup,purchase"
              />
              <p className="field-hint">{t('workspaceFunnelStepsHint')}</p>
            </div>
          ) : null}
          {saveMutation.error ? (
            <p className="text-danger" role="alert">
              {(saveMutation.error as Error).message}
            </p>
          ) : null}
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || saveMutation.isPending}>
            {t('save')}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}
