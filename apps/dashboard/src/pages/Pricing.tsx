import { Link } from 'react-router-dom';
import { LandingPlanCard } from '../components/landing/LandingPlanCards';
import { LandingChrome, useLandingStartHref } from '../components/landing/LandingChrome';
import { Button } from '../components/ui/button';
import { t } from '../lib/i18n';
import {
  FLAREBOARD_DEPLOY_DOCS,
  FLAREBOARD_ENTERPRISE_EMAIL,
  LANDING_PLANS,
} from '../lib/landing-links';
import { buildPricingCompareRows } from '../lib/pricing-comparison';

export default function Pricing() {
  const startHref = useLandingStartHref();
  const compareRows = buildPricingCompareRows();

  return (
    <LandingChrome activeNav="pricing">
      <div className="pricing-page">
        <header className="pricing-hero landing-reveal">
          <p className="landing-hero-badge">
            <span className="landing-hero-badge-dot" aria-hidden />
            {t('pricingPageBadge')}
          </p>
          <h1 className="landing-headline">{t('pricingPageTitle')}</h1>
          <p className="landing-lead pricing-hero-lead">
            {t('pricingPageLead')}{' '}
            <a href={FLAREBOARD_DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">
              {t('landingPathDeployGuide')}
            </a>
            .
          </p>
        </header>

        <section className="pricing-plans" aria-labelledby="pricing-plans-title">
          <h2 id="pricing-plans-title" className="visually-hidden">
            {t('landingPricingTitle')}
          </h2>
          <div className="landing-plans-row">
            {LANDING_PLANS.map((plan) => (
              <LandingPlanCard
                key={plan.id}
                plan={plan}
                featured={plan.id === 'cloud'}
                startHref={startHref}
              />
            ))}
          </div>

          <aside className="landing-plans-enterprise" aria-labelledby="pricing-enterprise-title">
            <div className="landing-plans-enterprise-copy">
              <p className="landing-plan-label">{t('landingEnterpriseLabel')}</p>
              <h3 id="pricing-enterprise-title" className="landing-plans-enterprise-title">
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

        <section
          className="pricing-compare landing-section landing-reveal-section"
          aria-labelledby="pricing-compare-title"
        >
          <h2 id="pricing-compare-title" className="landing-section-title pricing-compare-title">
            {t('pricingCompareTitle')}
          </h2>
          <div className="pricing-compare-wrap">
            <table className="pricing-compare-table">
              <caption className="visually-hidden">{t('pricingCompareAria')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('pricingCompareFeature')}</th>
                  <th scope="col">{t('pricingCompareFree')}</th>
                  <th scope="col">{t('pricingCompareCloud')}</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) =>
                  row.kind === 'section' ? (
                    <tr key={row.labelKey} className="pricing-compare-section">
                      <th scope="colgroup" colSpan={3}>
                        {t(row.labelKey)}
                      </th>
                    </tr>
                  ) : (
                    <tr key={row.labelKey}>
                      <th scope="row">{t(row.labelKey)}</th>
                      <td className="pricing-compare-plan">{row.free}</td>
                      <td
                        className={
                          row.cloudExclusive
                            ? 'pricing-compare-plan pricing-compare-cloud-exclusive'
                            : 'pricing-compare-plan'
                        }
                      >
                        {row.cloud}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <p className="pricing-self-host-note">
            {t('pricingSelfHostNote')}{' '}
            <a href={FLAREBOARD_DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">
              {t('landingPathDeployGuide')}
            </a>
            .
          </p>
        </section>

        <section className="landing-cta-band landing-reveal-section">
          <div className="landing-cta-inner">
            <h2 className="landing-cta-title">{t('pricingCtaTitle')}</h2>
            <p className="landing-cta-lead">{t('pricingCtaLead')}</p>
            <Button asChild variant="primary" size="lg" className="landing-cta-deploy">
              <Link to={startHref}>{t('pricingCtaButton')}</Link>
            </Button>
          </div>
        </section>
      </div>
    </LandingChrome>
  );
}
