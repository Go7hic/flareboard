import { X } from 'lucide-react';
import { useMemo } from 'react';
import { EmptyState } from './EmptyState';
import { JourneyFlowColumns } from './JourneyFlowColumns';
import { SectionCard } from './SectionCard';
import { Button } from './ui/button';
import {
  getContiguousPrefix,
  hasJourneySelection,
  journeyMatchingVisits,
  type JourneyColumnSelection,
  type JourneyFlowResponse,
} from '../lib/journey-utils';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';

type JourneyFlowPanelProps = {
  data: JourneyFlowResponse;
  selectedColumns: JourneyColumnSelection;
  displayDepth: number;
  onSelectColumns: (selected: JourneyColumnSelection) => void;
  onClear: () => void;
  refetching?: boolean;
};

/** The path flow card: header with the selected path and its visits, then the step columns. */
export function JourneyFlowPanel({
  data,
  selectedColumns,
  displayDepth,
  onSelectColumns,
  onClear,
  refetching = false,
}: JourneyFlowPanelProps) {
  const hasSelection = hasJourneySelection(selectedColumns);
  const paths = data.paths ?? [];
  const matchingVisits = useMemo(
    () => (hasSelection ? journeyMatchingVisits(paths, selectedColumns) : data.total),
    [paths, data.total, hasSelection, selectedColumns],
  );
  const prefix = getContiguousPrefix(selectedColumns);
  const selectedSteps = prefix.length ? prefix : selectedColumns.filter((step): step is string => step !== null);

  const description = hasSelection ? (
    <span className="behavior-journey-path" title={selectedSteps.join(' → ')}>
      {selectedSteps.map((step, index) => (
        <span key={`${step}-${index}`}>
          {index > 0 ? <span className="behavior-journey-path-sep">→</span> : null}
          <span className="mono">{step}</span>
        </span>
      ))}
    </span>
  ) : (
    t('behaviorJourneyFlowLead')
      .replace('{visits}', formatNumber(data.total))
      .replace('{paths}', formatNumber(paths.length))
  );

  return (
    <SectionCard
      className={cn('behavior-journey-card', refetching && 'behavior-refetching')}
      title={hasSelection ? t('journeyCurrentPath') : t('behaviorJourneyFlowTitle')}
      description={description}
      actions={
        hasSelection ? (
          <>
            <span className="behavior-journey-matching">
              <strong>{formatNumber(matchingVisits)}</strong> {t('journeyMatchingVisits')}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onClear}>
              <X aria-hidden />
              {t('journeyClearSelection')}
            </Button>
          </>
        ) : undefined
      }
    >
      {paths.length ? (
        <JourneyFlowColumns
          paths={paths}
          maxDepth={displayDepth}
          selectedColumns={selectedColumns}
          onSelectColumn={onSelectColumns}
        />
      ) : (
        <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />
      )}
    </SectionCard>
  );
}
