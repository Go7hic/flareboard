import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { t } from '../../lib/i18n';
import { useChartColors } from '../../lib/useChartColors';
import { chartTooltipStyle } from '../../lib/chartStyles';

export const DEMO_PAGEVIEWS = [
  { x: 'Mon', y: 842 },
  { x: 'Tue', y: 1204 },
  { x: 'Wed', y: 986 },
  { x: 'Thu', y: 1456 },
  { x: 'Fri', y: 1320 },
  { x: 'Sat', y: 780 },
  { x: 'Sun', y: 914 },
];

export const DEMO_TOP_PAGES = [
  { path: '/', views: 4200 },
  { path: '/docs', views: 2840 },
  { path: '/pricing', views: 1620 },
  { path: '/blog', views: 980 },
];

export const DEMO_REFERRERS = [
  { name: 'google.com', pct: 42 },
  { name: 'news.ycombinator.com', pct: 18 },
  { name: 'github.com', pct: 14 },
  { name: 'Direct', pct: 26 },
];

function LandingLineChart({
  data,
  height,
  compact,
}: {
  data: { x: string; y: number }[];
  height: number;
  compact?: boolean;
}) {
  const chartColors = useChartColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={compact ? { top: 4, right: 4, left: -18, bottom: 0 } : { top: 8, right: 8, left: -8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} vertical={false} />
        <XAxis
          dataKey="x"
          tick={{ fontSize: compact ? 9 : 11, fill: chartColors.muted }}
          stroke={chartColors.border}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: compact ? 9 : 11, fill: chartColors.muted }}
          stroke={chartColors.border}
          tickLine={false}
          axisLine={false}
          width={compact ? 28 : 36}
        />
        <Tooltip contentStyle={chartTooltipStyle(chartColors, { fontSize: 12 })} />
        <Line type="monotone" dataKey="y" stroke={chartColors.accent} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function LandingBarChart({
  data,
  height,
  barColor,
}: {
  data: { path: string; views: number }[];
  height: number;
  barColor: string;
}) {
  const chartColors = useChartColors();
  const viewsLabel = t('landingChartTooltipViews');
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="path"
          width={52}
          tick={{ fontSize: 9, fill: chartColors.muted }}
          stroke={chartColors.border}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={chartTooltipStyle(chartColors, { fontSize: 12 })} formatter={(v) => [Number(v).toLocaleString(), viewsLabel]} />
        <Bar
          dataKey="views"
          fill={barColor}
          radius={[0, 4, 4, 0]}
          barSize={10}
          stroke="none"
          activeBar={{ fill: barColor, stroke: 'none', strokeWidth: 0 }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HeroDashboardPreview() {
  const chartColors = useChartColors();
  const heroStats = [
    { labelKey: 'pageviews', value: '12,506', primary: true },
    { labelKey: 'visitors', value: '3,842', primary: false },
    { labelKey: 'bounceRate', value: '38%', primary: false },
  ];

  return (
    <div className="landing-hero-dash" aria-label={t('landingHeroDashPreview')}>
      <div className="landing-hero-dash-chrome">
        <span className="landing-hero-dash-traffic" aria-hidden>
          <span className="landing-hero-dash-dot" />
          <span className="landing-hero-dash-dot" />
          <span className="landing-hero-dash-dot" />
        </span>
        <span className="landing-hero-dash-domain">docs.example.com</span>
        <span className="badge badge-accent landing-hero-dash-live">{t('landingHeroLive')}</span>
      </div>
      <div className="landing-hero-dash-stats">
        {heroStats.map((s) => (
          <div key={s.labelKey} className={`landing-hero-dash-stat${s.primary ? ' landing-hero-dash-stat-primary' : ''}`}>
            <span className="landing-hero-dash-stat-label">{t(s.labelKey)}</span>
            <span className="landing-hero-dash-stat-value">{s.value}</span>
          </div>
        ))}
      </div>
      <div className="landing-hero-dash-charts">
        <div className="landing-hero-dash-panel">
          <p className="landing-hero-dash-panel-title">{t('landingHeroPageviews7d')}</p>
          <div className="landing-hero-dash-chart">
            <LandingLineChart data={DEMO_PAGEVIEWS} height={108} compact />
          </div>
        </div>
        <div className="landing-hero-dash-panel">
          <p className="landing-hero-dash-panel-title">{t('landingHeroTopPages')}</p>
          <div className="landing-hero-dash-chart landing-hero-dash-chart-bar">
            <LandingBarChart data={DEMO_TOP_PAGES} height={108} barColor={chartColors.accent} />
          </div>
        </div>
      </div>
      <p className="landing-hero-dash-foot" aria-hidden>
        <span>{t('landingPipelineIngest')}</span>
        <span aria-hidden>→</span>
        <span>{t('landingPipelineBuffer')}</span>
        <span aria-hidden>→</span>
        <span>{t('landingPipelineStore')}</span>
        <span aria-hidden>→</span>
        <span className="landing-hero-dash-foot-accent">{t('landingPipelineDashboard')}</span>
      </p>
    </div>
  );
}

function ReferrerBars() {
  const max = Math.max(...DEMO_REFERRERS.map((r) => r.pct));
  return (
    <ul className="landing-data-referrer-list">
      {DEMO_REFERRERS.map((r) => (
        <li key={r.name} className="landing-data-referrer-row">
          <span className="landing-data-referrer-name">{r.name}</span>
          <span className="landing-data-referrer-track" aria-hidden>
            <span className="landing-data-referrer-fill" style={{ width: `${(r.pct / max) * 100}%` }} />
          </span>
          <span className="landing-data-referrer-pct">{r.pct}%</span>
        </li>
      ))}
    </ul>
  );
}

export function DataClaritySection() {
  const chartColors = useChartColors();

  return (
    <section
      className="landing-data landing-section landing-reveal-section"
      aria-labelledby="data-clarity-title"
    >
      <div className="landing-data-intro">
        <h2 id="data-clarity-title" className="landing-section-title">
          {t('landingDataTitle')}
        </h2>
        <p className="landing-section-lead">{t('landingDataLead')}</p>
      </div>
      <div className="landing-data-bento">
        <div className="landing-data-cell landing-data-cell-stat landing-data-cell-stat-wide">
          <span className="landing-data-stat-label">{t('landingDataStatPageviews7d')}</span>
          <span className="landing-data-stat-value">12,506</span>
          <span className="landing-data-stat-delta landing-data-stat-up">{t('landingDataStatDelta')}</span>
        </div>
        <div className="landing-data-cell landing-data-cell-stat">
          <span className="landing-data-stat-label">{t('visitors')}</span>
          <span className="landing-data-stat-value">3,842</span>
        </div>
        <div className="landing-data-cell landing-data-cell-stat">
          <span className="landing-data-stat-label">{t('landingDataStatAvgSession')}</span>
          <span className="landing-data-stat-value">2m 14s</span>
        </div>
        <div className="landing-data-cell landing-data-cell-stat landing-data-cell-stat-cf">
          <span className="landing-data-stat-label">{t('landingPipelineIngest')}</span>
          <span className="landing-data-stat-value landing-data-stat-mono">{t('landingDataStatActive')}</span>
        </div>

        <article className="landing-data-cell landing-data-cell-line panel">
          <h3 className="landing-data-panel-title">{t('pageviewsOverTime')}</h3>
          <div className="landing-data-chart landing-data-chart-tall">
            <LandingLineChart data={DEMO_PAGEVIEWS} height={220} />
          </div>
        </article>

        <article className="landing-data-cell landing-data-cell-bar panel">
          <h3 className="landing-data-panel-title">{t('landingHeroTopPages')}</h3>
          <div className="landing-data-chart landing-data-chart-tall">
            <LandingBarChart data={DEMO_TOP_PAGES} height={220} barColor={chartColors.accent} />
          </div>
        </article>

        <article className="landing-data-cell landing-data-cell-referrers panel">
          <h3 className="landing-data-panel-title">{t('landingDataReferrers')}</h3>
          <ReferrerBars />
        </article>

        <article className="landing-data-cell landing-data-cell-pages panel">
          <h3 className="landing-data-panel-title">{t('landingDataTrafficByPath')}</h3>
          <table className="landing-data-table">
            <thead>
              <tr>
                <th scope="col">{t('landingDataTablePath')}</th>
                <th scope="col">{t('landingDataTableViews')}</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_TOP_PAGES.map((row) => (
                <tr key={row.path}>
                  <td>
                    <code className="landing-data-path">{row.path}</code>
                  </td>
                  <td className="landing-data-table-num">{row.views.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </div>
    </section>
  );
}
