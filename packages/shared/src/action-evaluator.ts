export type ActionRule = {
  field: 'event_name' | 'url_path' | 'property';
  key?: string;
  operator: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'not_equals' | 'not_contains';
  value: string;
};

export type ActionDefinitionLike = {
  id: string;
  name: string;
  rules: ActionRule[];
};

export type ActionMatchContext = {
  eventName: string | null;
  urlPath: string | null;
  properties: Record<string, string>;
};

function scalarMatches(actual: string | null | undefined, operator: ActionRule['operator'], expected: string) {
  const value = actual ?? '';
  switch (operator) {
    case 'equals':
      return value === expected;
    case 'contains':
      return value.includes(expected);
    case 'starts_with':
      return value.startsWith(expected);
    case 'ends_with':
      return value.endsWith(expected);
    case 'not_equals':
      return value !== expected;
    case 'not_contains':
      return !value.includes(expected);
    default:
      return true;
  }
}

export function actionRuleMatches(rule: ActionRule, context: ActionMatchContext): boolean {
  if (rule.field === 'event_name') {
    return scalarMatches(context.eventName, rule.operator, rule.value);
  }
  if (rule.field === 'url_path') {
    return scalarMatches(context.urlPath, rule.operator, rule.value);
  }
  if (rule.field === 'property' && rule.key) {
    return scalarMatches(context.properties[rule.key], rule.operator, rule.value);
  }
  return true;
}

export function actionDefinitionMatches(definition: ActionDefinitionLike, context: ActionMatchContext): boolean {
  const rules = Array.isArray(definition.rules) ? definition.rules : [];
  if (!rules.length) return false;
  return rules.every((rule) => actionRuleMatches(rule, context));
}

export function matchActionDefinitions(
  definitions: ActionDefinitionLike[],
  context: ActionMatchContext,
): ActionDefinitionLike[] {
  return definitions.filter((definition) => actionDefinitionMatches(definition, context));
}

export function actionMatchContextFromEvent(input: {
  eventName?: string | null;
  urlPath?: string | null;
  data?: Record<string, unknown>;
}): ActionMatchContext {
  const properties: Record<string, string> = {};
  if (input.data) {
    for (const [key, value] of Object.entries(input.data)) {
      if (value == null) continue;
      if (typeof value === 'string') properties[key] = value;
      else if (typeof value === 'number' || typeof value === 'boolean') properties[key] = String(value);
    }
  }
  return {
    eventName: input.eventName ?? null,
    urlPath: input.urlPath ?? null,
    properties,
  };
}
