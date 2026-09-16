import {
  ENTITY_TYPE,
  PUBLIC_DEMO_SHARE_SLUG,
  PUBLIC_DEMO_WEBSITE_ID,
} from '@flareboard/shared';
import type { Env } from '../env';
import { getShareBySlug, getWebsiteById } from './queries';

function isShareExpired(expiresAt: Date | number | null | undefined) {
  if (expiresAt == null) return false;
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt;
  return ms <= Date.now();
}

export function serializeDemoWebsite(website: {
  name: string;
  domain?: string | null;
  timezone?: string | null;
}) {
  return {
    name: website.name,
    domain: website.domain ?? null,
    timezone: website.timezone ?? 'UTC',
    sample: true as const,
  };
}

/** Resolve the public sample site: env id, then share slug `demo`, then seed id. */
export async function resolveDemoWebsite(env: Env) {
  const fromEnv = env.DEMO_WEBSITE_ID?.trim();
  if (fromEnv) {
    const website = await getWebsiteById(env, fromEnv);
    if (website) return website;
  }

  const share = await getShareBySlug(env, PUBLIC_DEMO_SHARE_SLUG);
  if (
    share &&
    share.shareType === ENTITY_TYPE.website &&
    !isShareExpired(share.expiresAt)
  ) {
    const params = share.parameters as { websiteId?: string } | null;
    const websiteId = params?.websiteId || share.entityId;
    const website = await getWebsiteById(env, websiteId);
    if (website) return website;
  }

  return getWebsiteById(env, PUBLIC_DEMO_WEBSITE_ID);
}
