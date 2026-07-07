import type { Context } from 'hono';
import { isbot } from 'isbot';
import {
  COLLECTION_TYPE,
  EVENT_TYPE,
  HEATMAP_NORM_SIZE,
  createCacheToken,
  extractWebVitals,
  flattenEventData,
  getSalt,
  getSecret,
  parseToken,
  postWebhook,
  sendSchema,
  uuid,
  geoFromCf,
  visitSalt,
  type CacheToken,
  type QueueMessage,
  type SendBody,
} from '@flareboard/shared';
import { patchPersonProperties, upsertPerson, upsertPersonGroupMembership } from '@flareboard/db';
import type { Env } from '../env';
import {
  badRequest,
  getSecret as envSecret,
  json,
  safeDecodeURI,
  safeDecodeURIComponent,
  serverError,
} from '../lib/response';
import { getWebsiteById } from '../lib/queries';
import { bumpRealtimeVisitor } from '../lib/realtime-kv';
import { appendMatchedActionTags } from '../lib/actions';
import { assertEventAllowed, recordEventUsageKv } from '../lib/hosted-limits';
import { checkIpRateLimit, checkRateLimit, getTrustedClientIp } from '../lib/rate-limit';

const SEND_BODY_MAX_BYTES = 65_536;

type LogEventDataInput = {
  data?: Record<string, unknown>;
  message?: string;
  name?: string;
  level?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  service?: string;
  operation?: string;
  durationMs?: number;
  status?: string;
  release?: string;
  environment?: string;
};

export function buildLogEventDataPayload(input: LogEventDataInput) {
  return {
    ...(input.data ?? {}),
    message: input.message ?? input.name ?? '',
    level: input.level ?? 'info',
    traceId: input.traceId,
    spanId: input.spanId,
    parentSpanId: input.parentSpanId,
    service: input.service,
    operation: input.operation,
    durationMs: input.durationMs,
    status: input.status,
    release: input.release,
    environment: input.environment,
  };
}

function isBot(userAgent: string) {
  if (!userAgent) return false;
  return isbot(userAgent);
}

function heatmapNorm(kind: 'click' | 'scroll', payload: {
  x?: number;
  y?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  scrollDepth?: number;
}) {
  if (kind === 'scroll') {
    const depth = payload.scrollDepth ?? 0;
    const normY = Math.min(HEATMAP_NORM_SIZE - 1, Math.floor((depth / 100) * HEATMAP_NORM_SIZE));
    return { normX: 0, normY, viewportW: 0, viewportH: 0 };
  }
  const vw = payload.viewportWidth ?? 1;
  const vh = payload.viewportHeight ?? 1;
  const normX = Math.min(HEATMAP_NORM_SIZE - 1, Math.floor(((payload.x ?? 0) / vw) * HEATMAP_NORM_SIZE));
  const normY = Math.min(HEATMAP_NORM_SIZE - 1, Math.floor(((payload.y ?? 0) / vh) * HEATMAP_NORM_SIZE));
  return { normX, normY, viewportW: vw, viewportH: vh };
}

function deviceClass(device: string): string {
  if (device === 'mobile' || device === 'tablet' || device === 'desktop') return device;
  return '';
}

type ProcessSendOpts = {
  cacheToken?: string;
  waitUntil: (promise: Promise<void>) => void;
};

function deferWrite(waitUntil: ProcessSendOpts['waitUntil'], fn: () => Promise<void>) {
  waitUntil(fn().catch((e) => console.error('waitUntil task failed', e)));
}

async function recordWorkflowExecutions(
  env: Env,
  args: {
    websiteId: string;
    sessionId: string;
    visitId: string;
    eventId: string;
    eventName: string;
    createdAt: number;
  },
) {
  const workflows = await env.DB.prepare(
    `SELECT workflow_id as workflowId,
            name,
            action_type as actionType,
            action_config as actionConfig
     FROM workflow
     WHERE website_id = ?1 AND enabled = 1 AND trigger_event = ?2
     LIMIT 20`,
  )
    .bind(args.websiteId, args.eventName)
    .all<{ workflowId: string; name: string; actionType: string; actionConfig: string | null }>();

  for (const workflow of workflows.results ?? []) {
    const executionId = crypto.randomUUID();
    const actionConfig = parseWorkflowActionConfig(workflow.actionConfig);
    const actionState = getWorkflowActionState(workflow.actionType, actionConfig);
    await env.DB.prepare(
      `INSERT INTO workflow_execution
       (execution_id, workflow_id, website_id, session_id, visit_id, event_id, event_name, status, error, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
      .bind(
        executionId,
        workflow.workflowId,
        args.websiteId,
        args.sessionId,
        args.visitId,
        args.eventId,
        args.eventName,
        actionState.status,
        actionState.error,
        args.createdAt,
      )
      .run();

    if (actionState.status !== 'queued') continue;

    const delivery = await deliverWorkflowAction(env, {
      workflowId: workflow.workflowId,
      workflowName: workflow.name,
      actionType: workflow.actionType,
      actionConfig,
      websiteId: args.websiteId,
      sessionId: args.sessionId,
      visitId: args.visitId,
      eventId: args.eventId,
      eventName: args.eventName,
      createdAt: args.createdAt,
    });

    await env.DB.prepare(
      `UPDATE workflow_execution
       SET status = ?2, error = ?3
       WHERE execution_id = ?1`,
    )
      .bind(executionId, delivery.status, delivery.error)
      .run();
  }
}

async function deliverWorkflowAction(
  env: Env,
  input: {
    workflowId: string;
    workflowName: string;
    actionType: string;
    actionConfig: { url?: string; email?: string };
    websiteId: string;
    sessionId: string;
    visitId: string;
    eventId: string;
    eventName: string;
    createdAt: number;
  },
): Promise<{ status: 'success' | 'failed'; error: string | null }> {
  const payload = {
    type: 'workflow',
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    websiteId: input.websiteId,
    sessionId: input.sessionId,
    visitId: input.visitId,
    eventId: input.eventId,
    eventName: input.eventName,
    createdAt: input.createdAt,
  };

  if (input.actionType === 'webhook') {
    const result = await postWebhook(input.actionConfig.url ?? '', payload);
    return result.ok
      ? { status: 'success', error: null }
      : { status: 'failed', error: result.error ?? 'Webhook failed' };
  }

  if (input.actionType === 'email') {
    const to = input.actionConfig.email?.trim();
    if (!to) return { status: 'failed', error: 'Missing email recipient' };
    const apiUrl = env.API_URL?.trim();
    if (!apiUrl) return { status: 'failed', error: 'API_URL not configured' };

    const subject = `Flareboard workflow: ${input.workflowName}`;
    const text = `Workflow ${input.workflowName} fired for event ${input.eventName} on website ${input.websiteId}.`;
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/internal/deliver-email`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.APP_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, text }),
    });
    if (!response.ok) {
      return { status: 'failed', error: `Email delivery failed (${response.status})` };
    }
    return { status: 'success', error: null };
  }

  return { status: 'success', error: null };
}

function parseWorkflowActionConfig(value: string | null): { url?: string; email?: string } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      url: typeof parsed.url === 'string' ? parsed.url.trim() : '',
      email: typeof parsed.email === 'string' ? parsed.email.trim() : '',
    };
  } catch {
    return {};
  }
}

function getWorkflowActionState(
  actionType: string,
  actionConfig: { url?: string; email?: string },
): { status: 'recorded' | 'queued' | 'failed'; error: string | null } {
  if (actionType === 'webhook') {
    return actionConfig.url
      ? { status: 'queued', error: null }
      : { status: 'failed', error: 'Missing webhook URL' };
  }
  if (actionType === 'email') {
    return actionConfig.email
      ? { status: 'queued', error: null }
      : { status: 'failed', error: 'Missing email recipient' };
  }
  return { status: 'recorded', error: null };
}

function parseSendRequest(
  raw: unknown,
): { body: SendBody; cacheToken?: string } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Expected JSON object' };
  const obj = raw as Record<string, unknown>;
  const cacheToken = typeof obj.cache === 'string' ? obj.cache : undefined;
  const { cache: _cache, ...rest } = obj;
  const parsed = sendSchema.safeParse(rest);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  return { body: parsed.data, cacheToken };
}

async function parseCacheToken(
  req: Request,
  secret: string,
  cacheToken?: string,
): Promise<CacheToken | null> {
  const token = cacheToken || req.headers.get('x-flareboard-cache');
  if (!token) return null;
  const result = await parseToken(token, secret);
  return result ? (result as unknown as CacheToken) : null;
}

function applyCacheToken(
  cache: CacheToken | null,
  sourceId: string,
  sessionId: string,
): CacheToken | null {
  if (!cache) return null;
  if (cache.websiteId !== sourceId) {
    console.warn(
      JSON.stringify({
        event: 'invalid_cache_token',
        reason: 'website_mismatch',
        expected: sourceId,
        got: cache.websiteId,
      }),
    );
    return null;
  }
  if (cache.sessionId !== sessionId) {
    console.warn(
      JSON.stringify({
        event: 'invalid_cache_token',
        reason: 'session_mismatch',
        expected: sessionId,
        got: cache.sessionId,
      }),
    );
    return null;
  }
  return cache;
}

function resolveUserAgent(
  req: Request,
  payload: { userAgent?: string },
): string {
  return payload.userAgent?.trim() || req.headers.get('user-agent') || '';
}

function parseEventTimestamp(timestamp: unknown): Date | null {
  if (timestamp == null) return null;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  const ms = timestamp * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function processSend(
  env: Env,
  req: Request,
  body: SendBody,
  appSecret: string,
  opts: ProcessSendOpts,
): Promise<Response> {
  try {
    const { type, payload } = body;
    const userAgent =
      type === COLLECTION_TYPE.heatmap
        ? req.headers.get('user-agent') ?? ''
        : resolveUserAgent(req, payload);
    if (isBot(userAgent)) return json({ beep: 'boop' });

    const defer = (fn: () => Promise<void>) => deferWrite(opts.waitUntil, fn);

    if (type === COLLECTION_TYPE.heatmap) {
      const websiteId = payload.website;
      const trustedIp = getTrustedClientIp(req);
      const [rl, quota] = await Promise.all([
        checkRateLimit(env, websiteId, trustedIp, defer),
        assertEventAllowed(env, websiteId),
      ]);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!quota.ok) {
        console.warn(
          JSON.stringify({ event: 'quota_denied', websiteId, message: quota.message }),
        );
        return new Response(JSON.stringify({ message: quota.message }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const client = getClientInfoFromRequest(req, {});

      const createdAt = parseEventTimestamp(payload.timestamp) ?? new Date();
      const base = payload.hostname ? `https://${payload.hostname}` : 'https://localhost';
      const currentUrl = new URL(payload.url || '/', base);
      const urlPath =
        currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname + currentUrl.hash;
      const { normX, normY, viewportW, viewportH } = heatmapNorm(payload.kind, payload);

      const msg: QueueMessage = {
        type: 'heatmap',
        data: {
          websiteId,
          urlPath: safeDecodeURI(urlPath) ?? urlPath,
          kind: payload.kind,
          normX,
          normY,
          deviceClass: deviceClass(client.device),
          viewportW,
          viewportH,
          createdAt: createdAt.getTime(),
        },
      };
      await env.EVENT_QUEUE.send(msg);
      return json({ ok: true });
    }

    const {
      website: websiteId,
      pixel: pixelId,
      link: linkId,
      hostname,
      screen,
      language,
      url,
      referrer,
      name,
      data,
      title,
      tag,
      timestamp,
      id,
      revenue,
      currency,
      message,
      level,
      traceId,
      spanId,
      parentSpanId,
      service,
      operation,
      durationMs,
      errorName,
      stack,
      source,
      lineno,
      colno,
      severity,
      handled,
      release,
      environment,
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      latencyMs,
      status,
      quality,
      groupType,
      groupKey,
    } = payload;

    const sourceId = websiteId || pixelId || linkId!;
    const secret = getSecret(appSecret);
    const trustedIp = getTrustedClientIp(req);
    const client = getClientInfoFromRequest(req, payload);

    let cache: CacheToken | null = null;
    let billingUserId = '';
    if (websiteId) {
      const [rl, quota, parsedCache] = await Promise.all([
        checkRateLimit(env, websiteId, trustedIp, defer),
        assertEventAllowed(env, websiteId),
        parseCacheToken(req, secret, opts.cacheToken),
      ]);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!quota.ok) {
        console.warn(
          JSON.stringify({ event: 'quota_denied', websiteId, message: quota.message }),
        );
        return new Response(JSON.stringify({ message: quota.message }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      billingUserId = quota.userId;
      cache = parsedCache;

      if (!cache?.websiteId) {
        const cached = await env.CACHE.get(`website:${websiteId}`);
        if (!cached) {
          const website = await getWebsiteById(env, websiteId);
          if (!website) return badRequest('Website not found.');
          await env.CACHE.put(`website:${websiteId}`, '1', { expirationTtl: 3600 });
        }
      }
    } else {
      cache = await parseCacheToken(req, secret, opts.cacheToken);
    }

    const createdAt = parseEventTimestamp(timestamp) ?? new Date();
    const now = Math.floor(Date.now() / 1000);
    const sessionSalt = getSalt(createdAt);
    const vSalt = visitSalt(createdAt);

    const sessionId = id
      ? uuid(sourceId, id)
      : uuid(sourceId, client.ip, client.userAgent, sessionSalt);

    cache = applyCacheToken(cache, sourceId, sessionId);

    let visitId = cache?.visitId || uuid(sessionId, vSalt);
    let iat = cache?.iat || now;

    if (!timestamp && now - iat > 1800) {
      visitId = uuid(sessionId, vSalt);
      iat = now;
    }

    const messages: QueueMessage[] = [];
    let realtimeMeta: {
      urlPath?: string;
      referrerDomain?: string | null;
      country?: string | null;
    } | undefined;

    if (!cache?.sessionId) {
      messages.push({
        type: 'session',
        data: {
          id: sessionId,
          websiteId: sourceId,
          browser: client.browser,
          os: client.os,
          device: client.device,
          screen: screen ?? null,
          language: language ?? null,
          country: client.country,
          region: client.region,
          city: client.city,
          distinctId: id ?? null,
          createdAt: createdAt.getTime(),
        },
      });
    }

    if (type === COLLECTION_TYPE.event || type === COLLECTION_TYPE.error || type === COLLECTION_TYPE.log || type === COLLECTION_TYPE.ai) {
      const base = hostname ? `https://${hostname}` : 'https://localhost';
      const currentUrl = new URL(url || '/', base);
      let urlPath =
        currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname + currentUrl.hash;
      const urlQuery = currentUrl.search.substring(1);
      const urlDomain = currentUrl.hostname.replace(/^www\./, '');

      let referrerPath: string | undefined;
      let referrerQuery: string | undefined;
      let referrerDomain: string | undefined;

      const utmSource = currentUrl.searchParams.get('utm_source');
      const utmMedium = currentUrl.searchParams.get('utm_medium');
      const utmCampaign = currentUrl.searchParams.get('utm_campaign');
      const utmContent = currentUrl.searchParams.get('utm_content');
      const utmTerm = currentUrl.searchParams.get('utm_term');
      const gclid = currentUrl.searchParams.get('gclid');
      const fbclid = currentUrl.searchParams.get('fbclid');
      const msclkid = currentUrl.searchParams.get('msclkid');
      const ttclid = currentUrl.searchParams.get('ttclid');
      const lifatid = currentUrl.searchParams.get('li_fat_id');
      const twclid = currentUrl.searchParams.get('twclid');

      if (referrer) {
        const referrerUrl = new URL(referrer, base);
        referrerPath = referrerUrl.pathname;
        referrerQuery = referrerUrl.search.substring(1);
        referrerDomain = referrerUrl.hostname.replace(/^www\./, '');
      }

      const eventType =
        type === COLLECTION_TYPE.error
          ? EVENT_TYPE.error
          : type === COLLECTION_TYPE.log
            ? EVENT_TYPE.log
          : type === COLLECTION_TYPE.ai
            ? EVENT_TYPE.ai
          : linkId
            ? EVENT_TYPE.linkEvent
            : pixelId
              ? EVENT_TYPE.pixelEvent
              : name
                ? EVENT_TYPE.customEvent
                : EVENT_TYPE.pageView;

      const eventId = crypto.randomUUID();
      let eventDataPayload =
        type === COLLECTION_TYPE.error
          ? {
              ...(data ?? {}),
              message: message ?? name ?? 'Unknown error',
              name: errorName ?? 'Error',
              stack,
              source,
              lineno,
              colno,
              severity: severity ?? 'error',
              handled: handled ?? false,
              release,
              environment,
            }
          : type === COLLECTION_TYPE.log
            ? buildLogEventDataPayload({
                data,
                message,
                name,
                level,
                traceId,
                spanId,
                parentSpanId,
                service,
                operation,
                durationMs,
                status,
                release,
                environment,
              })
          : type === COLLECTION_TYPE.ai
            ? {
                ...(data ?? {}),
                provider,
                model: model ?? name ?? 'unknown',
                inputTokens,
                outputTokens,
                totalTokens: totalTokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined),
                costUsd,
                latencyMs,
                status: status ?? 'success',
                quality,
                release,
                environment,
              }
          : data;

      if (websiteId && eventDataPayload && typeof eventDataPayload === 'object') {
        eventDataPayload = await appendMatchedActionTags(env, websiteId, {
          eventName:
            type === COLLECTION_TYPE.error
              ? (message ?? name ?? 'error')
              : type === COLLECTION_TYPE.log
                ? (name ?? 'log')
                : type === COLLECTION_TYPE.ai
                  ? (name ?? 'ai_generation')
                  : (name ?? null),
          urlPath: safeDecodeURI(urlPath) ?? urlPath,
          data: eventDataPayload as Record<string, unknown>,
        });
      }

      const eventData = eventDataPayload
        ? flattenEventData(sourceId, eventId, eventDataPayload, createdAt.getTime())
        : undefined;

      if (websiteId && eventType === EVENT_TYPE.pageView) {
        realtimeMeta = {
          urlPath: safeDecodeURI(urlPath) ?? urlPath,
          referrerDomain: referrerDomain ?? null,
          country: client.country ?? null,
        };
      }

      messages.push({
        type: 'event',
        data: {
          id: eventId,
          websiteId: sourceId,
          sessionId,
          visitId,
          createdAt: createdAt.getTime(),
          urlPath: safeDecodeURI(urlPath) ?? urlPath,
          urlQuery: urlQuery || null,
          utmSource,
          utmMedium,
          utmCampaign,
          utmContent,
          utmTerm,
          referrerPath: safeDecodeURI(referrerPath) ?? referrerPath ?? null,
          referrerQuery: referrerQuery ?? null,
          referrerDomain: referrerDomain ?? null,
          pageTitle: safeDecodeURIComponent(title) ?? null,
          gclid,
          fbclid,
          msclkid,
          ttclid,
          lifatid,
          twclid,
          eventType,
          eventName:
            type === COLLECTION_TYPE.error
              ? (message ?? name ?? 'error')
              : type === COLLECTION_TYPE.log
                ? (name ?? 'log')
                : type === COLLECTION_TYPE.ai
                  ? (name ?? 'ai_generation')
                : (name ?? null),
          tag: tag ?? null,
          hostname: hostname || urlDomain,
        },
        eventData,
      });

      if (websiteId && name) {
        defer(() =>
          recordWorkflowExecutions(env, {
            websiteId,
            sessionId,
            visitId,
            eventId,
            eventName: name,
            createdAt: createdAt.getTime(),
          }),
        );
      }

      if (websiteId && revenue != null && currency) {
        messages.push({
          type: 'revenue',
          data: {
            id: crypto.randomUUID(),
            websiteId,
            sessionId,
            eventId,
            eventName: name ?? 'pageview',
            currency,
            revenue,
            createdAt: createdAt.getTime(),
          },
        });
      }

      if (websiteId && name === '$alias' && data && typeof data === 'object' && !Array.isArray(data)) {
        const alias = typeof data.alias === 'string' ? data.alias.trim() : '';
        const canonicalDistinctId =
          typeof data.distinctId === 'string' && data.distinctId.trim()
            ? data.distinctId.trim()
            : (id ?? '').trim();
        if (alias && canonicalDistinctId) {
          defer(() =>
            upsertPerson(env.DB, {
              websiteId,
              distinctId: canonicalDistinctId,
              seenAt: createdAt.getTime(),
            })
              .then((canonicalPersonId) =>
                patchPersonProperties(
                  env.DB,
                  websiteId,
                  canonicalDistinctId,
                  { $alias: alias },
                  createdAt.getTime(),
                ).then(() =>
                  upsertPerson(env.DB, {
                    websiteId,
                    distinctId: alias,
                    personId: canonicalPersonId,
                    properties: { $alias: alias, $canonical_distinct_id: canonicalDistinctId },
                    seenAt: createdAt.getTime(),
                  }),
                ),
              )
              .then(() => undefined),
          );
        }
      }
    } else if (type === COLLECTION_TYPE.identify && data) {
      const items = flattenEventData(sourceId, sessionId, data, createdAt.getTime())?.map((row) => ({
        id: row.id,
        websiteId: sourceId,
        sessionId,
        dataKey: row.dataKey,
        stringValue: row.stringValue,
        numberValue: row.numberValue,
        dateValue: row.dateValue,
        dataType: row.dataType,
        distinctId: id ?? null,
        createdAt: createdAt.getTime(),
      }));
      if (items?.length) {
        messages.push({ type: 'session_data', data: items });
      }
      if (id) {
        defer(() =>
          upsertPerson(env.DB, {
            websiteId: sourceId,
            distinctId: id,
            properties: data as Record<string, unknown>,
            seenAt: createdAt.getTime(),
          }).then(() => undefined),
        );
      }
    } else if (type === COLLECTION_TYPE.group && groupType && groupKey) {
      const groupData: Record<string, unknown> = {
        [`$group/${groupType}`]: groupKey,
      };
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          groupData[`$group/${groupType}/${key}`] = value;
        }
      }
      const items = flattenEventData(sourceId, sessionId, groupData, createdAt.getTime())?.map((row) => ({
        id: row.id,
        websiteId: sourceId,
        sessionId,
        dataKey: row.dataKey,
        stringValue: row.stringValue,
        numberValue: row.numberValue,
        dateValue: row.dateValue,
        dataType: row.dataType,
        distinctId: id ?? null,
        createdAt: createdAt.getTime(),
      }));
      if (items?.length) {
        messages.push({ type: 'session_data', data: items });
      }
      if (id) {
        defer(() =>
          upsertPersonGroupMembership(env.DB, {
            websiteId: sourceId,
            distinctId: id,
            groupType,
            groupKey,
            seenAt: createdAt.getTime(),
          }).then(() => undefined),
        );
      }
    } else if (type === COLLECTION_TYPE.performance) {
      const base = hostname ? `https://${hostname}` : 'https://localhost';
      const currentUrl = new URL(url || '/', base);
      const urlPath = currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname;
      const vitals = extractWebVitals(payload);

      messages.push({
        type: 'event',
        data: {
          id: crypto.randomUUID(),
          websiteId: sourceId,
          sessionId,
          visitId,
          createdAt: createdAt.getTime(),
          urlPath,
          pageTitle: safeDecodeURIComponent(title) ?? null,
          eventType: EVENT_TYPE.performance,
          lcp: vitals.lcp,
          inp: vitals.inp,
          cls: vitals.cls,
          fcp: vitals.fcp,
          ttfb: vitals.ttfb,
        },
      });
    }

    if (websiteId) {
      defer(() => bumpRealtimeVisitor(env, websiteId, sessionId, realtimeMeta));
    }

    const queuePromise =
      messages.length === 1
        ? env.EVENT_QUEUE.send(messages[0]!)
        : messages.length > 1
          ? env.EVENT_QUEUE.sendBatch(messages.map((body) => ({ body })))
          : Promise.resolve();

    const tokenPromise = createCacheToken(
      { websiteId: sourceId, sessionId, visitId, iat },
      getSecret(appSecret),
    );

    if (billingUserId && messages.length) {
      const billable = messages.filter((m) => m.type === 'event' || m.type === 'revenue').length;
      if (billable > 1) defer(() => recordEventUsageKv(env, billingUserId, billable - 1));
    }

    try {
      const [token] = await Promise.all([tokenPromise, queuePromise]);
      return json({ cache: token, sessionId, visitId });
    } catch (e) {
      console.error(
        JSON.stringify({
          event: 'queue_send_failed',
          websiteId: sourceId,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      throw e;
    }
  } catch (e) {
    return serverError(e);
  }
}

function getClientInfoFromRequest(
  req: Request,
  payload: { ip?: string; userAgent?: string; browser?: string; os?: string; device?: string },
) {
  const ip =
    payload.ip ??
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '127.0.0.1';
  const userAgent = payload.userAgent ?? req.headers.get('user-agent') ?? '';
  const geo = geoFromCf((req as Request & { cf?: unknown }).cf);
  const browser = payload.browser ?? parseBrowser(userAgent);
  const os = payload.os ?? parseOs(userAgent);
  const device = payload.device ?? parseDevice(userAgent);
  return { ip, userAgent, browser, os, device, ...geo };
}

function parseBrowser(ua: string): string {
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/edge/i.test(ua)) return 'Edge';
  return 'Unknown';
}

function parseOs(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os/i.test(ua)) return 'macOS';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function parseDevice(ua: string): string {
  if (/mobile/i.test(ua)) return 'mobile';
  if (/tablet/i.test(ua)) return 'tablet';
  return 'desktop';
}

export async function handleSend(c: Context<{ Bindings: Env }>) {
  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > SEND_BODY_MAX_BYTES) {
    return badRequest('Payload too large');
  }

  const contentType = c.req.header('content-type') ?? '';
  let raw: unknown;
  if (contentType.includes('application/json')) {
    raw = await c.req.json().catch(() => null);
  } else {
    const text = await c.req.text().catch(() => '');
    if (text.length > SEND_BODY_MAX_BYTES) return badRequest('Payload too large');
    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      return badRequest('Invalid JSON');
    }
  }

  const parsed = parseSendRequest(raw);
  if ('error' in parsed) return badRequest(parsed.error);

  const waitUntil = (promise: Promise<void>) => {
    c.executionCtx.waitUntil(promise);
  };

  return processSend(c.env, c.req.raw, parsed.body, envSecret(c), {
    cacheToken: parsed.cacheToken,
    waitUntil,
  });
}

const MAX_BATCH_ITEMS = 50;
const MAX_BATCH_BYTES = 512 * 1024;

export async function handleBatch(c: Context<{ Bindings: Env }>) {
  try {
    const trustedIp = getTrustedClientIp(c.req.raw);
    const batchRl = await checkIpRateLimit(c.env, 'batch', trustedIp);
    if (!batchRl.allowed) {
      return json({ message: 'Rate limit exceeded' }, 429);
    }

    const raw = await c.req.text();
    if (raw.length > MAX_BATCH_BYTES) return badRequest('Batch payload too large');

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return badRequest('Invalid JSON');
    }
    if (!Array.isArray(body)) return badRequest('Expected array');
    if (body.length > MAX_BATCH_ITEMS) return badRequest(`Batch exceeds ${MAX_BATCH_ITEMS} items`);

    const errors: Array<{ index: number; response: unknown }> = [];
    let index = 0;
    let cache: string | null = null;

    for (const data of body) {
      const parsed = sendSchema.safeParse(data);
      if (!parsed.success) {
        errors.push({ index, response: { message: parsed.error.message } });
        index++;
        continue;
      }

      const headers = new Headers(c.req.raw.headers);
      headers.set('content-type', 'application/json');
      headers.delete('content-length');

      const req = new Request(c.req.url, { method: 'POST', headers, body: JSON.stringify(data) });
      const waitUntil = (promise: Promise<void>) => {
        c.executionCtx.waitUntil(promise);
      };
      const res = await processSend(c.env, req, parsed.data, envSecret(c), { waitUntil });
      const resJson = await res.json();
      if (!res.ok) {
        errors.push({ index, response: resJson });
      } else if (!cache && (resJson as { cache?: string }).cache) {
        cache = (resJson as { cache: string }).cache;
      }
      index++;
    }

    return json({
      size: body.length,
      processed: body.length - errors.length,
      errors: errors.length,
      details: errors,
      cache,
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function handleHeartbeat(c: Context<{ Bindings: Env }>) {
  return json({ ok: true });
}

export function handleRecorder(_c: Context<{ Bindings: Env }>) {
  const script = `(function(){'use strict';
var w=window,d=document,s=d.currentScript;
function ingestOrigin(){if(s&&s.src)try{return new URL(s.src).origin}catch(_){}return location.origin}
function post(body){return fetch(ingestOrigin()+'/api/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true})}
function start(){var website=s&&s.getAttribute('data-website-id');if(!website||!w.rrweb)return;
var sid=sessionStorage.getItem('flareboard.sid');if(!sid){setTimeout(start,300);return;}
var vid=sessionStorage.getItem('flareboard.vid')||sid;
var idx=0,started=Date.now();
w.rrweb.record({emit:function(events){var ended=Date.now();post({type:'record',payload:{website:website,sessionId:sid,visitId:vid,chunkIndex:idx++,events:events,startedAt:started,endedAt:ended}});started=ended}})}
if(d.readyState==='complete')start();else w.addEventListener('load',start);
})();`;

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

export function handleScript(_c: Context<{ Bindings: Env }>) {
  const script = `(function(){'use strict';
/*
 * SPA pageviews: pushState/replaceState/popstate + hash routes (#/path).
 * Declarative events (Umami-compatible): data-flareboard-event / data-umami-event (event delegation).
 * Heatmap: sample rate from data-heatmap-sample-rate or GET /api/tracker-config (cached per session).
 * Error tracking: window error/unhandledrejection + flareboard.captureException(error, extra).
 * Logs: flareboard.log(level, message, data) keeps app messages connected to sessions.
 * AI observability: flareboard.ai({ model, inputTokens, outputTokens, costUsd, latencyMs }).
 * Sends use text/plain + cache token in body to avoid CORS preflight.
 */
var t=window,d=document,l=location,s=sessionStorage,k='flareboard.cache',idKey='flareboard.distinct_id',me=d.currentScript,lastUrl='',hmRate=0.1,hmOn=true,featureFlags=[],surveys=[],flagReady=null,flagExposures={},scrollKey='flareboard.scroll',cacheReady=null,vitalsStarted=0;
function scriptEl(){if(me)return me;return d.querySelector('script[data-website-id]')}
function postBody(type,payload){var o={type:type,payload:payload},c=s.getItem(k);if(c)o.cache=c;return JSON.stringify(o)}
function p(u,type,payload){return fetch(u,{method:'POST',headers:{'Content-Type':'text/plain'},body:postBody(type,payload),keepalive:true})}
function appPath(){var h=l.hash;if(h.length>2&&h.charAt(1)==='/'){var q=h.indexOf('?');return q>=0?h.slice(1,q+1)+h.slice(q+1):h.slice(1)}return l.pathname+l.search}
function routeKey(){return l.pathname+l.search+l.hash}
function r(){return{width:t.innerWidth+'x'+t.innerHeight,language:navigator.language,screen:screen.width+'x'+screen.height,title:d.title,hostname:l.hostname,url:appPath(),referrer:d.referrer}}
function ingestOrigin(){var el=scriptEl();if(el&&el.src)try{return new URL(el.src).origin}catch(_){}return l.protocol+'//'+l.host}
function websiteId(a){var el=a||scriptEl();return el&&el.getAttribute('data-website-id')}
function getDistinctId(){try{return(t.localStorage&&t.localStorage.getItem(idKey))||s.getItem(idKey)||''}catch(_){try{return s.getItem(idKey)||''}catch(__){return''}}}
function setDistinctId(id){if(!id)return;try{if(t.localStorage)t.localStorage.setItem(idKey,String(id))}catch(_){}try{s.setItem(idKey,String(id))}catch(_){}}
function clearDistinctId(){try{if(t.localStorage)t.localStorage.removeItem(idKey)}catch(_){}try{s.removeItem(idKey)}catch(_){}}
function hmCfgKey(w){return 'flareboard.hmCfg:'+w}
function hasCache(){return!!s.getItem(k)}
function parseResp(res){if(!res.ok)return res.text().then(function(){throw new Error('send '+res.status)});return res.json()}
function sendSafe(pr){return pr.catch(function(e){console.warn('[flareboard] send failed',e)})}
function applySendResp(x){x.cache&&s.setItem(k,x.cache);x.sessionId&&s.setItem('flareboard.sid',x.sessionId);x.visitId&&s.setItem('flareboard.vid',x.visitId);return x}
function send(type,payload){var go=function(){return p(ingestOrigin()+'/api/send',type,payload).then(parseResp).then(applySendResp)};if(hasCache())return sendSafe(go());if(!cacheReady){cacheReady=go().then(function(x){return x},function(e){cacheReady=null;throw e});return sendSafe(cacheReady)}return sendSafe(cacheReady.catch(function(){}).then(function(){return hasCache()?go():cacheReady}))}
function withFeatureData(extra){var out=Object.assign({},extra||{}),data=Object.assign({},out.data||{}),k,has=0;for(k in flagExposures){if(Object.prototype.hasOwnProperty.call(flagExposures,k)){data['$feature/'+k]=String(flagExposures[k]);has=1}}if(has)out.data=data;return out}
function trackEvent(a,extra){var w=websiteId(a);if(!w){console.warn('[flareboard] missing data-website-id');return}var o=sdkMeta();o.website=w;Object.assign(o,withFeatureData(extra));if(extra&&extra.name)setTimeout(function(){showSurvey(extra.name)},200);return send('event',o)}
function pageview(){trackEvent(scriptEl())}
function onRoute(){var u=routeKey();if(u!==lastUrl){lastUrl=u;pageview()}}
function setupSpa(){lastUrl=routeKey();var ps=history.pushState,rs=history.replaceState;history.pushState=function(){ps.apply(history,arguments);onRoute()};history.replaceState=function(){rs.apply(history,arguments);onRoute()};t.addEventListener('popstate',onRoute);t.addEventListener('hashchange',onRoute)}
function eventProps(el){var data={},i,a,n;for(i=0;i<el.attributes.length;i++){a=el.attributes[i];n=a.name;if(n==='data-flareboard-event'||n==='data-umami-event'||n==='data-flareboard-event-tag'||n==='data-umami-event-tag')continue;var m=n.match(/^data-(?:flareboard|umami)-event-(.+)$/);if(m)data[m[1]]=a.value}return data}
function fireDeclEvent(el){var ev=el.getAttribute('data-flareboard-event')||el.getAttribute('data-umami-event');if(!ev)return;var data=eventProps(el),tag=el.getAttribute('data-flareboard-event-tag')||el.getAttribute('data-umami-event-tag');trackEvent(scriptEl(),{name:ev,data:Object.keys(data).length?data:undefined,tag:tag||undefined})}
function onDeclClick(e){var el=e.target;while(el&&el!==d){if(el.getAttribute('data-flareboard-event')||el.getAttribute('data-umami-event')){fireDeclEvent(el);break}el=el.parentElement}}
function hmSample(){return hmOn&&Math.random()<hmRate}
function sendHeatmap(payload){var w=websiteId();if(!w)return;var o=r();o.website=w;send('heatmap',Object.assign(o,payload))}
function sdkMeta(extra){var el=scriptEl(),o=Object.assign(r(),extra||{}),did=getDistinctId();if(did&&!o.id)o.id=did;if(el){var rel=el.getAttribute('data-release'),env=el.getAttribute('data-environment');if(rel&&!o.release)o.release=rel;if(env&&!o.environment)o.environment=env}return o}
function normalizeError(err,extra){var o=sdkMeta(extra),e=err&&err.error?err.error:err,reason=err&&err.reason?err.reason:null,msg='Unknown error',name='Error',stack,src,ln,cn;if(e){if(typeof e==='string')msg=e;else{msg=e.message||String(e);name=e.name||name;stack=e.stack}}else if(reason){msg=reason.message||String(reason);name=reason.name||name;stack=reason.stack}if(err){src=err.filename||err.source;ln=err.lineno;cn=err.colno}o.message=o.message||msg;o.errorName=o.errorName||name;if(stack&&!o.stack)o.stack=String(stack).slice(0,12000);if(src&&!o.source)o.source=String(src);if(ln!=null&&!o.lineno)o.lineno=ln;if(cn!=null&&!o.colno)o.colno=cn;if(o.handled==null)o.handled=false;if(!o.severity)o.severity='error';return o}
function captureException(err,extra){var w=websiteId();if(!w)return;var o=normalizeError(err,extra);o.website=w;return send('error',o)}
function setupErrors(){t.addEventListener('error',function(e){captureException(e,{handled:false})},true);t.addEventListener('unhandledrejection',function(e){captureException(e,{handled:false,message:e.reason&&e.reason.message?e.reason.message:String(e.reason||'Unhandled rejection'),errorName:e.reason&&e.reason.name?e.reason.name:'UnhandledRejection',stack:e.reason&&e.reason.stack?e.reason.stack:undefined})})}
function onHmClick(e){if(!hmSample())return;var vw=t.innerWidth,vh=t.innerHeight;if(!vw||!vh)return;sendHeatmap({kind:'click',x:Math.round(e.clientX),y:Math.round(e.clientY),viewportWidth:vw,viewportHeight:vh})}
function scrollDepth(){var docH=Math.max(d.body.scrollHeight,d.documentElement.scrollHeight),vh=t.innerHeight,st=t.scrollY||d.documentElement.scrollTop;return docH<=vh?100:Math.min(100,Math.round((st+vh)/docH*100))}
function onHmScroll(){var depth=scrollDepth(),path=appPath(),key=scrollKey+':'+path,prev=parseInt(s.getItem(key)||'0',10)||0;if(depth<=prev)return;s.setItem(key,String(depth));if(!hmSample())return;sendHeatmap({kind:'scroll',scrollDepth:depth})}
function setupHeatmap(){var scrollTimer;d.addEventListener('click',onHmClick,true);t.addEventListener('scroll',function(){clearTimeout(scrollTimer);scrollTimer=setTimeout(onHmScroll,400)},{passive:true})}
function applyCfg(cfg,w){if(cfg&&typeof cfg.heatmapSampleRate==='number')hmRate=cfg.heatmapSampleRate;if(cfg&&cfg.heatmapEnabled===false)hmOn=false;featureFlags=cfg&&Array.isArray(cfg.featureFlags)?cfg.featureFlags:[];surveys=cfg&&Array.isArray(cfg.surveys)?cfg.surveys:[];if(w)s.setItem(hmCfgKey(w),JSON.stringify({rate:hmRate,on:hmOn,flags:featureFlags,surveys:surveys,exp:Date.now()+6e4}))}
function loadHmConfig(a){var el=a||scriptEl(),attr=el&&el.getAttribute('data-heatmap-sample-rate');if(attr!=null){var rv=parseFloat(attr);if(!isNaN(rv))hmRate=Math.min(1,Math.max(0,rv))}var w=websiteId(el);if(!w)return Promise.resolve(featureFlags);var cfgKey=hmCfgKey(w),raw=s.getItem(cfgKey);if(raw){try{var c=JSON.parse(raw);if(c.exp>Date.now()){hmRate=c.rate;hmOn=c.on;featureFlags=Array.isArray(c.flags)?c.flags:[];surveys=Array.isArray(c.surveys)?c.surveys:[];flagReady=Promise.resolve(featureFlags);return flagReady}}catch(_){}}flagReady=fetch(ingestOrigin()+'/api/tracker-config?website='+encodeURIComponent(w)).then(function(x){return x.json()}).then(function(cfg){applyCfg(cfg,w);return featureFlags}).catch(function(){return featureFlags});return flagReady}
function hashFlag(str){var h=2166136261,i;for(i=0;i<str.length;i++){h^=str.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)}return Math.abs(h>>>0)%100}
function flagByKey(key){for(var i=0;i<featureFlags.length;i++)if(featureFlags[i].key===key)return featureFlags[i];return null}
function flagValue(field){if(field==='path')return appPath();if(field==='url')return l.href;if(field==='hostname')return l.hostname;if(field==='referrer')return d.referrer;if(field==='language')return navigator.language||'';if(field==='userAgent')return navigator.userAgent||'';return ''}
function matchRule(rule){if(!rule||!rule.field||!rule.operator||rule.value==null)return true;var left=String(flagValue(rule.field)).toLowerCase(),right=String(rule.value).toLowerCase(),op=rule.operator;if(op==='equals')return left===right;if(op==='contains')return left.indexOf(right)>=0;if(op==='starts_with')return left.indexOf(right)===0;if(op==='ends_with')return left.slice(-right.length)===right;if(op==='not_equals')return left!==right;if(op==='not_contains')return left.indexOf(right)<0;return true}
function flagMatches(f){var rules=Array.isArray(f.targetingRules)?f.targetingRules:[];for(var i=0;i<rules.length;i++)if(!matchRule(rules[i]))return false;return true}
function featureVariant(key,fallback){var f=flagByKey(key);if(!f)return fallback===undefined?false:fallback;if(!f.enabled||!flagMatches(f))return 'control';var pct=typeof f.rollout==='number'?f.rollout:100,sid=s.getItem('flareboard.sid')||s.getItem('flareboard.vid')||navigator.userAgent||'anonymous';if(pct<=0)return 'control';if(pct<100&&hashFlag(key+':'+sid)>=pct)return 'control';var vars=Array.isArray(f.variants)?f.variants:[];if(vars.length){var b=hashFlag(key+':variant:'+sid),sum=0,last='control';for(var i=0;i<vars.length;i++){var v=vars[i],w=Math.max(0,Math.min(100,Number(v.weight||0)));if(v&&v.key)last=String(v.key);sum+=w;if(b<sum)return last}return sum>=100?last:'control'}return 'test'}
function exposeFlag(key,variant){if(flagExposures[key])return;flagExposures[key]=String(variant);var data={'$feature_flag':key,'$feature_flag_response':String(variant)};data['$feature/'+key]=String(variant);trackEvent(scriptEl(),{name:'$feature_flag_called',data:data,tag:'feature_flag'})}
function getFeatureFlag(key,fallback){var v=featureVariant(key,fallback);if(flagByKey(key))exposeFlag(key,v);return v}
function isFeatureEnabled(key,fallback){var v=getFeatureFlag(key,fallback);return v===true||(v!==false&&v!=='control')}
function surveyStorageKey(id){return 'flareboard.survey:'+id}
function surveySeen(id){try{if(t.localStorage&&t.localStorage.getItem(surveyStorageKey(id)))return true}catch(_){}try{return!!s.getItem(surveyStorageKey(id))}catch(_){return false}}
function markSurvey(id){try{if(t.localStorage)t.localStorage.setItem(surveyStorageKey(id),'1')}catch(_){}try{s.setItem(surveyStorageKey(id),'1')}catch(_){}}
function surveyMatches(sv,eventName){var pth=appPath(),tr=sv&&sv.triggerPath,ev=sv&&sv.triggerEvent;if(ev&&ev!==eventName)return false;if(!ev&&eventName)return false;if(tr&&!(pth===tr||pth.indexOf(tr+'?')===0||pth.indexOf(tr+'/')===0))return false;return true}
function pickSurvey(eventName){for(var i=0;i<surveys.length;i++){if(surveys[i]&&surveys[i].id&&!surveySeen(surveys[i].id)&&surveyMatches(surveys[i],eventName))return surveys[i]}return null}
function submitSurvey(sv,answer){var w=websiteId();if(!w)return Promise.resolve();return fetch(ingestOrigin()+'/api/surveys/response',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({website:w,surveyId:sv.id,sessionId:s.getItem('flareboard.sid'),visitId:s.getItem('flareboard.vid'),answer:answer,urlPath:appPath()}),keepalive:true})}
function showSurvey(eventName){if(d.getElementById('flareboard-survey'))return;var sv=pickSurvey(eventName);if(!sv)return;var delay=Math.min(60,Math.max(0,Number(sv.displayDelaySeconds||0)));if(delay>0){sv.displayDelaySeconds=0;setTimeout(function(){showSurvey(eventName)},delay*1000);return}var box=d.createElement('div'),q=d.createElement('div'),inputWrap=d.createElement('div'),ta=null,selected='',actions=d.createElement('div'),sendBtn=d.createElement('button'),closeBtn=d.createElement('button');box.id='flareboard-survey';box.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(340px,calc(100vw - 36px));box-sizing:border-box;padding:16px;border:1px solid rgba(148,163,184,.45);border-radius:10px;background:#fff;color:#111827;box-shadow:0 14px 32px rgba(15,23,42,.18);font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';q.textContent=sv.question||sv.name||'Feedback';q.style.cssText='font-weight:700;margin-bottom:10px';inputWrap.style.cssText='display:grid;gap:8px';function chooseButton(btns,b,value){selected=value;for(var bi=0;bi<btns.length;bi++){btns[bi].style.borderColor='rgba(148,163,184,.65)';btns[bi].style.background='#fff';btns[bi].style.color='#111827'}b.style.borderColor='#0d9488';b.style.background='rgba(13,148,136,.1)';b.style.color='#0f766e'}if(sv.type==='choice'&&Array.isArray(sv.options)&&sv.options.length){for(var oi=0;oi<sv.options.length;oi++){var opt=d.createElement('button');opt.type='button';opt.textContent=String(sv.options[oi]);opt.style.cssText='box-sizing:border-box;width:100%;text-align:left;border:1px solid rgba(148,163,184,.65);border-radius:8px;background:#fff;color:#111827;padding:9px 10px;font:inherit;cursor:pointer';inputWrap.appendChild(opt);opt.onclick=function(){chooseButton(inputWrap.querySelectorAll('button'),this,this.textContent||'')}}}else if(sv.type==='rating'){var rating=d.createElement('div');rating.style.cssText='display:grid;grid-template-columns:repeat(5,1fr);gap:6px';inputWrap.appendChild(rating);for(var ri=1;ri<=5;ri++){(function(n){var rb=d.createElement('button');rb.type='button';rb.textContent=String(n);rb.style.cssText='border:1px solid rgba(148,163,184,.65);border-radius:8px;background:#fff;color:#111827;padding:9px 0;font:inherit;font-weight:700;cursor:pointer';rating.appendChild(rb);rb.onclick=function(){chooseButton(rating.querySelectorAll('button'),rb,String(n))}})(ri)}}else{ta=d.createElement('textarea');ta.rows=4;ta.placeholder='Share your feedback';ta.style.cssText='box-sizing:border-box;width:100%;resize:vertical;border:1px solid rgba(148,163,184,.65);border-radius:8px;padding:9px 10px;font:inherit;color:inherit;background:#fff';inputWrap.appendChild(ta)}actions.style.cssText='display:flex;justify-content:flex-end;gap:8px;margin-top:10px';sendBtn.type='button';sendBtn.textContent='Send';sendBtn.style.cssText='border:0;border-radius:8px;background:#0d9488;color:#fff;padding:8px 12px;font-weight:700;cursor:pointer';closeBtn.type='button';closeBtn.textContent='Close';closeBtn.style.cssText='border:1px solid rgba(148,163,184,.65);border-radius:8px;background:#fff;color:#374151;padding:8px 12px;cursor:pointer';closeBtn.onclick=function(){markSurvey(sv.id);box.remove()};sendBtn.onclick=function(){var v=ta?ta.value.trim():selected;if(!v){if(ta)ta.focus();return}sendBtn.disabled=true;submitSurvey(sv,v).then(function(){markSurvey(sv.id);box.remove();trackEvent(scriptEl(),{name:'survey_response',data:{surveyId:sv.id},tag:'survey'})}).catch(function(){sendBtn.disabled=false})};actions.appendChild(closeBtn);actions.appendChild(sendBtn);box.appendChild(q);box.appendChild(inputWrap);box.appendChild(actions);d.body&&d.body.appendChild(box)}
function collectVitals(a){if(vitalsStarted||!t.PerformanceObserver)return;vitalsStarted=1;var w=websiteId(a);if(!w)return;try{var o=r();o.website=w;var m={},sent=0,clsV=0,obs=[];function readTtfb(){try{var n=t.performance.getEntriesByType('navigation')[0];if(n){var st=n.activationStart||0,v=n.responseStart-st;if(v>=0&&v<6e4)return Math.round(v)}}catch(_){}}function readFcp(){try{var p=t.performance.getEntriesByType('paint'),i;for(i=0;i<p.length;i++)if(p[i].name==='first-contentful-paint')return Math.round(p[i].startTime)}catch(_){}}function readLcp(){try{var e=t.performance.getEntriesByType('largest-contentful-paint');if(e.length)return Math.round(e[e.length-1].startTime)}catch(_){}}function has(){return m.lcp!=null||m.inp!=null||m.cls!=null||m.fcp!=null||m.ttfb!=null}function cleanup(){for(var i=0;i<obs.length;i++)try{obs[i].disconnect()}catch(_){}obs=[];d.removeEventListener('visibilitychange',onVis);t.removeEventListener('pagehide',onLeave)}function flush(){if(sent)return;if(m.ttfb==null)m.ttfb=readTtfb();if(m.fcp==null)m.fcp=readFcp();if(m.lcp==null)m.lcp=readLcp();if(!has())return;sent=1;if(m.lcp!=null)o.lcp=m.lcp;if(m.inp!=null)o.inp=m.inp;if(m.cls!=null)o.cls=m.cls;if(m.fcp!=null)o.fcp=m.fcp;if(m.ttfb!=null)o.ttfb=m.ttfb;send('performance',o);cleanup()}function onVis(){if(d.visibilityState==='hidden')flush()}function onLeave(){flush()}function addObs(ob){try{obs.push(ob)}catch(_){}}try{addObs(new PerformanceObserver(function(l){var e=l.getEntries();if(e.length)m.lcp=Math.round(e[e.length-1].startTime)}));obs[obs.length-1].observe({type:'largest-contentful-paint',buffered:true})}catch(_){}try{addObs(new PerformanceObserver(function(l){var e=l.getEntries(),i;for(i=0;i<e.length;i++)if(e[i].name==='first-contentful-paint')m.fcp=Math.round(e[i].startTime)}));obs[obs.length-1].observe({type:'paint',buffered:true})}catch(_){}try{addObs(new PerformanceObserver(function(l){var e=l.getEntries();if(e.length)m.inp=Math.round(e[e.length-1].duration)}));obs[obs.length-1].observe({type:'event',buffered:true,durationThreshold:40})}catch(_){}try{addObs(new PerformanceObserver(function(l){var e=l.getEntries(),i;for(i=0;i<e.length;i++){if(!e[i].hadRecentInput)clsV+=e[i].value}m.cls=Math.round(clsV*1e4)/1e4}));obs[obs.length-1].observe({type:'layout-shift',buffered:true})}catch(_){}m.ttfb=readTtfb();m.fcp=readFcp();setTimeout(flush,1e4);d.addEventListener('visibilitychange',onVis);t.addEventListener('pagehide',onLeave)}catch(_){}}
function init(){var a=scriptEl();if(!websiteId(a))return;var cfg=loadHmConfig(a);pageview();setupSpa();d.addEventListener('click',onDeclClick,true);setupHeatmap();setupErrors();collectVitals(a);if(cfg&&cfg.then)cfg.then(function(){setTimeout(showSurvey,600)});else setTimeout(showSurvey,800);var api={track:function(n,data,tag){return trackEvent(scriptEl(),{name:n,data:data||undefined,tag:tag||undefined})},identify:function(id,data){var w=websiteId();if(!w||!id)return;setDistinctId(id);return send('identify',{website:w,id:id,data:data||{}})},alias:function(alias,distinctId){return trackEvent(scriptEl(),{name:'$alias',data:{alias:alias,distinctId:distinctId||getDistinctId()||null},tag:'identity'})},group:function(type,key,data){var w=websiteId();if(!w||!type||!key)return;return send('group',{website:w,id:getDistinctId()||undefined,groupType:String(type),groupKey:String(key),data:data||{}})},reset:function(){clearDistinctId();try{s.removeItem(k);s.removeItem('flareboard.sid');s.removeItem('flareboard.vid')}catch(_){}flagExposures={}},revenue:function(amount,currency,extra){return trackEvent(scriptEl(),Object.assign({revenue:amount,currency:currency||'USD'},extra||{}))},log:function(level,message,data){var w=websiteId();if(!w)return;var o=sdkMeta();o.website=w;o.level=level||'info';o.message=message||'';o.data=data||undefined;return send('log',o)},ai:function(data){var w=websiteId();if(!w)return;var o=sdkMeta(data||{});o.website=w;return send('ai',o)},captureException:function(error,extra){return captureException(error,Object.assign({handled:true},extra||{}))},page:function(){return pageview()},getDistinctId:function(){return getDistinctId()},getSessionId:function(){return s.getItem('flareboard.sid')},getVisitId:function(){return s.getItem('flareboard.vid')},getFeatureFlag:function(key,fallback){return getFeatureFlag(key,fallback)},getFeatureFlagVariant:function(key,fallback){return getFeatureFlag(key,fallback)},isFeatureEnabled:function(key,fallback){return isFeatureEnabled(key,fallback)},featureFlagsReady:function(){return flagReady||Promise.resolve(featureFlags)},showSurvey:function(){return showSurvey()}};t.flareboard=api;t.Flareboard=api}
init();
})();`;

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
