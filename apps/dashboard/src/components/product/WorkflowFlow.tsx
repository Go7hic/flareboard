import type { ReactNode } from 'react';
import { CircleStop, ClipboardList, Clock, GitBranch, Hash, Mail, Webhook, Zap } from 'lucide-react';
import type { Workflow, WorkflowCondition, WorkflowStep, WorkflowStepType } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { ConditionChips, type ChipCondition } from './ConditionChips';
import { formatMinutes, tf } from './format';

const STEP_ICONS: Record<WorkflowStepType, typeof Clock> = {
  delay: Clock,
  condition: GitBranch,
  webhook: Webhook,
  email: Mail,
  slack: Hash,
};

export function StepIcon({ type, className }: { type: WorkflowStepType; className?: string }) {
  const Icon = STEP_ICONS[type] ?? Clock;
  return <Icon className={className} strokeWidth={2} aria-hidden />;
}

export function workflowConditionChip(condition: WorkflowCondition): ChipCondition {
  const valueless = condition.operator === 'exists' || condition.operator === 'not_exists';
  return {
    field: t(`featureFlagField_${condition.field}`),
    subject: condition.key || undefined,
    operator: t(`featureFlagOperator_${condition.operator}`),
    value: valueless ? undefined : condition.value,
  };
}

/** One line per step for compact summaries (test results, attempts). */
export function stepHeadline(step: WorkflowStep): ReactNode {
  switch (step.type) {
    case 'delay':
      return tf('productFlowWait', { duration: formatMinutes(step.minutes) });
    case 'condition':
      return t('productFlowContinueIf');
    case 'webhook':
      return (
        <>
          <span className="product-flow-method">{step.method}</span>
          <span className="mono product-flow-url">{step.url}</span>
        </>
      );
    case 'email':
      return tf('productFlowEmailTo', { to: step.to });
    case 'slack':
      return t('workflowStepSummary_slack');
  }
}

function stepDetail(step: WorkflowStep): ReactNode {
  switch (step.type) {
    case 'delay':
      return null;
    case 'condition':
      return (
        <>
          <ConditionChips conditions={step.conditions.map(workflowConditionChip)} />
          <p className="product-flow-note">{t('productFlowStopsOtherwise')}</p>
        </>
      );
    case 'webhook': {
      const notes = [
        step.headers.length ? tf('productFlowHeaders', { count: formatNumber(step.headers.length) }) : null,
        step.method === 'GET' || step.method === 'DELETE'
          ? null
          : step.body.trim()
            ? t('productFlowCustomBody')
            : t('productFlowDefaultBody'),
      ].filter(Boolean);
      return notes.length ? <p className="product-flow-note">{notes.join(' · ')}</p> : null;
    }
    case 'email':
      return step.subject ? <p className="product-flow-note">{step.subject}</p> : null;
    case 'slack':
      return step.message ? <p className="product-flow-note product-flow-quote">{step.message}</p> : null;
  }
}

function FlowNode({
  icon,
  kind,
  title,
  children,
  tone,
}: {
  icon: ReactNode;
  kind: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  tone?: 'trigger' | 'end';
}) {
  return (
    <li className={cn('product-flow-node', tone && `product-flow-node--${tone}`)}>
      <span className="product-flow-icon">{icon}</span>
      <div className="product-flow-copy">
        <span className="product-flow-kind">{kind}</span>
        {title ? <div className="product-flow-title">{title}</div> : null}
        {children}
      </div>
    </li>
  );
}

/** Trigger → steps → end as a vertical diagram with icons and connectors. */
export function WorkflowFlow({ workflow }: { workflow: Workflow }) {
  return (
    <ol className="product-flow" aria-label={t('workflowFlow')}>
      <FlowNode
        tone="trigger"
        icon={<Zap strokeWidth={2} aria-hidden />}
        kind={t('workflowTrigger')}
        title={
          <>
            {t('productFlowWhen')} <code className="mono product-flow-event">{workflow.triggerEvent}</code>
          </>
        }
      >
        {workflow.filters.length ? (
          <ConditionChips conditions={workflow.filters.map(workflowConditionChip)} />
        ) : (
          <p className="product-flow-note">{t('workflowTriggerFiltersEmpty')}</p>
        )}
      </FlowNode>
      {workflow.steps.map((step, index) => (
        <FlowNode
          key={step.id}
          icon={<StepIcon type={step.type} />}
          kind={`${t('workflowStepN').replace('{n}', String(index + 1))} · ${t(`workflowStep_${step.type}`)}`}
          title={stepHeadline(step)}
        >
          {stepDetail(step)}
        </FlowNode>
      ))}
      {workflow.steps.length ? (
        <FlowNode tone="end" icon={<CircleStop strokeWidth={2} aria-hidden />} kind={t('productFlowEnd')} />
      ) : (
        <FlowNode
          tone="end"
          icon={<ClipboardList strokeWidth={2} aria-hidden />}
          kind={t('workflowRecordOnly')}
          title={<span className="product-flow-muted">{t('workflowRecordOnlyLead')}</span>}
        />
      )}
    </ol>
  );
}
