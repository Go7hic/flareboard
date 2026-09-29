import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DataViewState } from '../DataViewState';
import { EmptyState } from '../EmptyState';
import { Button } from '../ui/button';
import { api, type AiUserRow } from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';
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
    queryFn: () => api<{ users: AiUserRow[]; total: number }>(`/api/websites/${websiteId}/ai-observability/users?${rangeQs}&limit=200`),
  });
  const users = query.data?.users ?? [];
  const maxCost = Math.max(0, ...users.map((user) => user.costUsd));

  return (
    <section className="section-gap">
      <header className="panel-header">
        <div>
          <h2 className="section-title">{t('aiTabUsers')}</h2>
          <p className="text-muted">{t('aiUsersLead')}</p>
        </div>
      </header>
      <DataViewState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        {users.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('aiDistinctId')}</th>
                  <th className="num">{t('aiCost')}</th>
                  <th className="num">{t('aiGenerations')}</th>
                  <th className="num">{t('aiTracesCount')}</th>
                  <th className="num">{t('aiTokens')}</th>
                  <th className="num">{t('aiErrors')}</th>
                  <th>{t('aiModels')}</th>
                  <th>{t('aiLastSeen')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.distinctId ?? user.sessionId}>
                    <td className="mono">
                      {user.distinctId ?? (
                        <Link className="inline-link" to={`/websites/${websiteId}/sessions/${user.sessionId}`}>
                          {t('aiAnonymous')} · {user.sessionId.slice(0, 8)}
                        </Link>
                      )}
                    </td>
                    <td className="num">
                      <div className="llm-cost-cell">
                        <span className="breakdown-track llm-cost-track" aria-hidden>
                          <span style={{ width: `${maxCost ? Math.round((user.costUsd / maxCost) * 100) : 0}%` }} />
                        </span>
                        {formatUsd(user.costUsd)}
                        {user.unpricedCalls ? <span className="badge">{t('aiUnpriced')}</span> : null}
                      </div>
                    </td>
                    <td className="num">{formatNumber(user.calls)}</td>
                    <td className="num">{formatNumber(user.traces)}</td>
                    <td className="num">{formatNumber(user.tokens)}</td>
                    <td className="num">{formatNumber(user.errors)}</td>
                    <td className="text-muted">{user.models.slice(0, 3).join(', ')}</td>
                    <td className="text-muted">{formatDateTime(user.lastAt)}</td>
                    <td>
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
          <EmptyState title={t('aiNoUsers')} description={t('aiSetupBody')} />
        )}
      </DataViewState>
    </section>
  );
}
