import { Skeleton } from './ui/skeleton';

export function LazyRouteFallback() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-4 h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
