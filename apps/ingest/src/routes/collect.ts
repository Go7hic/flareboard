import type { Context } from 'hono';
import { isbot } from 'isbot';
import {
  ERROR_FINGERPRINT_PROPERTY,
  COLLECTION_TYPE,
  EVENT_TYPE,
  HEATMAP_NORM_SIZE,
  createCacheToken,
  extractWebVitals,
  getSalt,
  getSecret,
  parseToken,
  sendSchema,
  uuid,
  geoFromCf,
  isProjectKey,
  visitSalt,
  type CacheToken,
  type QueueMessage,
  type SendBody,
} from '@flareboard/shared';
import { upsertPerson, upsertPersonGroupMembership } from '@flareboard/db';
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
import { hitAllowed, recordHit, sourceExists, type HitSource } from '../lib/link-pixel-hits';
import { bumpRealtimeVisitor } from '../lib/realtime-kv';
import { appendMatchedActionTags } from '../lib/actions';
import { assertEventAllowed, recordEventUsageKv } from '../lib/hosted-limits';
import { checkIpRateLimit, checkProjectKeyRateLimit, checkRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import { enqueueWorkflowTriggers } from '../lib/workflows';
import { buildErrorEventDataPayload, reportPossibleRegression } from '../lib/error-tracking';
import { resolveDistinctId } from '../lib/tracker-settings';
import { TRACKER_SCRIPT } from '../tracker/script';
import { RECORDER_SCRIPT } from '../tracker/recorder';
import { eventMessage, pageContext, parsePageUrl, sessionDataMessage, sessionMessage } from '../lib/queue-messages';
import { recordAlias } from '../lib/person-identity';
import { writeSiteTables } from '../lib/site-db';
import { resolveWebsiteRef } from '../lib/project-keys';

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

/**
 * HTTP libraries (server SDKs, curl) are deliberate API callers, not crawlers
 * replaying pages, and isbot flags them all. Letting them through opens nothing
 * new: any sender can already pick a browser UA. Crawlers are still filtered.
 */
const HTTP_CLIENT_UA =
  /^(?:node|undici|node-fetch|axios|got|python-requests|python-httpx|python-urllib|aiohttp|go-http-client|curl|wget|okhttp|java|apache-httpclient|ruby|faraday|guzzlehttp|php|dart|reqwest)\b/i;

export function isBot(userAgent: string) {
  if (!userAgent || HTTP_CLIENT_UA.test(userAgent)) return false;
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
  /** The payload named its website by project key: rate limit per key instead of per IP. */
  projectKey?: string;
  waitUntil: (promise: Promise<void>) => void;
};

function deferWrite(waitUntil: ProcessSendOpts['waitUntil'], fn: () => Promise<void>) {
  waitUntil(fn().catch((e) => console.error('waitUntil task failed', e)));
}

/**
 * A project key in `payload.website` (e.g. `data-website-id="fb_pk_…"`) is swapped for the
 * website id before validation. Returns the key so the request is rate limited per key.
 */
async function resolvePayloadWebsite(
  env: Env,
  raw: unknown,
): Promise<{ projectKey?: string } | { error: string }> {
  const payload = raw && typeof raw === 'object' ? (raw as { payload?: unknown }).payload : undefined;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  if (typeof record.website !== 'string') return {};
  const ref = await resolveWebsiteRef(env, record.website);
  if (!ref) return { error: 'Website not found.' };
  record.website = ref.websiteId;
  return { projectKey: ref.projectKey };
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

/** Backfilled events may be this old; anything earlier (or in the future) is rejected. */
const MAX_EVENT_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Client `timestamp` is seconds since the epoch; SDKs that send milliseconds are
 * accepted too. Values outside [now - 90 days, now + 5 min] fall back to server time,
 * so a bad clock or unit cannot write rollups for 1970 or year 55840.
 */
export function parseEventTimestamp(timestamp: unknown, nowMs = Date.now()): Date | null {
  if (timestamp == null) return null;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const ms = timestamp > 1e11 ? timestamp : timestamp * 1000;
  if (ms < nowMs - MAX_EVENT_AGE_MS || ms > nowMs + MAX_CLOCK_SKEW_MS) return null;
  return new Date(ms);
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
    // Bot detection must use the trusted request header; payload.userAgent is
    // client-controlled and only used for device/browser display parsing.
    if (isBot(req.headers.get('user-agent') ?? '')) return json({ beep: 'boop' });

    const defer = (fn: () => Promise<void>) => deferWrite(opts.waitUntil, fn);
    const rateLimit = (websiteId: string, trustedIp: string) =>
      opts.projectKey ? checkProjectKeyRateLimit(env, opts.projectKey) : checkRateLimit(env, websiteId, trustedIp);

    if (type === COLLECTION_TYPE.heatmap) {
      const websiteId = payload.website;
      const trustedIp = getTrustedClientIp(req);
      const [rl, quota] = await Promise.all([
        rateLimit(websiteId, trustedIp),
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
      const cachedWebsite = await env.CACHE.get(`website:${websiteId}`);
      if (!cachedWebsite) {
        const website = await getWebsiteById(env, websiteId);
        if (!website) return badRequest('Website not found.');
        await env.CACHE.put(`website:${websiteId}`, '1', { expirationTtl: 3600 });
      }
      const client = getClientInfoFromRequest(req, {});

      const createdAt = parseEventTimestamp(payload.timestamp) ?? new Date();
      const currentUrl = parsePageUrl(payload.url, payload.hostname);
      const urlPath =
        currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname + currentUrl.hash;
      const { normX, normY, viewportW, viewportH } = heatmapNorm(payload.kind, payload);

      const msg: QueueMessage = {
        type: 'heatmap',
        data: {
          id: crypto.randomUUID(),
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
      if (quota.userId) {
        const billingUserId = quota.userId;
        defer(() => recordEventUsageKv(env, billingUserId, 1));
      }
      return json({ ok: true });
    }

    // Link and pixel ids are not websites: queueing them as website events fails the
    // website_id foreign key. Record a hit instead, with the existence check and
    // per-IP cap the website path gets from its own rate limit.
    if (!payload.website && (payload.link || payload.pixel)) {
      const source: HitSource = payload.link ? 'link' : 'pixel';
      const sourceId = (payload.link ?? payload.pixel)!;
      if (!(await sourceExists(env, source, sourceId))) return badRequest(`Unknown ${source}.`);
      if (await hitAllowed(env, source, sourceId, req)) {
        defer(() => recordHit(env, source, sourceId, req));
      }
      return json({ ok: true });
    }

    const {
      website: websiteId,
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
      id: claimedId,
      anonymousId,
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

    const sourceId = websiteId!;
    const secret = getSecret(appSecret);
    const trustedIp = getTrustedClientIp(req);
    const client = getClientInfoFromRequest(req, payload);

    let cache: CacheToken | null = null;
    let billingUserId = '';
    if (websiteId) {
      const [rl, quota, parsedCache] = await Promise.all([
        rateLimit(websiteId, trustedIp),
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

    // An anonymous tracker id counts the visitor only on websites that remember visitors;
    // elsewhere it is dropped here and nothing below ever sees it.
    const id = await resolveDistinctId(env, websiteId, claimedId, anonymousId);

    const createdAt = parseEventTimestamp(timestamp) ?? new Date();
    const now = Math.floor(Date.now() / 1000);
    const sessionSalt = getSalt(createdAt);
    const vSalt = visitSalt(createdAt);

    // Keyed with the deployment secret: session ids reach browsers and exports, and an
    // unkeyed hash of (site, IP, UA, month) lets anyone brute-force the IPv4 back out.
    // identify() mid-visit must not open a second session (double-counting the visitor
    // and bouncing the anonymous visit): keep this tab's session and attach the id to it.
    const tabSessionId = id && cache?.websiteId === sourceId ? cache.sessionId : undefined;
    const sessionId =
      tabSessionId ??
      (id ? uuid(sourceId, id) : uuid(sourceId, client.ip, client.userAgent, sessionSalt, secret));

    cache = applyCacheToken(cache, sourceId, sessionId);

    let visitId = cache?.visitId || uuid(sessionId, vSalt);
    let iat = cache?.iat || now;

    if (!timestamp && now - iat > 1800) {
      // New visit after 30 idle minutes. Include the rotation time: the hour salt alone
      // gave the same id when the visitor returned within the same UTC hour.
      visitId = uuid(sessionId, vSalt, String(now));
      iat = now;
    }

    const messages: QueueMessage[] = [];
    let realtimeMeta: {
      urlPath?: string;
      referrerDomain?: string | null;
      country?: string | null;
    } | undefined;

    if (!cache?.sessionId) {
      messages.push(
        sessionMessage({
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
        }),
      );
    }

    if (type === COLLECTION_TYPE.event || type === COLLECTION_TYPE.error || type === COLLECTION_TYPE.log || type === COLLECTION_TYPE.ai) {
      const page = pageContext(url, hostname, referrer);

      const eventType =
        type === COLLECTION_TYPE.error
          ? EVENT_TYPE.error
          : type === COLLECTION_TYPE.log
            ? EVENT_TYPE.log
          : type === COLLECTION_TYPE.ai
            ? EVENT_TYPE.ai
          : name
            ? EVENT_TYPE.customEvent
            : EVENT_TYPE.pageView;

      const eventId = crypto.randomUUID();
      let eventDataPayload =
        type === COLLECTION_TYPE.error
          ? buildErrorEventDataPayload({
              data,
              message,
              name,
              errorName,
              stack,
              source,
              lineno,
              colno,
              severity,
              handled,
              release,
              environment,
            })
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

      // Tag even when there is no `data`: the tracker's default pageview sends none, and
      // url_path actions must still match it.
      if (websiteId && (eventDataPayload == null || typeof eventDataPayload === 'object')) {
        const tagged = await appendMatchedActionTags(env, websiteId, {
          eventName:
            type === COLLECTION_TYPE.error
              ? (message ?? name ?? 'error')
              : type === COLLECTION_TYPE.log
                ? (name ?? 'log')
                : type === COLLECTION_TYPE.ai
                  ? (name ?? 'ai_generation')
                  : (name ?? null),
          urlPath: page.urlPath,
          data: (eventDataPayload ?? undefined) as Record<string, unknown> | undefined,
        });
        if (eventDataPayload || Object.keys(tagged).length) eventDataPayload = tagged;
      }

      if (websiteId && eventType === EVENT_TYPE.pageView) {
        realtimeMeta = {
          urlPath: page.urlPath,
          referrerDomain: page.referrerDomain,
          country: client.country ?? null,
        };
      }

      messages.push(
        eventMessage({
          id: eventId,
          websiteId: sourceId,
          sessionId,
          visitId,
          createdAt: createdAt.getTime(),
          page,
          title,
          eventType,
          eventName:
            type === COLLECTION_TYPE.error
              ? (message ?? name ?? 'error')
              : type === COLLECTION_TYPE.log
                ? (name ?? 'log')
                : type === COLLECTION_TYPE.ai
                  ? (name ?? 'ai_generation')
                : (name ?? null),
          tag,
          hostname,
          data: eventDataPayload as Record<string, unknown> | null | undefined,
        }),
      );

      if (websiteId && type === COLLECTION_TYPE.error) {
        const errorData = eventDataPayload as Record<string, unknown>;
        const fingerprint = errorData[ERROR_FINGERPRINT_PROPERTY];
        if (typeof fingerprint === 'string') {
          defer(() =>
            reportPossibleRegression(env, {
              websiteId,
              fingerprint,
              occurredAt: createdAt.getTime(),
              eventId,
              release: release ?? null,
              environment: environment ?? null,
              severity: severity ?? 'error',
              title: `${errorName ?? 'Error'}: ${message ?? name ?? 'Unknown error'}`,
            }).then(() => undefined),
          );
        }
      }

      if (websiteId && name) {
        defer(() =>
          enqueueWorkflowTriggers(env, {
            websiteId,
            trustedIp,
            events: [
              {
                eventId,
                eventName: name,
                sessionId,
                visitId,
                createdAt: createdAt.getTime(),
                distinctId: id ?? null,
                hostname: hostname || page.urlDomain,
                urlPath: page.urlPath,
                urlQuery: page.urlQuery,
                properties: eventDataPayload,
              },
            ],
          }).then(() => undefined),
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
          defer(() => recordAlias(env, { websiteId, alias, canonicalDistinctId, seenAt: createdAt.getTime() }));
        }
      }
    } else if (type === COLLECTION_TYPE.identify && data) {
      const identifyData = sessionDataMessage({
        websiteId: sourceId,
        sessionId,
        distinctId: id ?? null,
        data,
        createdAt: createdAt.getTime(),
      });
      if (identifyData) messages.push(identifyData);
      if (id) {
        defer(() =>
          writeSiteTables(env, sourceId, (db) =>
            upsertPerson(db, {
              websiteId: sourceId,
              distinctId: id,
              properties: data as Record<string, unknown>,
              seenAt: createdAt.getTime(),
            }),
          ).then(() => undefined),
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
      const groupMessage = sessionDataMessage({
        websiteId: sourceId,
        sessionId,
        distinctId: id ?? null,
        data: groupData,
        createdAt: createdAt.getTime(),
      });
      if (groupMessage) messages.push(groupMessage);
      if (id) {
        defer(() =>
          writeSiteTables(env, sourceId, (db) =>
            upsertPersonGroupMembership(db, {
              websiteId: sourceId,
              distinctId: id,
              groupType,
              groupKey,
              seenAt: createdAt.getTime(),
            }),
          ).then(() => undefined),
        );
      }
    } else if (type === COLLECTION_TYPE.performance) {
      const currentUrl = parsePageUrl(url, hostname);
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

    // Usage is charged only once the event is accepted for processing (rate
    // limit and quota checks passed, payload validated, messages built).
    if (billingUserId) {
      const usageUserId = billingUserId;
      const billable = Math.max(
        1,
        messages.filter((m) => m.type === 'event' || m.type === 'revenue').length,
      );
      defer(() => recordEventUsageKv(env, usageUserId, billable));
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

// Order matters: Edge/Opera UAs also say "Chrome", Chrome says "Safari", and iOS UAs
// say "like Mac OS X".
export function parseBrowser(ua: string): string {
  if (/\bedg(e|a|ios)?\//i.test(ua)) return 'Edge';
  if (/\bopr\/|opera/i.test(ua)) return 'Opera';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/chrome|crios|chromium/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Unknown';
}

export function parseOs(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/mac os/i.test(ua)) return 'macOS';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

export function parseDevice(ua: string): string {
  // Android tablets omit "Mobile"; iPads say "Mobile" but are tablets.
  if (/ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet';
  if (/mobile|iphone|ipod/i.test(ua)) return 'mobile';
  return 'desktop';
}

export async function handleSend(c: Context<{ Bindings: Env }>) {
  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > SEND_BODY_MAX_BYTES) {
    return badRequest('Payload too large');
  }

  // Read as text regardless of content type so the size limit is enforced on
  // the actual body, not the client-controlled Content-Length header.
  const text = await c.req.text().catch(() => '');
  if (text.length > SEND_BODY_MAX_BYTES) return badRequest('Payload too large');
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    return badRequest('Invalid JSON');
  }

  const website = await resolvePayloadWebsite(c.env, raw);
  if ('error' in website) return badRequest(website.error);

  const parsed = parseSendRequest(raw);
  if ('error' in parsed) return badRequest(parsed.error);

  const waitUntil = (promise: Promise<void>) => {
    c.executionCtx.waitUntil(promise);
  };

  return processSend(c.env, c.req.raw, parsed.body, envSecret(c), {
    cacheToken: parsed.cacheToken,
    projectKey: website.projectKey,
    waitUntil,
  });
}

const MAX_BATCH_ITEMS = 50;
const MAX_BATCH_BYTES = 512 * 1024;

export async function handleBatch(c: Context<{ Bindings: Env }>) {
  try {
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

    // Batches that name every website by project key are limited per key (each item below);
    // anything else keeps the per-IP batch limit.
    const keyed =
      body.length > 0 &&
      body.every((item) => isProjectKey((item as { payload?: { website?: unknown } } | null)?.payload?.website));
    if (!keyed) {
      const batchRl = await checkIpRateLimit(c.env, 'batch', getTrustedClientIp(c.req.raw));
      if (!batchRl.allowed) {
        return json({ message: 'Rate limit exceeded' }, 429);
      }
    }

    const errors: Array<{ index: number; response: unknown }> = [];
    let index = 0;
    let cache: string | null = null;

    for (const data of body) {
      const serialized = JSON.stringify(data);
      if (serialized.length > SEND_BODY_MAX_BYTES) {
        errors.push({ index, response: { message: 'Payload too large' } });
        index++;
        continue;
      }

      const website = await resolvePayloadWebsite(c.env, data);
      if ('error' in website) {
        errors.push({ index, response: { message: website.error } });
        index++;
        continue;
      }

      const parsed = sendSchema.safeParse(data);
      if (!parsed.success) {
        errors.push({ index, response: { message: parsed.error.message } });
        index++;
        continue;
      }

      const headers = new Headers(c.req.raw.headers);
      headers.set('content-type', 'application/json');
      headers.delete('content-length');

      const req = new Request(c.req.url, { method: 'POST', headers, body: serialized });
      const waitUntil = (promise: Promise<void>) => {
        c.executionCtx.waitUntil(promise);
      };
      const res = await processSend(c.env, req, parsed.data, envSecret(c), {
        projectKey: website.projectKey,
        waitUntil,
      });
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
  // The recorder source and its privacy rules live in ../tracker/recorder.ts.
  const script = RECORDER_SCRIPT;

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

export function handleScript(_c: Context<{ Bindings: Env }>) {
  // The tracker source lives in ../tracker/script.ts (unit-tested there against a fake DOM).
  const script = TRACKER_SCRIPT;

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
