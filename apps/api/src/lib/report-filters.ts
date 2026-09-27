import type { Env } from '../env';
import { resolveCohortMemberJoin } from './cohorts';
import { getSegmentById } from './queries';

/** Any route context: only the bindings and the query string are read. */
type Ctx = { env: Env; req: { query(name: string): string | undefined } };

/** `?segmentId=` parameters for this website, or null (other sites' segments are ignored). */
export async function segmentParamsFromQuery(c: Ctx, websiteId: string) {
  const segmentId = c.req.query('segmentId');
  if (!segmentId) return null;
  const segment = await getSegmentById(c.env, segmentId);
  if (!segment || segment.websiteId !== websiteId) return null;
  return segment.parameters as Record<string, unknown>;
}

/** `?cohort=` / `?cohortId=` member join for this website, or null. */
export async function cohortJoinFromQuery(c: Ctx, websiteId: string) {
  const cohortId = c.req.query('cohort') || c.req.query('cohortId');
  if (!cohortId) return null;
  return resolveCohortMemberJoin(c.env, websiteId, cohortId);
}
