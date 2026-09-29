import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { useConfirm } from '../components/ConfirmDialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Panel } from '../components/ui/panel';
import { Skeleton } from '../components/ui/skeleton';
import { api, API_URL } from '../lib/api';
import { formatDateTime } from '../lib/format';
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

export default function ApiKeysPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Record<Scope, boolean>>({ read: true, write: false });
  const [revealed, setRevealed] = useState<(PersonalApiKey & { key: string }) | null>(null);
  const [copied, setCopied] = useState(false);

  const keysQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api<PersonalApiKey[]>('/api/me/api-keys'),
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; scopes: Scope[] }) =>
      api<PersonalApiKey & { key: string }>('/api/me/api-keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (created) => {
      setRevealed(created);
      setCopied(false);
      setName('');
      setScopes({ read: true, write: false });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api(`/api/me/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      if (revealed?.id === id) setRevealed(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const selectedScopes = (Object.keys(scopes) as Scope[]).filter((scope) => scopes[scope]);

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !selectedScopes.length) return;
    createMutation.mutate({ name: name.trim(), scopes: selectedScopes });
  }

  async function copyRevealed() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

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
    <Page className="page-api-keys" variant="narrow">
      <PageHeader title={t('apiKeys')} lead={t('apiKeysLead')} />
      <PageBody>
        <div className="flex flex-col gap-4">
          <Panel variant="accent-rail">
            <h2 className="section-title">{t('apiKeyCreate')}</h2>
            <form onSubmit={onCreate}>
              <div className="field">
                <Label htmlFor="api-key-name">{t('apiKeyName')}</Label>
                <Input
                  id="api-key-name"
                  value={name}
                  maxLength={100}
                  placeholder={t('apiKeyNamePlaceholder')}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <fieldset className="field fieldset-plain">
                <legend className="text-sm font-medium mb-2">{t('apiKeyScopes')}</legend>
                {(['read', 'write'] as const).map((scope) => (
                  <label key={scope} className="flex items-start gap-2 mb-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={scopes[scope]}
                      onCheckedChange={(checked) => setScopes((current) => ({ ...current, [scope]: checked === true }))}
                    />
                    <span>
                      <strong>{scopeLabel(scope)}</strong>
                      <span className="text-[var(--text-muted)]">
                        {' — '}
                        {scope === 'write' ? t('apiKeyScopeWriteHint') : t('apiKeyScopeReadHint')}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="mt-3">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={createMutation.isPending || !name.trim() || !selectedScopes.length}
                >
                  {t('apiKeyCreate')}
                </Button>
              </div>
              {createMutation.error ? <p className="text-danger">{(createMutation.error as Error).message}</p> : null}
            </form>
          </Panel>

          {revealed ? (
            <Panel role="status">
              <h2 className="section-title">{t('apiKeyCreatedTitle').replace('{name}', revealed.name)}</h2>
              <p className="section-lead">{t('apiKeyCreatedLead')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  readOnly
                  aria-label={t('apiKeys')}
                  value={revealed.key}
                  className="font-mono min-w-0 flex-1 basis-72"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="secondary" onClick={() => void copyRevealed()}>
                  {copied ? t('copied') : t('copyToClipboard')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setRevealed(null)}>
                  {t('apiKeyDone')}
                </Button>
              </div>
            </Panel>
          ) : null}

          <Panel>
            <h2 className="section-title">{t('apiKeysYourKeys')}</h2>
            {keysQuery.isLoading ? <Skeleton className="h-12 w-full" /> : null}
            {keysQuery.error ? <p className="text-danger">{(keysQuery.error as Error).message}</p> : null}
            {!keysQuery.isLoading && !keysQuery.error && !keys.length ? (
              <EmptyState title={t('apiKeysEmpty')} description={t('apiKeysEmptyHint')} />
            ) : null}
            {keys.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('apiKeyName')}</th>
                      <th>{t('apiKeyKey')}</th>
                      <th>{t('apiKeyScopes')}</th>
                      <th>{t('apiKeyCreated')}</th>
                      <th>{t('apiKeyLastUsed')}</th>
                      <th aria-label={t('apiKeyRevoke')} />
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key.id}>
                        <td>{key.name}</td>
                        <td className="font-mono">{key.prefix}…</td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {key.scopes.map((scope) => (
                              <Badge key={scope} variant="secondary">
                                {scopeLabel(scope)}
                              </Badge>
                            ))}
                          </span>
                        </td>
                        <td className="text-muted">{formatDateTime(key.createdAt)}</td>
                        <td className="text-muted">{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : t('apiKeyNeverUsed')}</td>
                        <td className="text-right">
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
            ) : null}
            {revokeMutation.error ? <p className="text-danger">{(revokeMutation.error as Error).message}</p> : null}
          </Panel>

          <Panel>
            <h2 className="section-title">{t('apiKeysUsage')}</h2>
            <p className="section-lead">{t('apiKeysUsageLead')}</p>
            <pre className="code-block snippet-code">{`curl -H "Authorization: Bearer fb_sk_…" \\\n  ${apiBase}/api/websites`}</pre>
          </Panel>
        </div>
      </PageBody>
    </Page>
  );
}
