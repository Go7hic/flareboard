import { Link } from 'react-router-dom';
import { LandingChrome, useLandingStartHref } from '../components/landing/LandingChrome';
import { Button } from '../components/ui/button';
import { FEATURE_CATEGORIES } from '../lib/features-catalog';
import { t } from '../lib/i18n';

export default function Features() {
  const startHref = useLandingStartHref();

  return (
    <LandingChrome activeNav="features">
      <div className="features-page">
        <header className="features-hero landing-reveal">
          <p className="landing-hero-badge">
            <span className="landing-hero-badge-dot" aria-hidden />
            {t('featuresPageBadge')}
          </p>
          <h1 className="landing-headline">{t('featuresPageTitle')}</h1>
          <p className="landing-lead features-hero-lead">{t('featuresPageLead')}</p>
        </header>

        <nav className="features-jump" aria-label={t('featuresJumpNavAria')}>
          <ul className="features-jump-list">
            {FEATURE_CATEGORIES.map((cat) => (
              <li key={cat.id}>
                <a href={`#${cat.id}`} className="features-jump-link">
                  {t(cat.titleKey)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="features-body">
          {FEATURE_CATEGORIES.map((category) => (
            <section
              key={category.id}
              id={category.id}
              className="features-category landing-section landing-reveal-section"
              aria-labelledby={`${category.id}-title`}
            >
              <h2 id={`${category.id}-title`} className="features-category-title">
                {t(category.titleKey)}
              </h2>
              <ul className="features-category-grid">
                {category.items.map((item) => (
                  <li key={item.titleKey}>
                    <article className="landing-feature-card">
                      <h3 className="landing-feature-title">{t(item.titleKey)}</h3>
                      <p className="landing-feature-body">{t(item.bodyKey)}</p>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="landing-cta-band landing-reveal-section">
          <div className="landing-cta-inner">
            <h2 className="landing-cta-title">{t('featuresCtaTitle')}</h2>
            <p className="landing-cta-lead">{t('featuresCtaLead')}</p>
            <Button asChild variant="primary" size="lg" className="landing-cta-deploy">
              <Link to={startHref}>{t('featuresCtaButton')}</Link>
            </Button>
          </div>
        </section>
      </div>
    </LandingChrome>
  );
}
