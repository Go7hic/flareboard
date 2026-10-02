import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { api, type FeatureFlagEvaluateResult } from '../../lib/api';
import { t } from '../../lib/i18n';
import { KvList } from '../KvList';
import { StatusBadge } from '../StatusBadge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ProductSection } from './ProductSection';

const EMPTY = { distinctId: '', path: '', environment: '', release: '' };

/**
 * Server-side evaluation of the selected flag against a custom context (the "evaluate flag"
 * tool that used to sit above the flag list). Lives in the flag's Test tab.
 */
export function FlagEvaluatePanel({ websiteId, flagKey }: { websiteId: string; flagKey: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY);
  const evaluate = useMutation({
    mutationFn: () =>
      api<FeatureFlagEvaluateResult>(`/api/websites/${websiteId}/feature-flags/evaluate`, {
        method: 'POST',
        body: JSON.stringify({
          key: flagKey,
          distinctId: draft.distinctId.trim() || undefined,
          path: draft.path.trim() || undefined,
          environment: draft.environment.trim() || undefined,
          release: draft.release.trim() || undefined,
        }),
      }),
    // Evaluating records an exposure: refresh the list in the background, show the result now.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feature-flags', websiteId] });
    },
  });
  const result = evaluate.data;

  const field = (id: keyof typeof EMPTY, label: string, placeholder?: string) => (
    <div className="field">
      <Label htmlFor={`flag-evaluate-${id}`}>{label}</Label>
      <Input
        id={`flag-evaluate-${id}`}
        value={draft[id]}
        placeholder={placeholder}
        className={id === 'path' || id === 'distinctId' ? 'mono' : undefined}
        onChange={(event) => setDraft((prev) => ({ ...prev, [id]: event.target.value }))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !evaluate.isPending) evaluate.mutate();
        }}
      />
    </div>
  );

  return (
    <ProductSection title={t('featureFlagEvaluate')} description={t('productFlagEvaluateLead')}>
      <div className="product-form-grid">
        {field('distinctId', t('featureFlagEvaluateDistinctId'))}
        {field('path', t('featureFlagEvaluatePath'), '/checkout')}
        {field('environment', t('featureFlagEvaluateEnvironment'))}
        {field('release', t('featureFlagEvaluateRelease'))}
      </div>
      <div className="product-form-actions">
        <Button type="button" variant="primary" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>
          <Play strokeWidth={2} aria-hidden />
          {evaluate.isPending ? t('loading') : t('featureFlagRunEvaluate')}
        </Button>
        {evaluate.error ? <span className="text-danger">{(evaluate.error as Error).message}</span> : null}
      </div>
      {result ? (
        <div className="product-evaluate-result" role="status" aria-live="polite">
          <h4 className="product-subtitle">{t('featureFlagEvaluateResult')}</h4>
          <KvList
            items={[
              {
                key: 'enabled',
                label: t('status'),
                value: (
                  <StatusBadge tone={result.enabled ? 'success' : 'neutral'}>
                    {result.enabled ? t('productFlagServed') : t('productFlagNotServed')}
                  </StatusBadge>
                ),
              },
              {
                key: 'variant',
                label: t('variant'),
                value:
                  result.variant === null || result.variant === undefined ? (
                    <span className="text-muted">–</span>
                  ) : (
                    <span className="mono">{String(result.variant)}</span>
                  ),
              },
              {
                key: 'reason',
                label: t('featureFlagEvaluateReason'),
                value:
                  t(`featureFlagReason_${result.reason}`) +
                  (typeof result.conditionGroup === 'number'
                    ? ` · ${t('featureFlagGroupTitle').replace('{n}', String(result.conditionGroup + 1))}`
                    : ''),
              },
              ...(result.payload !== undefined && result.payload !== null
                ? [
                    {
                      key: 'payload',
                      label: t('featureFlagPayload'),
                      value: <pre className="product-json">{JSON.stringify(result.payload, null, 2)}</pre>,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}
    </ProductSection>
  );
}
