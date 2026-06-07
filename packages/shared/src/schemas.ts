import { z } from 'zod';

export const urlOrPathParam = z.string().max(500);

export const sendPayloadSchema = z
  .object({
    website: z.string().uuid().optional(),
    link: z.string().uuid().optional(),
    pixel: z.string().uuid().optional(),
    data: z.record(z.unknown()).optional(),
    hostname: z.string().max(100).optional(),
    language: z.string().max(35).optional(),
    referrer: urlOrPathParam.optional(),
    screen: z.string().max(11).optional(),
    title: z.string().optional(),
    url: urlOrPathParam.optional(),
    name: z.string().max(50).optional(),
    tag: z.string().max(50).optional(),
    ip: z.string().optional(),
    userAgent: z.string().optional(),
    timestamp: z.coerce.number().int().optional(),
    id: z.string().optional(),
    browser: z.string().optional(),
    os: z.string().optional(),
    device: z.string().optional(),
    lcp: z.number().nonnegative().max(60000).optional(),
    inp: z.number().nonnegative().max(60000).optional(),
    cls: z.number().nonnegative().max(100).optional(),
    fcp: z.number().nonnegative().max(60000).optional(),
    ttfb: z.number().nonnegative().max(60000).optional(),
    revenue: z.coerce.number().optional(),
    currency: z.string().max(10).optional(),
  })
  .refine(
    (data) => {
      const keys = [data.website, data.link, data.pixel];
      return keys.filter(Boolean).length === 1;
    },
    { message: 'Exactly one of website, link, or pixel must be provided' },
  );

export const sendSchema = z.object({
  type: z.enum(['event', 'identify', 'performance']),
  payload: sendPayloadSchema,
});

export const batchSchema = z.array(z.record(z.unknown()));

export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const registerSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  displayName: z.string().max(100).optional(),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const ssoSchema = z.object({
  token: z.string().min(1),
});

export const createTeamWebsiteSchema = z.object({
  name: z.string().max(100),
  domain: z.string().max(500),
});

export const createWebsiteSchema = z.object({
  name: z.string().max(100),
  domain: z.string().max(500),
  shareId: z.string().max(50).nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  id: z.string().uuid().nullable().optional(),
});

export const updateWebsiteSchema = z.object({
  name: z.string().max(100).optional(),
  domain: z.string().max(500).optional(),
  resetAt: z.string().datetime().optional(),
  replayEnabled: z.boolean().optional(),
  replayConfig: z.record(z.unknown()).nullable().optional(),
});

export const updateProfileSchema = z.object({
  displayName: z.string().max(100).nullable().optional(),
  logoUrl: z.string().url().max(2000).nullable().optional(),
});

export const updateTeamUserSchema = z.object({
  role: z.enum(['team-owner', 'team-manager', 'team-member', 'team-view-only']),
});

export const updateAdminUserSchema = z.object({
  username: z.string().min(1).max(50).optional(),
  role: z.enum(['admin', 'user', 'view-only', 'team-view-only']).optional(),
  password: z.string().min(6).max(100).optional(),
});

export const updateShareSchema = z.object({
  name: z.string().max(100).optional(),
});

export const statsQuerySchema = z.object({
  startAt: z.coerce.number().optional(),
  endAt: z.coerce.number().optional(),
  unit: z.enum(['year', 'month', 'day', 'hour', 'minute']).optional(),
  timezone: z.string().optional(),
});

export const compareQuerySchema = statsQuerySchema.extend({
  compareStartAt: z.coerce.number().optional(),
  compareEndAt: z.coerce.number().optional(),
});

export const metricsQuerySchema = statsQuerySchema.extend({
  type: z
    .enum(['path', 'url', 'referrer', 'browser', 'os', 'device', 'country', 'language', 'event'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const eventsQuerySchema = statsQuerySchema.extend({
  event: z.string().max(50).optional(),
});

export const createTeamSchema = z.object({
  name: z.string().max(100),
});

export const updateTeamSchema = z.object({
  name: z.string().max(100).optional(),
});

export const joinTeamSchema = z.object({
  accessCode: z.string().min(4).max(50),
});

export const createShareSchema = z.object({
  websiteId: z.string().uuid(),
  name: z.string().max(100).optional(),
});

export const createSegmentSchema = z.object({
  type: z.string().max(50),
  name: z.string().max(100),
  parameters: z.record(z.unknown()),
});

export const updateSegmentSchema = createSegmentSchema.partial();

export const createLinkSchema = z.object({
  name: z.string().max(100),
  url: z.string().url().max(2000),
  slug: z.string().max(50).regex(/^[a-z0-9-]+$/i).optional(),
  teamId: z.string().uuid().optional(),
});

export const updateLinkSchema = z.object({
  name: z.string().max(100).optional(),
  url: z.string().url().max(2000).optional(),
  slug: z.string().max(50).regex(/^[a-z0-9-]+$/i).optional(),
});

export const createPixelSchema = z.object({
  name: z.string().max(100),
  slug: z.string().max(50).regex(/^[a-z0-9-]+$/i).optional(),
  teamId: z.string().uuid().optional(),
});

export const updatePixelSchema = z.object({
  name: z.string().max(100).optional(),
  slug: z.string().max(50).regex(/^[a-z0-9-]+$/i).optional(),
});

export const createReportSchema = z.object({
  websiteId: z.string().uuid(),
  type: z.string().max(50),
  name: z.string().max(100),
  description: z.string().max(500).optional(),
  parameters: z.record(z.unknown()),
});

export const updateReportSchema = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  parameters: z.record(z.unknown()).optional(),
});

export const recordPayloadSchema = z.object({
  website: z.string().uuid(),
  sessionId: z.string().max(64),
  visitId: z.string().max(64),
  chunkIndex: z.coerce.number().int().min(0),
  events: z.array(z.unknown()),
  startedAt: z.coerce.number().int(),
  endedAt: z.coerce.number().int(),
});

export const recordSchema = z.object({
  type: z.literal('record'),
  payload: recordPayloadSchema,
});

export const createAdminUserSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(6).max(100),
  role: z.enum(['admin', 'user', 'view-only', 'team-view-only']).optional(),
});

export const createAdminWebsiteSchema = z.object({
  name: z.string().max(100),
  domain: z.string().max(500).optional(),
  userId: z.string().uuid(),
});

export const createBoardSchema = z.object({
  type: z.string().max(50).default('dashboard'),
  name: z.string().max(100),
  description: z.string().max(500).optional(),
  parameters: z.record(z.unknown()).default({}),
  teamId: z.string().uuid().nullable().optional(),
});

export const updateBoardSchema = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  parameters: z.record(z.unknown()).optional(),
});

export const forgotPasswordSchema = z.object({
  username: z.string().min(1).max(100),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6).max(100),
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(100),
});

export const createSavedReplaySchema = z.object({
  name: z.string().max(100),
  visitId: z.string().max(64),
});

export const updateSavedReplaySchema = z.object({
  name: z.string().max(100).optional(),
});

export const funnelQuerySchema = z.object({
  websiteId: z.string().uuid(),
  steps: z.string().min(1),
  startAt: z.coerce.number().optional(),
  endAt: z.coerce.number().optional(),
  segmentId: z.string().uuid().optional(),
});

export type SendPayload = z.infer<typeof sendPayloadSchema>;
export type SendBody = z.infer<typeof sendSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type CreateWebsiteBody = z.infer<typeof createWebsiteSchema>;
export type UpdateWebsiteBody = z.infer<typeof updateWebsiteSchema>;

export interface CacheToken {
  websiteId: string;
  sessionId: string;
  visitId: string;
  iat: number;
}

export interface AuthUser {
  userId: string;
  role: string;
}

export interface QueueSessionMessage {
  type: 'session';
  data: {
    id: string;
    websiteId: string;
    browser?: string | null;
    os?: string | null;
    device?: string | null;
    screen?: string | null;
    language?: string | null;
    country?: string | null;
    region?: string | null;
    city?: string | null;
    distinctId?: string | null;
    createdAt: number;
  };
}

export interface QueueEventMessage {
  type: 'event';
  data: {
    id: string;
    websiteId: string;
    sessionId: string;
    visitId: string;
    createdAt: number;
    urlPath: string;
    urlQuery?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    referrerPath?: string | null;
    referrerQuery?: string | null;
    referrerDomain?: string | null;
    pageTitle?: string | null;
    gclid?: string | null;
    fbclid?: string | null;
    msclkid?: string | null;
    ttclid?: string | null;
    lifatid?: string | null;
    twclid?: string | null;
    eventType: number;
    eventName?: string | null;
    tag?: string | null;
    hostname?: string | null;
    lcp?: number | null;
    inp?: number | null;
    cls?: number | null;
    fcp?: number | null;
    ttfb?: number | null;
  };
  eventData?: Array<{
    id: string;
    websiteId: string;
    websiteEventId: string;
    dataKey: string;
    stringValue?: string | null;
    numberValue?: number | null;
    dateValue?: number | null;
    dataType: number;
    createdAt: number;
  }>;
}

export interface QueueSessionDataMessage {
  type: 'session_data';
  data: Array<{
    id: string;
    websiteId: string;
    sessionId: string;
    dataKey: string;
    stringValue?: string | null;
    numberValue?: number | null;
    dateValue?: number | null;
    dataType: number;
    distinctId?: string | null;
    createdAt: number;
  }>;
}

export interface QueueRevenueMessage {
  type: 'revenue';
  data: {
    id: string;
    websiteId: string;
    sessionId: string;
    eventId: string;
    eventName: string;
    currency: string;
    revenue: number;
    createdAt: number;
  };
}

export type QueueMessage =
  | QueueSessionMessage
  | QueueEventMessage
  | QueueSessionDataMessage
  | QueueRevenueMessage;

export function flattenEventData(
  websiteId: string,
  websiteEventId: string,
  data: Record<string, unknown>,
  createdAt: number,
): QueueEventMessage['eventData'] {
  const result: NonNullable<QueueEventMessage['eventData']> = [];
  for (const [key, value] of Object.entries(data)) {
    const id = crypto.randomUUID();
    if (typeof value === 'string') {
      result.push({
        id,
        websiteId,
        websiteEventId,
        dataKey: key,
        stringValue: value,
        dataType: 1,
        createdAt,
      });
    } else if (typeof value === 'number') {
      result.push({
        id,
        websiteId,
        websiteEventId,
        dataKey: key,
        numberValue: value,
        dataType: 2,
        createdAt,
      });
    } else if (typeof value === 'boolean') {
      result.push({
        id,
        websiteId,
        websiteEventId,
        dataKey: key,
        stringValue: String(value),
        dataType: 3,
        createdAt,
      });
    }
  }
  return result;
}
