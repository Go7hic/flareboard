import { Skeleton } from '../ui/skeleton';

/** Placeholder rows in the shape of a flush card table (header band + 44px rows). */
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="q-table-skeleton" aria-hidden>
      <div className="q-table-skeleton-head">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3" style={{ width: index === 0 ? '28%' : '12%' }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="q-table-skeleton-row">
          {Array.from({ length: columns }, (_, index) => (
            <Skeleton key={index} className="h-3.5" style={{ width: index === 0 ? `${40 - ((row * 7) % 14)}%` : '10%' }} />
          ))}
        </div>
      ))}
    </div>
  );
}
