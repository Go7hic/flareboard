import type { Context } from 'hono';
import {
  createErrorAlertRuleSchema,
  createErrorIssueCommentSchema,
  mergeErrorIssuesSchema,
  updateErrorAlertRuleSchema,
  updateErrorIssueStateSchema,
  uploadErrorSourceMapSchema,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite, userIdHasWebsiteAccess } from '../lib/access';
import { parseStatsRange } from '../lib/parse-range';
import { requireWebsite } from '../lib/website';
import {
  addErrorIssueComment,
  createErrorAlertRule,
  deleteErrorAlertRule,
  ErrorIssueInputError,
  getErrorAlertRule,
  getErrorEvent,
  getErrorIssue,
  getErrorOverview,
  listErrorAlertRules,
  mergeErrorIssues,
  unmergeErrorIssue,
  updateErrorAlertRule,
  updateErrorIssueState,
  type ErrorIssueStatusFilter,
} from '../lib/errors';
import {
  deleteErrorSourceMap,
  listErrorSourceMaps,
  MAX_SOURCE_MAP_BYTES,
  SourceMapUploadError,
  storeErrorSourceMap,
} from '../lib/source-maps';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function normalizeOptionalParam(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

function parseIssueStatus(value: string | undefined): ErrorIssueStatusFilter | undefined {
  if (value === 'open' || value === 'resolved' || value === 'ignored' || value === 'regressed') return value;
  return undefined;
}

function waitUntil(c: Ctx) {
  try {
    const ctx = c.executionCtx;
    return (promise: Promise<unknown>) => ctx.waitUntil(promise);
  } catch {
    return undefined;
  }
}

export async function handleList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const filters = {
    release: normalizeOptionalParam(c.req.query('release')),
    environment: normalizeOptionalParam(c.req.query('environment')),
    status: parseIssueStatus(c.req.query('status')),
  };
  const overview = await getErrorOverview(c.env, website.websiteId, startAt, endAt, filters, {
    waitUntil: waitUntil(c),
  });
  return json(overview);
}

export async function handleGet(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const eventId = c.req.param('eventId');
  if (!eventId) return notFound();
  const event = await getErrorEvent(c.env, website.websiteId, eventId);
  if (!event) return notFound();
  return json(event);
}

export async function handleGetIssue(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const fingerprint = c.req.param('fingerprint')?.trim();
  if (!fingerprint || fingerprint.length > 1000) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const result = await getErrorIssue(c.env, website.websiteId, fingerprint, startAt, endAt, {
    waitUntil: waitUntil(c),
  });
  if (!result) return notFound();
  return json(result);
}

export async function handleUpdateIssue(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateErrorIssueStateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  if (
    parsed.data.assigneeUserId &&
    !(await userIdHasWebsiteAccess(c.env, website, parsed.data.assigneeUserId))
  ) {
    return badRequest('Assignee does not have access to this website.');
  }

  const state = await updateErrorIssueState(
    c.env,
    website.websiteId,
    parsed.data.fingerprint,
    parsed.data.status,
    parsed.data.note,
    parsed.data.assigneeUserId,
  );
  return json(state);
}

export async function handleCreateIssueComment(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createErrorIssueCommentSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const comment = await addErrorIssueComment(
    c.env,
    website.websiteId,
    parsed.data.fingerprint,
    c.get('user').userId,
    parsed.data.body,
  );
  return json(comment, 201);
}

export async function handleMergeIssues(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = mergeErrorIssuesSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  try {
    const result = await mergeErrorIssues(
      c.env,
      website.websiteId,
      parsed.data.targetFingerprint,
      parsed.data.sourceFingerprints,
      c.get('user').userId,
    );
    return json(result);
  } catch (error) {
    if (error instanceof ErrorIssueInputError) return badRequest(error.message);
    throw error;
  }
}

export async function handleUnmergeIssue(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const fingerprint = c.req.param('fingerprint')?.trim();
  if (!fingerprint) return notFound();
  const result = await unmergeErrorIssue(c.env, website.websiteId, fingerprint);
  if (!result) return notFound();
  return json(result);
}

export async function handleListSourceMaps(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();

  const release = normalizeOptionalParam(c.req.query('release'));
  const sourceMaps = await listErrorSourceMaps(c.env, website.websiteId, release);
  return json({ sourceMaps });
}

/** Room for multipart framing around several maps. */
const MAX_UPLOAD_REQUEST_BYTES = MAX_SOURCE_MAP_BYTES * 3;

/**
 * JSON `{ release, file, content }` (dashboard), or multipart/form-data for CI:
 *   curl -H "Authorization: Bearer $FLAREBOARD_TOKEN" \
 *     -F release=$GIT_SHA \
 *     -F "file=@dist/assets/index-C3sPvF1q.js.map;filename=assets/index-C3sPvF1q.js.map" \
 *     https://<api>/api/websites/<websiteId>/errors/source-maps
 * Every file part is stored under its filename (repeat -F for several maps).
 */
export async function handleUploadSourceMap(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > MAX_UPLOAD_REQUEST_BYTES) {
    return json({ message: `Upload is larger than ${MAX_UPLOAD_REQUEST_BYTES} bytes.` }, 413);
  }

  try {
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
      const form = await c.req.formData().catch(() => null);
      if (!form) return badRequest('Expected multipart/form-data.');
      const release = form.get('release');
      if (typeof release !== 'string' || !release.trim() || release.trim().length > 200) {
        return badRequest('release is required (max 200 characters).');
      }
      const files = [...form.values()].filter((value): value is File => typeof value !== 'string');
      if (!files.length) return badRequest('Attach at least one source map file.');
      if (files.length > 100) return badRequest('Upload at most 100 source maps per request.');
      const sourceMaps = [];
      for (const file of files) {
        if (!file.name?.trim() || file.name.length > 1000) return badRequest('Every file needs a filename.');
        if (file.size > MAX_SOURCE_MAP_BYTES) {
          return json({ message: `${file.name} is larger than ${MAX_SOURCE_MAP_BYTES} bytes.` }, 413);
        }
        sourceMaps.push(await storeErrorSourceMap(c.env, website.websiteId, release, file.name, await file.text()));
      }
      return json({ release: release.trim(), sourceMaps }, 201);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = uploadErrorSourceMapSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.message);
    const sourceMap = await storeErrorSourceMap(
      c.env,
      website.websiteId,
      parsed.data.release,
      parsed.data.file,
      parsed.data.content,
    );
    return json(sourceMap, 201);
  } catch (error) {
    if (error instanceof SourceMapUploadError) return json({ message: error.message }, error.status);
    throw error;
  }
}

export async function handleDeleteSourceMap(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const sourceMapId = c.req.param('sourceMapId');
  if (!sourceMapId) return notFound();
  const deleted = await deleteErrorSourceMap(c.env, website.websiteId, sourceMapId);
  if (!deleted) return notFound();
  return json({ ok: true });
}

export async function handleListAlertRules(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();

  const alertRules = await listErrorAlertRules(c.env, website.websiteId);
  return json({ alertRules });
}

export async function handleCreateAlertRule(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createErrorAlertRuleSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const alertRule = await createErrorAlertRule(c.env, website.websiteId, parsed.data);
  return json(alertRule, 201);
}

export async function handleUpdateAlertRule(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const alertRuleId = c.req.param('alertRuleId');
  if (!alertRuleId || !(await getErrorAlertRule(c.env, website.websiteId, alertRuleId))) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateErrorAlertRuleSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const alertRule = await updateErrorAlertRule(c.env, website.websiteId, alertRuleId, parsed.data);
  if (!alertRule) return notFound();
  return json(alertRule);
}

export async function handleDeleteAlertRule(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const alertRuleId = c.req.param('alertRuleId');
  if (!alertRuleId) return notFound();
  const deleted = await deleteErrorAlertRule(c.env, website.websiteId, alertRuleId);
  if (!deleted) return notFound();
  return json({ ok: true });
}
