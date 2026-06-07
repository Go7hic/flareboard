import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from '../lib/api';
import { initLocaleFromConfig, t } from '../lib/i18n';
import { BrandLogo } from './BrandLogo';
import { LanguageSelector } from './LanguageSelector';
import { ThemeToggle } from './ThemeToggle';
import { Button } from './ui/button';

const navItems = [
  { to: '/dashboard', labelKey: 'dashboard' },
  { to: '/websites', labelKey: 'websites', end: true },
  { to: '/teams', labelKey: 'teams' },
  { to: '/links', labelKey: 'links' },
  { to: '/reports', labelKey: 'reports' },
  { to: '/boards', labelKey: 'boards' },
  { to: '/admin', labelKey: 'admin' },
  { to: '/billing', labelKey: 'billing', hostedOnly: true },
] as const;

export function AppShell() {
  const navigate = useNavigate();
  const [hosted, setHosted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  useEffect(() => {
    api<{ locale?: string; hosted?: boolean; role?: string }>('/api/config')
      .then((cfg) => {
        if (cfg.locale) initLocaleFromConfig(cfg.locale);
        setHosted(Boolean(cfg.hosted));
        setIsAdmin(cfg.role === 'admin');
      })
      .catch(() => {});
  }, []);

  function logout() {
    setToken(null);
    navigate('/login');
  }

  return (
    <div className="shell">
      <header className="shell-nav">
        <Link to="/websites" className="shell-brand">
          <BrandLogo />
        </Link>
        <nav className="shell-links" aria-label="Main">
          {navItems
            .filter((item) => {
              if (item.to === '/admin' && !isAdmin) return false;
              if ('hostedOnly' in item && item.hostedOnly && !hosted) return false;
              return true;
            })
            .map(({ to, labelKey, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest ? rest.end : false}
              className={({ isActive }) => `shell-link${isActive ? ' active' : ''}`}
            >
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="shell-nav-end">
          <LanguageSelector />
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link to="/">{t('marketingHome')}</Link>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="shell-logout" onClick={logout}>
            {t('logout')}
          </Button>
        </div>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
