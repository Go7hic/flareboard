import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MasterDetailLayout, MasterDetailSelectableItem } from '../components/master-detail';
import { WebsiteNameLabel } from '../components/WebsiteNameLabel';
import { PlanUpgradeBanner } from '../components/PlanUpgradeBanner';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { AuditLogTable } from '../components/AuditLogTable';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { api, ApiError, type AuditLogPage, type Team, type Website } from '../lib/api';
import { t } from '../lib/i18n';
import { useConfirm } from '../components/ConfirmDialog';

interface TeamDetail extends Team {
  websites?: Array<{ id: string; name: string; domain?: string }>;
}

interface TeamMember {
  id: string;
  userId: string;
  username: string;
  role: string;
}

/** `GET /api/teams/:teamId/status` (only the fields this page reads). */
interface TeamStatus {
  canManageMembers: boolean;
  /** Owner or global admin: may change the team's security settings. */
  canManageSecurity?: boolean;
  requireTwoFactor?: boolean;
  members: Array<{ userId: string; username: string; role: string; twoFactorEnabled?: boolean }>;
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
  const confirm = useConfirm();
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

  const statusQuery = useQuery({
    queryKey: ['team-status', selectedTeamId],
    enabled: Boolean(selectedTeamId),
    queryFn: () => api<TeamStatus>(`/api/teams/${selectedTeamId}/status`),
  });

  const canManageMembers = Boolean(statusQuery.data?.canManageMembers);

  const auditQuery = useQuery({
    queryKey: ['team-audit-log', selectedTeamId],
    enabled: Boolean(selectedTeamId) && canManageMembers,
    queryFn: () => api<AuditLogPage>(`/api/teams/${selectedTeamId}/audit-log?page=1&pageSize=50`),
  });

  const requireTwoFactorMutation = useMutation({
    mutationFn: (requireTwoFactor: boolean) =>
      api<Team>(`/api/teams/${selectedTeamId}`, {
        method: 'PATCH',
        body: JSON.stringify({ requireTwoFactor }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-status', selectedTeamId] });
      queryClient.invalidateQueries({ queryKey: ['team', selectedTeamId] });
      queryClient.invalidateQueries({ queryKey: ['team-audit-log', selectedTeamId] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
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
  const selectedTeam = teams.find((team) => team.id === selectedTeamId);
  const canManageSecurity = Boolean(statusQuery.data?.canManageSecurity);
  const requireTwoFactor = Boolean(statusQuery.data?.requireTwoFactor ?? selectedTeam?.requireTwoFactor);
  const twoFactorByUser = new Map(
    (statusQuery.data?.members ?? []).map((member) => [member.userId, member.twoFactorEnabled]),
  );
  // Who lacks 2FA matters to owners deciding whether to require it, and to everyone once it is on.
  const showTwoFactorBadges = requireTwoFactor || canManageSecurity;
  const requireTwoFactorError = requireTwoFactorMutation.error;
  const ownerNeedsTwoFactor =
    requireTwoFactorError instanceof ApiError &&
    requireTwoFactorError.status === 409 &&
    requireTwoFactorError.data?.code === 'owner_two_factor_required';
  const auditItems = auditQuery.data?.items ?? [];

  return (
    <Page className="page-teams">
      <PageHeader title={t('teams')} lead={t('teamsSubtitle')} />

      <PageBody>
      {!teamsAllowed && billingQuery.data ? (
        <PlanUpgradeBanner message={t('teamsRequiresUpgrade')} className="section-gap" />
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
        <div className="section-gap">
          <EmptyState title={t('noTeams')} description={t('noTeamsHint')} />
        </div>
      ) : null}

      {teams.length > 0 ? (
        <MasterDetailLayout
          className="master-detail-layout--teams section-gap-lg"
          wrapList={false}
          list={
            <aside className="panel teams-sidebar-panel" aria-label={t('teams')}>
              <h2 className="section-title">{t('teams')}</h2>
              <p className="teams-sidebar-lead">{t('selectTeamHint')}</p>
              <div className="teams-sidebar">
                {teams.map((team) => (
                  <MasterDetailSelectableItem
                    key={team.id}
                    className="teams-sidebar-item"
                    selectedClassName="selected"
                    selected={selectedTeamId === team.id}
                    onSelect={() => {
                      setSelectedTeamId(team.id);
                      setAccessCodeCopied(false);
                      requireTwoFactorMutation.reset();
                    }}
                  >
                    <span className="teams-sidebar-item-name">{team.name}</span>
                    <span className="teams-sidebar-item-role">
                      {t('roleLabel')}: {formatTeamRole(team.role)}
                    </span>
                  </MasterDetailSelectableItem>
                ))}
              </div>
            </aside>
          }
          detail={
            selectedTeamId && teamDetailQuery.data ? (
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
                          <span className="teams-member-name">
                            {m.username}
                            {showTwoFactorBadges && twoFactorByUser.get(m.userId) === false ? (
                              <Badge variant="warning" className="ml-2">
                                {t('teamMemberNoTwoFactor')}
                              </Badge>
                            ) : null}
                          </span>
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
                                variant="destructive-ghost"
                                size="sm"
                                onClick={() => confirm({
                                    title: t('removeMemberConfirmTitle').replace('{name}', m.username),
                                    description: t('removeMemberConfirmBody'),
                                    confirmLabel: t('remove'),
                                    onConfirm: () => removeMemberMutation.mutate(m.userId),
                                  })}
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

                {canManageSecurity ? (
                  <section className="teams-detail-block">
                    <h3 className="section-title">{t('teamSecurity')}</h3>
                    <label className="teams-security-toggle">
                      <Switch
                        checked={requireTwoFactor}
                        disabled={requireTwoFactorMutation.isPending || statusQuery.isLoading}
                        onCheckedChange={(checked) => requireTwoFactorMutation.mutate(checked)}
                      />
                      <span>
                        <span className="teams-security-toggle-label">{t('teamRequireTwoFactor')}</span>
                        <span className="teams-security-toggle-hint">{t('teamRequireTwoFactorHint')}</span>
                      </span>
                    </label>
                    {ownerNeedsTwoFactor ? (
                      <p className="text-danger text-sm mt-2" role="alert">
                        {t('teamRequireTwoFactorOwnerFirst')}{' '}
                        <Link to="/account/security">{t('accountSecurity')}</Link>
                      </p>
                    ) : requireTwoFactorError ? (
                      <p className="text-danger text-sm mt-2" role="alert">
                        {(requireTwoFactorError as Error).message}
                      </p>
                    ) : null}
                  </section>
                ) : requireTwoFactor ? (
                  <section className="teams-detail-block">
                    <h3 className="section-title">{t('teamSecurity')}</h3>
                    <p className="teams-empty-hint">{t('teamRequiresTwoFactorInfo')}</p>
                  </section>
                ) : null}

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
                            className="font-mono"
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
                          <Link to={`/websites/${w.id}`}>
                            <WebsiteNameLabel name={w.name} domain={w.domain} faviconSize={16} />
                          </Link>
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

                {canManageMembers ? (
                  <section className="teams-detail-block">
                    <h3 className="section-title">{t('teamActivity')}</h3>
                    <p className="section-lead">{t('teamActivityLead')}</p>
                    {auditQuery.isLoading ? <Skeleton className="h-8 w-full" /> : null}
                    {auditQuery.error ? <p className="text-danger">{(auditQuery.error as Error).message}</p> : null}
                    {auditQuery.data && !auditItems.length ? (
                      <p className="teams-empty-hint">{t('teamActivityEmpty')}</p>
                    ) : null}
                    {auditItems.length ? <AuditLogTable entries={auditItems} showActor /> : null}
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
          )
          }
        />
      ) : null}
      </PageBody>
    </Page>
  );
}
