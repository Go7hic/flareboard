import type { Context } from 'hono';
import { createPersonalApiKeySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite, canMutateWebsite } from '../lib/access';
import { logAdminAction } from '../lib/audit';
import {
  countPersonalApiKeys,
  createPersonalApiKey,
  listPersonalApiKeys,
  MAX_PERSONAL_API_KEYS,
  revokePersonalApiKey,
} from '../lib/personal-api-keys';
import { getOrCreateProjectKey, rotateProjectKey } from '../lib/project-keys';
import { getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export async function handleListPersonalKeys(c: Ctx) {
  return json(await listPersonalApiKeys(c.env, c.get('user').userId));
}

/** The response is the only time the secret is ever returned. */
export async function handleCreatePersonalKey(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = createPersonalApiKeySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues.map((issue) => issue.message).join('; '));

  const { userId } = c.get('user');
  if ((await countPersonalApiKeys(c.env, userId)) >= MAX_PERSONAL_API_KEYS) {
    return json({ message: `You can have at most ${MAX_PERSONAL_API_KEYS} API keys. Revoke one first.` }, 409);
  }

  const created = await createPersonalApiKey(c.env, userId, parsed.data);
  await logAdminAction(c.env, userId, 'create', 'personal_api_key', created.id, {
    name: created.name,
    prefix: created.prefix,
    scopes: created.scopes,
  });
  return json(created, 201);
}

export async function handleRevokePersonalKey(c: Ctx) {
  const { userId } = c.get('user');
  const revoked = await revokePersonalApiKey(c.env, userId, c.req.param('keyId') ?? '');
  if (!revoked) return notFound();
  await logAdminAction(c.env, userId, 'delete', 'personal_api_key', revoked.id, {
    name: revoked.name,
    prefix: revoked.prefix,
  });
  return json({ ok: true });
}

async function accessibleWebsite(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  const website = websiteId ? await getWebsiteById(c.env, websiteId) : null;
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) return null;
  return website;
}

/** Public ingest key of a website. It is embedded in pages, so anyone who can view the site may read it. */
export async function handleGetProjectKey(c: Ctx) {
  const website = await accessibleWebsite(c);
  if (!website) return notFound();
  return json(await getOrCreateProjectKey(c.env, website.websiteId));
}

export async function handleRotateProjectKey(c: Ctx) {
  const website = await accessibleWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const rotated = await rotateProjectKey(c.env, website.websiteId);
  await logAdminAction(c.env, c.get('user').userId, 'update', 'website', website.websiteId, {
    projectKeyRotated: true,
  });
  return json(rotated);
}
