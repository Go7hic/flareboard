import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { IngestSnippetPanel } from '../components/IngestSnippetPanel';
import { PlanUpgradeBanner } from '../components/PlanUpgradeBanner';
import { ProjectKeyField } from '../components/ProjectKeyField';
import {
  ReplayConfigWizard,
  replayConfigFromJson,
  replayConfigToJson,
  type ReplayConfig,
} from '../components/ReplayConfigWizard';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { FormSelect } from '../components/quality/FormSelect';
import { SettingsCard, SettingSwitch } from '../components/quality/SettingsCard';
import { SITE_TIMEZONE_OPTIONS } from '@flareboard/shared/timezone';
import { api, authenticatedFetch, type BillingSubscription, type Website } from '../lib/api';
import { formatNumber, formatRetentionPeriod } from '../lib/format';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { ConfirmDialog } from '../components/ConfirmDialog';

/** Upper bound the API accepts for `retentionDays` (10 years), whatever the plan. */
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_HEATMAP_JSON = '{"sampleRate":0.1,"enabled":true}';

type HeatmapConfig = {
  sampleRate?: number;
  enabled?: boolean;
  previewUrl?: string;
};

type SettingsWebsite = Website & {
  replayEnabled?: boolean;
  replayConfig?: Record<string, unknown>;
  resetAt?: string;
  heatmapConfig?: HeatmapConfig;
};

type EmailReport = {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipientEmail?: string;
  timezone?: string;
};

/** Cards that save on their own; one PATCH mutation tells them apart by `card`. */
type CardId = 'timezone' | 'collection' | 'retention' | 'replay' | 'heatmap' | 'reset';

const SECTIONS = [
  { id: 'settings-general', label: () => t('qualitySettingsGeneral') },
  { id: 'settings-tracking', label: () => t('qualityTrackingCode') },
  { id: 'settings-privacy', label: () => t('qualitySettingsPrivacy') },
  { id: 'settings-data', label: () => t('qualitySettingsData') },
  { id: 'settings-heatmaps', label: () => t('qualitySettingsHeatmaps') },
  { id: 'settings-danger', label: () => t('qualityDangerZone') },
] as const;

/** `<input type="datetime-local">` value in the browser's local time (toISOString is UTC). */
function toDateTimeLocalValue(value: string | number | Date): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function heatmapBaseline(website: SettingsWebsite | undefined) {
  const config = website?.heatmapConfig;
  return { json: config ? JSON.stringify(config, null, 2) : DEFAULT_HEATMAP_JSON, previewUrl: config?.previewUrl ?? '' };
}

/** Left in-page navigation; highlights the section in view. */
function SettingsNav() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    const targets = SECTIONS.map((section) => document.getElementById(section.id)).filter(Boolean) as HTMLElement[];
    if (!targets.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '0px 0px -65% 0px', threshold: 0 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="q-settings-nav" aria-label={t('settings')}>
      {SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={cn('q-settings-nav-link', active === section.id && 'is-active', section.id === 'settings-danger' && 'is-danger')}
          aria-current={active === section.id ? 'true' : undefined}
          onClick={(event) => {
            event.preventDefault();
            setActive(section.id);
            document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          {section.label()}
        </a>
      ))}
    </nav>
  );
}

export default function WebsiteSettingsPage() {
  const { websiteId = '' } = useParams<{ websiteId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [replayEnabled, setReplayEnabled] = useState(false);
  const [replayConfig, setReplayConfig] = useState<ReplayConfig>({ sampleRate: 1, maskInputs: true, blockSelectors: '' });
  const [resetAt, setResetAt] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailFrequency, setEmailFrequency] = useState<EmailReport['frequency']>('weekly');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [siteTimezone, setSiteTimezone] = useState('UTC');
  const [autocapture, setAutocapture] = useState(true);
  const [persistVisitors, setPersistVisitors] = useState(false);
  const [respectDnt, setRespectDnt] = useState(false);
  /** Days as typed; empty = the plan maximum (hosted) or no expiry (self-hosted). */
  const [retentionInput, setRetentionInput] = useState('');
  const [heatmapConfigJson, setHeatmapConfigJson] = useState(DEFAULT_HEATMAP_JSON);
  const [heatmapPreviewUrl, setHeatmapPreviewUrl] = useState('');
  const [importFormat, setImportFormat] = useState<'flareboard' | 'ga4' | 'plausible' | 'matomo'>('ga4');
  const [importCsv, setImportCsv] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Form state is taken from the server once per website: a later refetch (after another card
  // saves) must not overwrite edits still pending in other cards.
  const syncedWebsite = useRef<string | null>(null);
  const syncedEmail = useRef<string | null>(null);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<SettingsWebsite>(`/api/websites/${websiteId}`),
  });
  const website = websiteQuery.data;

  const billingQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => api<BillingSubscription>('/api/billing/subscription'),
  });

  const emailReportsAllowed = !billingQuery.data?.hosted || Boolean(billingQuery.data?.plan?.emailReportsEnabled);
  const heatmapsAllowed = !billingQuery.data?.hosted || Boolean(billingQuery.data?.plan?.heatmapsEnabled);
  const dataPortabilityAllowed = !billingQuery.data?.hosted || Boolean(billingQuery.data?.plan?.dataPortabilityEnabled);

  const hostedPlan = billingQuery.data?.hosted ? billingQuery.data.plan : undefined;
  const maxRetentionDays = hostedPlan?.maxRetentionDays ?? MAX_RETENTION_DAYS;
  const savedRetentionDays = website?.retentionDays ?? null;
  const retentionDays = retentionInput.trim() === '' ? null : Number(retentionInput);
  // Only a changed value is sent (and checked), so a site whose stored retention is above a
  // lower plan's maximum can still save its other settings.
  const retentionChanged = retentionDays !== savedRetentionDays;
  const retentionError =
    !retentionChanged || retentionDays == null
      ? null
      : !Number.isInteger(retentionDays) || retentionDays < 1
        ? t('dataRetentionInvalid')
        : retentionDays > maxRetentionDays
          ? t('dataRetentionTooLong').replace('{max}', formatNumber(maxRetentionDays))
          : null;

  const emailReportQuery = useQuery({
    queryKey: ['email-report', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<EmailReport>(`/api/websites/${websiteId}/email-report`),
  });

  useEffect(() => {
    const e = emailReportQuery.data;
    if (!e || syncedEmail.current === websiteId) return;
    syncedEmail.current = websiteId;
    setEmailEnabled(e.enabled);
    setEmailFrequency(e.frequency);
    setRecipientEmail(e.recipientEmail ?? '');
  }, [emailReportQuery.data, websiteId]);

  useEffect(() => {
    const w = websiteQuery.data;
    if (!w || syncedWebsite.current === websiteId) return;
    syncedWebsite.current = websiteId;
    setReplayEnabled(Boolean(w.replayEnabled));
    if (w.replayConfig) setReplayConfig(replayConfigFromJson(w.replayConfig));
    setSiteTimezone(w.timezone ?? 'UTC');
    setAutocapture(w.autocapture !== false);
    setPersistVisitors(w.persistVisitors === true);
    setRespectDnt(w.respectDnt === true);
    setRetentionInput(w.retentionDays != null ? String(w.retentionDays) : '');
    const heatmap = heatmapBaseline(w);
    setHeatmapConfigJson(heatmap.json);
    setHeatmapPreviewUrl(heatmap.previewUrl);
    setResetAt(w.resetAt ? toDateTimeLocalValue(w.resetAt) : '');
  }, [websiteQuery.data, websiteId]);

  const heatmapJsonValid = useMemo(() => {
    try {
      JSON.parse(heatmapConfigJson);
      return true;
    } catch {
      return false;
    }
  }, [heatmapConfigJson]);

  const patchMutation = useMutation({
    mutationFn: ({ body }: { card: CardId; body: Record<string, unknown> }) =>
      api<SettingsWebsite>(`/api/websites/${websiteId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (data, { card }) => {
      if (data && typeof data === 'object') queryClient.setQueryData(['website', websiteId], data);
      queryClient.invalidateQueries({ queryKey: ['website', websiteId] });
      if (card === 'timezone') queryClient.invalidateQueries({ queryKey: ['email-report', websiteId] });
    },
  });

  const cardState = (card: CardId) => ({
    saving: patchMutation.isPending && patchMutation.variables?.card === card,
    saved: patchMutation.isSuccess && patchMutation.variables?.card === card,
    error:
      patchMutation.isError && patchMutation.variables?.card === card ? (patchMutation.error as Error).message : null,
  });

  const save = (card: CardId, body: Record<string, unknown>) => patchMutation.mutate({ card, body });

  const emailReportMutation = useMutation({
    mutationFn: () =>
      api(`/api/websites/${websiteId}/email-report`, {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: emailEnabled,
          frequency: emailFrequency,
          recipientEmail: recipientEmail || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-report', websiteId] });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file?: File | null) => {
      if (file) {
        const form = new FormData();
        form.append('format', importFormat);
        form.append('file', file);
        const res = await authenticatedFetch(`/api/websites/${websiteId}/import`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: res.statusText }));
          throw new Error((err as { message?: string }).message || t('importFailed'));
        }
        return res.json() as Promise<{ imported: number; skipped: number; errors: string[]; batches?: number }>;
      }
      return api<{ imported: number; skipped: number; errors: string[]; batches?: number }>(`/api/websites/${websiteId}/import`, {
        method: 'POST',
        body: JSON.stringify({ format: importFormat, csv: importCsv }),
      });
    },
    onSuccess: (data) => {
      const batchesNote = data.batches != null ? ` · ${t('importBatches').replace('{count}', String(data.batches))}` : '';
      setImportMessage(
        t('importSuccess')
          .replace('{count}', String(data.imported))
          .replace('{skipped}', String(data.skipped ?? 0)) + batchesNote,
      );
      setImportErrors(data.errors ?? []);
      setImportCsv('');
    },
    onError: (err) => {
      setImportMessage(err instanceof Error ? err.message : t('importFailed'));
      setImportErrors([]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/api/websites/${websiteId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['websites'] });
      navigate('/websites');
    },
  });

  // Dirty checks against the last server state.
  const serverReplayConfig = JSON.stringify(replayConfigToJson(replayConfigFromJson(website?.replayConfig)));
  const heatmapSaved = heatmapBaseline(website);
  const savedResetAt = website?.resetAt ? toDateTimeLocalValue(website.resetAt) : '';
  const emailSaved = emailReportQuery.data;
  const dirty = {
    timezone: Boolean(website) && siteTimezone !== (website?.timezone ?? 'UTC'),
    collection:
      Boolean(website) &&
      (autocapture !== (website?.autocapture !== false) ||
        persistVisitors !== (website?.persistVisitors === true) ||
        respectDnt !== (website?.respectDnt === true)),
    retention: Boolean(website) && retentionChanged,
    replay:
      Boolean(website) &&
      (replayEnabled !== Boolean(website?.replayEnabled) || JSON.stringify(replayConfigToJson(replayConfig)) !== serverReplayConfig),
    heatmap: Boolean(website) && (heatmapConfigJson !== heatmapSaved.json || heatmapPreviewUrl !== heatmapSaved.previewUrl),
    reset: Boolean(website) && resetAt !== savedResetAt,
    email:
      Boolean(emailSaved) &&
      (emailEnabled !== emailSaved?.enabled ||
        emailFrequency !== emailSaved?.frequency ||
        recipientEmail !== (emailSaved?.recipientEmail ?? '')),
  };

  const timezoneOptions = useMemo(() => {
    const values: string[] = [...SITE_TIMEZONE_OPTIONS];
    if (!values.includes(siteTimezone)) values.push(siteTimezone);
    return values.map((tz) => ({ value: tz, label: tz }));
  }, [siteTimezone]);

  return (
    <Page className="q-page q-page--settings">
      <PageHeader title={t('settings')} lead={t('settingsPageLead')} />

      <PageBody>
        <div className="q-settings">
          <SettingsNav />

          <div className="q-settings-main">
            <div id="settings-general" className="q-settings-group">
              <SettingsCard
                title={t('siteTimezone')}
                description={t('siteTimezoneHint')}
                onSave={() => save('timezone', { timezone: siteTimezone || 'UTC' })}
                dirty={dirty.timezone}
                {...cardState('timezone')}
              >
                <div className="q-field">
                  <Label htmlFor="site-timezone" className="sr-only">
                    {t('siteTimezone')}
                  </Label>
                  <FormSelect id="site-timezone" className="q-select-narrow" value={siteTimezone} onChange={setSiteTimezone} options={timezoneOptions} />
                </div>
              </SettingsCard>

              <SettingsCard
                title={t('emailReports')}
                description={t('emailReportsLead')}
                hint={t('emailUsesSiteTimezone').replace('{timezone}', siteTimezone)}
                onSave={() => emailReportMutation.mutate()}
                dirty={dirty.email}
                disabled={!emailReportsAllowed}
                saving={emailReportMutation.isPending}
                saved={emailReportMutation.isSuccess}
                error={emailReportMutation.error ? (emailReportMutation.error as Error).message : null}
              >
                {!emailReportsAllowed ? <PlanUpgradeBanner message={t('emailReportsRequiresUpgrade')} /> : null}
                <fieldset disabled={!emailReportsAllowed} className={cn('q-fieldset', !emailReportsAllowed && 'is-locked')}>
                  <SettingSwitch
                    id="email-enabled"
                    label={t('enableEmailReports')}
                    checked={emailEnabled}
                    disabled={!emailReportsAllowed}
                    onCheckedChange={setEmailEnabled}
                  />
                  <div className="q-form-row">
                    <div className="q-field">
                      <Label htmlFor="email-frequency">{t('emailFrequency')}</Label>
                      <FormSelect
                        id="email-frequency"
                        value={emailFrequency}
                        disabled={!emailReportsAllowed}
                        onChange={(value) => setEmailFrequency(value as EmailReport['frequency'])}
                        options={[
                          { value: 'daily', label: t('emailDaily') },
                          { value: 'weekly', label: t('emailWeekly') },
                          { value: 'monthly', label: t('emailMonthly') },
                        ]}
                      />
                    </div>
                    <div className="q-field">
                      <Label htmlFor="recipient-email">{t('recipientEmail')}</Label>
                      <Input
                        id="recipient-email"
                        value={recipientEmail}
                        onChange={(e) => setRecipientEmail(e.target.value)}
                        placeholder="you@example.com, team@example.com"
                      />
                    </div>
                  </div>
                  <p className="q-field-hint">{t('recipientEmailHint')}</p>
                </fieldset>
              </SettingsCard>
            </div>

            <div className="q-settings-group">
              {websiteId ? (
                <IngestSnippetPanel id="settings-tracking" websiteId={websiteId} replayEnabled={Boolean(website?.replayEnabled)} />
              ) : null}
              {websiteId ? (
                <SettingsCard title={t('projectKeyTitle')} description={t('projectKeyLead')}>
                  <ProjectKeyField websiteId={websiteId} hideLabel />
                </SettingsCard>
              ) : null}
            </div>

            <div id="settings-privacy" className="q-settings-group">
              <SettingsCard
                title={t('qualityDataCollection')}
                description={t('trackingSettingsLead')}
                onSave={() => save('collection', { autocapture, persistVisitors, respectDnt })}
                dirty={dirty.collection}
                {...cardState('collection')}
              >
                <div className="q-setting-list">
                  <SettingSwitch
                    id="autocapture"
                    label={t('autocaptureSetting')}
                    hint={t('autocaptureSettingHint')}
                    checked={autocapture}
                    onCheckedChange={setAutocapture}
                  />
                  <SettingSwitch
                    id="persist-visitors"
                    label={t('persistVisitorsSetting')}
                    hint={t('persistVisitorsSettingHint')}
                    checked={persistVisitors}
                    onCheckedChange={setPersistVisitors}
                  />
                  <SettingSwitch
                    id="respect-dnt"
                    label={t('respectDntSetting')}
                    hint={t('respectDntSettingHint')}
                    checked={respectDnt}
                    onCheckedChange={setRespectDnt}
                  />
                </div>
              </SettingsCard>

              <SettingsCard
                id="settings-replay"
                title={t('sessionReplay')}
                description={t('qualityReplayLead')}
                onSave={() => save('replay', { replayEnabled, replayConfig: replayConfigToJson(replayConfig) })}
                dirty={dirty.replay}
                {...cardState('replay')}
              >
                <SettingSwitch
                  id="replay-enabled"
                  label={t('enableSessionReplay')}
                  checked={replayEnabled}
                  onCheckedChange={setReplayEnabled}
                />
                <ReplayConfigWizard enabled={replayEnabled} config={replayConfig} onChange={setReplayConfig} />
              </SettingsCard>
            </div>

            <div id="settings-data" className="q-settings-group">
              <SettingsCard
                title={t('dataRetention')}
                description={t('dataRetentionLead')}
                hint={
                  hostedPlan
                    ? t('dataRetentionPlanHint')
                        .replace('{plan}', hostedPlan.name)
                        .replace('{duration}', formatRetentionPeriod(hostedPlan.maxRetentionDays))
                    : t('dataRetentionSelfHostedHint')
                }
                onSave={() => save('retention', { retentionDays })}
                dirty={dirty.retention}
                disabled={Boolean(retentionError)}
                {...cardState('retention')}
              >
                <div className="q-field q-field-narrow">
                  <Label htmlFor="retention-days">{t('dataRetentionDays')}</Label>
                  <Input
                    id="retention-days"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={maxRetentionDays}
                    step={1}
                    value={retentionInput}
                    onChange={(e) => setRetentionInput(e.target.value)}
                    placeholder={hostedPlan ? String(hostedPlan.maxRetentionDays) : undefined}
                    aria-invalid={retentionError ? true : undefined}
                  />
                  {retentionError ? (
                    <p className="q-form-error" role="alert">
                      {retentionError}
                    </p>
                  ) : null}
                </div>
              </SettingsCard>

              <SettingsCard
                title={t('dataImport')}
                description={t('dataImportLead')}
                footer={
                  <>
                    <span className="q-settings-card-hint">
                      {importMessage ? <span role="status">{importMessage}</span> : t('importMultipartHint')}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      disabled={!dataPortabilityAllowed || !importCsv.trim() || importMutation.isPending}
                      onClick={() => importMutation.mutate(null)}
                    >
                      {importMutation.isPending ? t('loading') : t('importData')}
                    </Button>
                  </>
                }
              >
                {!dataPortabilityAllowed ? <PlanUpgradeBanner message={t('dataPortabilityRequiresUpgrade')} /> : null}
                <fieldset disabled={!dataPortabilityAllowed} className={cn('q-fieldset', !dataPortabilityAllowed && 'is-locked')}>
                  <p className="q-field-hint">{t('importFormatsDoc')}</p>
                  <div className="q-form-row">
                    <div className="q-field">
                      <Label htmlFor="import-format">{t('importFormat')}</Label>
                      <FormSelect
                        id="import-format"
                        value={importFormat}
                        disabled={!dataPortabilityAllowed}
                        onChange={(value) => setImportFormat(value as typeof importFormat)}
                        options={[
                          { value: 'ga4', label: 'Google Analytics 4 CSV' },
                          { value: 'plausible', label: 'Plausible CSV' },
                          { value: 'matomo', label: 'Matomo CSV' },
                          { value: 'flareboard', label: 'Flareboard CSV' },
                        ]}
                      />
                    </div>
                    <div className="q-field">
                      <Label htmlFor="import-file">{t('importUpload')}</Label>
                      <label className="q-file" htmlFor="import-file">
                        <Upload aria-hidden />
                        <span>{importMutation.isPending ? t('loading') : t('qualityChooseFile')}</span>
                        <input
                          id="import-file"
                          type="file"
                          accept=".csv,.tsv,.txt"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            if (file) importMutation.mutate(file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="q-field">
                    <Label htmlFor="import-csv">{t('qualityPasteCsv')}</Label>
                    <Textarea
                      id="import-csv"
                      className="q-textarea-mono"
                      value={importCsv}
                      onChange={(e) => setImportCsv(e.target.value)}
                      placeholder={t('importCsvPlaceholder')}
                      rows={6}
                    />
                  </div>
                </fieldset>
                {importErrors.length > 0 ? (
                  <div className="q-import-errors">
                    <p className="q-field-hint">{t('importErrors')}:</p>
                    <ul>
                      {importErrors.slice(0, 10).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </SettingsCard>
            </div>

            <div id="settings-heatmaps" className="q-settings-group">
              <SettingsCard
                title={t('heatmapConfig')}
                description={t('heatmapConfigLead')}
                onSave={() => {
                  if (!heatmapJsonValid) return;
                  const parsed = JSON.parse(heatmapConfigJson) as HeatmapConfig;
                  save('heatmap', { heatmapConfig: { ...parsed, previewUrl: heatmapPreviewUrl.trim() || undefined } });
                }}
                dirty={dirty.heatmap}
                disabled={!heatmapJsonValid || !heatmapsAllowed}
                {...cardState('heatmap')}
              >
                {!heatmapsAllowed ? <PlanUpgradeBanner message={t('heatmapsRequiresUpgrade')} /> : null}
                <fieldset disabled={!heatmapsAllowed} className={cn('q-fieldset', !heatmapsAllowed && 'is-locked')}>
                  <div className="q-field">
                    <Label htmlFor="heatmap-preview-url">{t('heatmapPreviewUrl')}</Label>
                    <Input
                      id="heatmap-preview-url"
                      value={heatmapPreviewUrl}
                      onChange={(e) => setHeatmapPreviewUrl(e.target.value)}
                      placeholder="https://yoursite.com/test-page"
                    />
                    <p className="q-field-hint">{t('heatmapPreviewUrlHint')}</p>
                  </div>
                  <div className="q-field">
                    <Label htmlFor="heatmap-config-json">{t('qualityHeatmapJson')}</Label>
                    <Textarea
                      id="heatmap-config-json"
                      className="q-textarea-mono"
                      rows={5}
                      value={heatmapConfigJson}
                      aria-invalid={heatmapJsonValid ? undefined : true}
                      onChange={(e) => setHeatmapConfigJson(e.target.value)}
                    />
                    {!heatmapJsonValid ? <p className="q-form-error">{t('qualityInvalidJson')}</p> : null}
                  </div>
                </fieldset>
              </SettingsCard>
            </div>

            <section id="settings-danger" className="q-settings-group q-danger-zone panel" aria-labelledby="danger-zone-title">
              <h2 id="danger-zone-title" className="q-danger-title">
                {t('qualityDangerZone')}
              </h2>
              <div className="q-danger-row">
                <div className="q-danger-copy">
                  <h3 className="q-danger-row-title">{t('statsReset')}</h3>
                  <p className="q-field-hint">{t('statsResetLead')}</p>
                  {cardState('reset').error ? <p className="q-form-error">{cardState('reset').error}</p> : null}
                </div>
                <div className="q-danger-control">
                  <Label htmlFor="stats-reset-at" className="sr-only">
                    {t('statsReset')}
                  </Label>
                  <Input id="stats-reset-at" type="datetime-local" value={resetAt} onChange={(e) => setResetAt(e.target.value)} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!dirty.reset || cardState('reset').saving}
                    onClick={() => save('reset', { resetAt: resetAt ? new Date(resetAt).toISOString() : null })}
                  >
                    {cardState('reset').saving ? t('saving') : cardState('reset').saved && !dirty.reset ? t('saved') : t('save')}
                  </Button>
                </div>
              </div>
              <div className="q-danger-row">
                <div className="q-danger-copy">
                  <h3 className="q-danger-row-title">{t('deleteWebsite')}</h3>
                  <p className="q-field-hint">{t('deleteWebsiteLead')}</p>
                  {deleteMutation.error ? <p className="q-form-error">{(deleteMutation.error as Error).message}</p> : null}
                </div>
                <div className="q-danger-control">
                  <Button type="button" variant="danger" disabled={deleteMutation.isPending} onClick={() => setConfirmDeleteOpen(true)}>
                    {t('deleteWebsite')}
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </PageBody>
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={t('confirmDeleteTitle').replace('{name}', website?.name ?? websiteId ?? '')}
        description={t('confirmDeleteBody')}
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Page>
  );
}
