import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, getToken, setToken } from '../lib/api';
import { t } from '../lib/i18n';
import { AppSidebar } from './AppSidebar';
import { AppTopBar } from './AppTopBar';

type MeResponse = {
  username: string;
};

export function SidebarShell() {
  const navigate = useNavigate();
  const [hosted, setHosted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/api/me'),
    enabled: Boolean(getToken()),
    staleTime: 60_000,
  });

  const userLabel = meQuery.data?.username || t('username');

  useEffect(() => {
    api<{ hosted?: boolean; role?: string }>('/api/config')
      .then((cfg) => {
        setHosted(Boolean(cfg.hosted));
        setIsAdmin(cfg.role === 'admin');
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

  function logout() {
    setToken(null);
    navigate('/login');
  }

  function closeMobileNav() {
    setMobileNavOpen(false);
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
          onNavigate={closeMobileNav}
          onLogout={logout}
        />
        {mobileNavOpen ? (
          <button
            type="button"
            className="shell-sidebar-overlay"
            aria-label="Close navigation menu"
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
