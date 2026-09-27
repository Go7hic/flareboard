import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, bootstrapSession, hasSession, logoutSession } from '../lib/api';
import { LazyRouteFallback } from './LazyRouteFallback';
import { t } from '../lib/i18n';
import { AppSidebar } from './AppSidebar';
import { AppTopBar } from './AppTopBar';

type MeResponse = {
  username: string;
};

export function SidebarShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [hosted, setHosted] = useState(false);
  const [oauthProviders, setOauthProviders] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    void bootstrapSession().then((ok) => {
      setSessionReady(true);
      if (!ok) navigate('/login');
    });
  }, [navigate]);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/api/me'),
    enabled: sessionReady && hasSession(),
    staleTime: 60_000,
  });

  const userLabel = meQuery.data?.username || t('username');

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
    navigate('/login');
  }

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  if (!sessionReady) {
    return <LazyRouteFallback />;
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
          mobileOpen={mobileNavOpen}
          userLabel={userLabel}
          oauthProviders={oauthProviders}
          onNavigate={closeMobileNav}
          onLogout={logout}
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
          <main id="main-content" className="shell-main" tabIndex={-1}>
            <div className="shell-content-inner">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
