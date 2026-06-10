import { Link } from 'react-router-dom';
import { LandingChrome, useLandingStartHref } from '../components/landing/LandingChrome';
import { Button } from '../components/ui/button';
import { COMPARE_COMPETITORS, COMPARE_PILLARS } from '../lib/compare-catalog';
import { t } from '../lib/i18n';

function CompareCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="compare-check-icon">
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

export default function Compare() {
  const startHref = useLandingStartHref();

  return (
    <LandingChrome activeNav="compare">
      <div className="compare-page">
        <header className="compare-hero landing-reveal">
          <p className="landing-hero-badge">
            <span className="landing-hero-badge-dot" aria-hidden />
            {t('comparePageBadge')}
          </p>
          <h1 className="landing-headline">{t('comparePageTitle')}</h1>
          <p className="landing-lead compare-hero-lead">{t('comparePageLead')}</p>
        </header>

        <section className="compare-pillars landing-section landing-reveal-section" aria-labelledby="compare-pillars-title">
          <h2 id="compare-pillars-title" className="visually-hidden">
            {t('comparePillarsAria')}
          </h2>
          <ul className="compare-pillars-grid">
            {COMPARE_PILLARS.map((pillar) => (
              <li key={pillar.id}>
                <article className="landing-feature-card compare-pillar-card">
                  <h3 className="landing-feature-title">{t(pillar.titleKey)}</h3>
                  <p className="landing-feature-body">{t(pillar.bodyKey)}</p>
                </article>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="compare-grid-section landing-section landing-reveal-section"
          aria-labelledby="compare-grid-title"
        >
          <div className="compare-grid-head">
            <h2 id="compare-grid-title" className="landing-section-title">
              {t('compareGridTitle')}
            </h2>
            <p className="landing-section-lead compare-grid-lead">{t('compareGridLead')}</p>
          </div>

          <ul className="compare-cards-grid">
            {COMPARE_COMPETITORS.map((item) => (
              <li key={item.id} id={item.detailAnchor}>
                <article className="compare-card">
                  <h3 className="compare-card-title">{t(item.titleKey)}</h3>
                  <ul className="compare-card-bullets list-plain">
                    {item.bulletKeys.map((key) => (
                      <li key={key}>
                        <CompareCheckIcon />
                        <span>{t(key)}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/features" className="compare-card-link">
                    {t('compareCardFeaturesLink')}
                  </Link>
                </article>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-cta-band landing-reveal-section">
          <div className="landing-cta-inner">
            <h2 className="landing-cta-title">{t('compareCtaTitle')}</h2>
            <p className="landing-cta-lead">{t('compareCtaLead')}</p>
            <Button asChild variant="primary" size="lg" className="landing-cta-deploy">
              <Link to={startHref}>{t('compareCtaButton')}</Link>
            </Button>
          </div>
        </section>
      </div>
    </LandingChrome>
  );
}
