import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import {
  CloudflarePipeline,
  DataClaritySection,
  HeroDashboardPreview,
} from '../components/landing/LandingCharts';
import { ThemeToggle } from '../components/ThemeToggle';
import { Button } from '../components/ui/button';
import { api, getToken } from '../lib/api';
import { t } from '../lib/i18n';
import {
  CLOUD_MONTHLY_USD,
  CLOUD_ORIGINAL_MONTHLY_USD,
  CLOUD_PROMO_LABEL,
  FLAREBOARD_DEPLOY_DOCS,
  FLAREBOARD_ENTERPRISE_EMAIL,
  FLAREBOARD_GITHUB,
  FLAREBOARD_README,
  formatEventLimit,
  LANDING_PLANS,
  type LandingPlan,
} from '../lib/landing-links';

type AppConfig = {
  hosted?: boolean;
  registrationEnabled?: boolean;
  plans?: LandingPlan[];
};

const landingNav = [
  { href: '#product', labelKey: 'landingNavProduct' as const },
  { href: '#features', labelKey: 'landingNavFeatures' as const },
  { href: '#pricing', labelKey: 'landingNavPricing' as const },
  { href: FLAREBOARD_README, labelKey: 'landingNavDocs' as const, external: true },
] as const;

const gaCompare = [
  { titleKey: 'landingGaPrivacyTitle' as const, bodyKey: 'landingGaPrivacyBody' as const },
  { titleKey: 'landingGaCookiesTitle' as const, bodyKey: 'landingGaCookiesBody' as const },
  { titleKey: 'landingGaOwnTitle' as const, bodyKey: 'landingGaOwnBody' as const },
  { titleKey: 'landingGaEdgeTitle' as const, bodyKey: 'landingGaEdgeBody' as const },
];

const stack = [
  { nameKey: 'landingStackWorkers' as const, bodyKey: 'landingStackWorkersBody' as const, slug: 'cloudflareworkers' },
  { nameKey: 'landingStackQueues' as const, bodyKey: 'landingStackQueuesBody' as const, slug: 'cloudflare' },
  { nameKey: 'landingStackD1' as const, bodyKey: 'landingStackD1Body' as const, slug: 'cloudflare' },
  { nameKey: 'landingStackR2' as const, bodyKey: 'landingStackR2Body' as const, slug: 'cloudflare' },
  { nameKey: 'landingStackKv' as const, bodyKey: 'landingStackKvBody' as const, slug: 'cloudflare' },
];

const features = [
  { titleKey: 'landingFeatureRealtimeTitle' as const, bodyKey: 'landingFeatureRealtimeBody' as const, variant: 'accent' },
  { titleKey: 'landingFeatureAdvancedTitle' as const, bodyKey: 'landingFeatureAdvancedBody' as const, variant: 'default' },
  { titleKey: 'landingFeatureReplayTitle' as const, bodyKey: 'landingFeatureReplayBody' as const, variant: 'default' },
  { titleKey: 'landingFeatureTeamsTitle' as const, bodyKey: 'landingFeatureTeamsBody' as const, variant: 'default' },
  { titleKey: 'landingFeatureCloudTitle' as const, bodyKey: 'landingFeatureCloudBody' as const, variant: 'highlight' },
  { titleKey: 'landingFeatureSelfHostTitle' as const, bodyKey: 'landingFeatureSelfHostBody' as const, variant: 'default' },
];

function StackIcon({ slug }: { slug: string }) {
  return (
    <img
      src={`https://cdn.simpleicons.org/${slug}/F38020`}
      alt=""
      width={28}
      height={28}
      className="landing-stack-icon"
      loading="lazy"
    />
  );
}

function EdgeMap() {
  const nodes = [
    [12, 18],
    [28, 12],
    [45, 22],
    [62, 8],
    [78, 20],
    [88, 14],
    [22, 38],
    [38, 42],
    [55, 35],
    [72, 48],
    [15, 58],
    [48, 62],
    [65, 55],
    [82, 68],
    [35, 72],
  ];

  return (
    <div className="landing-edge-map" aria-hidden>
      <svg viewBox="0 0 100 80" className="landing-edge-map-svg" preserveAspectRatio="none">
        <path
          d="M12,18 Q40,8 62,8 T88,14 M22,38 Q48,28 72,48 M15,58 Q48,65 82,68"
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth="0.4"
          strokeDasharray="2 3"
          opacity="0.65"
          className="landing-edge-path"
        />
        {nodes.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={i % 3 === 0 ? 1.8 : 1.2} className="landing-edge-node" />
        ))}
      </svg>
    </div>
  );
}

function PlanCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function planFeatureLines(plan: LandingPlan): string[] {
  return [
    `${plan.maxWebsites} website${plan.maxWebsites > 1 ? 's' : ''}`,
    `${formatEventLimit(plan.maxEventsPerMonth)} events per month`,
    plan.replayEnabled ? t('landingPlanReplayIncluded') : t('landingPlanReplayExcluded'),
    t('landingPlanFeaturesShared'),
  ];
}

function PlanCard({
  plan,
  featured,
  startHref,
}: {
  plan: LandingPlan;
  featured?: boolean;
  startHref: string;
}) {
  const priceUsd = plan.monthlyPriceUsd ?? (plan.id === 'cloud' ? CLOUD_MONTHLY_USD : 0);
  const tagline = plan.id === 'cloud' ? t('landingPlanCloudTagline') : t('landingPlanFreeTagline');
  const ctaLabel = plan.id === 'free' ? t('landingPlanFreeCta') : t('landingPlanCloudCta');

  return (
    <article className={`landing-plan-card${featured ? ' landing-plan-card-featured' : ''}`}>
      {featured ? <p className="landing-plan-badge">{t('landingPlanRecommended')}</p> : null}
      <div className="landing-plan-card-top">
        <p className="landing-plan-label">
          {plan.id === 'cloud' ? t('landingPlanPaidLabel') : t('landingPlanFreeLabel')}
        </p>
        <h3 className="landing-plan-name">{plan.name}</h3>
        <p
          className="landing-plan-price"
          aria-label={
            plan.id === 'cloud'
              ? `${priceUsd} dollars per month, limited-time launch pricing, regularly ${CLOUD_ORIGINAL_MONTHLY_USD} dollars per month`
              : `${priceUsd} dollars per month`
          }
        >
          {plan.id === 'cloud' ? (
            <>
              <span className="promo-price">
                <span className="promo-price-original" aria-hidden="true">
                  ${CLOUD_ORIGINAL_MONTHLY_USD}
                </span>
                <span className="landing-plan-price-value">${priceUsd}</span>
              </span>
              <span className="landing-plan-price-period">{t('landingPlanPerMonth')}</span>
              <span className="promo-price-label">{CLOUD_PROMO_LABEL}</span>
            </>
          ) : (
            <>
              <span className="landing-plan-price-value">$0</span>
              <span className="landing-plan-price-period">{t('landingPlanPerMonth')}</span>
            </>
          )}
        </p>
      </div>
      <p className="landing-plan-tagline">{tagline}</p>
      <ul className="landing-plan-features">
        {planFeatureLines(plan).map((line) => (
          <li key={line}>
            <PlanCheckIcon />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <Button asChild variant={featured ? 'primary' : 'secondary'} className="landing-plan-cta">
        <Link to={startHref}>{ctaLabel}</Link>
      </Button>
    </article>
  );
}

export default function Landing() {
  const [config, setConfig] = useState<AppConfig>({});
  const isLoggedIn = Boolean(getToken());

  useEffect(() => {
    api<AppConfig>('/api/config')
      .then((cfg) => setConfig(cfg))
      .catch(() => {});
  }, []);

  const startHref = config.registrationEnabled ? '/register' : '/login';
  const plans = (config.plans?.length ? config.plans : LANDING_PLANS).filter(
    (p) => p.id === 'free' || p.id === 'cloud',
  );
  const showCloudPaths = config.hosted !== false;

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link to="/" className="shell-brand landing-brand">
            <BrandLogo />
          </Link>
          <nav className="landing-nav-links shell-links" aria-label="Page">
            {landingNav.map((item) =>
              'external' in item && item.external ? (
                <a
                  key={item.labelKey}
                  href={item.href}
                  className="shell-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t(item.labelKey)}
                </a>
              ) : (
                <a key={item.labelKey} href={item.href} className="shell-link">
                  {t(item.labelKey)}
                </a>
              ),
            )}
          </nav>
          <div className="landing-nav-actions shell-nav-end">
            <ThemeToggle />
            {isLoggedIn ? (
              <Button asChild variant="primary" size="sm">
                <Link to="/websites">{t('dashboard')}</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">{t('landingSignIn')}</Link>
                </Button>
                <Button asChild variant="primary" size="sm">
                  <Link to={startHref}>{t('landingGetStarted')}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy landing-reveal">
          <p className="landing-hero-badge">
            <span className="landing-hero-badge-dot" aria-hidden />
            {t('landingBadge')}
          </p>
          <p className="landing-hero-subbadge">{t('landingHeroBadge')}</p>
          <h1 className="landing-headline">{t('landingHeadline')}</h1>
          <p className="landing-lead">{t('landingLead')}</p>
          <div className="landing-cta-row">
            <Button asChild variant="primary">
              <Link to={startHref}>{t('landingGetStarted')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <a href={FLAREBOARD_GITHUB} target="_blank" rel="noopener noreferrer">
                {t('landingViewGithub')}
              </a>
            </Button>
          </div>
          <CloudflarePipeline />
        </div>
        <div className="landing-hero-visual landing-reveal landing-reveal-delay">
          <HeroDashboardPreview />
        </div>
      </section>

      <section className="landing-compare landing-section landing-reveal-section" aria-labelledby="compare-title">
        <div className="landing-compare-inner">
          <h2 id="compare-title" className="landing-compare-title">
            {t('landingCompareTitle')}
          </h2>
          <ul className="landing-compare-grid">
            {gaCompare.map((item) => (
              <li key={item.titleKey} className="landing-compare-item">
                <h3 className="landing-compare-item-title">{t(item.titleKey)}</h3>
                <p className="landing-compare-item-body">{t(item.bodyKey)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <DataClaritySection />

      {showCloudPaths ? (
        <section className="landing-paths landing-section landing-reveal-section" aria-labelledby="paths-title">
          <div className="landing-section-intro">
            <h2 id="paths-title" className="landing-section-title">
              {t('landingPathsTitle')}
            </h2>
            <p className="landing-section-lead">{t('landingPathsLead')}</p>
          </div>
          <div className="landing-path-grid">
            <article className="landing-path-card landing-path-cloud">
              <h3 className="landing-path-title">{t('landingPathCloudTitle')}</h3>
              <p className="landing-path-body">{t('landingPathCloudBody')}</p>
              <Button asChild variant="primary">
                <Link to={startHref}>{t('landingGetStarted')}</Link>
              </Button>
            </article>
            <article className="landing-path-card">
              <h3 className="landing-path-title">{t('landingPathSelfTitle')}</h3>
              <p className="landing-path-body">{t('landingPathSelfBody')}</p>
              <Button asChild variant="secondary">
                <a href={FLAREBOARD_DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">
                  {t('landingPathDeployGuide')}
                </a>
              </Button>
            </article>
          </div>
        </section>
      ) : null}

      <section
        id="product"
        className="landing-stack-section landing-section landing-reveal-section"
        aria-labelledby="stack-title"
      >
        <div className="landing-stack-header">
          <h2 id="stack-title" className="landing-section-title">
            {t('landingStackTitle')}
          </h2>
          <p className="landing-section-lead">{t('landingStackLead')}</p>
        </div>
        <ul className="landing-stack-grid">
          {stack.map((item) => (
            <li key={item.nameKey} className="landing-stack-card">
              <StackIcon slug={item.slug} />
              <div className="landing-stack-card-copy">
                <h3 className="landing-stack-card-title">{t(item.nameKey)}</h3>
                <p className="landing-stack-card-body">{t(item.bodyKey)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="features"
        className="landing-features landing-section landing-reveal-section"
        aria-labelledby="features-title"
      >
        <div className="landing-section-intro">
          <h2 id="features-title" className="landing-section-title">
            {t('landingFeaturesTitle')}
          </h2>
        </div>
        <div className="landing-feature-grid landing-feature-grid-6">
          {features.map((f) => (
            <article key={f.titleKey} className={`landing-feature-card landing-feature-${f.variant}`}>
              <h3 className="landing-feature-title">{t(f.titleKey)}</h3>
              <p className="landing-feature-body">
                {f.titleKey === 'landingFeatureCloudTitle'
                  ? `${t(f.bodyKey)} ($${CLOUD_MONTHLY_USD}/mo).`
                  : t(f.bodyKey)}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section
        id="pricing"
        className="landing-plans landing-section landing-reveal-section"
        aria-labelledby="pricing-title"
      >
        <div className="landing-plans-header">
          <h2 id="pricing-title" className="landing-section-title">
            {t('landingPricingTitle')}
          </h2>
          <p className="landing-section-lead landing-plans-lead">
            {t('landingPricingLead')}{' '}
            <a href={FLAREBOARD_DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">
              {t('landingPathDeployGuide')}
            </a>
            .
          </p>
        </div>

        <div className="landing-plans-row">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} featured={plan.id === 'cloud'} startHref={startHref} />
          ))}
        </div>

        <aside className="landing-plans-enterprise" aria-labelledby="enterprise-title">
          <div className="landing-plans-enterprise-copy">
            <p className="landing-plan-label">{t('landingEnterpriseLabel')}</p>
            <h3 id="enterprise-title" className="landing-plans-enterprise-title">
              {t('landingEnterpriseTitle')}
            </h3>
            <p className="landing-plans-enterprise-body">{t('landingEnterpriseBody')}</p>
          </div>
          <Button asChild variant="secondary" className="landing-plans-enterprise-cta">
            <a href={`mailto:${FLAREBOARD_ENTERPRISE_EMAIL}?subject=Flareboard%20enterprise%20deploy`}>
              {t('landingEnterpriseCta')}
            </a>
          </Button>
        </aside>
      </section>

      <section className="landing-network landing-reveal-section" aria-labelledby="network-title">
        <div className="landing-network-inner">
          <div className="landing-network-copy">
            <h2 id="network-title" className="landing-section-title">
              {t('landingNetworkTitle')}
            </h2>
            <p className="landing-section-lead">{t('landingNetworkLead')}</p>
            <div className="landing-network-logos" aria-label="Global network">
              <img
                src="https://cdn.simpleicons.org/cloudflare/F38020"
                alt=""
                width={120}
                height={32}
                className="landing-network-logo"
                loading="lazy"
              />
            </div>
          </div>
          <EdgeMap />
        </div>
      </section>

      <section className="landing-cta-band landing-reveal-section">
        <div className="landing-cta-inner">
          <h2 className="landing-cta-title">{t('landingCtaTitle')}</h2>
          <p className="landing-cta-lead">{t('landingCtaLead')}</p>
          <Button asChild variant="primary" size="lg" className="landing-cta-deploy">
            <Link to={startHref}>{t('landingCtaDeploy')}</Link>
          </Button>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <Link to="/" className="shell-brand">
            <BrandLogo />
          </Link>
          <nav className="landing-footer-links" aria-label="Footer">
            <Link to="/login">{t('landingSignIn')}</Link>
            <Link to={startHref}>{t('landingGetStarted')}</Link>
            <a href={FLAREBOARD_GITHUB} target="_blank" rel="noopener noreferrer">
              {t('github')}
            </a>
            <a href={FLAREBOARD_README} target="_blank" rel="noopener noreferrer">
              {t('landingCloudflareDocs')}
            </a>
            <a href={FLAREBOARD_DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">
              {t('landingPathDeployGuide')}
            </a>
          </nav>
          <p className="landing-footer-copy">{t('landingFooterCopy')}</p>
        </div>
      </footer>
    </div>
  );
}
