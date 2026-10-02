import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PersonDetailResponse, type PersonSummary } from '../../lib/api';
import { formatNumber, formatShortDate } from '../../lib/format';
import { t } from '../../lib/i18n';
import { DataViewState } from '../DataViewState';
import { KpiCell, KpiStrip } from '../KpiStrip';
import { KvList } from '../KvList';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { EventList, RelativeTime, SessionList } from './ActivityLists';
import { DetailSection, DetailSectionSkeleton, DetailSheet, DetailSheetHeader } from './DetailSheet';
import { IdentityAvatar } from './IdentityAvatar';
import { personIdentity } from './person-identity';

function propertiesToJson(properties: Array<{ key: string; value: string | null }>) {
  const record: Record<string, string> = {};
  for (const row of properties) {
    if (row.value != null) record[row.key] = row.value;
  }
  return JSON.stringify(record, null, 2);
}

/** Person detail in a side sheet: period numbers, profile properties, sessions, activity. */
export function PersonSheet({
  websiteId,
  personId,
  summary,
  canEdit,
  onClose,
}: {
  websiteId: string;
  personId: string | null;
  /** The person's row from the list (period counts); absent for a deep link outside the list. */
  summary?: PersonSummary;
  canEdit: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState('');

  const detailQuery = useQuery({
    queryKey: ['person-detail', websiteId, personId],
    enabled: Boolean(personId),
    queryFn: () =>
      api<PersonDetailResponse>(`/api/websites/${websiteId}/people/${encodeURIComponent(personId!)}`),
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, properties }: { id: string; properties: Record<string, unknown> }) =>
      api<PersonDetailResponse>(`/api/websites/${websiteId}/people/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      }),
    onSuccess: (data, variables) => {
      // Keyed by the id the request was made for: the sheet may show someone else by now.
      queryClient.setQueryData(['person-detail', websiteId, data?.personId ?? variables.id], data);
      queryClient.invalidateQueries({ queryKey: ['people', websiteId] });
      setEditing(false);
      setDraftError('');
    },
  });

  const identity = personIdentity(
    summary ?? { personId: personId ?? '', latestName: null, latestEmail: null, latestAlias: null },
  );
  const properties = detailQuery.data?.properties ?? [];
  const sessions = detailQuery.data?.sessions ?? [];
  const events = detailQuery.data?.events ?? [];
  const loading = detailQuery.isLoading;

  function startEditing() {
    setDraft(propertiesToJson(properties));
    setDraftError('');
    setEditing(true);
  }

  function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setDraftError(t('peoplePropertiesInvalid'));
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setDraftError(t('peoplePropertiesInvalid'));
      return;
    }
    if (!personId) return;
    saveMutation.mutate({ id: personId, properties: parsed as Record<string, unknown> });
  }

  function close() {
    setEditing(false);
    setDraftError('');
    onClose();
  }

  const firstSeen = summary?.firstSeenAt ?? null;
  const lastSeen = summary?.lastSeenAt ?? sessions[0]?.lastSeenAt ?? null;

  return (
    <DetailSheet open={Boolean(personId)} onClose={close} label={identity.title}>
      <DetailSheetHeader
        leading={
          <IdentityAvatar label={identity.avatarLabel} anonymous={!identity.avatarLabel} size="lg" />
        }
        title={identity.title}
        subtitle={
          identity.subtitle ? (
            <span className={identity.subtitleIsId ? 'mono' : undefined}>{identity.subtitle}</span>
          ) : undefined
        }
        meta={
          <>
            {personId && identity.subtitle !== personId && identity.title !== personId ? (
              <span className="mono truncate-1 audience-id" title={personId}>
                {personId}
              </span>
            ) : null}
            {firstSeen ? (
              <span title={t('firstSeen')}>
                {t('audienceFirstSeenOn').replace('{date}', formatShortDate(firstSeen))}
              </span>
            ) : null}
            {lastSeen ? (
              <span>
                {t('lastSeen')} <RelativeTime value={lastSeen} />
              </span>
            ) : null}
          </>
        }
      />

      <div className="audience-sheet-body">
        {summary ? (
          <KpiStrip inline columns={4}>
            <KpiCell label={t('sessions')} value={formatNumber(summary.sessions)} />
            <KpiCell label={t('visits')} value={formatNumber(summary.visits)} />
            <KpiCell label={t('pageviews')} value={formatNumber(summary.pageviews)} />
            <KpiCell label={t('events')} value={formatNumber(summary.events)} />
          </KpiStrip>
        ) : null}

        <DataViewState
          error={detailQuery.isError ? detailQuery.error : null}
          onRetry={() => detailQuery.refetch()}
        >
          <DetailSection
            title={t('peopleProperties')}
            description={t('peoplePropertiesLead')}
            actions={
              canEdit && !loading ? (
                editing ? (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      {t('cancel')}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={save}
                      disabled={saveMutation.isPending}
                    >
                      {t('peopleSaveProperties')}
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={startEditing}>
                    {t('peopleEditProperties')}
                  </Button>
                )
              ) : null
            }
          >
            {loading ? (
              <DetailSectionSkeleton lines={3} />
            ) : editing ? (
              <div className="audience-properties-editor">
                <Label htmlFor="person-properties-json">{t('peoplePropertiesJson')}</Label>
                <Textarea
                  id="person-properties-json"
                  className="textarea-mono"
                  rows={10}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  aria-invalid={draftError ? true : undefined}
                />
                {draftError ? <p className="text-danger audience-form-note">{draftError}</p> : null}
                {saveMutation.error ? (
                  <p className="text-danger audience-form-note">{saveMutation.error.message}</p>
                ) : null}
              </div>
            ) : properties.length ? (
              <KvList
                compact
                className="audience-kv"
                items={properties.map((property) => ({
                  key: property.key,
                  label: (
                    <span className="mono" title={property.key}>
                      {property.key}
                    </span>
                  ),
                  value: property.value ?? <span className="text-muted">-</span>,
                }))}
              />
            ) : (
              <p className="audience-section-empty">{t('peopleNoProperties')}</p>
            )}
            {saveMutation.isSuccess && !editing ? (
              <p className="text-muted audience-form-note" role="status">
                {t('peoplePropertiesSaved')}
              </p>
            ) : null}
          </DetailSection>

          <DetailSection title={t('audienceRecentSessions')}>
            {loading ? (
              <DetailSectionSkeleton lines={3} />
            ) : sessions.length ? (
              <SessionList websiteId={websiteId} sessions={sessions} />
            ) : (
              <p className="audience-section-empty">{t('audienceNoSessions')}</p>
            )}
          </DetailSection>

          <DetailSection title={t('audienceRecentActivity')}>
            {loading ? (
              <DetailSectionSkeleton lines={5} />
            ) : (
              <EventList
                websiteId={websiteId}
                events={events}
                empty={<p className="audience-section-empty">{t('peopleNoEvents')}</p>}
              />
            )}
          </DetailSection>
        </DataViewState>
      </div>
    </DetailSheet>
  );
}
