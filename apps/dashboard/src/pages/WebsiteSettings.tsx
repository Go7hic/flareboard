import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IngestSnippetPanel } from '../components/IngestSnippetPanel';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Panel } from '../components/ui/panel';
import { Textarea } from '../components/ui/textarea';
import { api, getToken, type Website } from '../lib/api';
import { t } from '../lib/i18n';

export default function WebsiteSettingsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [replayEnabled, setReplayEnabled] = useState(false);
  const [replayConfigJson, setReplayConfigJson] = useState('{"sampleRate":1}');
  const [resetAt, setResetAt] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<Website & { replayEnabled?: boolean; replayConfig?: Record<string, unknown>; resetAt?: string }>(
        `/api/websites/${websiteId}`,
      ),
  });

  useEffect(() => {
    const w = websiteQuery.data;
    if (!w) return;
    setReplayEnabled(Boolean(w.replayEnabled));
    if (w.replayConfig) setReplayConfigJson(JSON.stringify(w.replayConfig, null, 2));
    if (w.resetAt) setResetAt(new Date(w.resetAt).toISOString().slice(0, 16));
  }, [websiteQuery.data]);

  const jsonValid = useMemo(() => {
    try {
      JSON.parse(replayConfigJson);
      return true;
    } catch {
      return false;
    }
  }, [replayConfigJson]);

  function validateJson(value: string) {
    try {
      JSON.parse(value);
      setJsonError(null);
      return true;
    } catch {
      setJsonError(t('invalidReplayJson'));
      return false;
    }
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!validateJson(replayConfigJson)) {
        throw new Error(t('invalidReplayJson'));
      }
      const replayConfig = JSON.parse(replayConfigJson) as Record<string, unknown>;
      return api(`/api/websites/${websiteId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          replayEnabled,
          replayConfig,
          resetAt: resetAt ? new Date(resetAt).toISOString() : undefined,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['website', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/api/websites/${websiteId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['websites'] });
      navigate('/websites');
    },
  });

  function onDelete() {
    const name = websiteQuery.data?.name ?? websiteId;
    const message = t('deleteWebsiteConfirm').replace('{name}', name ?? '');
    if (!window.confirm(message)) return;
    deleteMutation.mutate();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!jsonValid) {
      setJsonError(t('invalidReplayJson'));
      return;
    }
    saveMutation.mutate();
  }

  return (
    <div className="page page-settings">
      <WebsitePageShell websiteId={websiteId} />

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
          <Panel variant="flush" className="page-settings-group">
            <div className="panel-body page-settings-group-head">
              <h2 className="section-title website-page-heading">{t('settings')}</h2>
            </div>

            <form className="page-settings-form" onSubmit={onSubmit}>
              <Panel variant="accent-rail">
                <h2 className="section-title">{t('sessionReplay')}</h2>
                <label className="field" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={replayEnabled}
                    onChange={(e) => setReplayEnabled(e.target.checked)}
                  />
                  {t('enableSessionReplay')}
                </label>
                <div className="field">
                  <Label>{t('replayConfigJson')}</Label>
                  <Textarea
                    className="textarea-mono"
                    value={replayConfigJson}
                    onChange={(e) => {
                      setReplayConfigJson(e.target.value);
                      validateJson(e.target.value);
                    }}
                    onBlur={(e) => validateJson(e.target.value)}
                    aria-invalid={jsonError ? true : undefined}
                  />
                  {jsonError ? <p className="text-danger">{jsonError}</p> : null}
                </div>
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
                <Button type="submit" variant="primary" disabled={saveMutation.isPending || !jsonValid}>
                  {t('saveSettings')}
                </Button>
                {saveMutation.error ? (
                  <p className="text-danger">{(saveMutation.error as Error).message}</p>
                ) : null}
                {saveMutation.isSuccess ? <p className="text-muted">{t('saved')}</p> : null}
              </div>
            </form>
          </Panel>

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
    </div>
  );
}
