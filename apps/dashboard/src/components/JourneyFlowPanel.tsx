import { useMemo } from 'react';
import { EmptyState } from './EmptyState';
import { JourneyFlowColumns } from './JourneyFlowColumns';
import {
  hasJourneySelection,
  journeyMatchingVisits,
  type JourneyColumnSelection,
  type JourneyFlowResponse,
} from '../lib/journey-utils';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';

type JourneyFlowPanelProps = {
  data: JourneyFlowResponse;
  selectedColumns: JourneyColumnSelection;
  displayDepth: number;
  onSelectColumns: (selected: JourneyColumnSelection) => void;
  onClear: () => void;
};

export function JourneyFlowPanel({
  data,
  selectedColumns,
  displayDepth,
  onSelectColumns,
  onClear,
}: JourneyFlowPanelProps) {
  const hasSelection = hasJourneySelection(selectedColumns);
  const hasFlowData = (data.paths ?? []).length > 0;
  const matchingVisits = useMemo(
    () =>
      hasSelection
        ? journeyMatchingVisits(data.paths ?? [], selectedColumns)
        : data.total,
    [data.paths, data.total, hasSelection, selectedColumns],
  );

  return (
    <div className="journey-flow">
      {hasSelection ? (
        <div className="journey-flow-toolbar">
          <p className="journey-flow-hint">
            {`${formatNumber(matchingVisits)} ${t('journeyMatchingVisits')}`}
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
            {t('journeyClearSelection')}
          </button>
        </div>
      ) : null}

      <section className="panel journey-flow-viz">
        <div className="panel-body journey-flow-viz-body">
          {hasFlowData ? (
            <JourneyFlowColumns
              paths={data.paths ?? []}
              maxDepth={displayDepth}
              selectedColumns={selectedColumns}
              onSelectColumn={onSelectColumns}
            />
          ) : (
            <EmptyState title={t('noDataInPeriod')} />
          )}
        </div>
      </section>
    </div>
  );
}
