import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Plus, ShieldCheck, Ticket, UserPlus, UsersRound } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuditLogTable } from '../components/AuditLogTable';
import { useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip } from '../components/KpiStrip';
import { MasterDetailLayout, MasterDetailListItem, MasterDetailPane } from '../components/master-detail';
import { ModalDialog } from '../components/ModalDialog';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PlanUpgradeBanner } from '../components/PlanUpgradeBanner';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { CopyButton } from '../components/workspace/CopyButton';
import { SiteIdentity } from '../components/workspace/SiteIdentity';
import { initialOf } from '../components/workspace/workspace-format';
import { api, ApiError, type AuditLogPage, type Team, type Website } from '../lib/api';
import { formatNumber } from '../lib/format';
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

/** `GET /api/teams/:teamId/status` (only the fields this page reads). */
interface TeamStatus {
  canManageMembers: boolean;
  /** Owner or global admin: may change the team's security settings. */
  canManageSecurity?: boolean;
  requireTwoFactor?: boolean;
  members: Array<{ userId: string; username: string; role: string; twoFactorEnabled?: boolean }>;
}

const TEAM_ROLES = ['team-owner', 'team-manager', 'team-member', 'team-view-only'] as const;

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

/** One-field form dialog (team name, access code). */
function SingleFieldDialog({
  title,
  lead,
  label,
  placeholder,
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
  mono = false,
}: {
  title: string;
  lead?: string;
  label: string;
  placeholder?: string;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (value: string) => void;
  onClose: () => void;
  mono?: boolean;
}) {
  const [value, setValue] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  }
  return (
    <ModalDialog className="ws-dialog--sm" aria-label={title} onClose={onClose}>
      <form onSubmit={submit}>
        <header className="dialog-header">
          <h2 className="dialog-title">{title}</h2>
          {lead ? <p>{lead}</p> : null}
        </header>
        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="ws-single-field">{label}</Label>
            <Input
              id="ws-single-field"
              value={value}
              placeholder={placeholder}
              className={mono ? 'font-mono' : undefined}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          </div>
          {error ? (
            <p className="text-danger" role="alert">
              {(error as Error).message}
            </p>
          ) : null}
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!value.trim() || pending}>
            {submitLabel}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}

function AddTeamWebsiteDialog({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      api<Website>(`/api/teams/${teamId}/websites`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), domain: domain.trim() }),
      }),
    onSuccess: (website) => {
      queryClient.invalidateQueries({ queryKey: ['team', teamId] });
      queryClient.invalidateQueries({ queryKey: ['websites'] });
      navigate(`/websites/${website.id}/settings?setup=1`);
    },
  });
  return (
    <ModalDialog className="ws-dialog--sm" aria-label={t('addTeamWebsite')} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && domain.trim()) mutation.mutate();
        }}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">{t('addTeamWebsite')}</h2>
          <p>{t('workspaceTeamWebsiteLead')}</p>
        </header>
        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="team-site-name">{t('name')}</Label>
            <Input id="team-site-name" value={name} placeholder={t('mySite')} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <Label htmlFor="team-site-domain">{t('domain')}</Label>
            <Input id="team-site-domain" value={domain} placeholder="example.com" onChange={(e) => setDomain(e.target.value)} />
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
          <Button type="submit" variant="primary" disabled={!name.trim() || !domain.trim() || mutation.isPending}>
            {t('createWebsite')}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}

function TeamPane({ team, teamsAllowed }: { team: Team; teamsAllowed: boolean }) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const teamId = team.id;
  const [addingSite, setAddingSite] = useState(false);

  const teamDetailQuery = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => api<TeamDetail>(`/api/teams/${teamId}`),
  });

  const membersQuery = useQuery({
    queryKey: ['team-members', teamId],
    queryFn: () => api<TeamMember[]>(`/api/teams/${teamId}/users`),
  });

  const statusQuery = useQuery({
    queryKey: ['team-status', teamId],
    queryFn: () => api<TeamStatus>(`/api/teams/${teamId}/status`),
  });

  const canManageMembers = Boolean(statusQuery.data?.canManageMembers);

  const auditQuery = useQuery({
    queryKey: ['team-audit-log', teamId],
    enabled: canManageMembers,
    queryFn: () => api<AuditLogPage>(`/api/teams/${teamId}/audit-log?page=1&pageSize=50`),
  });

  const requireTwoFactorMutation = useMutation({
    mutationFn: (requireTwoFactor: boolean) =>
      api<Team>(`/api/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify({ requireTwoFactor }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-status', teamId] });
      queryClient.invalidateQueries({ queryKey: ['team', teamId] });
      queryClient.invalidateQueries({ queryKey: ['team-audit-log', teamId] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api(`/api/teams/${teamId}/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members', teamId] });
      queryClient.invalidateQueries({ queryKey: ['team-audit-log', teamId] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api(`/api/teams/${teamId}/users/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members', teamId] });
      queryClient.invalidateQueries({ queryKey: ['team-status', teamId] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  const detail = teamDetailQuery.data;
  const role = detail?.role ?? team.role;
  const canManageTeam = role === 'team-owner' || role === 'team-manager' || role === 'admin';
  const canManageSecurity = Boolean(statusQuery.data?.canManageSecurity);
  const requireTwoFactor = Boolean(statusQuery.data?.requireTwoFactor ?? team.requireTwoFactor);
  const members = membersQuery.data ?? [];
  const websites = detail?.websites ?? [];
  const twoFactorByUser = new Map((statusQuery.data?.members ?? []).map((member) => [member.userId, member.twoFactorEnabled]));
  // Who lacks 2FA matters to owners deciding whether to require it, and to everyone once it is on.
  const showTwoFactor = requireTwoFactor || canManageSecurity;
  const withTwoFactor = (statusQuery.data?.members ?? []).filter((member) => member.twoFactorEnabled).length;
  const statusMembers = statusQuery.data?.members.length ?? 0;
  const requireTwoFactorError = requireTwoFactorMutation.error;
  const ownerNeedsTwoFactor =
    requireTwoFactorError instanceof ApiError &&
    requireTwoFactorError.status === 409 &&
    requireTwoFactorError.data?.code === 'owner_two_factor_required';
  const auditItems = auditQuery.data?.items ?? [];

  if (teamDetailQuery.isLoading) {
    return (
      <div className="master-detail-pane">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="mt-6 h-20 w-full" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  if (teamDetailQuery.isError) {
    return (
      <div className="master-detail-pane">
        <DataViewState error={teamDetailQuery.error} onRetry={() => teamDetailQuery.refetch()}>
          {null}
        </DataViewState>
      </div>
    );
  }

  return (
    <MasterDetailPane
      title={detail?.name ?? team.name}
      meta={
        <>
          <span className="ws-type-chip">{formatTeamRole(role)}</span>
          {requireTwoFactor ? (
            <StatusBadge tone="success" className="ws-badge-icon">
              <ShieldCheck aria-hidden />
              {t('workspaceTwoFactorRequired')}
            </StatusBadge>
          ) : null}
        </>
      }
      actions={
        <Button variant="ghost" size="sm" render={<Link to={`/links?teamId=${teamId}`} />}>
          {t('linksAndPixels')}
          <ArrowUpRight aria-hidden />
        </Button>
      }
    >
      <KpiStrip inline columns={showTwoFactor ? 3 : 2}>
        <KpiCell label={t('members')} value={membersQuery.isLoading ? '–' : formatNumber(members.length)} />
        <KpiCell label={t('websites')} value={formatNumber(websites.length)} />
        {showTwoFactor ? (
          <KpiCell
            label={t('workspaceTwoFactorCoverage')}
            value={statusMembers ? `${formatNumber(withTwoFactor)} / ${formatNumber(statusMembers)}` : '–'}
          />
        ) : null}
      </KpiStrip>

      <section className="ws-detail-block" aria-labelledby="team-members-title">
        <div className="ws-detail-block-head">
          <h3 id="team-members-title" className="card-title">
            {t('members')}
          </h3>
        </div>
        {membersQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="table-scroll">
            <table className="data-table ws-compact-table">
              <thead>
                <tr>
                  <th>{t('username')}</th>
                  <th>{t('role')}</th>
                  {showTwoFactor ? <th>{t('workspaceTwoFactorColumn')}</th> : null}
                  {canManageTeam ? (
                    <th className="ws-row-actions">
                      <span className="visually-hidden">{t('actions')}</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const twoFactor = twoFactorByUser.get(member.userId);
                  return (
                    <tr key={member.id}>
                      <td>
                        <span className="ws-user">
                          <span className="ws-user-avatar" aria-hidden>
                            {initialOf(member.username)}
                          </span>
                          {member.username}
                        </span>
                      </td>
                      <td>
                        {canManageTeam ? (
                          <select
                            className="select ws-inline-select"
                            aria-label={`${t('role')} · ${member.username}`}
                            value={member.role}
                            onChange={(event) => updateMemberMutation.mutate({ userId: member.userId, role: event.target.value })}
                          >
                            {TEAM_ROLES.map((value) => (
                              <option key={value} value={value}>
                                {formatTeamRole(value)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          formatTeamRole(member.role)
                        )}
                      </td>
                      {showTwoFactor ? (
                        <td>
                          {twoFactor === undefined ? (
                            <span className="text-muted">–</span>
                          ) : twoFactor ? (
                            <StatusBadge tone="success">{t('workspaceTwoFactorOn')}</StatusBadge>
                          ) : (
                            <StatusBadge tone="warning">{t('teamMemberNoTwoFactor')}</StatusBadge>
                          )}
                        </td>
                      ) : null}
                      {canManageTeam ? (
                        <td className="ws-row-actions">
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="sm"
                            onClick={() =>
                              confirm({
                                title: t('removeMemberConfirmTitle').replace('{name}', member.username),
                                description: t('removeMemberConfirmBody'),
                                confirmLabel: t('remove'),
                                onConfirm: () => removeMemberMutation.mutate(member.userId),
                              })
                            }
                          >
                            {t('remove')}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {updateMemberMutation.error || removeMemberMutation.error ? (
          <p className="text-danger" role="alert">
            {((updateMemberMutation.error ?? removeMemberMutation.error) as Error).message}
          </p>
        ) : null}
      </section>

      <section className="ws-detail-block" aria-labelledby="team-websites-title">
        <div className="ws-detail-block-head">
          <h3 id="team-websites-title" className="card-title">
            {t('websites')}
          </h3>
          {canManageTeam ? (
            <Button type="button" variant="outline" size="sm" disabled={!teamsAllowed} onClick={() => setAddingSite(true)}>
              <Plus aria-hidden />
              {t('addWebsite')}
            </Button>
          ) : null}
        </div>
        {websites.length ? (
          <ul className="ws-plain-rows">
            {websites.map((site) => (
              <li key={site.id}>
                <Link to={`/websites/${site.id}`} className="ws-cell-link">
                  <SiteIdentity name={site.name} domain={site.domain} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ws-muted-line">{t('noTeamWebsites')}</p>
        )}
      </section>

      {canManageTeam && detail?.accessCode ? (
        <section className="ws-detail-block" aria-labelledby="team-code-title">
          <div className="ws-detail-block-head">
            <h3 id="team-code-title" className="card-title">
              {t('accessCode')}
            </h3>
          </div>
          <div className="ws-code-row">
            <code className="ws-code-value">{detail.accessCode}</code>
            <CopyButton text={detail.accessCode} copiedLabel={t('accessCodeCopied')} variant="outline" />
          </div>
          <p className="ws-muted-line">{t('accessCodeHint')}</p>
        </section>
      ) : null}

      {canManageSecurity || requireTwoFactor ? (
        <section className="ws-detail-block" aria-labelledby="team-security-title">
          <div className="ws-detail-block-head">
            <h3 id="team-security-title" className="card-title">
              {t('teamSecurity')}
            </h3>
          </div>
          {canManageSecurity ? (
            <label className="ws-switch-row">
              <span className="ws-switch-row-copy">
                <span className="ws-switch-row-label">{t('teamRequireTwoFactor')}</span>
                <span className="ws-switch-row-hint">{t('teamRequireTwoFactorHint')}</span>
              </span>
              <Switch
                checked={requireTwoFactor}
                disabled={requireTwoFactorMutation.isPending || statusQuery.isLoading}
                onCheckedChange={(checked) => requireTwoFactorMutation.mutate(checked)}
              />
            </label>
          ) : (
            <p className="ws-muted-line">{t('teamRequiresTwoFactorInfo')}</p>
          )}
          {ownerNeedsTwoFactor ? (
            <p className="text-danger" role="alert">
              {t('teamRequireTwoFactorOwnerFirst')} <Link to="/account/security">{t('accountSecurity')}</Link>
            </p>
          ) : requireTwoFactorError ? (
            <p className="text-danger" role="alert">
              {(requireTwoFactorError as Error).message}
            </p>
          ) : null}
        </section>
      ) : null}

      {canManageMembers ? (
        <section className="ws-detail-block" aria-labelledby="team-activity-title">
          <div className="ws-detail-block-head">
            <div>
              <h3 id="team-activity-title" className="card-title">
                {t('teamActivity')}
              </h3>
              <p className="card-description">{t('teamActivityLead')}</p>
            </div>
          </div>
          <DataViewState
            loading={auditQuery.isLoading}
            error={auditQuery.isError ? auditQuery.error : null}
            onRetry={() => auditQuery.refetch()}
            loadingFallback={<Skeleton className="h-16 w-full" />}
          >
            {auditItems.length ? (
              <AuditLogTable entries={auditItems} showActor />
            ) : (
              <p className="ws-muted-line">{t('teamActivityEmpty')}</p>
            )}
          </DataViewState>
        </section>
      ) : null}

      {addingSite ? <AddTeamWebsiteDialog teamId={teamId} onClose={() => setAddingSite(false)} /> : null}
    </MasterDetailPane>
  );
}

export default function Teams() {
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null);

  const teamsQuery = useQuery({
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

  const createMutation = useMutation({
    mutationFn: (name: string) => api<Team>('/api/teams', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: (team) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      setSelectedTeamId(team.id);
      setDialog(null);
    },
  });

  const joinMutation = useMutation({
    mutationFn: (code: string) => api<Team>('/api/teams/join', { method: 'POST', body: JSON.stringify({ accessCode: code }) }),
    onSuccess: (team) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      if (team?.id) setSelectedTeamId(team.id);
      setDialog(null);
    },
  });

  const teams = teamsQuery.data ?? [];
  const selectedTeam = teams.find((team) => team.id === selectedTeamId);

  useEffect(() => {
    if (teams.length && !teams.some((team) => team.id === selectedTeamId)) setSelectedTeamId(teams[0]!.id);
  }, [teams, selectedTeamId]);

  const upgradeTitle = teamsAllowed ? undefined : t('teamsRequiresUpgrade');
  const joinButton = (
    <Button variant="outline" disabled={!teamsAllowed} title={upgradeTitle} onClick={() => setDialog('join')}>
      <Ticket aria-hidden />
      {t('joinTeam')}
    </Button>
  );
  const createButton = (
    <Button variant="primary" disabled={!teamsAllowed} title={upgradeTitle} onClick={() => setDialog('create')}>
      <UserPlus aria-hidden />
      {t('createTeam')}
    </Button>
  );

  return (
    <Page className="ws-page-teams">
      <PageHeader
        title={t('teams')}
        lead={t('teamsSubtitle')}
        actions={
          <div className="ws-header-controls">
            {joinButton}
            {createButton}
          </div>
        }
      />

      <PageBody className="stack">
        {!teamsAllowed && billingQuery.data ? <PlanUpgradeBanner message={t('teamsRequiresUpgrade')} /> : null}

        <DataViewState
          loading={teamsQuery.isLoading}
          error={teamsQuery.isError ? teamsQuery.error : null}
          onRetry={() => teamsQuery.refetch()}
          loadingFallback={
            <div className="master-detail-layout" aria-hidden>
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-80 w-full" />
            </div>
          }
        >
          {teams.length ? (
            <MasterDetailLayout
              listClassName="ws-md-list"
              listHeader={
                <span className="master-detail-list-count">
                  {t('workspaceTeamCount').replace('{count}', formatNumber(teams.length))}
                </span>
              }
              list={
                <>
                  {teams.map((team) => (
                    <MasterDetailListItem
                      key={team.id}
                      selected={selectedTeamId === team.id}
                      onSelect={() => setSelectedTeamId(team.id)}
                      icon={<UsersRound aria-hidden />}
                      title={team.name}
                      subtitle={formatTeamRole(team.role)}
                      meta={
                        team.requireTwoFactor ? (
                          <StatusBadge tone="success" dot={false}>
                            2FA
                          </StatusBadge>
                        ) : undefined
                      }
                    />
                  ))}
                </>
              }
              detail={
                selectedTeam ? (
                  <TeamPane key={selectedTeam.id} team={selectedTeam} teamsAllowed={teamsAllowed} />
                ) : (
                  <div className="master-detail-pane ws-pane-empty">
                    <EmptyState icon={<UsersRound />} title={t('selectTeamHint')} />
                  </div>
                )
              }
            />
          ) : (
            <EmptyState
              variant="rich"
              icon={<UsersRound />}
              title={t('noTeams')}
              description={t('noTeamsHint')}
              action={
                <>
                  {joinButton}
                  {createButton}
                </>
              }
            />
          )}
        </DataViewState>
      </PageBody>

      {dialog === 'create' ? (
        <SingleFieldDialog
          title={t('createTeam')}
          lead={t('workspaceCreateTeamLead')}
          label={t('teamName')}
          submitLabel={t('create')}
          pending={createMutation.isPending}
          error={createMutation.error}
          onSubmit={(name) => createMutation.mutate(name)}
          onClose={() => {
            createMutation.reset();
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'join' ? (
        <SingleFieldDialog
          title={t('joinWithCode')}
          lead={t('workspaceJoinTeamLead')}
          label={t('accessCode')}
          placeholder="a1b2c3d4"
          submitLabel={t('joinTeam')}
          pending={joinMutation.isPending}
          error={joinMutation.error}
          mono
          onSubmit={(code) => joinMutation.mutate(code)}
          onClose={() => {
            joinMutation.reset();
            setDialog(null);
          }}
        />
      ) : null}
    </Page>
  );
}
