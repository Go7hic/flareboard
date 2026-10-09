import { type MouseEvent, type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandLogo } from '../BrandLogo';
import { LanguageSelector } from '../LanguageSelector';
import { ThemeToggle } from '../ThemeToggle';
import { Button } from '../ui/button';
import { bootstrapSession } from '../../lib/api';
import { docsUrl, FLAREBOARD_GITHUB } from '../../lib/landing-links';
import { t } from '../../lib/i18n';
import { useStartHref } from '../../lib/useAppConfig';

type LandingChromeProps = {
  children: ReactNode;
  activeNav?: 'home' | 'features' | 'compare' | 'pricing' | 'none';
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
  const startHref = useStartHref();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    void bootstrapSession().then(setIsLoggedIn);
  }, []);

  const navItems: NavItem[] = [
    { kind: 'home', labelKey: 'landingNavHome', active: activeNav === 'home' },
    { kind: 'route', href: '/features', labelKey: 'landingNavFeatures', active: activeNav === 'features' },
    { kind: 'route', href: '/compare', labelKey: 'landingNavCompare', active: activeNav === 'compare' },
    { kind: 'route', href: '/pricing', labelKey: 'landingNavPricing', active: activeNav === 'pricing' },
    { kind: 'external', href: '/blog', labelKey: 'landingNavBlog' },
    { kind: 'href', href: docsUrl(), labelKey: 'landingNavDocs' },
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
                <Button asChild variant="ghost" size="sm" className="landing-nav-signin">
                  <Link to="/login">{t('signIn')}</Link>
                </Button>
                <Button asChild variant="primary" size="sm">
                  <Link to={startHref}>{t('landingCreateFreeAccount')}</Link>
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
            <p className="landing-footer-copy">{t('landingFooterCopy')}</p>
          </div>
          <nav className="landing-footer-cols" aria-label={t('landingFooterAria')}>
            <div className="landing-footer-col">
              <p className="landing-footer-heading">{t('homeFooterProduct')}</p>
              <Link to="/features">{t('landingNavFeatures')}</Link>
              <Link to="/compare">{t('landingNavCompare')}</Link>
              <Link to="/pricing">{t('landingNavPricing')}</Link>
              <Link to="/demo">{t('homeFooterDemo')}</Link>
            </div>
            <div className="landing-footer-col">
              <p className="landing-footer-heading">{t('homeFooterResources')}</p>
              <a href={docsUrl()}>{t('landingNavDocs')}</a>
              <a href="/blog">{t('landingNavBlog')}</a>
              <a href={docsUrl('self-host/deploy')}>{t('landingSelfHost')}</a>
              <a href={FLAREBOARD_GITHUB} target="_blank" rel="noopener noreferrer">
                {t('landingFooterGithub')}
              </a>
            </div>
            <div className="landing-footer-col">
              <p className="landing-footer-heading">{t('homeFooterAccount')}</p>
              <Link to="/login">{t('signIn')}</Link>
              <Link to={startHref}>{t('landingCreateFreeAccount')}</Link>
            </div>
          </nav>
          <div className="landing-footer-legal">
            <span>© {new Date().getFullYear()} Flareboard</span>
            <nav className="landing-footer-legal-links" aria-label={t('termsOfService')}>
              <Link to="/terms">{t('termsOfService')}</Link>
              <Link to="/privacy">{t('privacyPolicy')}</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
