import { upsertPerson, upsertPersonGroupMembership } from '@flareboard/db';
import { EVENT_TYPE, geoFromCf, uuid, visitSalt, type QueueMessage } from '@flareboard/shared';
import type { Env } from '../../env';
import { isBot, recordWorkflowExecutions } from '../../routes/collect';
import { loadWebsiteActionDefinitions, tagMatchedActions } from '../actions';
import { recordEventUsageKv } from '../hosted-limits';
import { recordAlias } from '../person-identity';
import { eventMessage, emptyPageContext, pageContext, sessionDataMessage, sessionMessage } from '../queue-messages';
import { getTrustedClientIp } from '../rate-limit';
import { bumpRealtimeVisitor } from '../realtime-kv';
import {
  clientInfo,
  EXCEPTION_PROPERTIES,
  eventGroups,
  eventProperties,
  exceptionPayload,
  ignoredEvent,
  isBrowserUserAgent,
  isRecord,
  pageInfo,
  personProperties,
  resolveEventTime,
  safeToMerge,
  webVitals,
  type PostHogEvent,
} from './events';

/** Cloudflare Queues: at most 100 messages and 256 KB per sendBatch call. */
const QUEUE_BATCH_MESSAGES = 100;
const QUEUE_BATCH_BYTES = 200 * 1024;

type Json = Record<string, unknown>;

export type CaptureInput = {
  env: Env;
  req: Request;
  websiteId: string;
  /** Hosted-plan account charged for the events ('' when not metered). */
  billingUserId: string;
  events: PostHogEvent[];
  sentAt: number | null;
  waitUntil: (promise: Promise<void>) => void;
  now?: number;
};

type SessionState = {
  message: ReturnType<typeof sessionMessage>['data'];
  realtime?: { urlPath?: string; referrerDomain?: string | null; country?: string | null };
};

type PersonUpdate = { set: Json; setOnce: Json; seenAt: number };

function text(value: unknown, max = 200): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, max) || undefined;
}

/** Keeps the first known value of each session field when several events describe one session. */
function mergeSession(target: SessionState['message'], next: SessionState['message']) {
  for (const key of Object.keys(next) as Array<keyof SessionState['message']>) {
    if (target[key] == null && next[key] != null) (target as Record<string, unknown>)[key] = next[key];
  }
  target.createdAt = Math.min(target.createdAt, next.createdAt);
}

async function sendMessages(env: Env, messages: QueueMessage[]) {
  let chunk: QueueMessage[] = [];
  let bytes = 0;
  const flush = async () => {
    if (!chunk.length) return;
    await env.EVENT_QUEUE.sendBatch(chunk.map((body) => ({ body })));
    chunk = [];
    bytes = 0;
  };
  for (const message of messages) {
    const size = JSON.stringify(message).length;
    if (chunk.length >= QUEUE_BATCH_MESSAGES || (chunk.length && bytes + size > QUEUE_BATCH_BYTES)) await flush();
    chunk.push(message);
    bytes += size;
  }
  await flush();
}

/**
 * Turns PostHog events into the same queue messages as /api/send, so they reach the aggregator
 * the same way, and applies person, alias and group updates through the tracker's identify path.
 *
 * Identity mapping (scoped per website): the Flareboard session (visitor) is derived from the
 * PostHog distinct id exactly like an identified tracker visitor, and the visit from the PostHog
 * `$session_id`, so one PostHog session is one Flareboard visit. Events without `$session_id`
 * (server SDKs) fall into the hourly visit the tracker uses without a cache token.
 */
export async function capturePostHogEvents(input: CaptureInput): Promise<{ accepted: number }> {
  const { env, req, websiteId } = input;
  const now = input.now ?? Date.now();
  const requestUa = req.headers.get('user-agent');
  const fromBrowser = isBrowserUserAgent(requestUa);
  // A server SDK's request location is the server's, not the visitor's.
  const geo = fromBrowser
    ? geoFromCf((req as Request & { cf?: unknown }).cf)
    : { country: null, region: null, city: null };
  const definitions = await loadWebsiteActionDefinitions(env, websiteId);

  const sessions = new Map<string, SessionState>();
  const sessionData: QueueMessage[] = [];
  const events: QueueMessage[] = [];
  const persons = new Map<string, PersonUpdate>();
  const aliases = new Map<string, { alias: string; canonicalDistinctId: string; seenAt: number }>();
  const memberships = new Map<string, { distinctId: string; groupType: string; groupKey: string; seenAt: number }>();
  const groupRows = new Map<string, { distinctId: string | null; createdAt: number; data: Json }>();
  const workflowEvents: Array<{ sessionId: string; visitId: string; eventId: string; eventName: string; createdAt: number }> = [];
  let accepted = 0;

  const updatePerson = (distinctId: string, set: Json | undefined, setOnce: Json | undefined, seenAt: number) => {
    const current = persons.get(distinctId) ?? { set: {}, setOnce: {}, seenAt };
    // Later `$set` values win; the earliest `$set_once` value wins.
    Object.assign(current.set, set ?? {});
    current.setOnce = { ...(setOnce ?? {}), ...current.setOnce };
    current.seenAt = Math.max(current.seenAt, seenAt);
    persons.set(distinctId, current);
  };
  const addAlias = (alias: string, canonicalDistinctId: string, seenAt: number) => {
    if (alias === canonicalDistinctId || !safeToMerge(alias) || !safeToMerge(canonicalDistinctId)) return;
    aliases.set(`${alias}\u0000${canonicalDistinctId}`, { alias, canonicalDistinctId, seenAt });
  };

  for (const event of input.events) {
    if (ignoredEvent(event.event)) continue;
    const props = event.properties;
    const client = clientInfo(props, requestUa);
    if (client.userAgent && client.userAgent !== requestUa && isBot(client.userAgent)) continue;

    const createdAt = resolveEventTime(event, input.sentAt, now);
    const ms = createdAt.getTime();
    const { distinctId } = event;
    const identityEvent = ['$identify', '$set', '$create_alias', '$merge_dangerously', '$groupidentify'].includes(event.event);
    const processPerson = identityEvent || props.$process_person_profile !== false;
    const groupType = event.event === '$groupidentify' ? text(props.$group_type, 80) : undefined;
    const groupKey = event.event === '$groupidentify' ? text(props.$group_key) : undefined;
    // posthog-node sends group updates under a synthetic "$<type>_<key>" distinct id.
    const syntheticGroupId = Boolean(groupType && groupKey && distinctId === `$${groupType}_${groupKey}`);
    const personId = processPerson && !syntheticGroupId ? distinctId : null;

    const sessionId = uuid(websiteId, distinctId);
    const posthogSessionId = text(props.$session_id);
    const visitId = posthogSessionId ? uuid(sessionId, '$session_id', posthogSessionId) : uuid(sessionId, visitSalt(createdAt));
    accepted++;

    const session: SessionState['message'] = {
      id: sessionId,
      websiteId,
      browser: client.browser,
      os: client.os,
      device: client.device,
      screen: client.screen,
      language: client.language,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      distinctId: personId,
      createdAt: ms,
    };
    const existing = sessions.get(sessionId);
    if (existing) mergeSession(existing.message, session);
    else sessions.set(sessionId, { message: session });

    const set = personProperties(event.set);
    const setOnce = personProperties(event.setOnce);
    if (personId && (set || setOnce || event.event === '$identify')) updatePerson(distinctId, set, setOnce, ms);

    for (const [type, key] of eventGroups(props)) {
      const rows = groupRows.get(sessionId) ?? { distinctId: personId, createdAt: ms, data: {} };
      rows.data[`$group/${type}`] = key;
      groupRows.set(sessionId, rows);
    }

    if (event.event === '$identify' || event.event === '$set') {
      const anon = text(props.$anon_distinct_id);
      if (event.event === '$identify' && anon) addAlias(anon, distinctId, ms);
      const identify = set && sessionDataMessage({ websiteId, sessionId, distinctId, data: set, createdAt: ms });
      if (identify) sessionData.push(identify);
      continue;
    }
    if (event.event === '$create_alias' || event.event === '$merge_dangerously') {
      const alias = text(props.alias);
      if (alias) addAlias(alias, distinctId, ms);
      continue;
    }
    if (event.event === '$groupidentify') {
      if (!groupType || !groupKey || groupType.includes('/')) continue;
      const data: Json = { [`$group/${groupType}`]: groupKey };
      if (isRecord(props.$group_set)) {
        for (const [key, value] of Object.entries(props.$group_set)) data[`$group/${groupType}/${key}`] = value;
      }
      const message = sessionDataMessage({ websiteId, sessionId, distinctId: personId, data, createdAt: ms });
      if (message) sessionData.push(message);
      if (personId) {
        memberships.set(`${distinctId}\u0000${groupType}\u0000${groupKey}`, { distinctId, groupType, groupKey, seenAt: ms });
      }
      continue;
    }

    const page = pageInfo(event);
    const context = page.url ? pageContext(page.url, page.hostname, page.referrer) : emptyPageContext();
    const eventId = event.uuid ? uuid(websiteId, '$posthog', event.uuid) : crypto.randomUUID();

    let eventType: number = EVENT_TYPE.customEvent;
    let eventName: string | null = event.event;
    let data: Json;
    let vitals: ReturnType<typeof webVitals> = null;
    if (event.event === '$pageview') {
      eventType = EVENT_TYPE.pageView;
      eventName = null;
      data = eventProperties(event, new Set(['title']));
    } else if (event.event === '$exception') {
      const error = exceptionPayload(props);
      eventType = EVENT_TYPE.error;
      eventName = error.message;
      data = { ...eventProperties(event, EXCEPTION_PROPERTIES), ...error };
    } else if (event.event === '$web_vitals') {
      vitals = webVitals(props);
      if (!vitals) continue;
      eventType = EVENT_TYPE.performance;
      eventName = null;
      data = {};
    } else {
      data = eventProperties(event);
    }
    if (eventType !== EVENT_TYPE.performance) {
      data = tagMatchedActions(definitions, { eventName, urlPath: context.urlPath, data });
    }

    const message = eventMessage({
      id: eventId,
      websiteId,
      sessionId,
      visitId,
      createdAt: ms,
      page: context,
      title: page.title,
      eventType,
      eventName,
      hostname: page.hostname,
      data: Object.keys(data).length ? data : null,
    });
    if (vitals) Object.assign(message.data, vitals);
    events.push(message);

    if (eventType === EVENT_TYPE.pageView) {
      sessions.get(sessionId)!.realtime = {
        urlPath: context.urlPath,
        referrerDomain: context.referrerDomain,
        country: geo.country,
      };
    }
    if (eventType === EVENT_TYPE.customEvent && eventName) {
      workflowEvents.push({ sessionId, visitId, eventId, eventName, createdAt: ms });
    }
  }

  for (const [sessionId, rows] of groupRows) {
    const message = sessionDataMessage({
      websiteId,
      sessionId,
      distinctId: rows.distinctId,
      data: rows.data,
      createdAt: rows.createdAt,
      // `$groups` rides on every event: a stable row id lets the aggregator keep one row per group.
      rowId: (dataKey) => uuid(websiteId, sessionId, dataKey, String(rows.data[dataKey])),
    });
    if (message) sessionData.push(message);
  }

  const messages: QueueMessage[] = [
    ...[...sessions.values()].map((session) => sessionMessage(session.message)),
    ...sessionData,
    ...events,
  ];
  if (!accepted) return { accepted };
  await sendMessages(env, messages);

  const trustedIp = getTrustedClientIp(req);
  const billable = Math.max(1, events.length);
  input.waitUntil(
    (async () => {
      const tasks: Array<() => Promise<unknown>> = [
        ...[...persons].map(([distinctId, update]) => () =>
          upsertPerson(env.DB, {
            websiteId,
            distinctId,
            properties: update.set,
            propertiesOnce: update.setOnce,
            seenAt: update.seenAt,
          }),
        ),
        ...[...aliases.values()].map((alias) => () => recordAlias(env, { websiteId, ...alias })),
        ...[...memberships.values()].map((membership) => () =>
          upsertPersonGroupMembership(env.DB, { websiteId, ...membership }),
        ),
        ...[...sessions].map(([sessionId, session]) => () => bumpRealtimeVisitor(env, websiteId, sessionId, session.realtime)),
      ];
      if (workflowEvents.length) {
        tasks.push(async () => {
          const triggers = await env.DB.prepare(
            `SELECT DISTINCT trigger_event AS name FROM workflow WHERE website_id = ?1 AND enabled = 1`,
          )
            .bind(websiteId)
            .all<{ name: string }>();
          const names = new Set((triggers.results ?? []).map((row) => row.name));
          for (const event of workflowEvents) {
            if (names.has(event.eventName)) await recordWorkflowExecutions(env, { websiteId, trustedIp, ...event });
          }
        });
      }
      if (input.billingUserId) tasks.push(() => recordEventUsageKv(env, input.billingUserId, billable));
      for (const task of tasks) {
        await task().catch((error) =>
          console.error(JSON.stringify({ event: 'posthog_deferred_failed', websiteId, error: String(error) })),
        );
      }
    })(),
  );
  return { accepted };
}
