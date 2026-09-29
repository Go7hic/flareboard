import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { AuditLogTable } from '../components/AuditLogTable';
import { useConfirm } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { TwoFactorPanel } from '../components/TwoFactorPanel';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Panel } from '../components/ui/panel';
import { Skeleton } from '../components/ui/skeleton';
import { api, type AuditLogPage, type MeResponse } from '../lib/api';
import { signInMethodLabel } from '../lib/audit-labels';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { formatRelativeTime } from '../lib/session-display';
import { twoFactorErrorMessage } from '../lib/two-factor';

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
const MIN_PASSWORD_LENGTH = 6;

export default function AccountSecurityPage() {
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/api/me'),
    staleTime: 60_000,
  });
  const me = meQuery.data;

  return (
    <Page className="page-account-security" variant="narrow">
      <PageHeader title={t('accountSecurity')} lead={t('accountSecurityLead')} />
      <PageBody>
        <div className="flex flex-col gap-4">
          {me && me.passwordRequired !== false ? <PasswordPanel /> : null}
          {me ? <TwoFactorPanel username={me.username} passwordRequired={me.passwordRequired !== false} /> : null}
          {meQuery.isLoading ? <Skeleton className="h-24 w-full" /> : null}
          {meQuery.error ? <p className="text-danger">{(meQuery.error as Error).message}</p> : null}
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
    <Panel aria-labelledby="password-title">
      <h2 id="password-title" className="section-title">
        {t('securityPasswordTitle')}
      </h2>
      <p className="section-lead">{t('securityPasswordLead')}</p>
      <form onSubmit={onSubmit} className="security-form">
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
        <div className="field">
          <Label htmlFor="security-new-password">{t('newPassword')}</Label>
          <Input
            id="security-new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={100}
            aria-invalid={tooShort || undefined}
          />
          {tooShort ? <p className="text-muted text-sm">{t('securityPasswordTooShort')}</p> : null}
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
          {mismatch ? <p className="text-danger text-sm">{t('securityPasswordMismatch')}</p> : null}
        </div>
        {mutation.error ? (
          <p className="text-danger" role="alert">
            {twoFactorErrorMessage(mutation.error)}
          </p>
        ) : null}
        {done ? (
          <p className="text-muted" role="status">
            {t('securityPasswordChanged')}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {t('securityChangePassword')}
        </Button>
      </form>
    </Panel>
  );
}

function SessionsPanel() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [revokedOthers, setRevokedOthers] = useState<number | null>(null);

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

  const sessions = sessionsQuery.data ?? [];
  const others = sessions.filter((session) => !session.current);

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
    <Panel aria-labelledby="sessions-title">
      <div className="security-panel-head">
        <div>
          <h2 id="sessions-title" className="section-title">
            {t('sessionsTitle')}
          </h2>
          <p className="section-lead">{t('sessionsLead')}</p>
        </div>
        <Button
          type="button"
          variant="danger"
          disabled={!others.length || revokeOthersMutation.isPending}
          onClick={revokeOthers}
        >
          {t('sessionRevokeOthers')}
        </Button>
      </div>
      {sessionsQuery.isLoading ? <Skeleton className="h-12 w-full" /> : null}
      {sessionsQuery.error ? <p className="text-danger">{(sessionsQuery.error as Error).message}</p> : null}
      {revokedOthers !== null ? (
        <p className="text-muted" role="status">
          {t('sessionRevokedOthers').replace('{count}', String(revokedOthers))}
        </p>
      ) : null}
      {sessions.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('device')}</th>
                <th>{t('sessionMethod')}</th>
                <th>{t('sessionSignedIn')}</th>
                <th>{t('sessionLastActive')}</th>
                <th aria-label={t('sessionRevoke')} />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <span className="flex flex-wrap items-center gap-2">
                      {deviceLabel(session)}
                      {session.current ? <Badge variant="secondary">{t('sessionThisDevice')}</Badge> : null}
                    </span>
                  </td>
                  <td>{signInMethodLabel(session.method)}</td>
                  <td className="text-muted whitespace-nowrap">{formatDateTime(session.createdAt)}</td>
                  <td className="text-muted whitespace-nowrap" title={formatDateTime(session.lastSeenAt)}>
                    {formatRelativeTime(Math.min(session.lastSeenAt, now), now)}
                  </td>
                  <td className="text-right">
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
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {mutationError ? <p className="text-danger">{(mutationError as Error).message}</p> : null}
    </Panel>
  );
}

function ActivityPanel() {
  const activityQuery = useQuery({
    queryKey: ACTIVITY_KEY,
    queryFn: () => api<AuditLogPage>('/api/me/audit-log?page=1&pageSize=50'),
  });
  const items = activityQuery.data?.items ?? [];
  const total = activityQuery.data?.total ?? 0;

  return (
    <Panel aria-labelledby="activity-title">
      <h2 id="activity-title" className="section-title">
        {t('accountActivity')}
      </h2>
      <p className="section-lead">{t('accountActivityLead')}</p>
      {activityQuery.isLoading ? <Skeleton className="h-12 w-full" /> : null}
      {activityQuery.error ? <p className="text-danger">{(activityQuery.error as Error).message}</p> : null}
      {activityQuery.data && !items.length ? (
        <EmptyState title={t('accountActivityEmpty')} description={t('accountActivityEmptyHint')} />
      ) : null}
      {items.length ? <AuditLogTable entries={items} /> : null}
      {total > items.length ? (
        <p className="text-muted text-sm mt-2">
          {t('auditShowingLatest').replace('{count}', String(items.length)).replace('{total}', String(total))}
        </p>
      ) : null}
    </Panel>
  );
}
