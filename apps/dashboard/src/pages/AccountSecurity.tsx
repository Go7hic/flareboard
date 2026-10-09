import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Laptop, LogOut, Smartphone } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuditLogTable } from '../components/AuditLogTable';
import { useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { TwoFactorPanel } from '../components/TwoFactorPanel';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import {
  api,
  ApiError,
  IDENTITIES_KEY,
  linkOAuthHref,
  OAUTH_PROVIDER_LABELS,
  type AuditLogPage,
  type LinkedIdentity,
  type MeResponse,
} from '../lib/api';
import { signInMethodLabel } from '../lib/audit-labels';
import { formatDateTime, formatNumber, formatRelativeTime, formatShortDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { twoFactorErrorMessage } from '../lib/two-factor';
import { useAppConfig } from '../lib/useAppConfig';

type AccountSession = {
  id: string;
  device: string | null;
  method: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
};

const SESSIONS_KEY = ['me-sessions'];
const ACTIVITY_KEY = ['me-audit-log'];
const MIN_PASSWORD_LENGTH = 8;
/** Sessions shown before "Show all": the current device and the most recent others. */
const SESSIONS_PREVIEW = 8;
const ACTIVITY_PREVIEW = 12;

export default function AccountSecurityPage() {
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/api/me'),
    staleTime: 60_000,
  });
  const me = meQuery.data;

  return (
    <Page className="ws-page-security ws-page-settings">
      <PageHeader title={t('accountSecurity')} lead={t('accountSecurityLead')} />
      <PageBody>
        <div className="ws-settings">
          {meQuery.isLoading ? <Skeleton className="h-40 w-full" /> : null}
          {meQuery.error ? (
            <p className="text-danger" role="alert">
              {(meQuery.error as Error).message}
            </p>
          ) : null}
          {me && me.passwordRequired !== false ? <PasswordPanel /> : null}
          {me ? <TwoFactorPanel username={me.username} passwordRequired={me.passwordRequired !== false} /> : null}
          {me && !me.isDemo ? <SignInMethodsPanel /> : null}
          <SessionsPanel />
          <ActivityPanel />
        </div>
      </PageBody>
    </Page>
  );
}

function PasswordPanel() {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean }>('/api/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setDone(true);
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
    },
  });

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    confirmPassword === newPassword &&
    !mutation.isPending;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (canSubmit) mutation.mutate();
  }

  return (
    <SectionCard title={t('securityPasswordTitle')} description={t('securityPasswordLead')}>
      <form onSubmit={onSubmit} className="ws-settings-form">
        <div className="field">
          <Label htmlFor="security-current-password">{t('securityCurrentPassword')}</Label>
          <Input
            id="security-current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="ws-form-grid">
          <div className="field">
            <Label htmlFor="security-new-password">{t('newPassword')}</Label>
            <Input
              id="security-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={128}
              aria-invalid={tooShort || undefined}
            />
            {tooShort ? <p className="field-hint">{t('securityPasswordTooShort')}</p> : null}
          </div>
          <div className="field">
            <Label htmlFor="security-confirm-password">{t('securityConfirmPassword')}</Label>
            <Input
              id="security-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch || undefined}
            />
            {mismatch ? <p className="field-hint text-danger">{t('securityPasswordMismatch')}</p> : null}
          </div>
        </div>
        {mutation.error ? (
          <p className="text-danger" role="alert">
            {twoFactorErrorMessage(mutation.error)}
          </p>
        ) : null}
        <div className="ws-form-actions">
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {t('securityChangePassword')}
          </Button>
          {done ? (
            <span className="ws-inline-status" role="status">
              {t('securityPasswordChanged')}
            </span>
          ) : null}
        </div>
      </form>
    </SectionCard>
  );
}

function deviceIcon(device: string | null) {
  return /iphone|android|mobile|ipad/i.test(device ?? '') ? Smartphone : Laptop;
}

/** Google / GitHub accounts that sign in to this account: linked or not, link and unlink. */
function SignInMethodsPanel() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { oauth: enabled = [] } = useAppConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  // Linking comes back here with ?linked=<provider>: say so once, then drop the parameter.
  const [justLinked] = useState(() => searchParams.get('linked'));
  useEffect(() => {
    if (!searchParams.has('linked')) return;
    setSearchParams({}, { replace: true });
    void queryClient.invalidateQueries({ queryKey: IDENTITIES_KEY });
    void queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
  }, [searchParams, setSearchParams, queryClient]);

  const identitiesQuery = useQuery({
    queryKey: IDENTITIES_KEY,
    queryFn: () => api<LinkedIdentity[]>('/api/me/identities'),
  });

  const unlinkMutation = useMutation({
    mutationFn: (provider: string) => api(`/api/me/identities/${encodeURIComponent(provider)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: IDENTITIES_KEY });
      void queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const identities = identitiesQuery.data ?? [];
  const linkedAt = new Map(identities.map((identity) => [identity.provider, identity.linkedAt]));
  const providers = ['github', 'google'].filter((provider) => enabled.includes(provider) || linkedAt.has(provider));
  if (!providers.length) return null;

  const label = (provider: string) => OAUTH_PROVIDER_LABELS[provider] ?? provider;

  function unlink(provider: string) {
    confirm({
      title: t('signInMethodUnlinkTitle').replace('{provider}', label(provider)),
      description: t('signInMethodUnlinkBody').replace('{provider}', label(provider)),
      confirmLabel: t('signInMethodUnlink'),
      onConfirm: () => unlinkMutation.mutate(provider),
    });
  }

  const error = unlinkMutation.error;
  const errorMessage =
    error instanceof ApiError && error.data?.code === 'last_sign_in_method'
      ? t('signInMethodLastMethod')
      : error
        ? (error as Error).message
        : null;

  return (
    <SectionCard flush id="sign-in-methods" title={t('signInMethodsTitle')} description={t('signInMethodsLead')}>
      {justLinked && linkedAt.has(justLinked) ? (
        <p className="ws-card-status" role="status">
          {t('signInMethodLinkedNotice').replace('{provider}', label(justLinked))}
        </p>
      ) : null}
      <DataViewState
        loading={identitiesQuery.isLoading}
        error={identitiesQuery.isError ? identitiesQuery.error : null}
        onRetry={() => identitiesQuery.refetch()}
        loadingFallback={<Skeleton className="m-5 h-16" />}
      >
        <div className="table-scroll">
          <table className="data-table ws-settings-table">
            <thead>
              <tr>
                <th>{t('signInMethodAccount')}</th>
                <th>{t('status')}</th>
                <th>{t('signInMethodLinkedAt')}</th>
                <th className="ws-row-actions">
                  <span className="visually-hidden">{t('signInMethodLink')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => {
                const at = linkedAt.get(provider);
                return (
                  <tr key={provider}>
                    <td>{label(provider)}</td>
                    <td>
                      {at ? (
                        <StatusBadge tone="success">{t('signInMethodLinked')}</StatusBadge>
                      ) : (
                        <span className="text-muted">{t('signInMethodNotLinked')}</span>
                      )}
                    </td>
                    <td className="text-muted ws-nowrap" title={at ? formatDateTime(at) : undefined}>
                      {at ? formatShortDateTime(at) : '—'}
                    </td>
                    <td className="ws-row-actions">
                      {at ? (
                        <Button
                          type="button"
                          variant="destructive-ghost"
                          size="sm"
                          disabled={unlinkMutation.isPending}
                          onClick={() => unlink(provider)}
                        >
                          {t('signInMethodUnlink')}
                        </Button>
                      ) : enabled.includes(provider) ? (
                        <Button asChild variant="outline" size="sm">
                          <a href={linkOAuthHref(provider)}>{t('signInMethodLink')}</a>
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DataViewState>
      {errorMessage ? (
        <p className="text-danger ws-card-status" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </SectionCard>
  );
}

function SessionsPanel() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [revokedOthers, setRevokedOthers] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sessionsQuery = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => api<AccountSession[]>('/api/me/sessions'),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    void queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
  }

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api(`/api/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const revokeOthersMutation = useMutation({
    mutationFn: () => api<{ ok: boolean; revoked: number }>('/api/me/sessions/revoke-others', { method: 'POST' }),
    onSuccess: (data) => {
      setRevokedOthers(data.revoked);
      refresh();
    },
  });

  // This device first, then by last activity.
  const sessions = [...(sessionsQuery.data ?? [])].sort(
    (a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt - a.lastSeenAt,
  );
  const others = sessions.filter((session) => !session.current);
  const shown = showAll ? sessions : sessions.slice(0, SESSIONS_PREVIEW);

  function deviceLabel(session: AccountSession) {
    return session.device?.trim() || t('sessionUnknownDevice');
  }

  function revoke(session: AccountSession) {
    confirm({
      title: t('sessionRevokeTitle').replace('{device}', deviceLabel(session)),
      description: t('sessionRevokeBody'),
      confirmLabel: t('sessionRevoke'),
      onConfirm: () => revokeMutation.mutate(session.id),
    });
  }

  function revokeOthers() {
    setRevokedOthers(null);
    confirm({
      title: t('sessionRevokeOthersTitle'),
      description: t('sessionRevokeOthersBody'),
      confirmLabel: t('sessionRevokeOthers'),
      onConfirm: () => revokeOthersMutation.mutate(),
    });
  }

  const now = Date.now();
  const mutationError = revokeMutation.error ?? revokeOthersMutation.error;

  return (
    <SectionCard
      flush
      title={t('sessionsTitle')}
      description={t('sessionsLead')}
      actions={
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={!others.length || revokeOthersMutation.isPending}
          onClick={revokeOthers}
        >
          <LogOut aria-hidden />
          {t('sessionRevokeOthers')}
        </Button>
      }
      footer={
        sessions.length > SESSIONS_PREVIEW ? (
          <>
            <span>{t('workspaceSessionCount').replace('{count}', formatNumber(sessions.length))}</span>
            <button type="button" className="card-footer-link" onClick={() => setShowAll((value) => !value)}>
              {showAll ? t('workspaceShowFewer') : t('workspaceShowAll')}
            </button>
          </>
        ) : undefined
      }
    >
      {revokedOthers !== null ? (
        <p className="ws-card-status" role="status">
          {t('sessionRevokedOthers').replace('{count}', String(revokedOthers))}
        </p>
      ) : null}
      <DataViewState
        loading={sessionsQuery.isLoading}
        error={sessionsQuery.isError ? sessionsQuery.error : null}
        onRetry={() => sessionsQuery.refetch()}
        loadingFallback={<Skeleton className="m-5 h-24" />}
      >
        {sessions.length ? (
          <div className="table-scroll">
            <table className="data-table ws-settings-table">
              <thead>
                <tr>
                  <th>{t('device')}</th>
                  <th>{t('sessionMethod')}</th>
                  <th>{t('sessionSignedIn')}</th>
                  <th>{t('sessionLastActive')}</th>
                  <th className="ws-row-actions">
                    <span className="visually-hidden">{t('sessionRevoke')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((session) => {
                  const Icon = deviceIcon(session.device);
                  return (
                    <tr key={session.id}>
                      <td>
                        <span className="ws-device">
                          <Icon aria-hidden />
                          {deviceLabel(session)}
                          {session.current ? <StatusBadge tone="success">{t('sessionThisDevice')}</StatusBadge> : null}
                        </span>
                      </td>
                      <td>{signInMethodLabel(session.method)}</td>
                      <td className="text-muted ws-nowrap" title={formatDateTime(session.createdAt)}>
                        {formatShortDateTime(session.createdAt)}
                      </td>
                      <td className="text-muted ws-nowrap" title={formatDateTime(session.lastSeenAt)}>
                        {formatRelativeTime(session.lastSeenAt, { now })}
                      </td>
                      <td className="ws-row-actions">
                        {session.current ? null : (
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="sm"
                            disabled={revokeMutation.isPending}
                            onClick={() => revoke(session)}
                          >
                            {t('sessionRevoke')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </DataViewState>
      {mutationError ? (
        <p className="text-danger ws-card-status" role="alert">
          {(mutationError as Error).message}
        </p>
      ) : null}
    </SectionCard>
  );
}

function ActivityPanel() {
  const activityQuery = useQuery({
    queryKey: ACTIVITY_KEY,
    queryFn: () => api<AuditLogPage>('/api/me/audit-log?page=1&pageSize=50'),
  });
  const items = activityQuery.data?.items ?? [];
  const total = activityQuery.data?.total ?? 0;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, ACTIVITY_PREVIEW);

  return (
    <SectionCard
      flush
      title={t('accountActivity')}
      description={t('accountActivityLead')}
      footer={
        items.length > ACTIVITY_PREVIEW || total > items.length ? (
          <>
            <span>
              {total > items.length
                ? t('auditShowingLatest').replace('{count}', String(items.length)).replace('{total}', String(total))
                : t('workspaceRowCount').replace('{count}', formatNumber(items.length))}
            </span>
            {items.length > ACTIVITY_PREVIEW ? (
              <button type="button" className="card-footer-link" onClick={() => setShowAll((value) => !value)}>
                {showAll ? t('workspaceShowFewer') : t('workspaceShowAll')}
              </button>
            ) : null}
          </>
        ) : undefined
      }
    >
      <DataViewState
        loading={activityQuery.isLoading}
        error={activityQuery.isError ? activityQuery.error : null}
        onRetry={() => activityQuery.refetch()}
        loadingFallback={<Skeleton className="m-5 h-24" />}
      >
        {items.length ? (
          <AuditLogTable entries={shown} />
        ) : (
          <EmptyState icon={<History />} title={t('accountActivityEmpty')} description={t('accountActivityEmptyHint')} />
        )}
      </DataViewState>
    </SectionCard>
  );
}
