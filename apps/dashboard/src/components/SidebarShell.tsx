import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, bootstrapSession, hasSession, logoutSession, markDemoSession } from '../lib/api';
import { LazyRouteFallback } from './LazyRouteFallback';
import { t } from '../lib/i18n';
import { demoRedirectTarget, fetchMe, isDemoHiddenPath } from '../lib/useDemoSession';
import { AppSidebar } from './AppSidebar';
import { AppTopBar } from './AppTopBar';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { DemoSessionBanner } from './DemoSessionBanner';
import { Button } from './ui/button';
import '../styles/console-pages';

const SECURITY_PATH = '/account/security';

/** Teams that require 2FA the user cannot reach until they turn it on. Not dismissable. */
function TwoFactorRequiredNotice({ teams, onSecurityPage }: { teams: Array<{ id: string; name: string }>; onSecurityPage: boolean }) {
  const names = teams.map((team) => team.name).join(', ');
  const message = (teams.length === 1 ? t('twoFactorRequiredNotice') : t('twoFactorRequiredNoticeMany')).replace(
    '{team}',
    names,
  );
  return (
    <div className="two-factor-required-notice" role="status">
      <p className="two-factor-required-notice-text">{message}</p>
      {onSecurityPage ? null : (
        <Button variant="primary" size="sm" asChild>
          <Link to={SECURITY_PATH}>{t('twoFactorSetUp')}</Link>
        </Button>
      )}
    </div>
  );
}

export function SidebarShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [hosted, setHosted] = useState(false);
  const [oauthProviders, setOauthProviders] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  useEffect(() => {
    void bootstrapSession().then((ok) => {
      setSessionReady(true);
      if (!ok) navigate('/login');
    });
  }, [navigate]);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    enabled: sessionReady && hasSession(),
    staleTime: 60_000,
  });

  const isDemo = Boolean(meQuery.data?.isDemo);
  const userLabel = isDemo ? t('demoSessionUser') : meQuery.data?.username || t('username');
  const twoFactorRequiredBy = meQuery.data?.twoFactorRequiredBy ?? [];

  useEffect(() => {
    markDemoSession(isDemo);
  }, [isDemo]);

  useEffect(() => {
    api<{ hosted?: boolean; role?: string; oauth?: string[] }>('/api/config')
      .then((cfg) => {
        setHosted(Boolean(cfg.hosted));
        setIsAdmin(cfg.role === 'admin');
        setOauthProviders(cfg.oauth ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  async function logout() {
    await logoutSession();
    // Drop the previous account's cached websites/stats before anyone else signs in.
    queryClient.clear();
    navigate(isDemo ? '/' : '/login');
  }

  /** Ends the demo session first, so the new account does not start inside the demo. */
  async function leaveDemoFor(path: string) {
    await logoutSession();
    queryClient.clear();
    navigate(path);
  }

  async function afterAccountDeleted() {
    setDeleteAccountOpen(false);
    await logoutSession();
    queryClient.clear();
    navigate('/', { replace: true });
  }

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  if (!sessionReady) {
    return <LazyRouteFallback />;
  }

  // Credentials, billing and team pages have nothing a demo visitor can use.
  if (isDemo && isDemoHiddenPath(location.pathname)) {
    return <Navigate to={demoRedirectTarget(location.pathname)} replace />;
  }

  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">
        {t('skipToMain')}
      </a>
      <div className="shell-body">
        <AppSidebar
          hosted={hosted}
          isAdmin={isAdmin}
          isDemo={isDemo}
          mobileOpen={mobileNavOpen}
          userLabel={userLabel}
          oauthProviders={oauthProviders}
          onNavigate={closeMobileNav}
          onLogout={logout}
          onDeleteAccount={meQuery.data && !isDemo ? () => setDeleteAccountOpen(true) : undefined}
        />
        {mobileNavOpen ? (
          <button
            type="button"
            className="shell-sidebar-overlay"
            aria-label={t('closeNavigationMenu')}
            onClick={closeMobileNav}
          />
        ) : null}
        <div className="shell-content">
          <AppTopBar
            menuOpen={mobileNavOpen}
            onMenuToggle={() => setMobileNavOpen((open) => !open)}
          />
          {isDemo ? (
            <DemoSessionBanner
              // Registration is open on hosted installs only; elsewhere accounts come from an admin.
              onCreateAccount={() => void leaveDemoFor(hosted ? '/register?from=demo' : '/login')}
              onExit={() => void leaveDemoFor('/')}
            />
          ) : null}
          <main id="main-content" className="shell-main" tabIndex={-1}>
            <div className="shell-content-inner">
              {twoFactorRequiredBy.length ? (
                <TwoFactorRequiredNotice
                  teams={twoFactorRequiredBy}
                  onSecurityPage={location.pathname === SECURITY_PATH}
                />
              ) : null}
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      {meQuery.data && !isDemo ? (
        <DeleteAccountDialog
          open={deleteAccountOpen}
          onOpenChange={setDeleteAccountOpen}
          username={meQuery.data.username}
          passwordRequired={meQuery.data.passwordRequired !== false}
          onDeleted={() => void afterAccountDeleted()}
        />
      ) : null}
    </div>
  );
}
