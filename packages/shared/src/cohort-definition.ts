import type { CohortDefinition } from './schemas';

/** Cohorts created before definitions existed store a single event name or path in type/value. */
export function legacyToDefinition(type: string, value: string): CohortDefinition {
  if (type === 'event') {
    return { conditions: [{ field: 'event_name', operator: 'equals', value }] };
  }
  return { conditions: [{ field: 'url_path', operator: 'equals', value }] };
}

export function parseCohortDefinition(
  definition: CohortDefinition | null | undefined,
  type: string,
  value: string,
): CohortDefinition {
  if (definition?.conditions?.length) return definition;
  return legacyToDefinition(type, value);
}
