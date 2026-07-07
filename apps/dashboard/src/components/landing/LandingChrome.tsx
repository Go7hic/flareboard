import { type MouseEvent, type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandLogo } from '../BrandLogo';
import { LanguageSelector } from '../LanguageSelector';
import { ThemeToggle } from '../ThemeToggle';
import { Button } from '../ui/button';
import { api, bootstrapSession, hasSession } from '../../lib/api';
import {
  FLAREBOARD_DEPLOY_DOCS,
  FLAREBOARD_GITHUB,
  FLAREBOARD_README,
} from '../../lib/landing-links';
import { t } from '../../lib/i18n';

type AppConfig = {
  registrationEnabled?: boolean;
};

type LandingChromeProps = {
  children: ReactNode;
  activeNav?: 'home' | 'features' | 'compare' | 'pricing';
};

type NavItem =
  | { kind: 'home'; labelKey: string; active?: boolean }
  | { kind: 'route'; href: string; labelKey: string; active?: boolean }
  | { kind: 'href'; href: string; labelKey: string; active?: boolean }
  | { kind: 'external'; href: string; labelKey: string };

function LandingNavLink({ item }: { item: NavItem }) {
  const location = useLocation();
  const navigate = useNavigate();
  const active = 'active' in item && item.active;
  const className = `shell-link${active ? ' active' : ''}`;

  if (item.kind === 'external') {
    return (
      <a
        href={item.href}
        className="shell-link"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t(item.labelKey)}
      </a>
    );
  }

  if (item.kind === 'href') {
    return (
      <a href={item.href} className={className}>
        {t(item.labelKey)}
      </a>
    );
  }

  if (item.kind === 'home') {
    function handleClick(e: MouseEvent<HTMLAnchorElement>) {
      if (location.pathname !== '/') return;

      e.preventDefault();
      if (location.hash) {
        navigate('/', { replace: true });
      }
      scrollLandingToTop();
    }

    return (
      <Link to="/" className={className} onClick={handleClick}>
        {t(item.labelKey)}
      </Link>
    );
  }

  return (
    <Link to={item.href} className={className}>
      {t(item.labelKey)}
    </Link>
  );
}

function scrollLandingToTop() {
  requestAnimationFrame(() => {
    const hero = document.querySelector('.landing-hero');
    if (hero) {
      hero.scrollIntoView();
    } else {
      window.scrollTo({ top: 0 });
    }
  });
}

function LandingBrandLink({ className }: { className?: string }) {
  const location = useLocation();
  const navigate = useNavigate();

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (location.pathname !== '/') return;

    e.preventDefault();
    if (location.hash) {
      navigate('/', { replace: true });
    }
    scrollLandingToTop();
  }

  return (
    <Link to="/" className={className} onClick={handleClick}>
      <BrandLogo />
    </Link>
  );
}

export function LandingChrome({ children, activeNav = 'home' }: LandingChromeProps) {
  const [config, setConfig] = useState<AppConfig>({});
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    api<AppConfig>('/api/config')
      .then((cfg) => setConfig(cfg))
      .catch(() => {});
    void bootstrapSession().then(setIsLoggedIn);
  }, []);

  const startHref = config.registrationEnabled ? '/register' : '/login';

  const navItems: NavItem[] = [
    { kind: 'home', labelKey: 'landingNavHome', active: activeNav === 'home' },
    { kind: 'route', href: '/features', labelKey: 'landingNavFeatures', active: activeNav === 'features' },
    { kind: 'route', href: '/compare', labelKey: 'landingNavCompare', active: activeNav === 'compare' },
    { kind: 'route', href: '/pricing', labelKey: 'landingNavPricing', active: activeNav === 'pricing' },
    { kind: 'external', href: '/blog', labelKey: 'landingNavBlog' },
    { kind: 'external', href: FLAREBOARD_README, labelKey: 'landingNavDocs' },
  ];

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <LandingBrandLink className="shell-brand landing-brand" />
          <nav className="landing-nav-links shell-links" aria-label={t('landingNavAria')}>
            {navItems.map((item) => (
              <LandingNavLink key={item.labelKey} item={item} />
            ))}
          </nav>
          <div className="landing-nav-actions shell-nav-end">
            <LanguageSelector />
            <ThemeToggle />
            {isLoggedIn ? (
              <Button asChild variant="primary" size="sm">
                <Link to="/dashboard">{t('dashboard')}</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">{t('signIn')}</Link>
                </Button>
                <Button asChild variant="primary" size="sm">
                  <Link to={startHref}>{t('landingGetStarted')}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {children}

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <LandingBrandLink className="shell-brand" />
            <img
              src="/fable5.avif"
              alt="Fable 5 Verified"
              className="landing-footer-fable-badge"
              width={220}
              height={40}
              loading="lazy"
              decoding="async"
            />
          </div>
          <nav className="landing-footer-links" aria-label={t('landingFooterAria')}>
            <Link to="/features">{t('landingNavFeatures')}</Link>
            <Link to="/compare">{t('landingNavCompare')}</Link>
            <Link to="/pricing">{t('landingNavPricing')}</Link>
            <a href="/blog">{t('landingNavBlog')}</a>
            <Link to="/login">{t('signIn')}</Link>
            <Link to={startHref}>{t('landingGetStarted')}</Link>
            <a href={FLAREBOARD_GITHUB} target="_blank" rel="noopener noreferrer">
              {t('landingFooterGithub')}
            </a>
            <a href={FLAREBOARD_README} target="_blank" rel="noopener noreferrer">
              {t('landingNavDocs')}
            </a>
            <a href={FLAREBOARD_DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">
              {t('landingSelfHost')}
            </a>
          </nav>
          <p className="landing-footer-copy">{t('landingFooterCopy')}</p>
        </div>
      </footer>
    </div>
  );
}

export function useLandingStartHref() {
  const [startHref, setStartHref] = useState('/register');

  useEffect(() => {
    api<AppConfig>('/api/config')
      .then((cfg) => setStartHref(cfg.registrationEnabled ? '/register' : '/login'))
      .catch(() => {});
  }, []);

  return startHref;
}
