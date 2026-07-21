import { useState } from 'react';
import { Link } from 'react-router-dom';
import { chartSeriesColor } from '../lib/chartStyles';
import { formatNumber } from '../lib/format';
import { WebsiteNameLabel } from './WebsiteNameLabel';
import { t } from '../lib/i18n';

const DEFAULT_VISIBLE = 8;

export type DashboardRankingSite = {
  id: string;
  name: string;
  domain?: string;
  pageviews: number;
  visitors: number;
};

export function DashboardSiteRanking({
  ranking,
  siteCount,
}: {
  ranking: DashboardRankingSite[];
  siteCount: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (ranking.length <= 1) return null;

  const hasHidden = ranking.length > DEFAULT_VISIBLE;
  const visible = expanded || !hasHidden ? ranking : ranking.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = ranking.length - DEFAULT_VISIBLE;

  return (
    <aside className="dashboard-site-ranking-panel" aria-labelledby="dashboard-ranking-title">
      <div className="dashboard-site-ranking-head">
        <h3 id="dashboard-ranking-title" className="dashboard-site-ranking-title">
          {t('dashboardRankingTop')}
        </h3>
        <p className="text-muted dashboard-aggregate-ranking-label">{t('dashboardPageviewsVisitors')}</p>
      </div>

      <ul className="dashboard-site-ranking list-plain">
        {visible.map((w, index) => (
          <li key={w.id}>
            <Link to={`/websites/${w.id}`} className="dashboard-site-ranking-item">
              <span
                className="dashboard-site-ranking-swatch"
                style={{ background: chartSeriesColor(index) }}
                aria-hidden
              />
              <WebsiteNameLabel
                name={w.name}
                domain={w.domain}
                className="dashboard-site-ranking-name"
                faviconSize={16}
              />
              <span className="dashboard-site-ranking-stats">
                {formatNumber(w.pageviews)} / {formatNumber(w.visitors)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {hasHidden ? (
        <button
          type="button"
          className="dashboard-site-ranking-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? t('dashboardRankingShowLess') : t('dashboardRankingShowMore').replace('{count}', String(hiddenCount))}
        </button>
      ) : null}

      {siteCount > ranking.length ? (
        <Link to="/websites" className="dashboard-site-ranking-all">
          {t('dashboardViewAllSites').replace('{count}', String(siteCount))}
        </Link>
      ) : null}
    </aside>
  );
}
