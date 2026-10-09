import {
  capWorkflowEventProperties,
  matchWorkflowConditions,
  parseStoredWorkflowFilters,
  workflowConditionContext,
  type WorkflowEventSnapshot,
  type WorkflowTriggerMessage,
} from '@flareboard/shared';
import type { Env } from '../env';
import { checkIpRateLimit } from './rate-limit';

/**
 * Public events can trigger customer-configured deliveries, so triggers are limited per client
 * IP before anything is queued. Per-website execution and delivery caps are enforced by the
 * API worker, which runs the flows (apps/api/src/lib/workflow-triggers.ts).
 */
const WORKFLOW_TRIGGER_PER_IP_MIN = 30;
const WORKFLOW_TRIGGER_PER_IP_SITE_HOUR = 10;
const MAX_WORKFLOWS_PER_SITE = 200;
const MAX_NAMES_PER_QUERY = 50;

export type WorkflowTriggerEvent = {
  eventId: string;
  eventName: string;
  sessionId: string;
  visitId: string;
  createdAt: number;
  distinctId?: string | null;
  hostname?: string | null;
  urlPath?: string | null;
  urlQuery?: string | null;
  properties?: unknown;
};

type TriggerRow = { workflowId: string; triggerEvent: string; triggerFilters: string | null };

/**
 * Queue a workflow trigger for each event that matches an enabled workflow. Event and URL
 * conditions are checked here so non-matching events never reach the queue; person
 * conditions need the person store and are checked by the API worker.
 */
export async function enqueueWorkflowTriggers(
  env: Env,
  input: { websiteId: string; trustedIp: string; fromServer?: boolean; events: WorkflowTriggerEvent[] },
) {
  const names = [...new Set(input.events.map((event) => event.eventName).filter(Boolean))];
  if (!names.length) return 0;

  // D1 binds at most 100 parameters: large batches read every enabled workflow of the site.
  const byName = names.length <= MAX_NAMES_PER_QUERY;
  const placeholders = names.map((_, index) => `?${index + 2}`).join(', ');
  const rows = await env.DB.prepare(
    `SELECT workflow_id as workflowId, trigger_event as triggerEvent, trigger_filters as triggerFilters
     FROM workflow
     WHERE website_id = ?1 AND enabled = 1${byName ? ` AND trigger_event IN (${placeholders})` : ''}
     LIMIT ${MAX_WORKFLOWS_PER_SITE}`,
  )
    .bind(input.websiteId, ...(byName ? names : []))
    .all<TriggerRow>();
  const workflows = rows.results ?? [];
  if (!workflows.length) return 0;

  const messages: WorkflowTriggerMessage[] = [];
  for (const trigger of input.events) {
    const event: WorkflowEventSnapshot = {
      id: trigger.eventId,
      name: trigger.eventName,
      createdAt: trigger.createdAt,
      sessionId: trigger.sessionId,
      visitId: trigger.visitId,
      distinctId: trigger.distinctId ?? null,
      hostname: trigger.hostname ?? null,
      urlPath: trigger.urlPath ?? null,
      urlQuery: trigger.urlQuery ?? null,
      properties: capWorkflowEventProperties(trigger.properties),
    };
    const context = workflowConditionContext(event);
    const workflowIds = workflows
      .filter((workflow) => {
        if (workflow.triggerEvent !== event.name) return false;
        const filters = parseStoredWorkflowFilters(workflow.triggerFilters);
        return filters !== null && matchWorkflowConditions(filters, context, { skipPerson: true });
      })
      .map((workflow) => workflow.workflowId);
    if (workflowIds.length) messages.push({ type: 'workflow_trigger', websiteId: input.websiteId, workflowIds, event });
  }
  if (!messages.length) return 0;

  const admitted: WorkflowTriggerMessage[] = [];
  for (const message of messages) {
    // A request signed with the site's own API key is its server, not a visitor: one IP sends
    // everything, so only the per-website caps in the API worker apply.
    if (input.fromServer) {
      admitted.push(message);
      continue;
    }
    const global = await checkIpRateLimit(env, 'workflow-trigger', input.trustedIp, WORKFLOW_TRIGGER_PER_IP_MIN, 60);
    if (!global.allowed) break;
    const perSite = await checkIpRateLimit(
      env,
      `workflow-trigger:${input.websiteId}`,
      input.trustedIp,
      WORKFLOW_TRIGGER_PER_IP_SITE_HOUR,
      3600,
    );
    if (!perSite.allowed) break;
    admitted.push(message);
  }
  if (!admitted.length) return 0;

  if (!env.WORKFLOW_QUEUE) {
    console.error(JSON.stringify({ event: 'workflow_queue_missing', websiteId: input.websiteId }));
    return 0;
  }
  if (admitted.length === 1) await env.WORKFLOW_QUEUE.send(admitted[0]!);
  else await env.WORKFLOW_QUEUE.sendBatch(admitted.map((body) => ({ body })));
  return admitted.length;
}
