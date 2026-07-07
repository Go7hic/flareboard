import { describe, expect, it } from 'vitest';
import {
  actionDefinitionMatches,
  actionMatchContextFromEvent,
  matchActionDefinitions,
} from '../../src/action-evaluator';

describe('action evaluator', () => {
  it('matches event, path, and property rules in memory', () => {
    const context = actionMatchContextFromEvent({
      eventName: 'checkout_started',
      urlPath: '/pricing',
      data: { plan: 'pro' },
    });

    const matched = matchActionDefinitions(
      [
        {
          id: 'action-1',
          name: 'Pro checkout',
          rules: [
            { field: 'event_name', operator: 'equals', value: 'checkout_started' },
            { field: 'property', key: 'plan', operator: 'equals', value: 'pro' },
          ],
        },
        {
          id: 'action-2',
          name: 'Pricing page',
          rules: [{ field: 'url_path', operator: 'contains', value: 'pricing' }],
        },
      ],
      context,
    );

    expect(matched.map((row) => row.id)).toEqual(['action-1', 'action-2']);
    expect(actionDefinitionMatches(matched[0]!, context)).toBe(true);
  });
});
