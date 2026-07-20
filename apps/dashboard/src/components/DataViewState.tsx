import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import { Button } from './ui/button';
import { t } from '../lib/i18n';

function resolveErrorMessage(error: Error | string): string {
  if (typeof error === 'string') return error;
  return error.message || t('requestFailed');
}

export function DataViewState({
  loading = false,
  error = null,
  isEmpty = false,
  emptyTitle,
  emptyDescription,
  onRetry,
  loadingFallback,
  children,
}: {
  loading?: boolean;
  error?: Error | string | null;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  loadingFallback?: ReactNode;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div aria-busy role="status">
        {loadingFallback ?? <div className="skeleton skeleton-block section-gap" />}
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state-block data-view-error" role="alert">
        <p className="empty-state-block-title">{t('dataLoadFailed')}</p>
        <p className="empty-state-block-desc">{resolveErrorMessage(error)}</p>
        {onRetry ? (
          <div className="data-view-error-actions">
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {t('retry')}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle ?? t('noDataInPeriod')}
        description={emptyDescription ?? t('noDataInPeriodHint')}
      />
    );
  }

  return <>{children}</>;
}
