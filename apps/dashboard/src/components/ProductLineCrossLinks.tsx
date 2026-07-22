import { Link } from 'react-router-dom';
import { t } from '../lib/i18n';

type ProductLineSurface = 'insights' | 'boards' | 'reports';

export function ProductLineCrossLinks({ surface }: { surface: ProductLineSurface }) {
  if (surface === 'insights') {
    return (
      <p className="section-lead product-line-cross-links">
        {t('insightsCrossLinksBeforeBoards')}{' '}
        <Link to="/boards">{t('boards')}</Link>{' '}
        {t('insightsCrossLinksBeforeReports')}{' '}
        <Link to="/reports">{t('reports')}</Link>
        {t('insightsCrossLinksEnd')}
      </p>
    );
  }

  if (surface === 'boards') {
    return (
      <p className="section-lead product-line-cross-links">
        {t('boardsCrossLinksBeforeInsights')}{' '}
        <Link to="/insights">{t('insights')}</Link>{' '}
        {t('boardsCrossLinksBeforeReports')}{' '}
        <Link to="/reports">{t('reports')}</Link>
        {t('boardsCrossLinksEnd')}
      </p>
    );
  }

  return (
    <p className="section-lead product-line-cross-links">
      {t('reportsCrossLinksBeforeInsights')}{' '}
      <Link to="/insights">{t('insights')}</Link>{' '}
      {t('reportsCrossLinksBeforeBoards')}{' '}
      <Link to="/boards">{t('boards')}</Link>
      {t('reportsCrossLinksEnd')}
    </p>
  );
}
