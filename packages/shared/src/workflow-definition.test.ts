import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkOutboundUrl } from './delivery';
import {
  buildWorkflowTemplateContext,
  capWorkflowEventProperties,
  createWorkflowSchema,
  generateWorkflowSigningSecret,
  isRetryableWorkflowStatus,
  legacyWorkflowSteps,
  matchWorkflowConditions,
  parseStoredWorkflowFilters,
  parseStoredWorkflowSteps,
  renderJsonTemplate,
  renderTextTemplate,
  renderWorkflowAction,
  signWorkflowPayload,
  summarizeWorkflowActionType,
  workflowConditionContext,
  workflowRetryDelayMs,
  workflowStepsSchema,
  WorkflowTemplateError,
  type WorkflowCondition,
  type WorkflowEventSnapshot,
} from './workflow-definition';

const EVENT: WorkflowEventSnapshot = {
  id: 'evt-1',
  name: 'checkout_completed',
  createdAt: Date.UTC(2026, 8, 1, 12),
  sessionId: 'sess-1',
  visitId: 'visit-1',
  distinctId: 'user-42',
  hostname: 'shop.example.com',
  urlPath: '/checkout/done',
  urlQuery: 'ref=mail',
  properties: {
    plan: 'Pro',
    amount: 49.5,
    quote: 'say "hi"\nnext line',
    nested: { tier: 'gold' },
    'dotted.key': 'flat wins',
  },
};

function context(personProperties: Record<string, unknown> = { email: 'ada@example.com', name: '<!channel> & co' }) {
  return buildWorkflowTemplateContext({
    event: EVENT,
    personProperties,
    website: { id: 'site-1', name: 'Shop', domain: 'shop.example.com' },
    workflow: { id: 'wf-1', name: 'Notify sales' },
    executionId: 'exec-1',
  });
}

describe('workflow templates', () => {
  it('renders text placeholders, nested and dotted property keys', () => {
    const out = renderTextTemplate(
      '{{event.name}} on {{ website.name }}: {{event.properties.plan}} / {{event.properties.nested.tier}} / {{event.properties.dotted.key}} / {{person.properties.email}} / {{event.url}} / [{{event.properties.missing}}]',
      context(),
    );
    expect(out).toBe(
      'checkout_completed on Shop: Pro / gold / flat wins / ada@example.com / https://shop.example.com/checkout/done?ref=mail / []',
    );
  });

  it('leaves unknown roots empty instead of leaking internals', () => {
    expect(renderTextTemplate('[{{env.APP_SECRET}}][{{constructor}}][{{event.properties.__proto__}}]', context())).toBe(
      '[][][]',
    );
  });

  it('escapes values inside JSON strings and types values outside them', () => {
    const body = renderJsonTemplate(
      '{"text": "Order by {{person.properties.name}}: {{event.properties.quote}}", "amount": {{event.properties.amount}}, "plan": {{event.properties.plan}}, "missing": {{event.properties.nope}}, "nested": {{event.properties.nested}}}',
      context(),
    );
    expect(JSON.parse(body)).toEqual({
      text: 'Order by <!channel> & co: say "hi"\nnext line',
      amount: 49.5,
      plan: 'Pro',
      missing: null,
      nested: { tier: 'gold' },
    });
  });

  it('cannot be broken out of by a hostile property value', () => {
    const hostile = buildWorkflowTemplateContext({
      event: { ...EVENT, properties: { v: '", "admin": true, "x": "' } },
      website: { id: 's', name: 'S' },
      workflow: { id: 'w', name: 'W' },
      executionId: 'e',
    });
    const inString = JSON.parse(renderJsonTemplate('{"note": "{{event.properties.v}}"}', hostile));
    expect(inString).toEqual({ note: '", "admin": true, "x": "' });
    const bare = JSON.parse(renderJsonTemplate('{"note": {{event.properties.v}}}', hostile));
    expect(bare).toEqual({ note: '", "admin": true, "x": "' });
  });

  it('keeps escaped quotes and braces in the template literal text', () => {
    const body = renderJsonTemplate('{"a": "x \\" {{event.name}}", "b": "}}", "c": {"d": 1}}', context());
    expect(JSON.parse(body)).toEqual({ a: 'x " checkout_completed', b: '}}', c: { d: 1 } });
  });

  it('renders webhook, email and Slack actions safely', () => {
    const webhook = renderWorkflowAction(
      {
        id: 'w',
        type: 'webhook',
        url: 'https://hooks.example.com/in',
        method: 'POST',
        headers: [{ key: 'X-Plan', value: '{{event.properties.quote}}' }],
        body: '',
      },
      context(),
    );
    expect(webhook.type).toBe('webhook');
    if (webhook.type !== 'webhook') throw new Error('unreachable');
    expect(webhook.headers[0]!.value).toBe('say "hi" next line');
    const payload = JSON.parse(webhook.body!);
    expect(payload).toMatchObject({
      type: 'workflow',
      workflowId: 'wf-1',
      eventId: 'evt-1',
      eventName: 'checkout_completed',
      sessionId: 'sess-1',
      event: { properties: { plan: 'Pro' } },
      person: { distinctId: 'user-42', properties: { email: 'ada@example.com' } },
    });

    const get = renderWorkflowAction(
      { id: 'g', type: 'webhook', url: 'https://x.example.com', method: 'GET', headers: [], body: '{"a": 1}' },
      context(),
    );
    expect(get.type === 'webhook' && get.body).toBeNull();

    const email = renderWorkflowAction(
      { id: 'e', type: 'email', to: 'a@example.com, b@example.com', subject: 'New {{event.properties.quote}}', body: '<b>{{person.properties.name}}</b>' },
      context(),
    );
    if (email.type !== 'email') throw new Error('unreachable');
    expect(email.to).toEqual(['a@example.com', 'b@example.com']);
    expect(email.subject).toBe('New say "hi" next line');
    expect(email.html).toContain('&lt;b&gt;&lt;!channel&gt; &amp; co&lt;/b&gt;');
    expect(email.text).toContain('Sent by the Flareboard workflow "Notify sales" for Shop.');

    const slack = renderWorkflowAction(
      { id: 's', type: 'slack', webhookUrl: 'https://hooks.slack.com/services/T/B/X', message: '*{{event.name}}* by {{person.properties.name}}' },
      context(),
    );
    if (slack.type !== 'slack') throw new Error('unreachable');
    expect(JSON.parse(slack.body)).toEqual({ text: '*checkout_completed* by &lt;!channel&gt; &amp; co' });
  });

  it('rejects a body template that renders to invalid JSON', () => {
    expect(() =>
      renderWorkflowAction(
        { id: 'w', type: 'webhook', url: 'https://x.example.com', method: 'POST', headers: [], body: '{"a": }' },
        context(),
      ),
    ).toThrow(WorkflowTemplateError);
  });
});

describe('workflow conditions', () => {
  const ctx = workflowConditionContext(EVENT, { plan: 'enterprise', seats: '12' });
  const cases: Array<[WorkflowCondition, boolean]> = [
    [{ field: 'property', key: 'plan', operator: 'equals', value: 'pro' }, true],
    [{ field: 'property', key: 'plan', operator: 'not_equals', value: 'Pro' }, false],
    [{ field: 'property', key: 'plan', operator: 'contains', value: 'r' }, true],
    [{ field: 'property', key: 'coupon', operator: 'exists', value: '' }, false],
    [{ field: 'property', key: 'coupon', operator: 'not_exists', value: '' }, true],
    [{ field: 'property', key: 'amount', operator: 'greater_than', value: '40' }, true],
    [{ field: 'property', key: 'amount', operator: 'less_than_or_equal', value: '49' }, false],
    [{ field: 'property', key: 'plan', operator: 'greater_than', value: '1' }, false],
    [{ field: 'person', key: 'seats', operator: 'greater_than_or_equal', value: '12' }, true],
    [{ field: 'person', key: 'plan', operator: 'equals', value: 'free' }, false],
    [{ field: 'path', key: '', operator: 'starts_with', value: '/checkout' }, true],
    [{ field: 'url', key: '', operator: 'contains', value: 'ref=mail' }, true],
    [{ field: 'hostname', key: '', operator: 'ends_with', value: 'example.org' }, false],
  ];

  it.each(cases)('%o → %s', (condition, expected) => {
    expect(matchWorkflowConditions([condition], ctx)).toBe(expected);
  });

  it('ANDs conditions and can skip person conditions for the ingest pre-filter', () => {
    const conditions: WorkflowCondition[] = [
      { field: 'property', key: 'plan', operator: 'equals', value: 'pro' },
      { field: 'person', key: 'plan', operator: 'equals', value: 'free' },
    ];
    expect(matchWorkflowConditions(conditions, ctx)).toBe(false);
    expect(matchWorkflowConditions(conditions, workflowConditionContext(EVENT), { skipPerson: true })).toBe(true);
    expect(matchWorkflowConditions([], ctx)).toBe(true);
  });

  it('fails closed on unreadable stored filters', () => {
    expect(parseStoredWorkflowFilters(null)).toEqual([]);
    expect(parseStoredWorkflowFilters('not json')).toBeNull();
    expect(parseStoredWorkflowFilters('[{"field":"nope"}]')).toBeNull();
  });
});

describe('workflow retry schedule', () => {
  it('backs off exponentially: 30s, 2m, 8m, 32m', () => {
    expect([1, 2, 3, 4].map(workflowRetryDelayMs)).toEqual([30_000, 120_000, 480_000, 1_920_000]);
  });

  it('retries server errors, timeouts and rate limits only', () => {
    expect([500, 502, 503, 429, 408].every(isRetryableWorkflowStatus)).toBe(true);
    expect([400, 401, 403, 404, 410, 422].some(isRetryableWorkflowStatus)).toBe(false);
  });
});

describe('workflow signatures', () => {
  it('signs `${timestamp}.${body}` with HMAC-SHA256', async () => {
    const secret = generateWorkflowSigningSecret();
    expect(secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    const body = '{"hello":"world"}';
    const signature = await signWorkflowPayload(secret, 1_700_000_000, body);
    const expected = createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex');
    expect(signature).toBe(`v1=${expected}`);
    expect(await signWorkflowPayload(secret, 1_700_000_001, body)).not.toBe(signature);
  });
});

describe('outbound URL guard', () => {
  it.each([
    'http://localhost/hook',
    'http://127.0.0.1/hook',
    'http://2130706433/hook',
    'http://0x7f.1/hook',
    'http://10.1.2.3/hook',
    'http://172.20.0.1/hook',
    'http://192.168.1.1/hook',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/',
    'http://[::1]/hook',
    'http://[::ffff:127.0.0.1]/hook',
    'http://metadata.google.internal/',
    'http://api.internal/',
    'http://printer.local/',
    'http://intranet/',
    'http://localhost./',
    'https://user:pass@example.com/',
    'ftp://example.com/file',
    'file:///etc/passwd',
    'not a url',
  ])('blocks %s', (url) => {
    expect(checkOutboundUrl(url).ok).toBe(false);
  });

  it.each(['https://example.com/hook', 'http://hooks.example.io:8080/in?a=1', 'https://8.8.8.8/x'])('allows %s', (url) => {
    expect(checkOutboundUrl(url).ok).toBe(true);
  });
});

describe('workflow step validation', () => {
  it('accepts a full flow', () => {
    const parsed = workflowStepsSchema.safeParse([
      { id: 'd1', type: 'delay', minutes: 60 },
      { id: 'c1', type: 'condition', conditions: [{ field: 'person', key: 'plan', operator: 'not_equals', value: 'pro' }] },
      {
        id: 'w1',
        type: 'webhook',
        url: 'https://hooks.example.com/x',
        method: 'POST',
        headers: [{ key: 'Authorization', value: 'Bearer abc' }],
        body: '{"user": "{{person.distinct_id}}", "amount": {{event.properties.amount}}}',
      },
      { id: 'e1', type: 'email', to: 'team@example.com', subject: 'Hi', body: '' },
      { id: 's1', type: 'slack', webhookUrl: 'https://hooks.slack.com/services/T/B/X', message: 'New {{event.name}}' },
    ]);
    expect(parsed.success).toBe(true);
  });

  it.each([
    [{ id: 'd', type: 'delay', minutes: 7 * 24 * 60 + 1 }, 'minutes'],
    [{ id: 'd', type: 'delay', minutes: 0 }, 'minutes'],
    [{ id: 'c', type: 'condition', conditions: [] }, 'conditions'],
    [{ id: 'w', type: 'webhook', url: 'http://10.0.0.1/x' }, 'url'],
    [{ id: 'w', type: 'webhook', url: 'https://x.example.com', headers: [{ key: 'Host', value: 'a' }] }, 'headers'],
    [{ id: 'w', type: 'webhook', url: 'https://x.example.com', headers: [{ key: 'X-Flareboard-Signature', value: 'a' }] }, 'headers'],
    [{ id: 'w', type: 'webhook', url: 'https://x.example.com', headers: [{ key: 'Bad Header', value: 'a' }] }, 'headers'],
    [{ id: 'w', type: 'webhook', url: 'https://x.example.com', body: '{"a": {{event.name}' }, 'body'],
    [{ id: 'w', type: 'webhook', url: 'https://x.example.com', body: '{"a": "{{evnt.name}}"}' }, 'body'],
    [{ id: 'e', type: 'email', to: '' }, 'to'],
    [{ id: 'e', type: 'email', to: 'a@x.com,b@x.com,c@x.com,d@x.com,e@x.com,f@x.com' }, 'to'],
    [{ id: 'e', type: 'email', to: 'not-an-email' }, 'to'],
    [{ id: 's', type: 'slack', webhookUrl: 'https://evil.example.com/services/x', message: 'x' }, 'webhookUrl'],
    [{ id: 's', type: 'slack', webhookUrl: 'https://hooks.slack.com/services/x', message: '  ' }, 'message'],
  ])('rejects %o (%s)', (step, field) => {
    const parsed = workflowStepsSchema.safeParse([step]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path.includes(field))).toBe(true);
  });

  it('caps the total delay of a flow at 30 days', () => {
    const week = { type: 'delay', minutes: 7 * 24 * 60 };
    const fourWeeks = [1, 2, 3, 4].map((n) => ({ ...week, id: `d${n}` }));
    expect(workflowStepsSchema.safeParse(fourWeeks).success).toBe(true);
    expect(workflowStepsSchema.safeParse([...fourWeeks, { ...week, id: 'd5' }]).success).toBe(false);
  });

  it('limits steps and rejects duplicate ids', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `e${i}`, type: 'email', to: 'a@example.com' }));
    expect(workflowStepsSchema.safeParse(many).success).toBe(false);
    expect(
      workflowStepsSchema.safeParse([
        { id: 'x', type: 'delay', minutes: 1 },
        { id: 'x', type: 'delay', minutes: 2 },
      ]).success,
    ).toBe(false);
  });

  it('keeps legacy stored steps with refused URLs so the failure is recorded at delivery', () => {
    expect(parseStoredWorkflowSteps(JSON.stringify(legacyWorkflowSteps('webhook', { url: 'http://localhost/x' })))).toEqual([
      { id: 'webhook-1', type: 'webhook', url: 'http://localhost/x', method: 'POST', headers: [], body: '' },
    ]);
    expect(parseStoredWorkflowSteps('{"broken": true}')).toBeNull();
    expect(parseStoredWorkflowSteps(null)).toEqual([]);
  });

  it('summarizes the action type for older readers', () => {
    expect(summarizeWorkflowActionType([])).toBe('record');
    expect(summarizeWorkflowActionType(legacyWorkflowSteps('email', { email: 'a@b.co' }))).toBe('email');
    expect(
      summarizeWorkflowActionType([
        ...legacyWorkflowSteps('email', { email: 'a@b.co' }),
        { id: 's', type: 'slack', webhookUrl: 'https://hooks.slack.com/x', message: 'x' },
      ]),
    ).toBe('multi');
  });

  it('still accepts the legacy create body', () => {
    const parsed = createWorkflowSchema.safeParse({
      name: 'Signup webhook',
      triggerEvent: 'signup',
      actionType: 'webhook',
      actionConfig: { url: 'https://example.com/hooks/signup' },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.steps).toBeUndefined();
  });
});

describe('event property capping', () => {
  it('drops oversized or non-object properties', () => {
    expect(capWorkflowEventProperties({ a: 1 })).toEqual({ a: 1 });
    expect(capWorkflowEventProperties('x')).toEqual({});
    expect(capWorkflowEventProperties({ big: 'x'.repeat(40_000) })).toEqual({});
  });
});
