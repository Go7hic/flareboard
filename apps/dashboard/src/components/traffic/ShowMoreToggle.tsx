import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';

/** "View all 20" / "Show less" under a list that shows its first rows only. */
export function ShowMoreToggle({
  expanded,
  total,
  onToggle,
}: {
  expanded: boolean;
  total: number;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="card-footer-link traffic-show-more" onClick={onToggle} aria-expanded={expanded}>
      {expanded ? t('trafficShowLess') : `${t('chartViewAll')} ${formatNumber(total)}`}
      {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
    </button>
  );
}
