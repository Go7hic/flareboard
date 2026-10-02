import type { ReactNode } from 'react';
import { SearchX } from 'lucide-react';
import { t } from '../../lib/i18n';
import { EmptyState } from '../EmptyState';
import { KpiStripSkeleton } from '../KpiStrip';
import { ResourceSearchField } from '../master-detail';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';

/** Sticky top of a catalog list: search, then a one-line count ("6 flags · 5 on"). */
export function ProductListHeader({
  search,
  onSearch,
  placeholder,
  summary,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  summary?: ReactNode;
}) {
  return (
    <>
      <ResourceSearchField value={search} onChange={onSearch} placeholder={placeholder} aria-label={placeholder} />
      {summary ? <p className="product-list-summary">{summary}</p> : null}
    </>
  );
}

/** Shown in the list card when the search matches nothing. */
export function ProductNoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState
      className="product-list-empty"
      icon={<SearchX strokeWidth={2} />}
      title={t('productNoMatchesTitle')}
      description={t('productNoMatchesBody').replace('{query}', query.trim())}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          {t('productClearSearch')}
        </Button>
      }
    />
  );
}

/** Loading state in the final master–detail shape: list rows beside a detail card. */
export function ProductMasterDetailSkeleton({ rows = 5, kpis = 4 }: { rows?: number; kpis?: number }) {
  return (
    <div className="master-detail-layout" aria-busy role="status">
      <div className="master-detail-list">
        <div className="master-detail-list-head">
          <Skeleton className="h-10 w-full" />
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="product-skeleton-row">
            <div className="product-skeleton-copy">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="h-5 w-12" />
          </div>
        ))}
      </div>
      <div className="master-detail-pane product-skeleton-pane">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="mt-3 h-3.5 w-1/2" />
        <div className="product-skeleton-kpis">
          <KpiStripSkeleton cells={kpis} inline />
        </div>
        <Skeleton className="mt-5 h-[220px] w-full" />
      </div>
    </div>
  );
}
