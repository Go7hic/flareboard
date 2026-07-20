import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { WebsiteNameLabel } from '../components/WebsiteNameLabel';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api, authenticatedFetch, type AdminUser } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';

interface AuditEntry {
  id: string;
  userId: string;
  username: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  createdAt?: string | number;
}

interface AuditResponse {
  items: AuditEntry[];
  page: number;
  pageSize: number;
  total: number;
}

export default function AdminPage() {
    const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('user');
  const [editPassword, setEditPassword] = useState('');
  const [eventsWebsiteId, setEventsWebsiteId] = useState('');

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api<AdminUser[]>('/api/admin/users'),
    retry: false,
  });

  const teamsQuery = useQuery({
    queryKey: ['admin-teams'],
    queryFn: () => api<Array<{ id: string; name: string; accessCode?: string }>>('/api/admin/teams'),
    retry: false,
  });

  const websitesQuery = useQuery({
    queryKey: ['admin-websites'],
    queryFn: () =>
      api<Array<{ id: string; name: string; userId?: string; domain?: string }>>('/api/admin/websites'),
    retry: false,
  });

  const auditQuery = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => api<AuditResponse>('/api/admin/audit?page=1&pageSize=50'),
    retry: false,
  });

  const updateUser = useMutation({
    mutationFn: () =>
      api(`/api/admin/users/${editUserId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          role: editRole,
          ...(editPassword ? { password: editPassword } : {}),
        }),
      }),
    onSuccess: () => {
      setEditUserId(null);
      setEditPassword('');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
    },
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api(`/api/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
    },
  });

  const createUser = useMutation({
    mutationFn: () =>
      api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, role: 'user' }),
      }),
    onSuccess: () => {
      setUsername('');
      setPassword('');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
    },
  });

  function downloadExport(type: 'users' | 'websites' | 'events') {
    const qs =
      type === 'events' && eventsWebsiteId
        ? `?type=events&websiteId=${encodeURIComponent(eventsWebsiteId)}`
        : `?type=${type}`;
    authenticatedFetch(`/api/admin/export${qs}`)
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `flareboard-${type}.csv`;
        a.click();
      });
  }

  const isForbidden =
    usersQuery.error?.message?.includes('Forbidden') ||
    (usersQuery.error as Error | undefined)?.message === 'Forbidden';

  return (
    <Page>
      <PageHeader title={t('admin')} lead={t('adminSubtitle')} backTo="/websites" backLabel={t('websites')} />

      <PageBody>
      {isForbidden ? (
        <div className="panel empty-state-rich">
          <h3>{t('adminRequired')}</h3>
          <p className="text-danger">{t('adminDenied')}</p>
        </div>
      ) : (
        <>
          <section className="panel section-gap">
            <h2 className="section-title">{t('exportData')}</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <Button type="button" variant="secondary" size="sm" onClick={() => downloadExport('users')}>
                {t('exportUsers')}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => downloadExport('websites')}>
                {t('exportWebsites')}
              </Button>
              <Input
                style={{ maxWidth: '16rem' }}
                placeholder="website UUID"
                value={eventsWebsiteId}
                onChange={(e) => setEventsWebsiteId(e.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!eventsWebsiteId}
                onClick={() => downloadExport('events')}
              >
                {t('exportEvents')}
              </Button>
            </div>
          </section>

          <section className="panel section-gap">
            <h2 className="section-title">{t('users')}</h2>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (username && password) createUser.mutate();
              }}
            >
              <div className="form-row">
                <div className="field">
                  <Input placeholder={t('username')} value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="field">
                  <Input
                    type="password"
                    placeholder={t('password')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="primary">{t('createUser')}</Button>
              </div>
            </form>
            <ul className="list-plain section-gap">
              {(usersQuery.data ?? []).map((u) => (
                <li key={u.id} className="list-item list-row">
                  <span>{u.username}</span>
                  <span style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    <span className="badge admin-role-badge">{u.role}</span>
                    <Button type="button" variant="secondary" size="sm" onClick={() => { setEditUserId(u.id); setEditRole(u.role); }}>
                      {t('edit')}
                    </Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => deleteUser.mutate(u.id)}>
                      {t('delete')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            {editUserId ? (
              <form
                className="section-gap"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateUser.mutate();
                }}
              >
                <h3 className="section-title">{t('editUser')}</h3>
                <select className="select" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                  <option value="view-only">view-only</option>
                  <option value="team-view-only">team-view-only</option>
                </select>
                <div className="field">
                  <Input
                    type="password"
                    placeholder={`${t('newPassword')} (${t('optional') ?? 'optional'})`}
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="primary">{t('save')}</Button>
              </form>
            ) : null}
          </section>

          <section className="panel section-gap">
            <h2 className="section-title">{t('teams')}</h2>
            <ul className="list-plain">
              {(teamsQuery.data ?? []).map((team) => (
                <li key={team.id} className="list-item list-row">
                  <span>{team.name}</span>
                  <span className="text-muted list-row-value">code {team.accessCode}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel section-gap">
            <h2 className="section-title">{t('allWebsites')}</h2>
            <ul className="list-plain">
              {(websitesQuery.data ?? []).map((w) => (
                <li key={w.id} className="list-item list-row">
                  <span>
                  <WebsiteNameLabel name={w.name} domain={w.domain} faviconSize={16} />
                  {w.domain ? <span className="text-muted"> · {w.domain}</span> : null}
                  </span>
                  <span className="text-muted list-row-value">user {w.userId?.slice(0, 8) ?? 'unknown'}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel section-gap">
            <h2 className="section-title">{t('auditLog')}</h2>
            <ul className="list-plain">
              {(auditQuery.data?.items ?? []).map((entry) => (
                <li key={entry.id} className="list-item list-row">
                  <span>
                    <strong>{entry.username}</strong> {entry.action} {entry.entityType}
                    {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ''}
                  </span>
                  <span className="text-muted list-row-value">
                    {entry.createdAt ? formatDateTime(entry.createdAt) : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      </PageBody>
    </Page>
  );
}
