import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { api, type Team, type Website } from '../lib/api';
import { t } from '../lib/i18n';

interface TeamDetail extends Team {
  websites?: Array<{ id: string; name: string; domain?: string }>;
}

interface TeamMember {
  id: string;
  userId: string;
  username: string;
  role: string;
}

function formatTeamRole(role: string | undefined): string {
  switch (role) {
    case 'team-owner':
      return t('teamOwner');
    case 'team-manager':
      return t('teamManager');
    case 'team-member':
      return t('teamMember');
    case 'team-view-only':
      return t('readOnlyRole');
    case 'admin':
      return 'Admin';
    default:
      return role ?? t('teamMember');
  }
}

export default function Teams() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [siteName, setSiteName] = useState('');
  const [siteDomain, setSiteDomain] = useState('');
  const [accessCodeCopied, setAccessCodeCopied] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['teams'],
    queryFn: () => api<Team[]>('/api/teams'),
  });

  const billingQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () =>
      api<{
        hosted: boolean;
        plan?: { teamsEnabled?: boolean };
      }>('/api/billing/subscription'),
  });

  const teamsAllowed = !billingQuery.data?.hosted || Boolean(billingQuery.data?.plan?.teamsEnabled);

  const teamDetailQuery = useQuery({
    queryKey: ['team', selectedTeamId],
    enabled: Boolean(selectedTeamId),
    queryFn: () => api<TeamDetail>(`/api/teams/${selectedTeamId}`),
  });

  const membersQuery = useQuery({
    queryKey: ['team-members', selectedTeamId],
    enabled: Boolean(selectedTeamId),
    queryFn: () => api<TeamMember[]>(`/api/teams/${selectedTeamId}/users`),
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string }) =>
      api<Team>('/api/teams', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  const joinMutation = useMutation({
    mutationFn: (code: string) =>
      api<Team>('/api/teams/join', { method: 'POST', body: JSON.stringify({ accessCode: code }) }),
    onSuccess: () => {
      setAccessCode('');
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api(`/api/teams/${selectedTeamId}/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team-members', selectedTeamId] }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) =>
      api(`/api/teams/${selectedTeamId}/users/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members', selectedTeamId] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  const createWebsiteMutation = useMutation({
    mutationFn: (body: { name: string; domain: string }) =>
      api<Website>(`/api/teams/${selectedTeamId}/websites`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (website) => {
      setSiteName('');
      setSiteDomain('');
      queryClient.invalidateQueries({ queryKey: ['team', selectedTeamId] });
      queryClient.invalidateQueries({ queryKey: ['websites'] });
      navigate(`/websites/${website.id}/settings?setup=1`);
    },
  });

  const teams = data ?? [];

  useEffect(() => {
    if (teams.length && !selectedTeamId) {
      setSelectedTeamId(teams[0].id);
    }
  }, [teams, selectedTeamId]);

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ name: name.trim() });
  }

  function onJoin(e: FormEvent) {
    e.preventDefault();
    if (!accessCode.trim()) return;
    joinMutation.mutate(accessCode.trim());
  }

  function onCreateWebsite(e: FormEvent) {
    e.preventDefault();
    if (!selectedTeamId || !siteName.trim() || !siteDomain.trim()) return;
    createWebsiteMutation.mutate({ name: siteName.trim(), domain: siteDomain.trim() });
  }

  async function copyAccessCode() {
    const code = teamDetailQuery.data?.accessCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setAccessCodeCopied(true);
    } catch {
      setAccessCodeCopied(false);
    }
  }

  const canManageTeam =
    teamDetailQuery.data?.role === 'team-owner' ||
    teamDetailQuery.data?.role === 'team-manager' ||
    teamDetailQuery.data?.role === 'admin';

  const teamWebsites = teamDetailQuery.data?.websites ?? [];
  const members = membersQuery.data ?? [];

  return (
    <div className="page page-teams">
      <PageHeader title={t('teams')} subtitle={t('teamsSubtitle')} />

      {!teamsAllowed && billingQuery.data ? (
        <div className="panel section-gap">
          <p className="text-muted" style={{ fontSize: '0.875rem' }}>
            {t('teamsRequiresUpgrade')}{' '}
            <Link to="/billing" className="shell-link">
              {t('upgradeTo')} Cloud
            </Link>
          </p>
        </div>
      ) : null}

      <div className="grid-2 section-gap">
        <section className="panel">
          <h2 className="section-title">{t('createTeam')}</h2>
          <form onSubmit={onCreate}>
            <div className="field">
              <Label htmlFor="team-name">{t('teamName')}</Label>
              <Input
                id="team-name"
                placeholder={t('teamName')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!teamsAllowed}
              />
            </div>
            <Button variant="primary" type="submit" disabled={createMutation.isPending || !teamsAllowed}>
              {t('create')}
            </Button>
          </form>
        </section>

        <section className="panel">
          <h2 className="section-title">{t('joinWithCode')}</h2>
          <form onSubmit={onJoin}>
            <div className="field">
              <Label htmlFor="access-code">{t('accessCode')}</Label>
              <Input
                id="access-code"
                placeholder={t('accessCode')}
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                disabled={!teamsAllowed}
              />
            </div>
            <Button variant="primary" type="submit" disabled={joinMutation.isPending || !teamsAllowed}>
              {t('joinTeam')}
            </Button>
          </form>
          {joinMutation.error ? <p className="text-danger">{(joinMutation.error as Error).message}</p> : null}
        </section>
      </div>

      {isLoading ? <Skeleton className="section-gap h-12 w-full" /> : null}
      {error ? <p className="text-danger section-gap">{(error as Error).message}</p> : null}

      {!isLoading && !teams.length ? (
        <div className="panel empty-state-rich section-gap">
          <EmptyState title={t('noTeams')} description={t('noTeamsHint')} />
        </div>
      ) : null}

      {teams.length > 0 ? (
        <div className="teams-layout section-gap-lg">
          <aside className="panel teams-sidebar-panel" aria-label={t('teams')}>
            <h2 className="section-title">{t('teams')}</h2>
            <p className="teams-sidebar-lead">{t('selectTeamHint')}</p>
            <div className="teams-sidebar">
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={`teams-sidebar-item${selectedTeamId === team.id ? ' selected' : ''}`}
                  onClick={() => {
                    setSelectedTeamId(team.id);
                    setAccessCodeCopied(false);
                  }}
                >
                  <span className="teams-sidebar-item-name">{team.name}</span>
                  <span className="teams-sidebar-item-role">
                    {t('roleLabel')}: {formatTeamRole(team.role)}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          {selectedTeamId && teamDetailQuery.data ? (
            <section className="panel teams-detail-panel">
              <header className="teams-detail-header">
                <h2 className="section-title">{teamDetailQuery.data.name}</h2>
                <p className="teams-detail-role">
                  {t('roleLabel')}: {formatTeamRole(teamDetailQuery.data.role)}
                </p>
              </header>

              <div className="teams-detail-blocks">
                <section className="teams-detail-block">
                  <h3 className="section-title">{t('members')}</h3>
                  {membersQuery.isLoading ? (
                    <Skeleton className="h-8 w-3/5" />
                  ) : (
                    <ul className="list-plain">
                      {members.map((m) => (
                        <li key={m.id} className="list-item teams-member-row">
                          <span className="teams-member-name">{m.username}</span>
                          {canManageTeam ? (
                            <span className="teams-member-actions">
                              <select
                                className="select"
                                aria-label={`${t('role')} — ${m.username}`}
                                value={m.role}
                                onChange={(e) =>
                                  updateMemberMutation.mutate({ userId: m.userId, role: e.target.value })
                                }
                              >
                                <option value="team-owner">{t('teamOwner')}</option>
                                <option value="team-manager">{t('teamManager')}</option>
                                <option value="team-member">{t('teamMember')}</option>
                                <option value="team-view-only">{t('readOnlyRole')}</option>
                              </select>
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                onClick={() => removeMemberMutation.mutate(m.userId)}
                              >
                                {t('remove')}
                              </Button>
                            </span>
                          ) : (
                            <span className="badge">{formatTeamRole(m.role)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {canManageTeam && teamDetailQuery.data.accessCode ? (
                  <section className="teams-detail-block">
                    <h3 className="section-title">{t('accessCode')}</h3>
                    <p className="section-lead">{t('accessCodeHint')}</p>
                    <div className="teams-access-code-block">
                      <div className="field">
                        <Label htmlFor="team-access-code">{t('accessCode')}</Label>
                        <div className="teams-form-actions">
                          <Input
                            id="team-access-code"
                            readOnly
                            value={teamDetailQuery.data.accessCode}
                            style={{ fontFamily: 'var(--font-mono)' }}
                          />
                          <Button type="button" variant="secondary" onClick={() => void copyAccessCode()}>
                            {accessCodeCopied ? t('accessCodeCopied') : t('copyToClipboard')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                <section className="teams-detail-block">
                  <h3 className="section-title">{t('allWebsites')}</h3>
                  {teamWebsites.length ? (
                    <ul className="list-plain">
                      {teamWebsites.map((w) => (
                        <li key={w.id} className="list-item list-row">
                          <Link to={`/websites/${w.id}`}>{w.name}</Link>
                          {w.domain ? <span className="text-muted list-row-value">{w.domain}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="teams-empty-hint">{t('noTeamWebsites')}</p>
                  )}
                </section>

                {canManageTeam ? (
                  <section className="teams-detail-block">
                    <h3 className="section-title">{t('addTeamWebsite')}</h3>
                    <form onSubmit={onCreateWebsite}>
                      <div className="teams-form-actions">
                        <div className="field">
                          <Label htmlFor="team-site-name">{t('name')}</Label>
                          <Input
                            id="team-site-name"
                            placeholder={t('name')}
                            value={siteName}
                            onChange={(e) => setSiteName(e.target.value)}
                            disabled={!teamsAllowed}
                          />
                        </div>
                        <div className="field">
                          <Label htmlFor="team-site-domain">{t('domain')}</Label>
                          <Input
                            id="team-site-domain"
                            placeholder="example.com"
                            value={siteDomain}
                            onChange={(e) => setSiteDomain(e.target.value)}
                            disabled={!teamsAllowed}
                          />
                        </div>
                        <Button
                          variant="primary"
                          type="submit"
                          disabled={createWebsiteMutation.isPending || !teamsAllowed}
                        >
                          {t('createWebsite')}
                        </Button>
                      </div>
                      {createWebsiteMutation.error ? (
                        <p className="text-danger">{(createWebsiteMutation.error as Error).message}</p>
                      ) : null}
                    </form>
                  </section>
                ) : null}

                <footer className="teams-detail-footer">
                  {t('teamLinksPixels')}:{' '}
                  <Link to={`/links?teamId=${selectedTeamId}`}>{t('linksAndPixels')}</Link>
                </footer>
              </div>
            </section>
          ) : (
            <section className="panel teams-detail-panel">
              <p className="text-muted">{t('selectTeamHint')}</p>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}
