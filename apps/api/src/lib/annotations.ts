import type { Env } from '../env';

export type AnnotationRow = {
  annotationId: string;
  websiteId: string;
  userId: string;
  title: string;
  description: string;
  category: string;
  happenedAt: number | Date;
  createdAt: number | Date | null;
  updatedAt: number | Date | null;
};

function timeValue(value: number | Date | null) {
  if (value instanceof Date) return value.getTime();
  return value;
}

export function serializeAnnotation(row: AnnotationRow) {
  return {
    id: row.annotationId,
    websiteId: row.websiteId,
    userId: row.userId,
    title: row.title,
    description: row.description,
    category: row.category,
    happenedAt: timeValue(row.happenedAt),
    createdAt: timeValue(row.createdAt),
    updatedAt: timeValue(row.updatedAt),
  };
}

export async function listAnnotations(env: Env, websiteId: string, startAt: number, endAt: number) {
  const rows = await env.DB.prepare(
    `SELECT annotation_id as annotationId,
            website_id as websiteId,
            user_id as userId,
            title,
            description,
            category,
            happened_at as happenedAt,
            created_at as createdAt,
            updated_at as updatedAt
     FROM annotation
     WHERE website_id = ?1
       AND happened_at >= ?2
       AND happened_at <= ?3
     ORDER BY happened_at DESC
     LIMIT 500`,
  )
    .bind(websiteId, startAt, endAt)
    .all<AnnotationRow>();

  return rows.results ?? [];
}
