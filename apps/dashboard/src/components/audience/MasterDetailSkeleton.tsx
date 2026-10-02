import { KpiStripSkeleton } from '../KpiStrip';
import { Skeleton } from '../ui/skeleton';

/** Loading state of a catalog page in its final shape: list card + detail card. */
export function MasterDetailSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="master-detail-layout" aria-hidden>
      <div className="master-detail-list">
        <div className="master-detail-list-head">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-3 w-20" />
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="master-detail-list-item">
            <div className="master-detail-list-main">
              <Skeleton className="size-4 shrink-0" />
              <div className="master-detail-list-copy">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-44" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="master-detail-pane">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-2 h-3.5 w-64" />
        <div className="audience-pane-kpis mt-5">
          <KpiStripSkeleton cells={4} inline />
        </div>
        <Skeleton className="mt-6 h-4 w-32" />
        <Skeleton className="mt-3 h-8 w-80" />
      </div>
    </div>
  );
}
