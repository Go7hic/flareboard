import { z } from 'zod';
import { checkOutboundUrl } from './delivery';
import {
  matchFeatureFlagRule,
  type FeatureFlagEvaluationContext,
  type FeatureFlagRuleOperator,
} from './feature-flag-evaluator';

/**
 * Workflow definitions: trigger conditions, ordered flow steps, template rendering and the
 * retry schedule. Shared by the ingest worker (cheap trigger pre-filter), the API worker
 * (validation, execution, test sends) and their tests.
 */

export const WORKFLOW_MAX_CONDITIONS = 20;
export const WORKFLOW_MAX_STEPS = 20;
export const WORKFLOW_MAX_ACTION_STEPS = 10;
/** Longest single delay step: 7 days. */
export const WORKFLOW_MAX_DELAY_MINUTES = 7 * 24 * 60;
/** All delay steps of a flow together (keeps every run well inside the 90-day log retention). */
export const WORKFLOW_MAX_TOTAL_DELAY_MINUTES = 30 * 24 * 60;
export const WORKFLOW_MAX_HEADERS = 20;
export const WORKFLOW_MAX_TEMPLATE_LENGTH = 10_000;
export const WORKFLOW_MAX_EMAIL_RECIPIENTS = 5;
/** Delivery attempts per action step, the first one included. */
export const WORKFLOW_MAX_ATTEMPTS = 5;
/** Wait before the second attempt. Each later wait is four times longer (30s, 2m, 8m, 32m). */
export const WORKFLOW_RETRY_BASE_MS = 30_000;
/** Event properties carried into an execution (serialized JSON). Larger payloads are dropped. */
export const WORKFLOW_MAX_EVENT_PROPERTIES_BYTES = 32 * 1024;

export const WORKFLOW_CONDITION_FIELDS = ['property', 'person', 'path', 'url', 'hostname'] as const;
export type WorkflowConditionField = (typeof WORKFLOW_CONDITION_FIELDS)[number];

export const WORKFLOW_CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'exists',
  'not_exists',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
] as const satisfies readonly FeatureFlagRuleOperator[];
export type WorkflowConditionOperator = (typeof WORKFLOW_CONDITION_OPERATORS)[number];

const KEYED_CONDITION_FIELDS: ReadonlySet<WorkflowConditionField> = new Set(['property', 'person']);
const VALUELESS_OPERATORS: ReadonlySet<WorkflowConditionOperator> = new Set(['exists', 'not_exists']);
const NUMERIC_OPERATORS: ReadonlySet<WorkflowConditionOperator> = new Set([
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
]);

export type WorkflowCondition = {
  field: WorkflowConditionField;
  /** Property name for `property` (event) and `person` conditions. */
  key: string;
  operator: WorkflowConditionOperator;
  value: string;
};

export const WORKFLOW_STEP_TYPES = ['delay', 'condition', 'webhook', 'email', 'slack'] as const;
export type WorkflowStepType = (typeof WORKFLOW_STEP_TYPES)[number];
export const WORKFLOW_ACTION_STEP_TYPES = ['webhook', 'email', 'slack'] as const;
export type WorkflowActionStepType = (typeof WORKFLOW_ACTION_STEP_TYPES)[number];
export const WORKFLOW_WEBHOOK_METHODS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'] as const;
export type WorkflowWebhookMethod = (typeof WORKFLOW_WEBHOOK_METHODS)[number];

export type WorkflowHeader = { key: string; value: string };

export type WorkflowDelayStep = { id: string; type: 'delay'; minutes: number };
export type WorkflowConditionStep = { id: string; type: 'condition'; conditions: WorkflowCondition[] };
export type WorkflowWebhookStep = {
  id: string;
  type: 'webhook';
  url: string;
  method: WorkflowWebhookMethod;
  headers: WorkflowHeader[];
  /** JSON body template. Empty sends the default payload (see defaultWebhookPayload). */
  body: string;
};
export type WorkflowEmailStep = {
  id: string;
  type: 'email';
  /** Comma-separated recipients. */
  to: string;
  /** Empty uses DEFAULT_EMAIL_SUBJECT. */
  subject: string;
  /** Plain-text body template. Empty uses DEFAULT_EMAIL_BODY. */
  body: string;
};
export type WorkflowSlackStep = { id: string; type: 'slack'; webhookUrl: string; message: string };
export type WorkflowActionStep = WorkflowWebhookStep | WorkflowEmailStep | WorkflowSlackStep;
export type WorkflowStep = WorkflowDelayStep | WorkflowConditionStep | WorkflowActionStep;

export const DEFAULT_EMAIL_SUBJECT = 'Flareboard workflow: {{workflow.name}}';
export const DEFAULT_EMAIL_BODY =
  'Workflow "{{workflow.name}}" ran for event {{event.name}} on {{website.name}}.\n\nPage: {{event.url}}\nTime: {{event.timestamp}}';

export function isWorkflowActionStep(step: WorkflowStep): step is WorkflowActionStep {
  return (WORKFLOW_ACTION_STEP_TYPES as readonly string[]).includes(step.type);
}

// ---------------------------------------------------------------------------------------------
// Events and template context
// ---------------------------------------------------------------------------------------------

/** The triggering event, as captured by ingest and carried through the execution. */
export type WorkflowEventSnapshot = {
  id: string;
  name: string;
  /** Epoch milliseconds. */
  createdAt: number;
  sessionId: string | null;
  visitId: string | null;
  distinctId: string | null;
  hostname: string | null;
  urlPath: string | null;
  urlQuery: string | null;
  properties: Record<string, unknown>;
};

/** Ingest → API queue message (queue `flareboard-workflow-triggers`). */
export type WorkflowTriggerMessage = {
  type: 'workflow_trigger';
  websiteId: string;
  /** Enabled workflows whose event/URL conditions matched in ingest. */
  workflowIds: string[];
  event: WorkflowEventSnapshot;
};

export function workflowEventUrl(event: Pick<WorkflowEventSnapshot, 'hostname' | 'urlPath' | 'urlQuery'>) {
  const path = event.urlPath ?? '';
  const query = event.urlQuery ? `?${event.urlQuery}` : '';
  return event.hostname ? `https://${event.hostname}${path}${query}` : `${path}${query}`;
}

/** Drop properties that would make the queue message / workflow params too large. */
export function capWorkflowEventProperties(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).byteLength > WORKFLOW_MAX_EVENT_PROPERTIES_BYTES) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type WorkflowTemplateContext = {
  event: {
    id: string;
    name: string;
    timestamp: string;
    url: string;
    path: string;
    hostname: string;
    distinct_id: string;
    session_id: string;
    visit_id: string;
    properties: Record<string, unknown>;
  };
  person: { distinct_id: string; properties: Record<string, unknown> };
  website: { id: string; name: string; domain: string };
  workflow: { id: string; name: string };
  execution: { id: string };
};

export function buildWorkflowTemplateContext(input: {
  event: WorkflowEventSnapshot;
  personProperties?: Record<string, unknown> | null;
  website: { id: string; name: string; domain?: string | null };
  workflow: { id: string; name: string };
  executionId: string;
}): WorkflowTemplateContext {
  const { event } = input;
  return {
    event: {
      id: event.id,
      name: event.name,
      timestamp: new Date(event.createdAt).toISOString(),
      url: workflowEventUrl(event),
      path: event.urlPath ?? '',
      hostname: event.hostname ?? '',
      distinct_id: event.distinctId ?? '',
      session_id: event.sessionId ?? '',
      visit_id: event.visitId ?? '',
      properties: event.properties ?? {},
    },
    person: { distinct_id: event.distinctId ?? '', properties: input.personProperties ?? {} },
    website: { id: input.website.id, name: input.website.name, domain: input.website.domain ?? '' },
    workflow: { id: input.workflow.id, name: input.workflow.name },
    execution: { id: input.executionId },
  };
}

const EMPTY_TEMPLATE_CONTEXT: WorkflowTemplateContext = {
  event: {
    id: '',
    name: '',
    timestamp: '',
    url: '',
    path: '',
    hostname: '',
    distinct_id: '',
    session_id: '',
    visit_id: '',
    properties: {},
  },
  person: { distinct_id: '', properties: {} },
  website: { id: '', name: '', domain: '' },
  workflow: { id: '', name: '' },
  execution: { id: '' },
};

/** Placeholders offered by the dashboard helper. `<key>` stands for any property name. */
export const WORKFLOW_TEMPLATE_PLACEHOLDERS = [
  'event.name',
  'event.id',
  'event.timestamp',
  'event.url',
  'event.path',
  'event.hostname',
  'event.distinct_id',
  'event.session_id',
  'event.properties.<key>',
  'person.distinct_id',
  'person.properties.<key>',
  'website.id',
  'website.name',
  'website.domain',
  'workflow.id',
  'workflow.name',
  'execution.id',
] as const;

const SCALAR_PLACEHOLDERS: Record<string, readonly string[]> = {
  event: ['id', 'name', 'timestamp', 'url', 'path', 'hostname', 'distinct_id', 'session_id', 'visit_id'],
  person: ['distinct_id'],
  website: ['id', 'name', 'domain'],
  workflow: ['id', 'name'],
  execution: ['id'],
};

function readNested(source: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  // `{{event.properties.plan.tier}}` reads nested objects when no flat key matches.
  let current: unknown = source;
  for (const part of key.split('.')) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Whether `path` names a known placeholder (a property placeholder needs a key). */
export function isKnownWorkflowPlaceholder(path: string): boolean {
  const [root, ...rest] = path.split('.');
  const scalars = SCALAR_PLACEHOLDERS[root ?? ''];
  if (!scalars) return false;
  if (rest.length === 1 && scalars.includes(rest[0]!)) return true;
  if ((root === 'event' || root === 'person') && rest[0] === 'properties') {
    return rest.length === 1 || rest.slice(1).join('.').trim().length > 0;
  }
  return false;
}

export function resolveWorkflowPlaceholder(context: WorkflowTemplateContext, path: string): unknown {
  const [root, field, ...rest] = path.split('.');
  if (root !== 'event' && root !== 'person' && root !== 'website' && root !== 'workflow' && root !== 'execution') {
    return undefined;
  }
  const scope = context[root] as Record<string, unknown>;
  if (!field) return undefined;
  if (field === 'properties' && (root === 'event' || root === 'person')) {
    const properties = context[root].properties ?? {};
    return rest.length ? readNested(properties, rest.join('.')) : properties;
  }
  if (rest.length || !SCALAR_PLACEHOLDERS[root]!.includes(field)) return undefined;
  return scope[field];
}

const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Placeholder paths used by a template, in order of appearance. */
export function listWorkflowPlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]!.trim());
}

function valueToText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** Plain-text rendering; `escape` is applied to every substituted value (never to the template). */
export function renderTextTemplate(
  template: string,
  context: WorkflowTemplateContext,
  escape: (value: string) => string = (value) => value,
): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, path: string) =>
    escape(valueToText(resolveWorkflowPlaceholder(context, path.trim()))),
  );
}

function jsonValue(value: unknown): string {
  if (value === undefined) return 'null';
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return 'null';
  }
}

/**
 * Render a JSON body template. A placeholder inside a JSON string literal is inserted as
 * escaped string content (`"Hi {{person.properties.name}}"`). A placeholder anywhere else is
 * inserted as a JSON value (`"amount": {{event.properties.amount}}` gives a number, a string,
 * an object, or `null` when missing). Values can therefore never break out of their slot.
 */
export function renderJsonTemplate(template: string, context: WorkflowTemplateContext): string {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < template.length) {
    if (template.startsWith('{{', i)) {
      const end = template.indexOf('}}', i + 2);
      const inner = end === -1 ? '' : template.slice(i + 2, end);
      if (end !== -1 && !inner.includes('{') && !inner.includes('}')) {
        const value = resolveWorkflowPlaceholder(context, inner.trim());
        out += inString ? JSON.stringify(valueToText(value)).slice(1, -1) : jsonValue(value);
        i = end + 2;
        continue;
      }
    }
    const ch = template[i]!;
    if (inString && ch === '\\') {
      out += template.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '"') inString = !inString;
    out += ch;
    i += 1;
  }
  return out;
}

/** Header values: placeholders rendered as text with line breaks removed (no header injection). */
export function renderHeaderTemplate(template: string, context: WorkflowTemplateContext): string {
  return renderTextTemplate(template, context, stripLineBreaks).replace(/[\r\n\0]/g, ' ').slice(0, 2000);
}

function stripLineBreaks(value: string) {
  return value.replace(/[\r\n\0]+/g, ' ');
}

/** Slack mrkdwn control characters, so a property value cannot add mentions or links. */
export function escapeSlackText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export type RenderedWorkflowAction =
  | {
      type: 'webhook';
      method: WorkflowWebhookMethod;
      url: string;
      headers: WorkflowHeader[];
      /** Null for GET / DELETE. */
      body: string | null;
    }
  | { type: 'email'; to: string[]; subject: string; text: string; html: string }
  | { type: 'slack'; url: string; body: string };

export function defaultWebhookPayload(context: WorkflowTemplateContext) {
  return {
    type: 'workflow',
    workflowId: context.workflow.id,
    workflowName: context.workflow.name,
    executionId: context.execution.id,
    websiteId: context.website.id,
    sessionId: context.event.session_id || null,
    visitId: context.event.visit_id || null,
    eventId: context.event.id,
    eventName: context.event.name,
    createdAt: Date.parse(context.event.timestamp),
    event: {
      name: context.event.name,
      timestamp: context.event.timestamp,
      url: context.event.url,
      path: context.event.path,
      hostname: context.event.hostname,
      distinctId: context.event.distinct_id || null,
      properties: context.event.properties,
    },
    person: context.person.distinct_id
      ? { distinctId: context.person.distinct_id, properties: context.person.properties }
      : null,
    website: context.website,
  };
}

export function parseEmailRecipients(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export class WorkflowTemplateError extends Error {}

/** Render an action step against a context. Throws WorkflowTemplateError on an invalid JSON body. */
export function renderWorkflowAction(step: WorkflowActionStep, context: WorkflowTemplateContext): RenderedWorkflowAction {
  if (step.type === 'webhook') {
    const hasBody = step.method !== 'GET' && step.method !== 'DELETE';
    let body: string | null = null;
    if (hasBody) {
      if (step.body.trim()) {
        body = renderJsonTemplate(step.body, context);
        try {
          JSON.parse(body);
        } catch {
          throw new WorkflowTemplateError('Rendered body is not valid JSON');
        }
      } else {
        body = JSON.stringify(defaultWebhookPayload(context));
      }
    }
    return {
      type: 'webhook',
      method: step.method,
      url: step.url,
      headers: step.headers.map((header) => ({
        key: header.key,
        value: renderHeaderTemplate(header.value, context),
      })),
      body,
    };
  }
  if (step.type === 'email') {
    const subject = renderTextTemplate(step.subject.trim() || DEFAULT_EMAIL_SUBJECT, context, stripLineBreaks)
      .replace(/[\r\n]/g, ' ')
      .trim()
      .slice(0, 200);
    const text = renderTextTemplate(step.body.trim() || DEFAULT_EMAIL_BODY, context);
    const footer = `Sent by the Flareboard workflow "${context.workflow.name}" for ${context.website.name}.`;
    return {
      type: 'email',
      to: parseEmailRecipients(step.to),
      subject: subject || renderTextTemplate(DEFAULT_EMAIL_SUBJECT, context, stripLineBreaks),
      text: `${text}\n\n--\n${footer}`,
      html: `${escapeHtml(text).replace(/\n/g, '<br/>')}<hr/><p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>`,
    };
  }
  return {
    type: 'slack',
    url: step.webhookUrl,
    body: JSON.stringify({ text: renderTextTemplate(step.message, context, escapeSlackText) }),
  };
}

// ---------------------------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------------------------

export function workflowConditionContext(
  event: WorkflowEventSnapshot,
  personProperties?: Record<string, unknown> | null,
): FeatureFlagEvaluationContext {
  return {
    distinctId: event.distinctId ?? undefined,
    path: event.urlPath ?? '',
    url: workflowEventUrl(event),
    hostname: event.hostname ?? '',
    properties: event.properties ?? {},
    personProperties: personProperties ?? {},
  };
}

export function workflowConditionsNeedPerson(conditions: WorkflowCondition[]): boolean {
  return conditions.some((condition) => condition.field === 'person');
}

/**
 * AND of all conditions, with the feature-flag operator semantics (case-insensitive text
 * comparison, numeric comparison for greater/less, unknown operators fail closed).
 * `skipPerson` treats person conditions as met, for ingest's pre-filter that has no person.
 */
export function matchWorkflowConditions(
  conditions: WorkflowCondition[],
  context: FeatureFlagEvaluationContext,
  options: { skipPerson?: boolean } = {},
): boolean {
  return conditions.every((condition) => {
    if (options.skipPerson && condition.field === 'person') return true;
    return matchFeatureFlagRule(
      { field: condition.field, key: condition.key, operator: condition.operator, value: condition.value },
      context,
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Retries
// ---------------------------------------------------------------------------------------------

/** Wait after failed attempt `attempt` (1-based) before the next one. */
export function workflowRetryDelayMs(attempt: number): number {
  return WORKFLOW_RETRY_BASE_MS * 4 ** Math.max(0, attempt - 1);
}

/** Response codes worth another attempt. Other 4xx are permanent (bad URL, auth, payload). */
export function isRetryableWorkflowStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------------------------

export const WORKFLOW_SIGNATURE_HEADER = 'X-Flareboard-Signature';
export const WORKFLOW_TIMESTAMP_HEADER = 'X-Flareboard-Timestamp';

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `v1=<hex>` where hex is HMAC-SHA256(secret, `${timestamp}.${body}`) and `timestamp` is the
 * Unix time in seconds sent in X-Flareboard-Timestamp. Receivers recompute it over the raw
 * body and reject stale timestamps to stop replays.
 */
export async function signWorkflowPayload(secret: string, timestamp: number, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  return `v1=${toHex(signature)}`;
}

export function generateWorkflowSigningSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `whsec_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

const RESERVED_HEADER_NAMES = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'user-agent',
  'cookie',
]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;
const SLACK_WEBHOOK_HOSTS = new Set(['hooks.slack.com', 'hooks.slack-gov.com']);

function checkTemplatePlaceholders(template: string, ctx: z.RefinementCtx, path: (string | number)[]) {
  for (const placeholder of listWorkflowPlaceholders(template)) {
    if (!isKnownWorkflowPlaceholder(placeholder)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `Unknown placeholder {{${placeholder}}}` });
      return;
    }
  }
}

const templateString = (max = WORKFLOW_MAX_TEMPLATE_LENGTH) => z.string().max(max);
const stepId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid step id');

export const workflowConditionSchema = z
  .object({
    field: z.enum(WORKFLOW_CONDITION_FIELDS),
    key: z.string().trim().max(200).optional().default(''),
    operator: z.enum(WORKFLOW_CONDITION_OPERATORS),
    value: z.string().max(1000).optional().default(''),
  })
  .superRefine((condition, ctx) => {
    if (KEYED_CONDITION_FIELDS.has(condition.field) && !condition.key) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['key'], message: 'Property name is required' });
    }
    if (NUMERIC_OPERATORS.has(condition.operator) && !Number.isFinite(Number(condition.value.trim() || 'x'))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'A number is required' });
    }
    if (
      !VALUELESS_OPERATORS.has(condition.operator) &&
      !NUMERIC_OPERATORS.has(condition.operator) &&
      condition.value === '' &&
      condition.operator !== 'equals' &&
      condition.operator !== 'not_equals'
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'A value is required' });
    }
  });

const conditionList = z.array(workflowConditionSchema).max(WORKFLOW_MAX_CONDITIONS);

const delayStepSchema = z.object({
  id: stepId,
  type: z.literal('delay'),
  minutes: z.number().int().min(1).max(WORKFLOW_MAX_DELAY_MINUTES),
});

const conditionStepSchema = z.object({
  id: stepId,
  type: z.literal('condition'),
  conditions: conditionList.min(1),
});

const webhookStepSchema = z.object({
  id: stepId,
  type: z.literal('webhook'),
  url: z.string().trim().max(2000),
  method: z.enum(WORKFLOW_WEBHOOK_METHODS).optional().default('POST'),
  headers: z
    .array(z.object({ key: z.string().trim().max(100), value: templateString(2000) }))
    .max(WORKFLOW_MAX_HEADERS)
    .optional()
    .default([]),
  body: templateString().optional().default(''),
});

const emailStepSchema = z.object({
  id: stepId,
  type: z.literal('email'),
  to: z.string().trim().max(1000),
  subject: templateString(500).optional().default(''),
  body: templateString().optional().default(''),
});

const slackStepSchema = z.object({
  id: stepId,
  type: z.literal('slack'),
  webhookUrl: z.string().trim().max(2000),
  message: templateString(3000),
});

/** Structure of one step. Destination checks run in validateWorkflowStep (on write). */
export const workflowStepSchema = z.discriminatedUnion('type', [
  delayStepSchema,
  conditionStepSchema,
  webhookStepSchema,
  emailStepSchema,
  slackStepSchema,
]);

/** Write-time checks of a structurally valid step: destinations, headers and templates. */
function validateWorkflowStep(step: WorkflowStep, ctx: z.RefinementCtx, path: (string | number)[]) {
  const issue = (message: string, ...rest: (string | number)[]) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, ...rest], message });

  if (step.type === 'webhook') {
    const checked = checkOutboundUrl(step.url);
    if (!checked.ok) issue(checked.error, 'url');
    step.headers.forEach((header, index) => {
      const name = header.key.toLowerCase();
      if (!HEADER_NAME_PATTERN.test(header.key)) {
        issue('Invalid header name', 'headers', index, 'key');
      } else if (RESERVED_HEADER_NAMES.has(name) || name.startsWith('x-flareboard-') || name.startsWith('cf-')) {
        issue(`Header ${header.key} is set by Flareboard`, 'headers', index, 'key');
      }
      checkTemplatePlaceholders(header.value, ctx, [...path, 'headers', index, 'value']);
    });
    if (step.body.trim()) {
      checkTemplatePlaceholders(step.body, ctx, [...path, 'body']);
      try {
        JSON.parse(renderJsonTemplate(step.body, EMPTY_TEMPLATE_CONTEXT));
      } catch {
        issue('Body template must be valid JSON', 'body');
      }
    }
    return;
  }
  if (step.type === 'email') {
    const recipients = parseEmailRecipients(step.to);
    if (!recipients.length) issue('At least one recipient is required', 'to');
    else if (recipients.length > WORKFLOW_MAX_EMAIL_RECIPIENTS) {
      issue(`At most ${WORKFLOW_MAX_EMAIL_RECIPIENTS} recipients`, 'to');
    } else if (recipients.some((recipient) => !z.string().email().safeParse(recipient).success)) {
      issue('Invalid email recipient', 'to');
    }
    checkTemplatePlaceholders(step.subject, ctx, [...path, 'subject']);
    checkTemplatePlaceholders(step.body, ctx, [...path, 'body']);
    return;
  }
  if (step.type === 'slack') {
    if (!isSlackWebhookUrl(step.webhookUrl)) {
      issue('Use a Slack incoming webhook URL (https://hooks.slack.com/…)', 'webhookUrl');
    }
    if (!step.message.trim()) issue('Message is required', 'message');
    checkTemplatePlaceholders(step.message, ctx, [...path, 'message']);
  }
}

export function isSlackWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && SLACK_WEBHOOK_HOSTS.has(url.hostname.toLowerCase()) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const workflowStepsSchema = z
  .array(workflowStepSchema)
  .max(WORKFLOW_MAX_STEPS)
  .superRefine((steps, ctx) => {
    const actions = steps.filter((step) => isWorkflowActionStep(step as WorkflowStep)).length;
    if (actions > WORKFLOW_MAX_ACTION_STEPS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${WORKFLOW_MAX_ACTION_STEPS} action steps` });
    }
    const delayMinutes = steps.reduce((sum, step) => sum + (step.type === 'delay' ? step.minutes : 0), 0);
    if (delayMinutes > WORKFLOW_MAX_TOTAL_DELAY_MINUTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Delays may add up to at most 30 days' });
    }
    const ids = new Set<string>();
    steps.forEach((step, index) => {
      if (ids.has(step.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'id'], message: 'Duplicate step id' });
      }
      ids.add(step.id);
      validateWorkflowStep(step as WorkflowStep, ctx, [index]);
    });
  });

export const workflowTriggerFiltersSchema = conditionList;

/** Actions of the original one-step workflows, still accepted by the API. */
export const workflowActionTypeSchema = z.enum(['record', 'webhook', 'email']);
export const workflowActionConfigSchema = z
  .object({
    note: z.string().max(500).optional().default(''),
    url: z.string().max(500).optional().default(''),
    email: z.string().max(200).optional().default(''),
  })
  .default({});

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  triggerEvent: z.string().trim().min(1).max(200),
  enabled: z.boolean().optional().default(true),
  filters: workflowTriggerFiltersSchema.optional(),
  steps: workflowStepsSchema.optional(),
  /** @deprecated use `steps`; converted with legacyWorkflowSteps when `steps` is absent. */
  actionType: workflowActionTypeSchema.optional(),
  /** @deprecated use `steps`. */
  actionConfig: workflowActionConfigSchema.optional(),
});

export const updateWorkflowSchema = createWorkflowSchema.partial().extend({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
});

/** Body of POST /workflows/:id/test. `filters` / `steps` test unsaved editor state. */
export const workflowTestRequestSchema = z.object({
  event: z
    .object({
      name: z.string().trim().max(200).optional(),
      properties: z.record(z.unknown()).optional(),
      url: z.string().max(2000).optional(),
      distinctId: z.string().max(200).optional(),
    })
    .optional(),
  personProperties: z.record(z.unknown()).optional(),
  filters: workflowTriggerFiltersSchema.optional(),
  steps: workflowStepsSchema.optional(),
  /** False renders the actions without delivering them. */
  send: z.boolean().optional().default(false),
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;

/** Steps equivalent to a legacy single action (`actionType` + `actionConfig`). */
export function legacyWorkflowSteps(
  actionType: 'record' | 'webhook' | 'email',
  config: { url?: string; email?: string } = {},
): WorkflowStep[] {
  if (actionType === 'webhook') {
    return [{ id: 'webhook-1', type: 'webhook', url: config.url ?? '', method: 'POST', headers: [], body: '' }];
  }
  if (actionType === 'email') {
    return [{ id: 'email-1', type: 'email', to: config.email ?? '', subject: '', body: '' }];
  }
  return [];
}

/** The legacy `action_type` column value summarising a flow, for older readers. */
export function summarizeWorkflowActionType(steps: WorkflowStep[]): string {
  const types = [...new Set(steps.filter(isWorkflowActionStep).map((step) => step.type))];
  if (!types.length) return 'record';
  return types.length === 1 ? types[0]! : 'multi';
}

/**
 * Parse stored JSON steps structurally. Destinations are checked again when delivering, so a
 * legacy row with a now-refused URL still runs and records the failure. A corrupt row yields
 * null so callers can fail the execution instead of running a half-understood flow.
 */
export function parseStoredWorkflowSteps(value: unknown): WorkflowStep[] | null {
  if (value == null || value === '') return [];
  const parsed = z.array(workflowStepSchema).safeParse(parseStoredJson(value));
  return parsed.success ? (parsed.data as WorkflowStep[]) : null;
}

/**
 * Parse stored trigger filters. A corrupt row yields null so callers can fail closed
 * (never run a workflow whose filters cannot be read).
 */
export function parseStoredWorkflowFilters(value: unknown): WorkflowCondition[] | null {
  if (value == null || value === '') return [];
  const raw = parseStoredJson(value);
  const parsed = conditionList.safeParse(raw);
  return parsed.success ? (parsed.data as WorkflowCondition[]) : null;
}

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
