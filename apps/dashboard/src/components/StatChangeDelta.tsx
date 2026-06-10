import { t } from '../lib/i18n';

export function statChangeDeltaClass(change: number) {
  if (change > 0) return 'positive';
  if (change < 0) return 'negative';
  return 'neutral';
}

export function StatChangeDelta({
  change,
  invertColors = false,
}: {
  change: number;
  invertColors?: boolean;
}) {
  const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '';
  const colorChange = invertColors ? -change : change;
  return (
    <div className={`stat-delta ${statChangeDeltaClass(colorChange)}`}>
      {arrow ? `${arrow} ` : ''}
      {Math.abs(change)}% {t('compareDeltaVsPrevious')}
    </div>
  );
}
