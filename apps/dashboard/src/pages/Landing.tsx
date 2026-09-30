import { ArrowRight, Check, Cookie, Database, Layers, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LandingCapabilities } from '../components/landing/LandingCapabilities';
import { LandingChrome } from '../components/landing/LandingChrome';
import { LandingHowItWorks } from '../components/landing/LandingHowItWorks';
import { LandingPlanCard, useLandingPlanActions } from '../components/landing/LandingPlanCards';
import { LandingProductPreview } from '../components/landing/LandingProductPreview';
import { Button } from '../components/ui/button';
import { BILLING_PLAN_IDS } from '../lib/api';
import { t } from '../lib/i18n';
import { FLAREBOARD_DEPLOY_DOCS, FLAREBOARD_ENTERPRISE_EMAIL, LANDING_PLANS } from '../lib/landing-links';
import { useAppConfig, useStartHref } from '../lib/useAppConfig';
import '../styles/landing-home.css';

const FACTS = [
  { valueKey: 'homeFactScriptValue', bodyKey: 'homeFactScriptBody' },
  { valueKey: 'homeFactCookiesValue', bodyKey: 'homeFactCookiesBody' },
  { valueKey: 'homeFactEdgeValue', bodyKey: 'homeFactEdgeBody' },
  { valueKey: 'homeFactCodeValue', bodyKey: 'homeFactCodeBody' },
];

const REASONS = [
  { icon: ShieldCheck, titleKey: 'homeWhyPrivacyTitle', bodyKey: 'homeWhyPrivacyBody' },
  { icon: Cookie, titleKey: 'homeWhyCookiesTitle', bodyKey: 'homeWhyCookiesBody' },
  { icon: Database, titleKey: 'homeWhyOwnTitle', bodyKey: 'homeWhyOwnBody' },
  { icon: Layers, titleKey: 'homeWhyToolsTitle', bodyKey: 'homeWhyToolsBody' },
];

const SELF_HOST_FEATURES = ['homeSelfHostFeatureAll', 'homeSelfHostFeatureStack', 'homeSelfHostFeatureLicense'];

const FAQ = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ q: `homeFaqQ${n}`, a: `homeFaqA${n}` }));

function useScrollToHash() {
  const location = useLocation();
  useEffect(() => {
    const stateScroll = (location.state as { scrollTo?: string } | null)?.scrollTo;
    const targetId = stateScroll || location.hash.replace(/^#/, '');
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (!el) return;
    requestAnimationFrame(() => el.scrollIntoView());
  }, [location.hash, location.state]);
}

function SectionHeader({ id, titleKey, leadKey }: { id: string; titleKey: string; leadKey: string }) {
  return (
    <header className="home-section-head">
      <h2 id={id} className="home-h2">
        {t(titleKey)}
      </h2>
      <p className="home-section-lead">{t(leadKey)}</p>
    </header>
  );
}

function SelfHostCard() {
  return (
    <article className="landing-plan-card home-selfhost-card">
      <div className="landing-plan-card-top">
        <p className="landing-plan-label">{t('landingSelfHost')}</p>
        <h3 className="landing-plan-name">{t('homeSelfHostName')}</h3>
        <p className="landing-plan-price">
          <span className="landing-plan-price-value">$0</span>
          <span className="landing-plan-price-period">{t('homeSelfHostPeriod')}</span>
        </p>
      </div>
      <p className="landing-plan-tagline">{t('homeSelfHostTagline')}</p>
      <ul className="landing-plan-features">
        {SELF_HOST_FEATURES.map((key) => (
          <li key={key}>
            <Check size={16} strokeWidth={1.75} aria-hidden />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <Button asChild variant="secondary" className="landing-plan-cta">
        <a href={FLAREBOARD_DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">
          {t('landingPathDeployGuide')}
        </a>
      </Button>
    </article>
  );
}

export default function Landing() {
  useScrollToHash();
  const config = useAppConfig();
  const startHref = useStartHref();
  const planActions = useLandingPlanActions();
  const plans = (config.plans?.length ? config.plans : LANDING_PLANS).filter((p) =>
    (BILLING_PLAN_IDS as readonly string[]).includes(p.id),
  );

  return (
    <LandingChrome activeNav="home">
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-container home-hero-copy">
          <a href="#product" className="home-eyebrow home-reveal">
            <span className="home-eyebrow-mark" aria-hidden />
            {t('homeHeroEyebrow')}
            <ArrowRight aria-hidden />
          </a>
          <h1 id="home-hero-title" className="home-h1 home-reveal">
            {t('homeHeroTitle')}
          </h1>
          <p className="home-hero-lead home-reveal">{t('homeHeroLead')}</p>
          <div className="home-hero-ctas home-reveal">
            <Button asChild variant="primary" size="lg" className="home-btn-lg">
              <Link to={startHref}>{t('landingCreateFreeAccount')}</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="home-btn-lg">
              <Link to="/demo">{t('homeHeroDemoCta')}</Link>
            </Button>
          </div>
        </div>
        <div className="home-hero-stage">
          <div className="home-container home-reveal home-reveal-late">
            <LandingProductPreview />
          </div>
        </div>
      </section>

      <section className="home-facts" aria-label={t('homeFactsAria')}>
        <dl className="home-container home-facts-grid">
          {FACTS.map((fact) => (
            <div key={fact.valueKey} className="home-fact">
              <dt className="home-fact-value">{t(fact.valueKey)}</dt>
              <dd className="home-fact-body">{t(fact.bodyKey)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="features" className="home-section" aria-labelledby="home-features-title">
        <div className="home-container">
          <SectionHeader id="home-features-title" titleKey="homeBentoTitle" leadKey="homeBentoLead" />
          <LandingCapabilities />
        </div>
      </section>

      <section id="product" className="home-section home-section-subtle" aria-labelledby="home-how-title">
        <div className="home-container">
          <SectionHeader id="home-how-title" titleKey="homeHowTitle" leadKey="homeHowLead" />
          <LandingHowItWorks />
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-why-title">
        <div className="home-container home-why">
          <div className="home-why-intro">
            <h2 id="home-why-title" className="home-h2">
              {t('homeWhyTitle')}
            </h2>
            <p className="home-section-lead">{t('homeWhyLead')}</p>
            <Link to="/compare" className="home-text-link">
              {t('compareViewAll')}
              <ArrowRight aria-hidden />
            </Link>
          </div>
          <ul className="home-why-grid">
            {REASONS.map(({ icon: Icon, titleKey, bodyKey }) => (
              <li key={titleKey} className="home-why-item">
                <span className="home-why-icon" aria-hidden>
                  <Icon />
                </span>
                <h3 className="home-why-title">{t(titleKey)}</h3>
                <p className="home-why-body">{t(bodyKey)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="pricing" className="home-section home-section-subtle" aria-labelledby="home-pricing-title">
        <div className="home-container">
          <SectionHeader id="home-pricing-title" titleKey="landingPricingTitle" leadKey="homePricingLead" />
          <div className="home-plans">
            {plans.map((plan) => (
              <LandingPlanCard
                key={plan.id}
                plan={plan}
                compact
                featured={plan.id === 'cloud'}
                startHref={startHref}
                isLoggedIn={planActions.isLoggedIn}
                isCheckoutPending={planActions.isCheckoutPending}
                checkoutError={planActions.checkoutError}
                checkoutPlanId={planActions.checkoutPlanId}
                onCheckout={planActions.startCheckout}
              />
            ))}
            <SelfHostCard />
          </div>
          <div className="home-enterprise">
            <div>
              <h3 className="home-enterprise-title">{t('landingEnterpriseTitle')}</h3>
              <p className="home-enterprise-body">{t('homeEnterpriseBody')}</p>
            </div>
            <div className="home-enterprise-actions">
              <Link to="/pricing" className="home-text-link">
                {t('pricingViewAll')}
                <ArrowRight aria-hidden />
              </Link>
              <Button asChild variant="outline">
                <a href={`mailto:${FLAREBOARD_ENTERPRISE_EMAIL}?subject=Flareboard%20commercial%20license`}>
                  {t('landingEnterpriseCta')}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-faq-title">
        <div className="home-container home-faq">
          <h2 id="home-faq-title" className="home-h2">
            {t('homeFaqTitle')}
          </h2>
          <div className="home-faq-list">
            {FAQ.map((item) => (
              <details key={item.q} className="home-faq-item">
                <summary>{t(item.q)}</summary>
                <p>{t(item.a)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="home-cta-section" aria-labelledby="home-cta-title">
        <div className="home-container">
          <div className="home-cta">
            <div>
              <h2 id="home-cta-title" className="home-h2">
                {t('homeCtaTitle')}
              </h2>
              <p className="home-section-lead">{t('homeCtaLead')}</p>
            </div>
            <div className="home-hero-ctas">
              <Button asChild variant="primary" size="lg" className="home-btn-lg">
                <Link to={startHref}>{t('landingCreateFreeAccount')}</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="home-btn-lg">
                <Link to="/demo">{t('homeHeroDemoCta')}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </LandingChrome>
  );
}
