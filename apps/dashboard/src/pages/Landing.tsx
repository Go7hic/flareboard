import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { DataClaritySection, HeroDashboardPreview } from '../components/landing/LandingCharts';
import { LandingPlanCard } from '../components/landing/LandingPlanCards';
import { LandingChrome } from '../components/landing/LandingChrome';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import {
  CLOUD_MONTHLY_USD,
  FLAREBOARD_DEPLOY_DOCS,
  FLAREBOARD_ENTERPRISE_EMAIL,
  FLAREBOARD_GITHUB,
  LANDING_PLANS,
  type LandingPlan,
} from '../lib/landing-links';

type AppConfig = {
  hosted?: boolean;
  registrationEnabled?: boolean;
  plans?: LandingPlan[];
};

const gaCompareKeys = [
  { titleKey: 'landingGaPrivacyTitle', bodyKey: 'landingGaPrivacyBody' },
  { titleKey: 'landingGaCookiesTitle', bodyKey: 'landingGaCookiesBody' },
  { titleKey: 'landingGaOwnTitle', bodyKey: 'landingGaOwnBody' },
  { titleKey: 'landingGaEdgeTitle', bodyKey: 'landingGaEdgeBody' },
] as const;

const stackKeys = [
  { titleKey: 'landingStackWorkers', bodyKey: 'landingStackWorkersBody', slug: 'cloudflareworkers' },
  { titleKey: 'landingStackQueues', bodyKey: 'landingStackQueuesBody', slug: 'cloudflare' },
  { titleKey: 'landingStackD1', bodyKey: 'landingStackD1Body', slug: 'cloudflare' },
  { titleKey: 'landingStackR2', bodyKey: 'landingStackR2Body', slug: 'cloudflare' },
  { titleKey: 'landingStackKv', bodyKey: 'landingStackKvBody', slug: 'cloudflare' },
] as const;

const featureKeys = [
  { titleKey: 'landingFeatureRealtimeTitle', bodyKey: 'landingFeatureRealtimeBody', variant: 'accent' },
  { titleKey: 'landingFeatureAdvancedTitle', bodyKey: 'landingFeatureAdvancedBody', variant: 'default' },
  { titleKey: 'landingFeatureReplayTitle', bodyKey: 'landingFeatureReplayBody', variant: 'default' },
  { titleKey: 'landingFeatureTeamsTitle', bodyKey: 'landingFeatureTeamsBody', variant: 'default' },
  { titleKey: 'landingFeatureCloudTitle', bodyKey: 'landingFeatureCloudBody', variant: 'highlight' },
  { titleKey: 'landingFeatureSelfHostTitle', bodyKey: 'landingFeatureSelfHostBody', variant: 'default' },
] as const;

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
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={i % 3 === 0 ? 1.8 : 1.2}
            className="landing-edge-node"
          />
        ))}
      </svg>
    </div>
  );
}

export default function Landing() {
  const [config, setConfig] = useState<AppConfig>({});
  const location = useLocation();

  useEffect(() => {
    api<AppConfig>('/api/config')
      .then((cfg) => setConfig(cfg))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const stateScroll = (location.state as { scrollTo?: string } | null)?.scrollTo;
    const hashId = location.hash.replace(/^#/, '');
    const targetId = stateScroll || hashId;
    if (!targetId) return;

    const el = document.getElementById(targetId);
    if (!el) return;

    requestAnimationFrame(() => {
      el.scrollIntoView();
    });
  }, [location.hash, location.state]);

  const startHref = config.registrationEnabled ? '/register' : '/login';
  const plans = (config.plans?.length ? config.plans : LANDING_PLANS).filter(
    (p) => p.id === 'free' || p.id === 'cloud',
  );
  const showCloudPaths = config.hosted !== false;

  return (
    <LandingChrome activeNav="home">
      <section className="landing-hero">
        <div className="landing-hero-copy landing-reveal">
          <p className="landing-hero-badge">
            <span className="landing-hero-badge-dot" aria-hidden />
            {t('landingHeroBadge')}
          </p>
          <h1 className="landing-headline">{t('landingHeadline')}</h1>
          <p className="landing-lead">{t('landingLead')}</p>
          <div className="landing-cta-row">
            <Button asChild variant="primary">
              <Link to={startHref}>{t('landingCreateFreeAccount')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <a href={FLAREBOARD_GITHUB} target="_blank" rel="noopener noreferrer">
                {t('landingViewGithub')}
              </a>
            </Button>
          </div>
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
            {gaCompareKeys.map((item) => (
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
                <Link to={startHref}>{t('landingPlanCloudCta')}</Link>
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
          {stackKeys.map((item) => (
            <li key={item.titleKey} className="landing-stack-card">
              <StackIcon slug={item.slug} />
              <div className="landing-stack-card-copy">
                <h3 className="landing-stack-card-title">{t(item.titleKey)}</h3>
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
          {featureKeys.map((f) => (
            <article key={f.titleKey} className={`landing-feature-card landing-feature-${f.variant}`}>
              <h3 className="landing-feature-title">{t(f.titleKey)}</h3>
              <p className="landing-feature-body">
                {f.bodyKey === 'landingFeatureCloudBody'
                  ? t(f.bodyKey).replace('{price}', String(CLOUD_MONTHLY_USD))
                  : t(f.bodyKey)}
              </p>
            </article>
          ))}
        </div>
        <div className="landing-features-cta">
          <Button asChild variant="secondary">
            <Link to="/compare">{t('compareViewAll')}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/features">{t('featuresViewAll')}</Link>
          </Button>
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
            <LandingPlanCard
              key={plan.id}
              plan={plan}
              featured={plan.id === 'cloud'}
              startHref={startHref}
            />
          ))}
        </div>

        <div className="landing-plans-cta">
          <Button asChild variant="secondary">
            <Link to="/pricing">{t('pricingViewAll')}</Link>
          </Button>
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
            <a href={`mailto:${FLAREBOARD_ENTERPRISE_EMAIL}?subject=Flareboard%20commercial%20license`}>
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
            <div className="landing-network-logos" aria-label={t('landingNetworkAria')}>
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
            <Link to={startHref}>{t('landingCreateFreeAccount')}</Link>
          </Button>
        </div>
      </section>
    </LandingChrome>
  );
}
