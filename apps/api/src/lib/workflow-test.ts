import {
  WorkflowTemplateError,
  buildWorkflowTemplateContext,
  isWorkflowActionStep,
  matchWorkflowConditions,
  renderWorkflowAction,
  workflowConditionContext,
  type WorkflowCondition,
  type WorkflowEventSnapshot,
  type WorkflowStep,
} from '@flareboard/shared';
import type { Env } from '../env';
import { deliverWorkflowAction, describeWorkflowRequest, type WorkflowDeliveryRequest } from './workflow-delivery';

export type WorkflowTestStepStatus = 'skipped' | 'passed' | 'stopped' | 'rendered' | 'sent' | 'failed' | 'not_reached';

export type WorkflowTestStepResult = {
  index: number;
  type: WorkflowStep['type'];
  status: WorkflowTestStepStatus;
  detail: string | null;
  request: WorkflowDeliveryRequest | null;
  response: { statusCode: number | null; body: string | null; durationMs: number } | null;
  error: string | null;
};

export type WorkflowTestResult = {
  matched: boolean;
  sent: boolean;
  steps: WorkflowTestStepResult[];
};

/**
 * Run a flow once against a sample event, for the dashboard's "send test": trigger filters and
 * condition steps are evaluated, delays are skipped, and every action is rendered. With
 * `send`, actions are delivered once each (no retries, marked X-Flareboard-Test) and the
 * destination's response is returned. Nothing is written to the execution log.
 */
export async function runWorkflowTest(
  env: Env,
  input: {
    website: { id: string; name: string; domain: string | null };
    workflow: { id: string; name: string; filters: WorkflowCondition[]; steps: WorkflowStep[]; signingSecret: string | null };
    event: WorkflowEventSnapshot;
    personProperties: Record<string, unknown>;
    send: boolean;
  },
): Promise<WorkflowTestResult> {
  const conditionContext = workflowConditionContext(input.event, input.personProperties);
  const matched = matchWorkflowConditions(input.workflow.filters, conditionContext);
  const executionId = `test-${crypto.randomUUID()}`;
  const templateContext = buildWorkflowTemplateContext({
    event: input.event,
    personProperties: input.personProperties,
    website: input.website,
    workflow: { id: input.workflow.id, name: input.workflow.name },
    executionId,
  });

  const steps: WorkflowTestStepResult[] = [];
  let reached = matched;
  let sent = false;
  for (const [index, step] of input.workflow.steps.entries()) {
    const base = { index, type: step.type, detail: null, request: null, response: null, error: null };
    if (!reached) {
      steps.push({ ...base, status: 'not_reached' });
      continue;
    }
    if (step.type === 'delay') {
      steps.push({ ...base, status: 'skipped', detail: `Waits ${step.minutes} minutes in a real run` });
      continue;
    }
    if (step.type === 'condition') {
      const passed = matchWorkflowConditions(step.conditions, conditionContext);
      steps.push({ ...base, status: passed ? 'passed' : 'stopped', detail: passed ? null : 'Condition not met' });
      reached = passed;
      continue;
    }
    if (!isWorkflowActionStep(step)) continue;

    let rendered;
    try {
      rendered = renderWorkflowAction(step, templateContext);
    } catch (error) {
      steps.push({
        ...base,
        status: 'failed',
        error: error instanceof WorkflowTemplateError ? error.message : 'Template rendering failed',
      });
      reached = false;
      continue;
    }
    const meta = {
      deliveryId: `${executionId}:${index}`,
      executionId,
      attempt: 1,
      eventName: input.event.name,
      signingSecret: input.workflow.signingSecret,
      test: true,
    };
    if (!input.send) {
      steps.push({ ...base, status: 'rendered', request: await describeWorkflowRequest(rendered, meta) });
      continue;
    }
    const { outcome, request } = await deliverWorkflowAction(env, rendered, meta);
    sent = true;
    steps.push({
      ...base,
      status: outcome.ok ? 'sent' : 'failed',
      request,
      response: { statusCode: outcome.statusCode, body: outcome.responseBody, durationMs: outcome.durationMs },
      error: outcome.error,
    });
    // A failed action ends a real run too (after its retries).
    if (!outcome.ok) reached = false;
  }
  return { matched, sent, steps };
}
