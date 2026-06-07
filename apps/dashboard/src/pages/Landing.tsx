import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { DataClaritySection, HeroDashboardPreview } from '../components/landing/LandingCharts';
import { LandingChrome } from '../components/landing/LandingChrome';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
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

const gaCompare = [
  {
    title: 'Privacy by default',
    body: 'No cross-site tracking graph. Events stay in your account.',
  },
  {
    title: 'Skip cookie banners',
    body: 'Cookieless measurement means fewer consent modals and cleaner UX.',
  },
  {
    title: 'You own the data',
    body: 'Export, audit, and delete on your terms — especially when you self-host.',
  },
  {
    title: 'Edge speed',
    body: 'Collection runs close to visitors worldwide for fast, reliable measurement.',
  },
];

const stack = [
  {
    name: 'Edge Workers',
    slug: 'cloudflareworkers',
    role: 'Ingest collects events at the edge; API serves the dashboard, reports, and realtime streams.',
  },
  {
    name: 'Queues & aggregator',
    slug: 'cloudflare',
    role: 'Queues buffer spikes; the aggregator Worker batches writes into D1 and maintains rollups.',
  },
  {
    name: 'D1 database',
    slug: 'cloudflare',
    role: 'Sessions, events, reports, and daily rollups — SQLite at the edge.',
  },
  {
    name: 'R2 storage',
    slug: 'cloudflare',
    role: 'Session replay chunks in your bucket — not a third-party video stack.',
  },
  {
    name: 'KV cache',
    slug: 'cloudflare',
    role: 'Live visitor counters, rate limits, and cached API responses.',
  },
];

const features = [
  {
    title: 'Realtime dashboards',
    body: 'Active visitors and live sessions — paths, referrers, and countries over SSE when traffic is flowing.',
    variant: 'accent',
  },
  {
    title: 'Advanced reports',
    body: 'Funnel, retention, attribution, journeys, and web vitals without another BI tool.',
    variant: 'default',
  },
  {
    title: 'Session replay',
    body: 'rrweb recordings in your R2 bucket. Watch flows without shipping video to a vendor.',
    variant: 'default',
  },
  {
    title: 'Teams & share links',
    body: 'Collaborate on sites and publish read-only dashboards for stakeholders.',
    variant: 'default',
  },
  {
    title: 'Flareboard Cloud',
    body: `Start free, then upgrade to Cloud ($${CLOUD_MONTHLY_USD}/mo) for replay and higher limits.`,
    variant: 'highlight',
  },
  {
    title: 'Self-host on Cloudflare',
    body: 'Deploy ingest, API, aggregator, and dashboard on your account. Same product — you operate the data plane.',
    variant: 'default',
  },
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
    plan.replayEnabled ? 'Session replay included' : 'Session replay not included',
    'Reports, teams, and share links',
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
  const tagline =
    plan.id === 'cloud'
      ? 'For growing sites that need replay and higher volume.'
      : 'Try Flareboard with real traffic at no cost.';

  return (
    <article className={`landing-plan-card${featured ? ' landing-plan-card-featured' : ''}`}>
      {featured ? <p className="landing-plan-badge">Recommended</p> : null}
      <div className="landing-plan-card-top">
        <p className="landing-plan-label">{plan.id === 'cloud' ? 'Paid plan' : 'Free tier'}</p>
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
              <span className="landing-plan-price-period">per month</span>
              <span className="promo-price-label">{CLOUD_PROMO_LABEL}</span>
            </>
          ) : (
            <>
              <span className="landing-plan-price-value">$0</span>
              <span className="landing-plan-price-period">per month</span>
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
        <Link to={startHref}>{plan.id === 'free' ? 'Start free' : 'Create account'}</Link>
      </Button>
    </article>
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
            Cloudflare-native · Cloud or self-host
          </p>
          <h1 className="landing-headline">
            Privacy-first analytics on the edge
          </h1>
          <p className="landing-lead">
            The Google Analytics alternative on Workers, D1, KV, R2, and Queues.
            Run Flareboard Cloud or deploy on your own Cloudflare account.
          </p>
          <div className="landing-cta-row">
            <Button asChild variant="primary">
              <Link to={startHref}>Create free account</Link>
            </Button>
            <Button asChild variant="secondary">
              <a href={FLAREBOARD_GITHUB} target="_blank" rel="noopener noreferrer">
                View on GitHub
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
            Why not Google Analytics?
          </h2>
          <ul className="landing-compare-grid">
            {gaCompare.map((item) => (
              <li key={item.title} className="landing-compare-item">
                <h3 className="landing-compare-item-title">{item.title}</h3>
                <p className="landing-compare-item-body">{item.body}</p>
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
              Cloud or self-host
            </h2>
            <p className="landing-section-lead">
              Use Flareboard Cloud for the fastest start, or deploy the same codebase on your Cloudflare account.
            </p>
          </div>
          <div className="landing-path-grid">
            <article className="landing-path-card landing-path-cloud">
              <h3 className="landing-path-title">Flareboard Cloud</h3>
              <p className="landing-path-body">
                Register with email, add a website, paste the tracking snippet. Billing and limits are built in.
              </p>
              <Button asChild variant="primary">
                <Link to={startHref}>Create account</Link>
              </Button>
            </article>
            <article className="landing-path-card">
              <h3 className="landing-path-title">Self-host</h3>
              <p className="landing-path-body">
                Clone the repo, wire D1/KV/R2/Queues, and deploy four Workers. No subscription required.
              </p>
              <Button asChild variant="secondary">
                <a href={FLAREBOARD_DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">
                  Deployment guide
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
            How Flareboard works
          </h2>
          <p className="landing-section-lead">
            Not a bolt-on script to someone else&apos;s cloud. Every layer runs on Cloudflare products you can operate.
          </p>
        </div>
        <ul className="landing-stack-grid">
          {stack.map((item) => (
            <li key={item.name} className="landing-stack-card">
              <StackIcon slug={item.slug} />
              <div className="landing-stack-card-copy">
                <h3 className="landing-stack-card-title">{item.name}</h3>
                <p className="landing-stack-card-body">{item.role}</p>
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
            Analytics without vendor lock-in
          </h2>
        </div>
        <div className="landing-feature-grid landing-feature-grid-6">
          {features.map((f) => (
            <article key={f.title} className={`landing-feature-card landing-feature-${f.variant}`}>
              <h3 className="landing-feature-title">{f.title}</h3>
              <p className="landing-feature-body">{f.body}</p>
            </article>
          ))}
        </div>
        <div className="landing-features-cta">
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
            Pricing
          </h2>
          <p className="landing-section-lead landing-plans-lead">
            Start free on Flareboard Cloud. Upgrade when you need session replay and more volume.
            Self-host for noncommercial use anytime —{' '}
            <a href={FLAREBOARD_DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">
              deployment guide
            </a>
            .
          </p>
        </div>

        <div className="landing-plans-row">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              featured={plan.id === 'cloud'}
              startHref={startHref}
            />
          ))}
        </div>

        <aside className="landing-plans-enterprise" aria-labelledby="enterprise-title">
          <div className="landing-plans-enterprise-copy">
            <p className="landing-plan-label">Enterprise</p>
            <h3 id="enterprise-title" className="landing-plans-enterprise-title">
              Dedicated deploy on your Cloudflare account
            </h3>
            <p className="landing-plans-enterprise-body">
              We set up Workers, D1, KV, R2, and Queues in your org, migrate from existing analytics,
              and optionally stay on for support. Your data never leaves your account.
            </p>
          </div>
          <Button asChild variant="secondary" className="landing-plans-enterprise-cta">
            <a href={`mailto:${FLAREBOARD_ENTERPRISE_EMAIL}?subject=Flareboard%20enterprise%20deploy`}>
              Contact us
            </a>
          </Button>
        </aside>
      </section>

      <section className="landing-network landing-reveal-section" aria-labelledby="network-title">
        <div className="landing-network-inner">
          <div className="landing-network-copy">
            <h2 id="network-title" className="landing-section-title">
              Runs on a global edge network
            </h2>
            <p className="landing-section-lead">
              Ingest and API traffic hit the edge first. Your visitors get fast responses; your data stays on Cloudflare.
            </p>
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
          <h2 className="landing-cta-title">Get started in minutes</h2>
          <p className="landing-cta-lead">
            Create an account, add a site, paste one script tag. Your dashboard lights up as events arrive.
          </p>
          <Button asChild variant="primary" size="lg" className="landing-cta-deploy">
            <Link to={startHref}>Create free account</Link>
          </Button>
        </div>
      </section>

    </LandingChrome>
  );
}
