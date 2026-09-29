import type { Context } from 'hono';
import type { Env } from '../env';
import { evaluateAllFlags, hasEnabledFlags } from '../lib/feature-flags';
import { assertEventAllowed } from '../lib/hosted-limits';
import { PostHogBodyError, readPostHogBody } from '../lib/posthog/body';
import { flagsContext, flagsResponse, remoteConfig, requestedFlagKeys } from '../lib/posthog/decide';
import {
  extractPostHogRequest,
  isBrowserUserAgent,
  isRecord,
  MAX_EVENTS_PER_REQUEST,
  normalizePostHogEvent,
  type PostHogEvent,
} from '../lib/posthog/events';
import { capturePostHogEvents } from '../lib/posthog/pipeline';
import { resolveProjectKey } from '../lib/project-keys';
import { checkProjectKeyRateLimit } from '../lib/rate-limit';
import { json, serverError } from '../lib/response';
import { isBot } from './collect';

/**
 * PostHog-compatible ingestion: point posthog-js / posthog-node / posthog-python at the ingest
 * host (`api_host` / `host`) and use the website's project key (`fb_pk_…`) as the API key.
 * See docs/ingest-posthog-compat.md.
 */

type Ctx = Context<{ Bindings: Env }>;

function validationError(detail: string, status: 400 | 413 = 400) {
  return json({ type: 'validation_error', code: 'invalid_payload', detail }, status);
}

function invalidKey() {
  return json(
    {
      type: 'authentication_error',
      code: 'invalid_api_key',
      detail: 'Project API key invalid. Use the fb_pk_ project key from your Flareboard website settings.',
    },
    401,
  );
}

function rateLimited() {
  return json({ type: 'rate_limited', code: 'rate_limited', detail: 'Rate limit exceeded' }, 429);
}

async function readBody(c: Ctx): Promise<{ body: unknown } | { error: Response }> {
  try {
    return { body: await readPostHogBody(c.req.raw) };
  } catch (error) {
    if (error instanceof PostHogBodyError) return { error: validationError(error.message, error.status) };
    throw error;
  }
}

/** `/capture/`, `/e/`, `/i/v0/e/`, `/batch/`, `/track/`: single events, arrays and batches. */
export async function handleCapture(c: Ctx) {
  try {
    const read = await readBody(c);
    if ('error' in read) return read.error;

    const request = extractPostHogRequest(read.body, new URL(c.req.url));
    if (!request.token) return invalidKey();
    const websiteId = await resolveProjectKey(c.env, request.token);
    if (!websiteId) return invalidKey();

    if (!request.events.length) return validationError('No events in payload');
    if (request.events.length > MAX_EVENTS_PER_REQUEST) {
      return validationError(`At most ${MAX_EVENTS_PER_REQUEST} events per request`, 413);
    }
    // An event naming another project's key is dropped: one request writes to one website.
    const events = request.events
      .map(normalizePostHogEvent)
      .filter((event): event is PostHogEvent => Boolean(event) && (!event!.token || event!.token === request.token));
    if (!events.length) return validationError('No valid events: each event needs an event name and a distinct_id');

    const [rl, quota] = await Promise.all([
      checkProjectKeyRateLimit(c.env, request.token),
      assertEventAllowed(c.env, websiteId),
    ]);
    if (!rl.allowed) return rateLimited();
    if (!quota.ok) {
      console.warn(JSON.stringify({ event: 'quota_denied', websiteId, message: quota.message }));
      return json({ type: 'quota_limited', code: 'quota_limited', detail: quota.message }, 402);
    }

    // Browser traffic from crawlers is dropped like the tracker's; server SDKs are filtered per
    // event by `$raw_user_agent` in the pipeline.
    const ua = c.req.header('user-agent') ?? '';
    if (isBrowserUserAgent(ua) && isBot(ua)) return json({ status: 1 });

    await capturePostHogEvents({
      env: c.env,
      req: c.req.raw,
      websiteId,
      billingUserId: quota.userId,
      events,
      sentAt: request.sentAt,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
    });
    return json({ status: 1 });
  } catch (error) {
    return serverError(error);
  }
}

/** `/decide/` and `/flags/`: feature flags (v2/v3/v4 response shapes) plus the SDK config. */
export async function handleFlags(c: Ctx) {
  try {
    const read = await readBody(c);
    if ('error' in read) return read.error;
    const body = isRecord(read.body) ? read.body : {};
    const token =
      (typeof body.token === 'string' && body.token) ||
      (typeof body.api_key === 'string' && body.api_key) ||
      c.req.query('token') ||
      '';
    const websiteId = token ? await resolveProjectKey(c.env, token) : null;
    if (!websiteId) return invalidKey();

    const rl = await checkProjectKeyRateLimit(c.env, token, 'flags');
    if (!rl.allowed) return rateLimited();

    if (body.disable_flags === true) return json(flagsResponse([], await hasEnabledFlags(c.env, websiteId)));
    const flags = await evaluateAllFlags(c.env, websiteId, flagsContext(body), requestedFlagKeys(body));
    return json(flagsResponse(flags, flags.length > 0 || (await hasEnabledFlags(c.env, websiteId))));
  } catch (error) {
    return serverError(error);
  }
}

async function configFor(c: Ctx) {
  const token = c.req.param('token') ?? '';
  const websiteId = await resolveProjectKey(c.env, token);
  if (!websiteId) return null;
  const rl = await checkProjectKeyRateLimit(c.env, token, 'flags');
  if (!rl.allowed) return 'rate_limited' as const;
  return { token, ...remoteConfig(await hasEnabledFlags(c.env, websiteId)) };
}

/** `GET /array/<key>/config`: remote config posthog-js loads on start. */
export async function handleRemoteConfig(c: Ctx) {
  const config = await configFor(c);
  if (config === 'rate_limited') return rateLimited();
  if (!config) return json({ type: 'validation_error', code: 'invalid_token', detail: 'Unknown project key' }, 404);
  return new Response(JSON.stringify(config), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  });
}

/** `GET /array/<key>/config.js`: the same config as a script, the form posthog-js tries first. */
export async function handleRemoteConfigJs(c: Ctx) {
  const config = await configFor(c);
  if (config === 'rate_limited') return rateLimited();
  if (!config) return new Response('/* unknown project key */', { status: 404, headers: { 'Content-Type': 'application/javascript' } });
  const script = `(function(){window._POSTHOG_REMOTE_CONFIG=window._POSTHOG_REMOTE_CONFIG||{};window._POSTHOG_REMOTE_CONFIG[${JSON.stringify(config.token)}]={config:${JSON.stringify(config)},siteApps:[]}})();`;
  return new Response(script, {
    headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=60' },
  });
}
