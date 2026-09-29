import {
  WORKFLOW_SIGNATURE_HEADER,
  WORKFLOW_TIMESTAMP_HEADER,
  checkOutboundUrl,
  isRetryableWorkflowStatus,
  isSlackWebhookUrl,
  signWorkflowPayload,
  type RenderedWorkflowAction,
  type WorkflowHeader,
} from '@flareboard/shared';
import type { Env } from '../env';
import { sendEmail } from './email';

/** Webhook and Slack requests are aborted after this long (counts as a retryable failure). */
export const WORKFLOW_DELIVERY_TIMEOUT_MS = 10_000;
/** Response bodies kept in the attempt log and shown by test sends. */
export const WORKFLOW_RESPONSE_BODY_MAX_CHARS = 1_000;

const USER_AGENT = 'Flareboard-Webhooks/1.0 (+https://flareboard.dev)';

export type WorkflowDeliveryOutcome = {
  ok: boolean;
  /** Another attempt may succeed (network error, timeout, 408/425/429/5xx, email send error). */
  retryable: boolean;
  statusCode: number | null;
  error: string | null;
  responseBody: string | null;
  durationMs: number;
};

export type WorkflowDeliveryMeta = {
  /** Stable per step and attempt; receivers can use it to drop duplicates. */
  deliveryId: string;
  executionId: string;
  attempt: number;
  eventName: string;
  /** Per-workflow HMAC key; webhooks are unsigned only when it is missing. */
  signingSecret: string | null;
  test?: boolean;
};

/** The request as it goes on the wire, for test-send previews. */
export type WorkflowDeliveryRequest =
  | { type: 'webhook' | 'slack'; method: string; url: string; headers: WorkflowHeader[]; body: string | null }
  | { type: 'email'; to: string[]; subject: string; text: string };

function outcome(
  partial: Partial<WorkflowDeliveryOutcome> & Pick<WorkflowDeliveryOutcome, 'ok'>,
  startedAt: number,
): WorkflowDeliveryOutcome {
  return {
    retryable: false,
    statusCode: null,
    error: null,
    responseBody: null,
    ...partial,
    durationMs: Date.now() - startedAt,
  };
}

/** Read at most `max` characters of a response body without buffering the rest. */
export async function readTruncatedBody(response: Response, max = WORKFLOW_RESPONSE_BODY_MAX_CHARS): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length <= max) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // A body that fails mid-stream still yields what arrived.
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Headers for a webhook request. Flareboard's own headers are added last so a step's custom
 * headers can never replace the signature (validation also refuses X-Flareboard-* names).
 */
export async function buildWebhookHeaders(
  action: Extract<RenderedWorkflowAction, { type: 'webhook' }>,
  meta: WorkflowDeliveryMeta,
  now = Date.now(),
): Promise<WorkflowHeader[]> {
  const headers: WorkflowHeader[] = [];
  const hasContentType = action.headers.some((header) => header.key.toLowerCase() === 'content-type');
  if (action.body !== null && !hasContentType) headers.push({ key: 'Content-Type', value: 'application/json' });
  headers.push(...action.headers);
  const timestamp = Math.floor(now / 1000);
  headers.push(
    { key: 'User-Agent', value: USER_AGENT },
    { key: 'X-Flareboard-Event', value: meta.eventName },
    { key: 'X-Flareboard-Delivery', value: meta.deliveryId },
    { key: 'X-Flareboard-Execution', value: meta.executionId },
    { key: 'X-Flareboard-Attempt', value: String(meta.attempt) },
    { key: WORKFLOW_TIMESTAMP_HEADER, value: String(timestamp) },
  );
  if (meta.signingSecret) {
    headers.push({
      key: WORKFLOW_SIGNATURE_HEADER,
      value: await signWorkflowPayload(meta.signingSecret, timestamp, action.body ?? ''),
    });
  }
  if (meta.test) headers.push({ key: 'X-Flareboard-Test', value: '1' });
  return headers;
}

async function sendHttp(
  method: string,
  url: string,
  headers: WorkflowHeader[],
  body: string | null,
  startedAt: number,
): Promise<WorkflowDeliveryOutcome> {
  const checked = checkOutboundUrl(url);
  if (!checked.ok) return outcome({ ok: false, error: `Destination refused: ${checked.error}` }, startedAt);

  const init: RequestInit = {
    method,
    headers: headers.map((header) => [header.key, header.value] as [string, string]),
    body: body ?? undefined,
    // A public host must not bounce the request to an internal one.
    redirect: 'manual',
    signal: AbortSignal.timeout(WORKFLOW_DELIVERY_TIMEOUT_MS),
  };
  let response: Response;
  try {
    response = await fetch(checked.url.toString(), init);
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return outcome(
      {
        ok: false,
        retryable: true,
        error: timedOut
          ? `Timed out after ${WORKFLOW_DELIVERY_TIMEOUT_MS / 1000}s`
          : `Request failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
      },
      startedAt,
    );
  }
  const responseBody = await readTruncatedBody(response);
  if (response.status >= 200 && response.status < 300) {
    return outcome({ ok: true, statusCode: response.status, responseBody }, startedAt);
  }
  if (response.status >= 300 && response.status < 400) {
    return outcome(
      {
        ok: false,
        statusCode: response.status,
        responseBody,
        error: `Redirect (${response.status}) not followed; use the final URL`,
      },
      startedAt,
    );
  }
  return outcome(
    {
      ok: false,
      retryable: isRetryableWorkflowStatus(response.status),
      statusCode: response.status,
      responseBody,
      error: `Destination returned ${response.status}`,
    },
    startedAt,
  );
}

/** The request `deliverWorkflowAction` sends, with the headers it adds. */
export async function describeWorkflowRequest(
  action: RenderedWorkflowAction,
  meta: WorkflowDeliveryMeta,
  now = Date.now(),
): Promise<WorkflowDeliveryRequest> {
  if (action.type === 'webhook') {
    return {
      type: 'webhook',
      method: action.method,
      url: action.url,
      headers: await buildWebhookHeaders(action, meta, now),
      body: action.body,
    };
  }
  if (action.type === 'slack') {
    return {
      type: 'slack',
      method: 'POST',
      url: action.url,
      headers: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'User-Agent', value: USER_AGENT },
      ],
      body: action.body,
    };
  }
  return { type: 'email', to: action.to, subject: action.subject, text: action.text };
}

/** One delivery attempt. Never throws: every failure is reported in the outcome. */
export async function deliverWorkflowAction(
  env: Env,
  action: RenderedWorkflowAction,
  meta: WorkflowDeliveryMeta,
): Promise<{ outcome: WorkflowDeliveryOutcome; request: WorkflowDeliveryRequest }> {
  const startedAt = Date.now();
  const request = await describeWorkflowRequest(action, meta, startedAt);

  if (request.type === 'email') {
    if (!request.to.length) {
      return { outcome: outcome({ ok: false, error: 'Missing email recipient' }, startedAt), request };
    }
    try {
      const sent = await sendEmail(env, {
        to: request.to,
        subject: request.subject,
        text: request.text,
        html: action.type === 'email' ? action.html : request.text,
      });
      return {
        outcome: sent
          ? outcome({ ok: true }, startedAt)
          : outcome({ ok: false, error: 'Email sending is not configured on this deployment' }, startedAt),
        request,
      };
    } catch (error) {
      return {
        outcome: outcome(
          {
            ok: false,
            retryable: true,
            error: `Email send failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
          },
          startedAt,
        ),
        request,
      };
    }
  }

  if (request.type === 'slack' && !isSlackWebhookUrl(request.url)) {
    return { outcome: outcome({ ok: false, error: 'Not a Slack incoming webhook URL' }, startedAt), request };
  }
  return {
    outcome: await sendHttp(request.method, request.url, request.headers, request.body, startedAt),
    request,
  };
}
