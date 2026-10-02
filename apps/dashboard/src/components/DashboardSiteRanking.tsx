import type { CSSProperties } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { SectionCard } from './SectionCard';
import { StatChangeDelta } from './StatChangeDelta';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { SiteIdentity } from './workspace/SiteIdentity';
import { Sparkline } from './workspace/Sparkline';
import { changePercent } from './workspace/workspace-format';

export type DashboardRankingSite = {
  id: string;
  name: string;
  domain?: string;
  pageviews: number;
  visitors: number;
  visits?: number;
  /** Pageviews per bucket of the selected range. */
  series: Array<{ x: string; y: number }>;
};

export type DashboardSiteTotals = { pageviews: number; visitors: number; visits?: number };

function hasTraffic(site: DashboardRankingSite) {
  return site.visitors > 0 || site.pageviews > 0;
}

/**
 * Websites on the dashboard home, ranked by visitors: one card per site with traffic (identity,
 * visitors / pageviews / visits with deltas, a pageviews sparkline), then the quiet sites as one
 * compact list with a link to their tracking setup.
 */
export function DashboardSiteRanking({
  sites,
  previous,
  deltasPending = false,
  siteCount,
}: {
  sites: DashboardRankingSite[];
  /** Same metrics for the previous period, by website id (undefined while loading). */
  previous?: Map<string, DashboardSiteTotals>;
  /** The previous period is still loading: show chip placeholders. */
  deltasPending?: boolean;
  siteCount: number;
}) {
  const active = sites
    .filter(hasTraffic)
    .sort((a, b) => b.visitors - a.visitors || b.pageviews - a.pageviews);
  const quiet = sites.filter((site) => !hasTraffic(site));
  const hidden = Math.max(0, siteCount - sites.length);

  return (
    <section className="ws-sites" aria-labelledby="ws-sites-title">
      <div className="ws-section-head">
        <h2 id="ws-sites-title" className="ws-section-title">
          {t('websites')}
          <span className="ws-section-count">{formatNumber(siteCount)}</span>
        </h2>
        <Link to="/websites" className="card-footer-link">
          {t('workspaceManageWebsites')}
          <ArrowRight aria-hidden />
        </Link>
      </div>

      {active.length ? (
        <div className="ws-site-grid">
          {active.map((site) => (
            <SiteCard key={site.id} site={site} previous={previous?.get(site.id)} deltasPending={deltasPending} />
          ))}
        </div>
      ) : null}

      {quiet.length ? (
        <SectionCard
          flush
          className="ws-quiet-sites"
          title={t('workspaceQuietSitesTitle')}
          description={t('workspaceQuietSitesLead')}
        >
          <ul className="ws-row-list">
            {quiet.map((site) => (
              <li key={site.id} className="ws-row">
                <Link to={`/websites/${site.id}`} className="ws-row-main">
                  <SiteIdentity name={site.name} domain={site.domain} size="sm" />
                </Link>
                <span className="ws-row-meta">{t('workspaceNoTraffic')}</span>
                <Button variant="ghost" size="sm" render={<Link to={`/websites/${site.id}/settings?setup=1`} />}>
                  {t('workspaceCheckTracking')}
                </Button>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {hidden > 0 ? (
        <p className="ws-section-note">
          {t('workspaceSitesHidden').replace('{shown}', formatNumber(sites.length)).replace('{total}', formatNumber(siteCount))}{' '}
          <Link to="/websites">{t('chartViewAll')}</Link>
        </p>
      ) : null}
    </section>
  );
}

function SiteCard({
  site,
  previous,
  deltasPending,
}: {
  site: DashboardRankingSite;
  previous?: DashboardSiteTotals;
  deltasPending: boolean;
}) {
  const colors = useChartColors();
  return (
    <Link to={`/websites/${site.id}`} className="ws-site-card">
      <div className="ws-site-card-head">
        <SiteIdentity name={site.name} domain={site.domain} />
        <ArrowUpRight className="ws-site-card-arrow" aria-hidden />
      </div>
      <div className="ws-site-card-metrics">
        <SiteMetric label={t('visitors')} value={site.visitors} previous={previous?.visitors} pending={deltasPending} />
        <SiteMetric
          label={t('pageviews')}
          value={site.pageviews}
          previous={previous?.pageviews}
          keyColor="var(--chart-pageviews)"
          pending={deltasPending}
        />
        <SiteMetric label={t('visits')} value={site.visits ?? 0} previous={previous?.visits} pending={deltasPending} />
      </div>
      <Sparkline
        className="ws-site-card-spark"
        values={site.series.map((point) => point.y)}
        color={colors.series.pageviews}
        height={44}
      />
    </Link>
  );
}

function SiteMetric({
  label,
  value,
  previous,
  keyColor,
  pending = false,
}: {
  label: string;
  value: number;
  previous?: number;
  /** Series key when the card's sparkline draws this metric. */
  keyColor?: string;
  pending?: boolean;
}) {
  const change = changePercent(value, previous);
  return (
    <div className="ws-site-metric">
      <span className="ws-site-metric-label">
        {keyColor ? <span className="ws-key" style={{ '--ws-key': keyColor } as CSSProperties} aria-hidden /> : null}
        {label}
      </span>
      <span className="ws-site-metric-value">{formatNumber(value)}</span>
      {pending ? (
        <Skeleton className="ws-delta-skeleton" />
      ) : change === undefined ? (
        <span className="ws-site-metric-delta-empty" aria-hidden />
      ) : (
        <StatChangeDelta change={change} />
      )}
    </div>
  );
}

/** Two card placeholders in the grid's final shape. */
export function DashboardSiteRankingSkeleton() {
  return (
    <div className="ws-site-grid" aria-hidden>
      {[0, 1].map((key) => (
        <div key={key} className="ws-site-card ws-site-card--skeleton">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="mt-5 h-14 w-full" />
          <Skeleton className="mt-4 h-10 w-full" />
        </div>
      ))}
    </div>
  );
}
