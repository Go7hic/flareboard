import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep as DurableStep } from 'cloudflare:workers';
import { WORKFLOW_MAX_ATTEMPTS, isWorkflowActionStep } from '@flareboard/shared';
import type { Env } from '../env';
import {
  loadWorkflowLiveState,
  markExecutionFinished,
  markWaiting,
  runActionAttempt,
  runConditionStep,
  updateExecution,
  type WorkflowRunParams,
} from '../lib/workflow-runtime';

/**
 * Runs one workflow execution durably (Cloudflare Workflows). Each side effect is a named
 * `step.do`, so a restarted instance replays recorded results instead of re-sending, and
 * delays and retry back-off are `step.sleep`s that survive deploys and restarts.
 *
 * Step names are stable per position (`s<index>:…`); params carry a snapshot of the flow so
 * editing a workflow never shifts the steps of an execution already in flight. The workflow
 * row is re-read before every step: disabling or deleting it cancels pending executions.
 */
export class WorkflowRunner extends WorkflowEntrypoint<Env, WorkflowRunParams> {
  async run(event: Readonly<WorkflowEvent<WorkflowRunParams>>, step: DurableStep) {
    const params = event.payload;
    const env = this.env;

    try {
      await step.do('start', async () => {
        await updateExecution(env, params.executionId, { status: 'running', currentStep: 0 });
        return true;
      });

      for (let index = 0; index < params.steps.length; index++) {
        const flowStep = params.steps[index]!;
        const active = await step.do(`s${index}:check`, async () => {
          return (await loadWorkflowLiveState(env, params.websiteId, params.workflowId)).active;
        });
        if (!active) {
          await step.do(`s${index}:cancel`, async () => {
            await markExecutionFinished(env, params.executionId, 'cancelled', 'Workflow was disabled or deleted');
            return true;
          });
          return { status: 'cancelled', step: index };
        }

        if (flowStep.type === 'delay') {
          const delayMs = flowStep.minutes * 60_000;
          await step.do(`s${index}:wait`, async () => markWaiting(env, params, index, delayMs));
          await step.sleep(`s${index}:sleep`, delayMs);
          continue;
        }

        if (flowStep.type === 'condition') {
          const passed = await step.do(`s${index}:condition`, async () => runConditionStep(env, params, index, flowStep));
          if (!passed) {
            await step.do(`s${index}:stop`, async () => {
              await markExecutionFinished(env, params.executionId, 'stopped', 'Stopped by a condition step');
              return true;
            });
            return { status: 'stopped', step: index };
          }
          continue;
        }

        if (!isWorkflowActionStep(flowStep)) continue;
        for (let attempt = 1; attempt <= WORKFLOW_MAX_ATTEMPTS; attempt++) {
          const result = await step.do(
            `s${index}:attempt${attempt}`,
            // One engine-level retry only covers an interrupted step (isolate restart). Delivery
            // failures are returned, not thrown, so they follow the recorded back-off below.
            { retries: { limit: 1, delay: '30 seconds' }, timeout: '2 minutes' },
            async () => runActionAttempt(env, params, index, flowStep, attempt),
          );
          if (result.outcome === 'success') break;
          if (result.outcome === 'failed' || result.outcome === 'throttled') {
            return { status: result.outcome, step: index };
          }
          await step.sleep(`s${index}:backoff${attempt}`, result.delayMs);
        }
      }

      await step.do('complete', async () => {
        await markExecutionFinished(env, params.executionId, 'success');
        return true;
      });
    } catch (error) {
      // Only infrastructure failures get here (delivery failures are recorded results).
      // Leave a final state behind instead of an execution stuck in "running".
      const message = `Execution failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500);
      await step.do('fail', async () => {
        await markExecutionFinished(env, params.executionId, 'failed', message);
        return true;
      });
      throw error;
    }
    return { status: 'success' };
  }
}
