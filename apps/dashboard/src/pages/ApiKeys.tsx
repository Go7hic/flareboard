import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { ModalDialog } from '../components/ModalDialog';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { CopyButton } from '../components/workspace/CopyButton';
import { api, API_URL } from '../lib/api';
import { formatDateTime, formatRelativeTime, formatShortDate } from '../lib/format';
import { t } from '../lib/i18n';

type Scope = 'read' | 'write';

type PersonalApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
};

const QUERY_KEY = ['personal-api-keys'];

function scopeLabel(scope: Scope) {
  return scope === 'write' ? t('apiKeyScopeWrite') : t('apiKeyScopeRead');
}

/** Create form, then the one-time reveal of the new key in the same dialog. */
function CreateKeyDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Record<Scope, boolean>>({ read: true, write: false });
  const [revealed, setRevealed] = useState<(PersonalApiKey & { key: string }) | null>(null);
  const selectedScopes = (Object.keys(scopes) as Scope[]).filter((scope) => scopes[scope]);

  const createMutation = useMutation({
    mutationFn: (body: { name: string; scopes: Scope[] }) =>
      api<PersonalApiKey & { key: string }>('/api/me/api-keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (created) => {
      setRevealed(created);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !selectedScopes.length) return;
    createMutation.mutate({ name: name.trim(), scopes: selectedScopes });
  }

  if (revealed) {
    return (
      <ModalDialog className="ws-dialog--md" aria-label={t('apiKeyCreatedTitle').replace('{name}', revealed.name)} onClose={onClose}>
        <header className="dialog-header">
          <h2 className="dialog-title">{t('apiKeyCreatedTitle').replace('{name}', revealed.name)}</h2>
          <p>{t('apiKeyCreatedLead')}</p>
        </header>
        <div className="dialog-body" role="status">
          <div className="ws-copy-cell ws-key-reveal">
            <Input
              readOnly
              aria-label={t('apiKeys')}
              value={revealed.key}
              className="font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton text={revealed.key} variant="outline" size="default" />
          </div>
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="primary" onClick={onClose}>
            {t('apiKeyDone')}
          </Button>
        </footer>
      </ModalDialog>
    );
  }

  return (
    <ModalDialog className="ws-dialog--sm" aria-label={t('apiKeyCreate')} onClose={onClose}>
      <form onSubmit={onCreate}>
        <header className="dialog-header">
          <h2 className="dialog-title">{t('apiKeyCreate')}</h2>
          <p>{t('apiKeysLead')}</p>
        </header>
        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="api-key-name">{t('apiKeyName')}</Label>
            <Input
              id="api-key-name"
              value={name}
              maxLength={100}
              placeholder={t('apiKeyNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <fieldset className="ws-fieldset">
            <legend className="field-label">{t('apiKeyScopes')}</legend>
            {(['read', 'write'] as const).map((scope) => (
              <label key={scope} className="ws-check-row">
                <Checkbox
                  checked={scopes[scope]}
                  onCheckedChange={(checked) => setScopes((current) => ({ ...current, [scope]: checked === true }))}
                />
                <span>
                  <span className="ws-switch-row-label">{scopeLabel(scope)}</span>
                  <span className="ws-switch-row-hint">
                    {scope === 'write' ? t('apiKeyScopeWriteHint') : t('apiKeyScopeReadHint')}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {createMutation.error ? (
            <p className="text-danger" role="alert">
              {(createMutation.error as Error).message}
            </p>
          ) : null}
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={createMutation.isPending || !name.trim() || !selectedScopes.length}>
            {t('apiKeyCreate')}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}

export default function ApiKeysPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const keysQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api<PersonalApiKey[]>('/api/me/api-keys'),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api(`/api/me/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  function revoke(key: PersonalApiKey) {
    confirm({
      title: t('apiKeyRevokeTitle').replace('{name}', key.name),
      description: t('apiKeyRevokeBody'),
      confirmLabel: t('apiKeyRevoke'),
      onConfirm: () => revokeMutation.mutate(key.id),
    });
  }

  const keys = keysQuery.data ?? [];
  const apiBase = API_URL || window.location.origin;

  return (
    <Page className="ws-page-api-keys ws-page-settings">
      <PageHeader
        title={t('apiKeys')}
        lead={t('apiKeysLead')}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('apiKeyCreate')}
          </Button>
        }
      />
      <PageBody>
        <div className="ws-settings">
          <SectionCard flush title={t('apiKeysYourKeys')}>
            <DataViewState
              loading={keysQuery.isLoading}
              error={keysQuery.isError ? keysQuery.error : null}
              onRetry={() => keysQuery.refetch()}
              loadingFallback={<Skeleton className="m-5 h-16" />}
            >
              {keys.length ? (
                <div className="table-scroll">
                  <table className="data-table ws-settings-table">
                    <thead>
                      <tr>
                        <th>{t('apiKeyName')}</th>
                        <th>{t('apiKeyKey')}</th>
                        <th>{t('apiKeyScopes')}</th>
                        <th>{t('apiKeyCreated')}</th>
                        <th>{t('apiKeyLastUsed')}</th>
                        <th className="ws-row-actions">
                          <span className="visually-hidden">{t('apiKeyRevoke')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((key) => (
                        <tr key={key.id}>
                          <td className="ws-cell-title">{key.name}</td>
                          <td>
                            <code className="ws-mono-value">{key.prefix}…</code>
                          </td>
                          <td>
                            <span className="ws-chip-row">
                              {key.scopes.map((scope) => (
                                <span key={scope} className="ws-type-chip">
                                  {scopeLabel(scope)}
                                </span>
                              ))}
                            </span>
                          </td>
                          <td className="text-muted ws-nowrap" title={formatDateTime(key.createdAt)}>
                            {formatShortDate(key.createdAt)}
                          </td>
                          <td
                            className="text-muted ws-nowrap"
                            title={key.lastUsedAt ? formatDateTime(key.lastUsedAt) : undefined}
                          >
                            {key.lastUsedAt ? formatRelativeTime(key.lastUsedAt) : t('apiKeyNeverUsed')}
                          </td>
                          <td className="ws-row-actions">
                            <Button
                              type="button"
                              variant="destructive-ghost"
                              size="sm"
                              disabled={revokeMutation.isPending}
                              onClick={() => revoke(key)}
                            >
                              {t('apiKeyRevoke')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={<KeyRound />}
                  title={t('apiKeysEmpty')}
                  description={t('apiKeysEmptyHint')}
                  action={
                    <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                      {t('apiKeyCreate')}
                    </Button>
                  }
                />
              )}
            </DataViewState>
            {revokeMutation.error ? (
              <p className="text-danger ws-card-status" role="alert">
                {(revokeMutation.error as Error).message}
              </p>
            ) : null}
          </SectionCard>

          <SectionCard title={t('apiKeysUsage')} description={t('apiKeysUsageLead')}>
            <pre className="ws-code-block">{`curl -H "Authorization: Bearer fb_sk_…" \\\n  ${apiBase}/api/websites`}</pre>
          </SectionCard>
        </div>
      </PageBody>

      {creating ? <CreateKeyDialog onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}
