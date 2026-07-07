import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  attributionQuerySchema,
  createReportSchema,
  updateReportSchema,
  uuid,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite } from '../lib/access';
import {
  getAttributionConversionReport,
  getAttributionReport,
  getBreakdownReport,
  getFunnelReport,
  getJourneyFlowReport,
  getJourneyReport,
  getPerformanceReport,
  getRetentionReport,
  getStickinessReport,
} from '../lib/advanced-reports';
import { parseStatsRange } from '../lib/parse-range';
import {
  getGoalReport,
  getReportById,
  getRevenueReport,
  getSegmentById,
  getUtmReport,
  getUserReports,
  getWebsiteById,
} from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import { REPORT_TEMPLATES, readReportParams, summarizeReport } from '../lib/report-templates';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function serializeReport(r: typeof schema.report.$inferSelect) {
  const parameters = readReportParams(r.parameters);
  return {
    id: r.reportId,
    websiteId: r.websiteId,
    type: r.type,
    name: r.name,
    description: r.description,
    parameters,
    parameterSummary: summarizeReport(r.type, parameters),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function handleList(c: Ctx) {
  const reports = await getUserReports(c.env, c.get('user').userId);
  return json(reports.map(serializeReport));
}

export async function handleTemplates(c: Ctx) {
  return json(REPORT_TEMPLATES);
}

export async function handleCreate(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = createReportSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const website = await getWebsiteById(c.env, parsed.data.websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }

  const reportId = uuid();
  const now = new Date();
  const db = createDb(c.env.DB);
  await db.insert(schema.report).values({
    reportId,
    userId: c.get('user').userId,
    websiteId: parsed.data.websiteId,
    type: parsed.data.type,
    name: parsed.data.name,
    description: parsed.data.description ?? '',
    parameters: parsed.data.parameters,
    createdAt: now,
    updatedAt: now,
  });

  const report = await getReportById(c.env, reportId);
  return json(serializeReport(report!), 201);
}

export async function handleGet(c: Ctx) {
  const report = await getReportById(c.env, c.req.param('reportId') ?? '');
  if (!report || report.userId !== c.get('user').userId) return notFound();
  return json(serializeReport(report));
}

export async function handleUpdate(c: Ctx) {
  const report = await getReportById(c.env, c.req.param('reportId') ?? '');
  if (!report || report.userId !== c.get('user').userId) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateReportSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  await db
    .update(schema.report)
    .set({
      name: parsed.data.name ?? report.name,
      description: parsed.data.description ?? report.description,
      parameters: parsed.data.parameters ?? report.parameters,
      updatedAt: new Date(),
    })
    .where(eq(schema.report.reportId, report.reportId));

  const updated = await getReportById(c.env, report.reportId);
  return json(serializeReport(updated!));
}

export async function handleDelete(c: Ctx) {
  const report = await getReportById(c.env, c.req.param('reportId') ?? '');
  if (!report || report.userId !== c.get('user').userId) return notFound();

  const db = createDb(c.env.DB);
  await db.delete(schema.report).where(eq(schema.report.reportId, report.reportId));
  return json({ ok: true });
}

export async function handleUtm(c: Ctx) {
  const ctx = await requireReportWebsite(c);
  if ('error' in ctx && ctx.error) return ctx.error;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const segmentId = c.req.query('segmentId') ?? null;
  const data = await getUtmReport(c.env, ctx.websiteId!, startAt, endAt, ctx.segment);
  return json({ ...data, segmentId, startAt, endAt });
}

export async function handleGoal(c: Ctx) {
  const websiteId = c.req.query('websiteId');
  if (!websiteId) return badRequest('websiteId required');
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const event = c.req.query('event') ?? undefined;
  const rows = await getGoalReport(c.env, websiteId, startAt, endAt, event);
  return json(rows);
}

export async function handleRevenue(c: Ctx) {
  const websiteId = c.req.query('websiteId');
  if (!websiteId) return badRequest('websiteId required');
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const data = await getRevenueReport(c.env, websiteId, startAt, endAt);
  return json(data);
}

async function loadSegmentParams(c: Ctx, websiteId: string) {
  const segmentId = c.req.query('segmentId');
  if (!segmentId) return null;
  const segment = await getSegmentById(c.env, segmentId);
  if (!segment || segment.websiteId !== websiteId) return null;
  return segment.parameters as Record<string, unknown>;
}

async function requireReportWebsite(c: Ctx) {
  const websiteId = c.req.query('websiteId');
  if (!websiteId) return { error: badRequest('websiteId required') as Response };
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return { error: notFound() as Response };
  }
  return { websiteId, segment: await loadSegmentParams(c, websiteId) };
}

export async function handleFunnel(c: Ctx) {
  const ctx = await requireReportWebsite(c);
  if ('error' in ctx && ctx.error) return ctx.error;
  const stepsRaw = c.req.query('steps') ?? '';
  const steps = stepsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!steps.length) return badRequest('steps required (comma-separated event names)');
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const data = await getFunnelReport(c.env, ctx.websiteId!, startAt, endAt, steps, ctx.segment);
  return json(data);
}

export async function handleRetention(c: Ctx) {
  const ctx = await requireReportWebsite(c);
  if ('error' in ctx && ctx.error) return ctx.error;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d', clamp: true });
  const data = await getRetentionReport(c.env, ctx.websiteId!, startAt, endAt, ctx.segment);
  return json(data);
}

export async function handleStickiness(c: Ctx) {
  const ctx = await requireReportWebsite(c);
  if ('error' in ctx && ctx.error) return ctx.error;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d', clamp: true });
  const event = c.req.query('event')?.trim() || null;
  const actor = c.req.query('actor') === 'session' ? 'session' : 'person';
  const data = await getStickinessReport(c.env, ctx.websiteId!, startAt, endAt, event, actor, ctx.segment);
  return json(data);
}

export async function handleJourney(c: Ctx) {
  const ctx = await requireReportWebsite(c);
  if ('error' in ctx && ctx.error) return ctx.error;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d', clamp: true });
  const limit = Number(c.req.query('limit') || 20);
  const offset = Number(c.req.query('offset') || 0);
  const segmentId = c.req.query('segmentId');
  const flowMode = c.req.query('flow') === '1' || c.req.query('mode') === 'flow';
  const prefixSteps = (c.req.queries('step') ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

  const data = flowMode || prefixSteps.length > 0
    ? await getJourneyFlowReport(
        c.env,
        ctx.websiteId!,
        startAt,
        endAt,
        prefixSteps,
        limit,
        ctx.segment,
      )
    : await getJourneyReport(
        c.env,
        ctx.websiteId!,
        startAt,
        endAt,
        limit,
        ctx.segment,
        offset,
      );
  return json({ ...data, segmentId: segmentId ?? null });
}

export async function handleAttribution(c: Ctx) {
  const ctx = await requireReportWebsite(c);
  if ('error' in ctx && ctx.error) return ctx.error;

  const parsed = attributionQuerySchema.safeParse({
    websiteId: ctx.websiteId,
    model: c.req.query('model') === 'first' ? 'first' : 'last',
    type: c.req.query('type') || undefined,
    step: c.req.query('step') || undefined,
    dimension: c.req.query('dimension') || undefined,
    startAt: c.req.query('startAt') || undefined,
    endAt: c.req.query('endAt') || undefined,
    segmentId: c.req.query('segmentId') || undefined,
  });
  if (!parsed.success) return badRequest(parsed.error.message);

  const { model, type, step } = parsed.data;
  const segmentId = c.req.query('segmentId') ?? null;

  if (!step) {
    const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
    const data = await getAttributionReport(c.env, ctx.websiteId!, startAt, endAt, model, ctx.segment);
    return json(data);
  }

  if (!type) return badRequest('type required when step is set (path or event)');

  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d', clamp: true });
  const data = await getAttributionConversionReport(
    c.env,
    ctx.websiteId!,
    startAt,
    endAt,
    model,
    type,
    step,
    ctx.segment,
    segmentId,
  );
  return json(data);
}

export async function handleBreakdown(c: Ctx) {
  const ctx = await requireReportWebsite(c);
  if ('error' in ctx && ctx.error) return ctx.error;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const dimension = c.req.query('dimension') || 'country';
  const data = await getBreakdownReport(
    c.env,
    ctx.websiteId!,
    startAt,
    endAt,
    dimension,
    ctx.segment,
  );
  return json(data);
}

export async function handlePerformance(c: Ctx) {
  const ctx = await requireReportWebsite(c);
  if ('error' in ctx && ctx.error) return ctx.error;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const data = await getPerformanceReport(c.env, ctx.websiteId!, startAt, endAt, ctx.segment);
  return json(data);
}
