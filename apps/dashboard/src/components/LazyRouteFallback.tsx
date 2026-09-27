import { Skeleton } from './ui/skeleton';
import { t } from '../lib/i18n';

export function LazyRouteFallback() {
  return (
    <div className="page" aria-busy="true" aria-label={t('loading')}>
      <Skeleton className="mb-4 h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
