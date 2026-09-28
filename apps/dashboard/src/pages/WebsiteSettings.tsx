import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IngestSnippetPanel } from '../components/IngestSnippetPanel';
import { PlanUpgradeBanner } from '../components/PlanUpgradeBanner';
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
import { Panel } from '../components/ui/panel';
import { SITE_TIMEZONE_OPTIONS } from '@flareboard/shared/timezone';
import { api, authenticatedFetch, type Website } from '../lib/api';
import { t } from '../lib/i18n';
import { ConfirmDialog } from '../components/ConfirmDialog';

type HeatmapConfig = {
  sampleRate?: number;
  enabled?: boolean;
  previewUrl?: string;
};

/** `<input type="datetime-local">` value in the browser's local time (toISOString is UTC). */
function toDateTimeLocalValue(value: string | number | Date): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function WebsiteSettingsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [replayEnabled, setReplayEnabled] = useState(false);
  const [replayConfig, setReplayConfig] = useState<ReplayConfig>({
    sampleRate: 1,
    maskInputs: true,
    blockSelectors: '',
  });
  const [resetAt, setResetAt] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailFrequency, setEmailFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [siteTimezone, setSiteTimezone] = useState('UTC');
  const [autocapture, setAutocapture] = useState(true);
  const [persistVisitors, setPersistVisitors] = useState(false);
  const [respectDnt, setRespectDnt] = useState(false);
  const [heatmapConfigJson, setHeatmapConfigJson] = useState('{"sampleRate":0.1,"enabled":true}');
  const [heatmapPreviewUrl, setHeatmapPreviewUrl] = useState('');
  const [importFormat, setImportFormat] = useState<'flareboard' | 'ga4' | 'plausible' | 'matomo'>('ga4');
  const [importCsv, setImportCsv] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<Website & { replayEnabled?: boolean; replayConfig?: Record<string, unknown>; resetAt?: string }>(
        `/api/websites/${websiteId}`,
      ),
  });

  const billingQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () =>
      api<{
        hosted: boolean;
        plan?: {
          emailReportsEnabled?: boolean;
          heatmapsEnabled?: boolean;
          dataPortabilityEnabled?: boolean;
        };
      }>('/api/billing/subscription'),
  });

  const emailReportsAllowed =
    !billingQuery.data?.hosted || Boolean(billingQuery.data?.plan?.emailReportsEnabled);

  const heatmapsAllowed =
    !billingQuery.data?.hosted || Boolean(billingQuery.data?.plan?.heatmapsEnabled);

  const dataPortabilityAllowed =
    !billingQuery.data?.hosted || Boolean(billingQuery.data?.plan?.dataPortabilityEnabled);

  const emailReportQuery = useQuery({
    queryKey: ['email-report', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<{
        enabled: boolean;
        frequency: 'daily' | 'weekly' | 'monthly';
        recipientEmail?: string;
        timezone?: string;
      }>(`/api/websites/${websiteId}/email-report`),
  });

  useEffect(() => {
    const e = emailReportQuery.data;
    if (!e) return;
    setEmailEnabled(e.enabled);
    setEmailFrequency(e.frequency);
    setRecipientEmail(e.recipientEmail ?? '');
  }, [emailReportQuery.data]);

  useEffect(() => {
    const w = websiteQuery.data;
    if (!w) return;
    setReplayEnabled(Boolean(w.replayEnabled));
    if (w.replayConfig) setReplayConfig(replayConfigFromJson(w.replayConfig));
    setSiteTimezone(w.timezone ?? 'UTC');
    setAutocapture(w.autocapture !== false);
    setPersistVisitors(w.persistVisitors === true);
    setRespectDnt(w.respectDnt === true);
    const heatmapConfig = (w as { heatmapConfig?: HeatmapConfig }).heatmapConfig;
    if (heatmapConfig) {
      setHeatmapConfigJson(JSON.stringify(heatmapConfig, null, 2));
      setHeatmapPreviewUrl(heatmapConfig.previewUrl ?? '');
    }
    setResetAt(w.resetAt ? toDateTimeLocalValue(w.resetAt) : '');
  }, [websiteQuery.data]);

  const heatmapJsonValid = useMemo(() => {
    try {
      JSON.parse(heatmapConfigJson);
      return true;
    } catch {
      return false;
    }
  }, [heatmapConfigJson]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const heatmapParsed = JSON.parse(heatmapConfigJson) as HeatmapConfig;
      const heatmapConfig: HeatmapConfig = {
        ...heatmapParsed,
        previewUrl: heatmapPreviewUrl.trim() || undefined,
      };
      return api(`/api/websites/${websiteId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          replayEnabled,
          replayConfig: replayConfigToJson(replayConfig),
          heatmapConfig,
          timezone: siteTimezone || 'UTC',
          autocapture,
          persistVisitors,
          respectDnt,
          // datetime-local is local time; `null` clears a previous reset.
          resetAt: resetAt ? new Date(resetAt).toISOString() : null,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['website', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['email-report', websiteId] });
    },
  });

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
      return api<{ imported: number; skipped: number; errors: string[]; batches?: number }>(
        `/api/websites/${websiteId}/import`,
        {
          method: 'POST',
          body: JSON.stringify({ format: importFormat, csv: importCsv }),
        },
      );
    },
    onSuccess: (data) => {
      const batchesNote =
        data.batches != null
          ? ` · ${t('importBatches').replace('{count}', String(data.batches))}`
          : '';
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

  function onImportFile(file: File | null) {
    if (!file) return;
    importMutation.mutate(file);
  }

  const deleteMutation = useMutation({
    mutationFn: () => api(`/api/websites/${websiteId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['websites'] });
      navigate('/websites');
    },
  });

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  function onDelete() {
    setConfirmDeleteOpen(true);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!heatmapJsonValid) return;
    saveMutation.mutate();
  }

  return (
    <Page className="page-settings">
      <PageHeader title={t('settings')} lead={t('settingsPageLead')} />

      <PageBody>
      <div className="page-settings-stack">
        {websiteId ? (
          <IngestSnippetPanel
            key={websiteId}
            websiteId={websiteId}
            createdAt={websiteQuery.data?.createdAt}
            replayEnabled={Boolean(websiteQuery.data?.replayEnabled)}
          />
        ) : null}

        <div className="page-settings-main">
          {/* Sections are sibling panels; the old outer card nested cards inside a card. */}
          <div className="page-settings-group">
            <form className="page-settings-form" onSubmit={onSubmit}>
              <Panel variant="accent-rail">
                <h2 className="section-title">{t('siteTimezone')}</h2>
                <p className="section-lead">{t('siteTimezoneHint')}</p>
                <div className="field">
                  <Label htmlFor="site-timezone">{t('siteTimezone')}</Label>
                  <select
                    id="site-timezone"
                    className="select"
                    value={siteTimezone}
                    onChange={(e) => setSiteTimezone(e.target.value)}
                  >
                    {SITE_TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                    {!SITE_TIMEZONE_OPTIONS.includes(siteTimezone as (typeof SITE_TIMEZONE_OPTIONS)[number]) ? (
                      <option value={siteTimezone}>{siteTimezone}</option>
                    ) : null}
                  </select>
                </div>
              </Panel>

              <Panel variant="accent-rail">
                <h2 className="section-title">{t('trackingSettings')}</h2>
                <p className="section-lead">{t('trackingSettingsLead')}</p>
                <div className="field">
                  <label className="field-inline">
                    <input
                      type="checkbox"
                      checked={autocapture}
                      onChange={(e) => setAutocapture(e.target.checked)}
                    />
                    {t('autocaptureSetting')}
                  </label>
                  <p className="field-hint">{t('autocaptureSettingHint')}</p>
                </div>
                <div className="field">
                  <label className="field-inline">
                    <input
                      type="checkbox"
                      checked={persistVisitors}
                      onChange={(e) => setPersistVisitors(e.target.checked)}
                    />
                    {t('persistVisitorsSetting')}
                  </label>
                  <p className="field-hint">{t('persistVisitorsSettingHint')}</p>
                </div>
                <div className="field">
                  <label className="field-inline">
                    <input
                      type="checkbox"
                      checked={respectDnt}
                      onChange={(e) => setRespectDnt(e.target.checked)}
                    />
                    {t('respectDntSetting')}
                  </label>
                  <p className="field-hint">{t('respectDntSettingHint')}</p>
                </div>
              </Panel>

              <Panel variant="accent-rail">
                <h2 className="section-title">{t('sessionReplay')}</h2>
                <label className="field field-inline">
                  <input
                    type="checkbox"
                    checked={replayEnabled}
                    onChange={(e) => setReplayEnabled(e.target.checked)}
                  />
                  {t('enableSessionReplay')}
                </label>
                <ReplayConfigWizard
                  enabled={replayEnabled}
                  config={replayConfig}
                  onChange={setReplayConfig}
                />
              </Panel>

              <Panel variant="accent-rail">
                <h2 className="section-title">{t('heatmapConfig')}</h2>
                <p className="section-lead">{t('heatmapConfigLead')}</p>
                {!heatmapsAllowed ? (
                  <PlanUpgradeBanner message={t('heatmapsRequiresUpgrade')} />
                ) : null}
                <fieldset
                  disabled={!heatmapsAllowed}
                  className={`fieldset-plain${heatmapsAllowed ? '' : ' is-locked'}`}
                >
                  <div className="field">
                    <Label htmlFor="heatmap-preview-url">{t('heatmapPreviewUrl')}</Label>
                    <Input
                      id="heatmap-preview-url"
                      value={heatmapPreviewUrl}
                      onChange={(e) => setHeatmapPreviewUrl(e.target.value)}
                      placeholder="https://yoursite.com/test-page"
                    />
                    <p className="field-hint">
                      {t('heatmapPreviewUrlHint')}
                    </p>
                  </div>
                  <div className="field">
                    <Label>{t('heatmapConfig')}</Label>
                    <Textarea
                      className="textarea-mono"
                      value={heatmapConfigJson}
                      onChange={(e) => setHeatmapConfigJson(e.target.value)}
                    />
                  </div>
                </fieldset>
              </Panel>

              <Panel variant="accent-rail">
                <h2 className="section-title">{t('emailReports')}</h2>
                <p className="section-lead">{t('emailReportsLead')}</p>
                {!emailReportsAllowed ? (
                  <PlanUpgradeBanner message={t('emailReportsRequiresUpgrade')} />
                ) : null}
                <fieldset
                  disabled={!emailReportsAllowed}
                  className={`fieldset-plain${emailReportsAllowed ? '' : ' is-locked'}`}
                >
                  <label className="field field-inline">
                    <input
                      type="checkbox"
                      checked={emailEnabled}
                      onChange={(e) => setEmailEnabled(e.target.checked)}
                    />
                    {t('enableEmailReports')}
                  </label>
                  <div className="field">
                    <Label htmlFor="email-frequency">{t('emailFrequency')}</Label>
                    <select
                      id="email-frequency"
                      className="select"
                      value={emailFrequency}
                      onChange={(e) =>
                        setEmailFrequency(e.target.value as 'daily' | 'weekly' | 'monthly')
                      }
                    >
                      <option value="daily">{t('emailDaily')}</option>
                      <option value="weekly">{t('emailWeekly')}</option>
                      <option value="monthly">{t('emailMonthly')}</option>
                    </select>
                  </div>
                  <p className="field-hint">
                    {t('emailUsesSiteTimezone').replace('{timezone}', siteTimezone)}
                  </p>
                  <div className="field">
                    <Label htmlFor="recipient-email">{t('recipientEmail')}</Label>
                    <Input
                      id="recipient-email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="you@example.com, team@example.com"
                    />
                    <p className="field-hint">
                      {t('recipientEmailHint')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={emailReportMutation.isPending || !emailReportsAllowed}
                    onClick={() => emailReportMutation.mutate()}
                  >
                    {t('saveSettings')}
                  </Button>
                </fieldset>
              </Panel>

              <Panel>
                <h2 className="section-title">{t('dataImport')}</h2>
                <p className="section-lead">{t('dataImportLead')}</p>
                {!dataPortabilityAllowed ? (
                  <PlanUpgradeBanner message={t('dataPortabilityRequiresUpgrade')} />
                ) : null}
                <p className="field-hint">{t('importFormatsDoc')}</p>
                <p className="field-hint">{t('importMultipartHint')}</p>
                <fieldset
                  disabled={!dataPortabilityAllowed}
                  className={`fieldset-plain${dataPortabilityAllowed ? '' : ' is-locked'}`}
                >
                  <div className="field">
                    <Label htmlFor="import-format">{t('importFormat')}</Label>
                    <select
                      id="import-format"
                      className="select"
                      value={importFormat}
                      onChange={(e) =>
                        setImportFormat(e.target.value as 'flareboard' | 'ga4' | 'plausible' | 'matomo')
                      }
                    >
                      <option value="ga4">Google Analytics 4 CSV</option>
                      <option value="plausible">Plausible CSV</option>
                      <option value="matomo">Matomo CSV</option>
                      <option value="flareboard">Flareboard CSV</option>
                    </select>
                  </div>
                  <div className="field">
                    <Label htmlFor="import-file">{t('importUpload')}</Label>
                    <input
                      id="import-file"
                      type="file"
                      accept=".csv,.tsv,.txt"
                      className="input"
                      onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <div className="field">
                    <Label htmlFor="import-csv">{t('importData')}</Label>
                    <Textarea
                      id="import-csv"
                      className="textarea-mono"
                      value={importCsv}
                      onChange={(e) => setImportCsv(e.target.value)}
                      placeholder={t('importCsvPlaceholder')}
                      rows={8}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!dataPortabilityAllowed || !importCsv.trim() || importMutation.isPending}
                    onClick={() => importMutation.mutate(null)}
                  >
                    {t('importData')}
                  </Button>
                </fieldset>
                {importMessage ? <p className="text-muted">{importMessage}</p> : null}
                {importErrors.length > 0 ? (
                  <div>
                    <p className="text-muted">{t('importErrors')}:</p>
                    <ul className="list-plain">
                      {importErrors.slice(0, 10).map((err, i) => (
                        <li key={i} className="field-hint">
                          {err}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Panel>

              <Panel variant="danger-zone">
                <h2 className="section-title">{t('statsReset')}</h2>
                <p className="section-lead">{t('statsResetLead')}</p>
                <div className="field">
                  <Label htmlFor="stats-reset-at">{t('statsReset')}</Label>
                  <Input
                    id="stats-reset-at"
                    type="datetime-local"
                    value={resetAt}
                    onChange={(e) => setResetAt(e.target.value)}
                  />
                </div>
              </Panel>

              <div className="page-settings-form-actions">
                <Button type="submit" variant="primary" disabled={saveMutation.isPending || !heatmapJsonValid}>
                  {t('saveSettings')}
                </Button>
                {saveMutation.error ? (
                  <p className="text-danger">{(saveMutation.error as Error).message}</p>
                ) : null}
                {saveMutation.isSuccess ? <p className="text-muted">{t('saved')}</p> : null}
              </div>
            </form>
          </div>

          <Panel variant="danger-zone">
            <h2 className="section-title">{t('deleteWebsite')}</h2>
            <p className="section-lead">{t('deleteWebsiteLead')}</p>
            <Button
              type="button"
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={onDelete}
            >
              {t('deleteWebsite')}
            </Button>
            {deleteMutation.error ? (
              <p className="text-danger">{(deleteMutation.error as Error).message}</p>
            ) : null}
          </Panel>
        </div>
      </div>
      </PageBody>
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={t('confirmDeleteTitle').replace('{name}', websiteQuery.data?.name ?? websiteId ?? '')}
        description={t('confirmDeleteBody')}
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Page>
  );
}
