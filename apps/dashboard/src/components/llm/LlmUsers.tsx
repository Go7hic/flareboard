import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { DataViewState } from '../DataViewState';
import { EmptyState } from '../EmptyState';
import { SectionCard } from '../SectionCard';
import { RelativeTime } from '../quality/RelativeTime';
import { TableSkeleton } from '../quality/TableSkeleton';
import { Button } from '../ui/button';
import { api, type AiUserRow } from '../../lib/api';
import { formatNumber, shortId } from '../../lib/format';
import { t } from '../../lib/i18n';
import { formatUsd } from './llm-format';

export function LlmUsers({
  websiteId,
  rangeQs,
  rangeKey,
  onViewTraces,
}: {
  websiteId: string;
  rangeQs: string;
  rangeKey: unknown;
  onViewTraces: (distinctId: string) => void;
}) {
  const query = useQuery({
    queryKey: ['ai-users', websiteId, rangeKey],
    placeholderData: keepPreviousData,
    queryFn: () => api<{ users: AiUserRow[]; total: number }>(`/api/websites/${websiteId}/ai-observability/users?${rangeQs}&limit=200`),
  });
  const users = query.data?.users ?? [];
  const maxCost = Math.max(0, ...users.map((user) => user.costUsd));

  return (
    <SectionCard
      flush
      title={t('aiTabUsers')}
      description={t('aiUsersLead')}
      actions={
        users.length ? (
          <span className="q-card-count">
            {t('qualityShownOf')
              .replace('{shown}', formatNumber(users.length))
              .replace('{total}', formatNumber(query.data?.total ?? users.length))}
          </span>
        ) : null
      }
    >
      <DataViewState
        loading={query.isLoading}
        error={query.isError && !query.data ? query.error : null}
        onRetry={() => void query.refetch()}
        loadingFallback={<TableSkeleton rows={8} columns={6} />}
      >
        {users.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('aiDistinctId')}</th>
                  <th>{t('aiCost')}</th>
                  <th className="num">{t('aiGenerations')}</th>
                  <th className="num">{t('aiTracesCount')}</th>
                  <th className="num">{t('aiTokens')}</th>
                  <th className="num">{t('aiErrors')}</th>
                  <th>{t('aiModels')}</th>
                  <th>{t('aiLastSeen')}</th>
                  <th className="q-col-actions">
                    <span className="sr-only">{t('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.distinctId ?? user.sessionId}>
                    <td className="q-col-user">
                      {user.distinctId ? (
                        <span className="mono">{user.distinctId}</span>
                      ) : (
                        <Link className="q-id-link" to={`/websites/${websiteId}/sessions/${user.sessionId}`} title={user.sessionId}>
                          <span className="q-col-muted">{t('aiAnonymous')}</span> {shortId(user.sessionId)}
                        </Link>
                      )}
                    </td>
                    <td>
                      <span className="q-dur">
                        <span className="q-dur-track" aria-hidden>
                          <span className="q-dur-bar" style={{ width: `${maxCost ? Math.max(2, (user.costUsd / maxCost) * 100) : 0}%` }} />
                        </span>
                        <span className="q-dur-value">{formatUsd(user.costUsd)}</span>
                      </span>
                      {user.unpricedCalls ? <span className="q-cell-sub">{t('aiUnpriced')}</span> : null}
                    </td>
                    <td className="num">{formatNumber(user.calls)}</td>
                    <td className="num">{formatNumber(user.traces)}</td>
                    <td className="num">{formatNumber(user.tokens)}</td>
                    <td className="num">{user.errors ? formatNumber(user.errors) : <span className="q-col-muted">0</span>}</td>
                    <td className="q-col-models" title={user.models.join(', ')}>
                      {user.models.slice(0, 3).join(', ')}
                    </td>
                    <td className="q-col-when">
                      <RelativeTime value={user.lastAt} />
                    </td>
                    <td className="q-col-actions">
                      {user.distinctId ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => onViewTraces(user.distinctId!)}>
                          {t('aiViewTraces')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Users />} title={t('aiNoUsers')} description={t('aiSetupBody')} />
        )}
      </DataViewState>
    </SectionCard>
  );
}
