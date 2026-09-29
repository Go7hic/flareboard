import {
  AI_CONTENT_KEYS,
  EVENT_TYPE,
  flattenEventData,
  type QueueEventMessage,
  type QueueSessionDataMessage,
  type QueueSessionMessage,
} from '@flareboard/shared';
import { safeDecodeURI, safeDecodeURIComponent } from './response';

/**
 * Builders for the queue messages the aggregator consumes. Every ingest path (the tracker's
 * /api/send, PostHog-compatible capture, …) builds its messages here so they stay identical.
 */

/**
 * Page URL resolved against the reported hostname. Client input is not trusted to be
 * well-formed ("exa mple.com", "http://[" ...): a bad value degrades to the site root
 * instead of throwing and turning the whole request into a 500.
 */
export function parsePageUrl(url: string | undefined, hostname: string | undefined): URL {
  let base = 'https://localhost';
  if (hostname) {
    try {
      base = new URL(`https://${hostname}`).origin;
    } catch {
      // keep the neutral base
    }
  }
  try {
    return new URL(url || '/', base);
  } catch {
    return new URL('/', base);
  }
}

export function parseReferrerUrl(referrer: string, base: URL): URL | null {
  try {
    return new URL(referrer, base);
  } catch {
    return null;
  }
}

export type PageContext = {
  /** Path + hash, URI-decoded. Empty for events without a page (server-side events). */
  urlPath: string;
  urlQuery: string | null;
  /** Hostname without `www.`, or null without a page. */
  urlDomain: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  gclid: string | null;
  fbclid: string | null;
  msclkid: string | null;
  ttclid: string | null;
  lifatid: string | null;
  twclid: string | null;
  referrerPath: string | null;
  referrerQuery: string | null;
  referrerDomain: string | null;
};

/** URL, campaign parameters, click ids and referrer of a page event. */
export function pageContext(url: string | undefined, hostname: string | undefined, referrer: string | undefined): PageContext {
  const currentUrl = parsePageUrl(url, hostname);
  const urlPath = currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname + currentUrl.hash;
  const params = currentUrl.searchParams;
  const referrerUrl = referrer ? parseReferrerUrl(referrer, currentUrl) : null;
  const referrerPath = referrerUrl?.pathname;
  return {
    urlPath: safeDecodeURI(urlPath) ?? urlPath,
    urlQuery: currentUrl.search.substring(1) || null,
    urlDomain: currentUrl.hostname.replace(/^www\./, ''),
    utmSource: params.get('utm_source'),
    utmMedium: params.get('utm_medium'),
    utmCampaign: params.get('utm_campaign'),
    utmContent: params.get('utm_content'),
    utmTerm: params.get('utm_term'),
    gclid: params.get('gclid'),
    fbclid: params.get('fbclid'),
    msclkid: params.get('msclkid'),
    ttclid: params.get('ttclid'),
    lifatid: params.get('li_fat_id'),
    twclid: params.get('twclid'),
    referrerPath: safeDecodeURI(referrerPath) ?? referrerPath ?? null,
    referrerQuery: referrerUrl ? referrerUrl.search.substring(1) : null,
    referrerDomain: referrerUrl ? referrerUrl.hostname.replace(/^www\./, '') : null,
  };
}

/** Context for events that did not happen on a page (e.g. sent by a backend SDK). */
export function emptyPageContext(): PageContext {
  return {
    urlPath: '',
    urlQuery: null,
    urlDomain: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    gclid: null,
    fbclid: null,
    msclkid: null,
    ttclid: null,
    lifatid: null,
    twclid: null,
    referrerPath: null,
    referrerQuery: null,
    referrerDomain: null,
  };
}

export function sessionMessage(data: QueueSessionMessage['data']): QueueSessionMessage {
  return { type: 'session', data };
}

export function eventMessage(input: {
  id: string;
  websiteId: string;
  sessionId: string;
  visitId: string;
  createdAt: number;
  page: PageContext;
  title?: string;
  eventType: number;
  eventName: string | null;
  tag?: string | null;
  /** Reported hostname; falls back to the page URL's domain. */
  hostname?: string;
  data?: Record<string, unknown> | null;
}): QueueEventMessage {
  const { page } = input;
  return {
    type: 'event',
    data: {
      id: input.id,
      websiteId: input.websiteId,
      sessionId: input.sessionId,
      visitId: input.visitId,
      createdAt: input.createdAt,
      urlPath: page.urlPath,
      urlQuery: page.urlQuery,
      utmSource: page.utmSource,
      utmMedium: page.utmMedium,
      utmCampaign: page.utmCampaign,
      utmContent: page.utmContent,
      utmTerm: page.utmTerm,
      referrerPath: page.referrerPath,
      referrerQuery: page.referrerQuery,
      referrerDomain: page.referrerDomain,
      pageTitle: safeDecodeURIComponent(input.title) ?? null,
      gclid: page.gclid,
      fbclid: page.fbclid,
      msclkid: page.msclkid,
      ttclid: page.ttclid,
      lifatid: page.lifatid,
      twclid: page.twclid,
      eventType: input.eventType,
      eventName: input.eventName,
      tag: input.tag ?? null,
      hostname: input.hostname || page.urlDomain,
    },
    eventData: input.data
      ? flattenEventData(
          input.websiteId,
          input.id,
          input.data,
          input.createdAt,
          // AI prompt / response content is size-capped by the AI normalizers, not at 2000 chars.
          input.eventType === EVENT_TYPE.ai ? AI_CONTENT_KEYS : undefined,
        )
      : undefined,
  };
}

/**
 * Session (visitor) properties, e.g. from identify or group calls. Pass `rowId` for rows that
 * repeat on every request (the aggregator ignores a row id it already stored).
 */
export function sessionDataMessage(input: {
  websiteId: string;
  sessionId: string;
  distinctId: string | null;
  data: Record<string, unknown>;
  createdAt: number;
  rowId?: (dataKey: string) => string;
}): QueueSessionDataMessage | null {
  const rows = flattenEventData(input.websiteId, input.sessionId, input.data, input.createdAt) ?? [];
  if (!rows.length) return null;
  return {
    type: 'session_data',
    data: rows.map((row) => ({
      id: input.rowId ? input.rowId(row.dataKey) : row.id,
      websiteId: input.websiteId,
      sessionId: input.sessionId,
      dataKey: row.dataKey,
      stringValue: row.stringValue,
      numberValue: row.numberValue,
      dateValue: row.dateValue,
      dataType: row.dataType,
      distinctId: input.distinctId,
      createdAt: input.createdAt,
    })),
  };
}
