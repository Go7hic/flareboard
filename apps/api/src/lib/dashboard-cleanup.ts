import { ENTITY_TYPE } from '@flareboard/shared';
import type { Env } from '../env';

/** Rows that only exist for one insight: alerts (and their history), subscriptions and shares. */
export async function deleteInsightDependents(env: Env, insightId: string) {
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM insight_alert_check WHERE alert_id IN (SELECT alert_id FROM insight_alert WHERE insight_id = ?1)`,
    ).bind(insightId),
    env.DB.prepare(`DELETE FROM insight_alert WHERE insight_id = ?1`).bind(insightId),
    env.DB.prepare(`DELETE FROM report_subscription WHERE target_type = 'insight' AND target_id = ?1`).bind(insightId),
    env.DB.prepare(`DELETE FROM share WHERE share_type = ?1 AND entity_id = ?2`).bind(ENTITY_TYPE.insight, insightId),
  ]);
}

/** Subscriptions and shares of a board. */
export async function deleteBoardDependents(env: Env, boardId: string) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM report_subscription WHERE target_type = 'board' AND target_id = ?1`).bind(boardId),
    env.DB.prepare(`DELETE FROM share WHERE share_type = ?1 AND entity_id = ?2`).bind(ENTITY_TYPE.board, boardId),
  ]);
}
