import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ShieldAlert, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { AuditLogTable } from '../components/AuditLogTable';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip } from '../components/KpiStrip';
import { ModalDialog } from '../components/ModalDialog';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { SiteIdentity } from '../components/workspace/SiteIdentity';
import { initialOf } from '../components/workspace/workspace-format';
import { api, authenticatedFetch, type AdminUser, type AuditLogEntry } from '../lib/api';
import { formatDateOnly, formatNumber, formatShortDate, shortId } from '../lib/format';
import { t } from '../lib/i18n';

interface AdminUserRow extends AdminUser {
  displayName?: string | null;
  createdAt?: string | number | null;
}

interface AuditResponse {
  items: AuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
}

type AdminWebsite = { id: string; name: string; userId?: string; teamId?: string | null; domain?: string };
type AdminTeam = { id: string; name: string; accessCode?: string | null };

const USER_ROLES = ['user', 'admin', 'view-only', 'team-view-only'] as const;
/** Audit rows shown before "Show all". */
const AUDIT_PREVIEW = 12;

function roleTone(role: string) {
  return role === 'admin' ? 'info' : 'neutral';
}

function TableSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((key) => (
        <div key={key} className="ws-table-skeleton-row">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      api('/api/admin/users', { method: 'POST', body: JSON.stringify({ username: username.trim(), password, role: 'user' }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
      onClose();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (username.trim() && password) mutation.mutate();
  }
  return (
    <ModalDialog className="ws-dialog--sm" aria-label={t('createUser')} onClose={onClose}>
      <form onSubmit={submit}>
        <header className="dialog-header">
          <h2 className="dialog-title">{t('createUser')}</h2>
          <p>{t('workspaceCreateUserLead')}</p>
        </header>
        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="admin-new-username">{t('username')}</Label>
            <Input id="admin-new-username" value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <Label htmlFor="admin-new-password">{t('password')}</Label>
            <Input
              id="admin-new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {mutation.error ? (
            <p className="text-danger" role="alert">
              {(mutation.error as Error).message}
            </p>
          ) : null}
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!username.trim() || !password || mutation.isPending}>
            {t('createUser')}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}

function EditUserDialog({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState(user.role);
  const [password, setPassword] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role, ...(password ? { password } : {}) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
      onClose();
    },
  });
  return (
    <ModalDialog className="ws-dialog--sm" aria-label={t('editUser')} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">{t('editUser')}</h2>
          <p>{user.username}</p>
        </header>
        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="admin-edit-role">{t('role')}</Label>
            <select id="admin-edit-role" className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              {USER_ROLES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <Label htmlFor="admin-edit-password">{t('newPassword')}</Label>
            <Input
              id="admin-edit-password"
              type="password"
              autoComplete="new-password"
              placeholder={t('workspaceOptional')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="field-hint">{t('workspaceKeepPasswordHint')}</p>
          </div>
          {mutation.error ? (
            <p className="text-danger" role="alert">
              {(mutation.error as Error).message}
            </p>
          ) : null}
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {t('save')}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}

export default function AdminPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  // Shares the sidebar's ['me'] cache; the API refuses self-deletion, so hide that button.
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ id: string }>('/api/me'),
    staleTime: 60_000,
  });
  const myUserId = meQuery.data?.id;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [eventsWebsiteId, setEventsWebsiteId] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [showAllAudit, setShowAllAudit] = useState(false);

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api<AdminUserRow[]>('/api/admin/users'),
    retry: false,
  });

  const teamsQuery = useQuery({
    queryKey: ['admin-teams'],
    queryFn: () => api<AdminTeam[]>('/api/admin/teams'),
    retry: false,
  });

  const websitesQuery = useQuery({
    queryKey: ['admin-websites'],
    queryFn: () => api<AdminWebsite[]>('/api/admin/websites'),
    retry: false,
  });

  const auditQuery = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => api<AuditResponse>('/api/admin/audit?page=1&pageSize=50'),
    retry: false,
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api(`/api/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
    },
  });

  const users = usersQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const websites = websitesQuery.data ?? [];
  const auditItems = auditQuery.data?.items ?? [];
  const shownAudit = showAllAudit ? auditItems : auditItems.slice(0, AUDIT_PREVIEW);
  const usernames = new Map(users.map((user) => [user.id, user.username]));
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));

  useEffect(() => {
    if (!eventsWebsiteId && websites.length) setEventsWebsiteId(websites[0]!.id);
  }, [eventsWebsiteId, websites]);

  function downloadExport(type: 'users' | 'websites' | 'events') {
    const qs =
      type === 'events' && eventsWebsiteId
        ? `?type=events&websiteId=${encodeURIComponent(eventsWebsiteId)}`
        : `?type=${type}`;
    setExporting(type);
    authenticatedFetch(`/api/admin/export${qs}`)
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `flareboard-${type}.csv`;
        a.click();
      })
      .finally(() => setExporting(null));
  }

  const isForbidden =
    usersQuery.error?.message?.includes('Forbidden') || (usersQuery.error as Error | undefined)?.message === 'Forbidden';

  return (
    <Page className="ws-page-admin ws-page-settings">
      <PageHeader
        title={t('admin')}
        lead={t('adminSubtitle')}
        actions={
          isForbidden ? null : (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <UserPlus aria-hidden />
              {t('createUser')}
            </Button>
          )
        }
      />

      <PageBody>
        {isForbidden ? (
          <EmptyState
            variant="rich"
            tone="danger"
            icon={<ShieldAlert />}
            title={t('adminRequired')}
            description={t('adminDenied')}
          />
        ) : (
          <div className="ws-settings">
            <KpiStrip columns={4}>
              <KpiCell label={t('users')} value={usersQuery.isLoading ? '–' : formatNumber(users.length)} />
              <KpiCell
                label={t('workspaceAdmins')}
                value={usersQuery.isLoading ? '–' : formatNumber(users.filter((user) => user.role === 'admin').length)}
              />
              <KpiCell label={t('teams')} value={teamsQuery.isLoading ? '–' : formatNumber(teams.length)} />
              <KpiCell label={t('websites')} value={websitesQuery.isLoading ? '–' : formatNumber(websites.length)} />
            </KpiStrip>

            <SectionCard flush title={t('users')}>
              <DataViewState
                loading={usersQuery.isLoading}
                error={usersQuery.isError ? usersQuery.error : null}
                onRetry={() => usersQuery.refetch()}
                loadingFallback={<TableSkeleton />}
              >
                <div className="table-scroll">
                  <table className="data-table ws-settings-table">
                    <thead>
                      <tr>
                        <th>{t('username')}</th>
                        <th>{t('role')}</th>
                        <th>{t('created')}</th>
                        <th className="ws-row-actions">
                          <span className="visually-hidden">{t('actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <span className="ws-user">
                              <span className="ws-user-avatar" aria-hidden>
                                {initialOf(user.username)}
                              </span>
                              {user.username}
                              {user.id === myUserId ? <span className="ws-cell-sub ws-inline-sub">{t('workspaceYou')}</span> : null}
                            </span>
                          </td>
                          <td>
                            <StatusBadge tone={roleTone(user.role)} dot={false}>
                              {user.role}
                            </StatusBadge>
                          </td>
                          <td className="text-muted ws-nowrap" title={user.createdAt ? formatDateOnly(user.createdAt) : undefined}>
                            {user.createdAt ? formatShortDate(user.createdAt) : '–'}
                          </td>
                          <td className="ws-row-actions">
                            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(user)}>
                              {t('edit')}
                            </Button>
                            {user.id !== myUserId ? (
                              <Button
                                type="button"
                                variant="destructive-ghost"
                                size="sm"
                                onClick={() => confirm({ title: deleteTitle(user.username), onConfirm: () => deleteUser.mutate(user.id) })}
                              >
                                {t('delete')}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DataViewState>
              {deleteUser.error ? (
                <p className="text-danger ws-card-error" role="alert">
                  {(deleteUser.error as Error).message}
                </p>
              ) : null}
            </SectionCard>

            <SectionCard flush title={t('teams')}>
              <DataViewState
                loading={teamsQuery.isLoading}
                error={teamsQuery.isError ? teamsQuery.error : null}
                onRetry={() => teamsQuery.refetch()}
                loadingFallback={<TableSkeleton />}
              >
                {teams.length ? (
                  <div className="table-scroll">
                    <table className="data-table ws-settings-table">
                      <thead>
                        <tr>
                          <th>{t('name')}</th>
                          <th>{t('accessCode')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teams.map((team) => (
                          <tr key={team.id}>
                            <td className="ws-cell-title">{team.name}</td>
                            <td>{team.accessCode ? <code className="ws-mono-value">{team.accessCode}</code> : '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title={t('noTeams')} />
                )}
              </DataViewState>
            </SectionCard>

            <SectionCard flush title={t('allWebsites')}>
              <DataViewState
                loading={websitesQuery.isLoading}
                error={websitesQuery.isError ? websitesQuery.error : null}
                onRetry={() => websitesQuery.refetch()}
                loadingFallback={<TableSkeleton />}
              >
                <div className="table-scroll">
                  <table className="data-table ws-settings-table">
                    <thead>
                      <tr>
                        <th>{t('website')}</th>
                        <th>{t('workspaceOwner')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {websites.map((site) => (
                        <tr key={site.id}>
                          <td>
                            <SiteIdentity name={site.name} domain={site.domain} size="sm" />
                          </td>
                          <td>
                            {site.teamId && teamNames.get(site.teamId) ? (
                              <span>{teamNames.get(site.teamId)}</span>
                            ) : site.userId && usernames.get(site.userId) ? (
                              usernames.get(site.userId)
                            ) : (
                              <code className="ws-mono-value" title={site.userId}>
                                {site.userId ? shortId(site.userId) : t('unknown')}
                              </code>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DataViewState>
            </SectionCard>

            <SectionCard title={t('exportData')} description={t('workspaceExportLead')}>
              <ul className="ws-settings-rows">
                <li className="ws-settings-row">
                  <span className="ws-settings-row-label">{t('exportUsers')}</span>
                  <Button type="button" variant="outline" size="sm" disabled={exporting === 'users'} onClick={() => downloadExport('users')}>
                    <Download aria-hidden />
                    CSV
                  </Button>
                </li>
                <li className="ws-settings-row">
                  <span className="ws-settings-row-label">{t('exportWebsites')}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={exporting === 'websites'}
                    onClick={() => downloadExport('websites')}
                  >
                    <Download aria-hidden />
                    CSV
                  </Button>
                </li>
                <li className="ws-settings-row">
                  <span className="ws-settings-row-label">{t('workspaceExportEvents')}</span>
                  <span className="ws-settings-row-controls">
                    <select
                      className="select ws-inline-select"
                      aria-label={t('website')}
                      value={eventsWebsiteId}
                      onChange={(event) => setEventsWebsiteId(event.target.value)}
                    >
                      {websites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!eventsWebsiteId || exporting === 'events'}
                      onClick={() => downloadExport('events')}
                    >
                      <Download aria-hidden />
                      CSV
                    </Button>
                  </span>
                </li>
              </ul>
            </SectionCard>
            <SectionCard
              flush
              title={t('auditLog')}
              description={
                auditQuery.data && auditQuery.data.total > auditItems.length
                  ? t('auditShowingLatest')
                      .replace('{count}', String(auditItems.length))
                      .replace('{total}', String(auditQuery.data.total))
                  : undefined
              }
              footer={
                auditItems.length > AUDIT_PREVIEW ? (
                  <>
                    <span>{t('workspaceRowCount').replace('{count}', formatNumber(auditItems.length))}</span>
                    <button type="button" className="card-footer-link" onClick={() => setShowAllAudit((value) => !value)}>
                      {showAllAudit ? t('workspaceShowFewer') : t('workspaceShowAll')}
                    </button>
                  </>
                ) : undefined
              }
            >
              <DataViewState
                loading={auditQuery.isLoading}
                error={auditQuery.isError ? auditQuery.error : null}
                onRetry={() => auditQuery.refetch()}
                loadingFallback={<TableSkeleton />}
              >
                {auditItems.length ? (
                  <AuditLogTable entries={shownAudit} showActor showEntity />
                ) : (
                  <EmptyState title={t('accountActivityEmpty')} />
                )}
              </DataViewState>
            </SectionCard>

          </div>
        )}
      </PageBody>

      {creating ? <CreateUserDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <EditUserDialog user={editing} onClose={() => setEditing(null)} /> : null}
    </Page>
  );
}
