import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import type { AuthUser } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite } from './access';
import { getUserById, getWebsiteById } from './queries';

export type BoardWidget = {
  type?: string;
  websiteId?: string;
  insightId?: string;
  label?: string;
  width?: string;
};

export function parseBoardWidgets(parameters: unknown): BoardWidget[] {
  if (!parameters || typeof parameters !== 'object') return [];
  const widgets = (parameters as { widgets?: unknown }).widgets;
  if (!Array.isArray(widgets)) return [];
  return widgets.filter((row): row is BoardWidget => Boolean(row && typeof row === 'object'));
}

async function userCanAccessWebsiteId(env: Env, user: AuthUser, websiteId: string) {
  const website = await getWebsiteById(env, websiteId);
  if (!website) return false;
  return canAccessWebsite(env, website, user);
}

export async function validateBoardWidgetsForUser(
  env: Env,
  user: AuthUser,
  widgets: BoardWidget[],
): Promise<string | null> {
  for (const widget of widgets) {
    if (widget.type === 'stats' && widget.websiteId) {
      if (!(await userCanAccessWebsiteId(env, user, widget.websiteId))) {
        return 'Board widget references a website you cannot access.';
      }
    }
    if (widget.type === 'insight' && widget.insightId) {
      const db = createDb(env.DB);
      const [insight] = await db
        .select()
        .from(schema.insight)
        .where(eq(schema.insight.insightId, widget.insightId))
        .limit(1);
      if (!insight) return 'Board widget references an insight that does not exist.';
      if (!(await userCanAccessWebsiteId(env, user, insight.websiteId))) {
        return 'Board widget references an insight from a website you cannot access.';
      }
    }
  }
  return null;
}

export async function filterBoardWidgetsForPublicShare(
  env: Env,
  owner: AuthUser,
  widgets: BoardWidget[],
): Promise<BoardWidget[]> {
  const allowed: BoardWidget[] = [];
  for (const widget of widgets) {
    if (widget.type === 'stats' && widget.websiteId) {
      if (await userCanAccessWebsiteId(env, owner, widget.websiteId)) allowed.push(widget);
      continue;
    }
    if (widget.type === 'insight' && widget.insightId) {
      const db = createDb(env.DB);
      const [insight] = await db
        .select()
        .from(schema.insight)
        .where(eq(schema.insight.insightId, widget.insightId))
        .limit(1);
      if (insight && (await userCanAccessWebsiteId(env, owner, insight.websiteId))) {
        allowed.push(widget);
      }
      continue;
    }
    allowed.push(widget);
  }
  return allowed;
}

export async function resolveBoardOwner(env: Env, userId: string): Promise<AuthUser | null> {
  const user = await getUserById(env, userId);
  if (!user) return null;
  return { userId: user.userId, role: user.role };
}
