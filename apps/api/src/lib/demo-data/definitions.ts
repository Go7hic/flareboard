import {
  surveyQuestionsSchema,
  type FeatureFlagConfigForEvaluation,
  type FeatureFlagJsonValue,
  type SurveyQuestion,
} from '@flareboard/shared';
import { demoId } from './ids';
import type { SiteKind } from './catalog';

/**
 * The configuration objects the demo generator owns (flags, experiment, surveys, workflows,
 * actions, cohorts, insights, …), with deterministic ids. `config.ts` writes them to D1 and the
 * event generator reads the same definitions, so exposures match the flags' real bucketing and
 * survey answers match the questions.
 */

export type DemoFlag = FeatureFlagConfigForEvaluation & {
  name: string;
  description: string;
  earlyAccessName?: string;
  earlyAccessDescription?: string;
};

export const CHECKOUT_FLAG = 'new-checkout-flow';
export const SHIPPING_FLAG = 'free-shipping-banner';
export const RECOMMENDATIONS_FLAG = 'product-recommendations';
export const SIZE_GUIDE_FLAG = 'size-guide-v2';
export const ASSISTANT_FLAG = 'ai-shopping-assistant';
export const HOLIDAY_FLAG = 'holiday-theme';
export const DOCS_SEARCH_FLAG = 'docs-ai-search';

const STORE_FLAGS: readonly DemoFlag[] = [
  {
    key: CHECKOUT_FLAG,
    name: 'New checkout flow',
    description: 'One-page checkout with address autocomplete and express pay. Experiment flag.',
    enabled: true,
    conditionGroups: [{ conditions: [], rollout: 100, description: 'Everyone' }],
    variants: [
      { key: 'control', name: 'Current checkout', weight: 50 },
      { key: 'test', name: 'One-page checkout', weight: 50, payload: { layout: 'single-page', expressPay: true } },
    ],
  },
  {
    key: SHIPPING_FLAG,
    name: 'Free shipping banner',
    description: 'Announcement bar with the free shipping threshold.',
    enabled: true,
    conditionGroups: [{ conditions: [], rollout: 50, description: 'Half of all visitors' }],
    payload: { threshold: 75, currency: 'USD', message: 'Free shipping on orders over $75' },
  },
  {
    key: RECOMMENDATIONS_FLAG,
    name: 'Product recommendations',
    description: 'Recommendation strategy on product pages. Pro members always get collaborative filtering.',
    enabled: true,
    conditionGroups: [
      {
        conditions: [{ field: 'person', key: 'plan', operator: 'equals', value: 'pro' }],
        rollout: 100,
        variant: 'collaborative',
        description: 'Pro members',
      },
      { conditions: [], rollout: 80, description: 'Everyone else' },
    ],
    variants: [
      { key: 'control', name: 'Same category', weight: 34, payload: { strategy: 'category', slots: 4 } },
      { key: 'collaborative', name: 'Bought together', weight: 33, payload: { strategy: 'collaborative', slots: 6 } },
      { key: 'trending', name: 'Trending now', weight: 33, payload: { strategy: 'trending', slots: 6 } },
    ],
  },
  {
    key: SIZE_GUIDE_FLAG,
    name: 'Size guide v2',
    description: 'Interactive size guide with fit predictions.',
    enabled: true,
    conditionGroups: [
      {
        conditions: [{ field: 'language', operator: 'starts_with', value: 'en' }],
        rollout: 100,
        description: 'English-speaking visitors',
      },
      {
        conditions: [{ field: 'person', key: 'company', operator: 'exists', value: '' }],
        rollout: 30,
        description: 'Business accounts',
      },
    ],
  },
  {
    key: ASSISTANT_FLAG,
    name: 'AI shopping assistant',
    description: 'Chat assistant on product pages (early access, plus 20% of visitors).',
    enabled: true,
    earlyAccess: true,
    earlyAccessName: 'AI shopping assistant',
    earlyAccessDescription: 'Ask questions about fit, materials and delivery while you shop.',
    conditionGroups: [
      {
        conditions: [{ field: 'person', key: 'plan', operator: 'equals', value: 'pro' }],
        rollout: 100,
        description: 'Pro members',
      },
      { conditions: [], rollout: 20, description: 'Public beta' },
    ],
  },
  {
    key: HOLIDAY_FLAG,
    name: 'Holiday theme',
    description: 'Seasonal header artwork. Off until December.',
    enabled: false,
    conditionGroups: [{ conditions: [], rollout: 100 }],
  },
];

const DOCS_FLAGS: readonly DemoFlag[] = [
  {
    key: DOCS_SEARCH_FLAG,
    name: 'AI answers in search',
    description: 'Show a generated answer above search results.',
    enabled: true,
    conditionGroups: [{ conditions: [], rollout: 30 }],
  },
];

export function demoFlags(kind: SiteKind): readonly DemoFlag[] {
  return kind === 'store' ? STORE_FLAGS : DOCS_FLAGS;
}

export function flagId(websiteId: string, key: string) {
  return demoId(websiteId, 'flag', key);
}

export function experimentId(websiteId: string) {
  return demoId(websiteId, 'experiment', CHECKOUT_FLAG);
}

/** Purchase conversion (given checkout started) per checkout variant. */
export const CHECKOUT_CONVERSION: Record<string, number> = { control: 0.5, test: 0.6 };
/** Share of carts (with the flag evaluated) that start checkout, per variant. */
export const CHECKOUT_START: Record<string, number> = { control: 0.58, test: 0.64 };

export type DemoSurvey = {
  key: string;
  name: string;
  questions: SurveyQuestion[];
  triggerPath: string | null;
  triggerEvent: string | null;
  sampleRate: number;
};

function questions(raw: unknown): SurveyQuestion[] {
  return surveyQuestionsSchema.parse(raw) as SurveyQuestion[];
}

export const NPS_OPTIONS = ['Quality', 'Fit', 'Delivery speed', 'Customer service', 'Sustainability'];
export const HESITATION_OPTIONS = [
  'Shipping cost',
  'Delivery time',
  'Price',
  'Unsure about sizing',
  'Payment options',
  'Nothing, it was easy',
];
export const DOCS_HELPFUL_OPTIONS = ['Yes', 'Somewhat', 'No'];

const STORE_SURVEYS: readonly DemoSurvey[] = [
  {
    key: 'nps',
    name: 'Customer NPS',
    triggerPath: null,
    triggerEvent: null,
    sampleRate: 20,
    questions: questions([
      {
        id: 'nps',
        type: 'rating',
        scale: 'nps',
        question: 'How likely are you to recommend Northwind Supply to a friend?',
        lowerLabel: 'Not likely',
        upperLabel: 'Very likely',
        branching: [
          { when: { type: 'range', min: 0, max: 6 }, next: 'improve' },
          { when: { type: 'range', min: 9, max: 10 }, next: 'love' },
          { when: { type: 'any' }, next: 'end' },
        ],
      },
      {
        id: 'improve',
        type: 'open',
        question: 'What should we do better?',
        placeholder: 'Tell us what went wrong',
        branching: [{ when: { type: 'any' }, next: 'end' }],
      },
      { id: 'love', type: 'single_choice', question: 'What do you like most?', options: NPS_OPTIONS },
    ]),
  },
  {
    key: 'hesitation',
    name: 'What almost stopped you?',
    triggerPath: '/checkout/success',
    triggerEvent: 'purchase',
    sampleRate: 100,
    questions: questions([
      {
        id: 'hesitation',
        type: 'multiple_choice',
        question: 'What almost stopped you from buying today?',
        options: HESITATION_OPTIONS,
        hasOther: true,
      },
    ]),
  },
];

const DOCS_SURVEYS: readonly DemoSurvey[] = [
  {
    key: 'helpful',
    name: 'Was this page helpful?',
    triggerPath: '/docs',
    triggerEvent: null,
    sampleRate: 30,
    questions: questions([
      {
        id: 'helpful',
        type: 'single_choice',
        question: 'Was this page helpful?',
        options: DOCS_HELPFUL_OPTIONS,
        branching: [
          { when: { type: 'choice', value: 'No' }, next: 'missing' },
          { when: { type: 'any' }, next: 'end' },
        ],
      },
      { id: 'missing', type: 'open', question: 'What were you looking for?', optional: true },
    ]),
  },
];

export function demoSurveys(kind: SiteKind): readonly DemoSurvey[] {
  return kind === 'store' ? STORE_SURVEYS : DOCS_SURVEYS;
}

export function surveyId(websiteId: string, key: string) {
  return demoId(websiteId, 'survey', key);
}

/**
 * Workflows never have a delivery step (webhook, email or Slack): they either only record runs
 * or wait and check a condition. Nothing can be sent, even from the dashboard's test button.
 */
export type DemoWorkflow = {
  key: string;
  name: string;
  description: string;
  triggerEvent: string;
  enabled: boolean;
  filters: Array<{ field: 'property' | 'person' | 'path'; key: string; operator: string; value: string }>;
  steps: Array<{ id: string; type: 'delay'; minutes: number } | { id: string; type: 'condition'; conditions: Array<{ field: 'person' | 'property'; key: string; operator: string; value: string }> }>;
};

const STORE_WORKFLOWS: readonly DemoWorkflow[] = [
  {
    key: 'high-value-orders',
    name: 'Record high-value orders',
    description: 'Keeps a run log of every order over $150 for the VIP team.',
    triggerEvent: 'purchase',
    enabled: true,
    filters: [{ field: 'property', key: 'revenue', operator: 'greater_than', value: '150' }],
    steps: [],
  },
  {
    key: 'member-onboarding',
    name: 'Onboard new members',
    description: 'Waits an hour after signup, then checks whether the member chose a paid plan.',
    triggerEvent: 'signed_up',
    enabled: true,
    filters: [],
    steps: [
      { id: 'wait', type: 'delay', minutes: 60 },
      { id: 'paid', type: 'condition', conditions: [{ field: 'person', key: 'plan', operator: 'not_equals', value: 'free' }] },
    ],
  },
  {
    key: 'cart-abandonment',
    name: 'Cart abandonment follow-up (draft)',
    description: 'Draft: waits a day after checkout starts. No message step yet.',
    triggerEvent: 'checkout_started',
    enabled: false,
    filters: [],
    steps: [{ id: 'wait-day', type: 'delay', minutes: 1440 }],
  },
];

export function demoWorkflows(kind: SiteKind): readonly DemoWorkflow[] {
  return kind === 'store' ? STORE_WORKFLOWS : [];
}

export function workflowId(websiteId: string, key: string) {
  return demoId(websiteId, 'workflow', key);
}

export type DemoAction = { key: string; name: string; description: string; rules: Array<{ field: string; operator: string; value: string; key?: string }> };

const STORE_ACTIONS: readonly DemoAction[] = [
  { key: 'viewed-product', name: 'Viewed a product', description: 'Product detail views.', rules: [{ field: 'event_name', operator: 'equals', value: 'product_viewed' }] },
  { key: 'reached-checkout', name: 'Reached checkout', description: 'Any checkout page.', rules: [{ field: 'url_path', operator: 'starts_with', value: '/checkout' }] },
  { key: 'signed-up', name: 'Signed up', description: 'New member accounts.', rules: [{ field: 'event_name', operator: 'equals', value: 'signed_up' }] },
  { key: 'read-journal', name: 'Read the journal', description: 'Blog article views.', rules: [{ field: 'url_path', operator: 'starts_with', value: '/blog/' }] },
];

const DOCS_ACTIONS: readonly DemoAction[] = [
  { key: 'copied-snippet', name: 'Copied a snippet', description: 'Code block copy button.', rules: [{ field: 'event_name', operator: 'equals', value: 'code_copied' }] },
  { key: 'read-api-docs', name: 'Read API docs', description: 'API reference pages.', rules: [{ field: 'url_path', operator: 'starts_with', value: '/docs/api/' }] },
];

export function demoActions(kind: SiteKind): readonly DemoAction[] {
  return kind === 'store' ? STORE_ACTIONS : DOCS_ACTIONS;
}

export const STORE_GOALS = {
  goals: [
    { event: 'purchase', target: 1800, period: 'monthly' },
    { event: 'signed_up', target: 250, period: 'weekly' },
    { event: 'add_to_cart', target: 180, period: 'daily' },
  ],
};

export const DOCS_GOALS = {
  goals: [
    { event: 'code_copied', target: 4000, period: 'monthly' },
    { event: 'trial_started', target: 60, period: 'weekly' },
  ],
};

export type DemoCohort = { key: string; name: string; definition: Record<string, unknown>; legacyType: string; legacyValue: string };

const STORE_COHORTS: readonly DemoCohort[] = [
  {
    key: 'purchasers',
    name: 'Purchasers',
    legacyType: 'event',
    legacyValue: 'purchase',
    definition: { conditions: [{ field: 'event_name', operator: 'equals', value: 'purchase' }] },
  },
  {
    key: 'pro-members',
    name: 'Pro members',
    legacyType: 'event',
    legacyValue: 'product_viewed',
    definition: {
      conditions: [
        { field: 'event_name', operator: 'equals', value: 'product_viewed', filters: [{ type: 'person', key: 'plan', operator: 'is', value: 'pro' }] },
      ],
    },
  },
  {
    key: 'journal-readers',
    name: 'Journal readers',
    legacyType: 'path',
    legacyValue: '/blog/',
    definition: { conditions: [{ field: 'url_path', operator: 'contains', value: '/blog/' }] },
  },
  {
    key: 'newsletter-visitors',
    name: 'Newsletter visitors',
    legacyType: 'event',
    legacyValue: 'any',
    definition: {
      conditions: [{ field: 'any_event', operator: 'equals', value: '', filters: [{ type: 'dimension', key: 'utm_medium', operator: 'is', value: 'email' }] }],
    },
  },
];

const DOCS_COHORTS: readonly DemoCohort[] = [
  {
    key: 'api-readers',
    name: 'API readers',
    legacyType: 'path',
    legacyValue: '/docs/api/',
    definition: { conditions: [{ field: 'url_path', operator: 'contains', value: '/docs/api/' }] },
  },
];

export function demoCohorts(kind: SiteKind): readonly DemoCohort[] {
  return kind === 'store' ? STORE_COHORTS : DOCS_COHORTS;
}

export type DemoInsight = { key: string; type: string; name: string; description: string; query: Record<string, unknown> };

const STORE_INSIGHTS: readonly DemoInsight[] = [
  {
    key: 'conversion-by-device',
    type: 'trend',
    name: 'Purchase conversion rate by device',
    description: 'Orders per 100 visitors (formula A / B * 100), split by device.',
    query: {
      version: 2,
      interval: 'day',
      series: [
        { kind: 'event', event: 'purchase', math: 'total', label: 'Orders' },
        { kind: 'pageview', math: 'unique_users', label: 'Visitors' },
      ],
      formula: 'A / B * 100',
      breakdown: { type: 'dimension', key: 'device' },
    },
  },
  {
    key: 'revenue-by-country',
    type: 'trend',
    name: 'Revenue by country',
    description: 'Sum of order revenue per week, split by country.',
    query: {
      version: 2,
      interval: 'week',
      series: [{ kind: 'event', event: 'purchase', math: 'sum', mathProperty: 'revenue', label: 'Revenue' }],
      breakdown: { type: 'dimension', key: 'country' },
    },
  },
  {
    key: 'checkout-funnel',
    type: 'funnel',
    name: 'Checkout funnel',
    description: 'Product view to purchase within a day.',
    query: {
      version: 2,
      countBy: 'person',
      funnel: {
        steps: [
          { kind: 'event', event: 'product_viewed' },
          { kind: 'event', event: 'add_to_cart' },
          { kind: 'event', event: 'checkout_started' },
          { kind: 'event', event: 'purchase' },
        ],
        window: { value: 1, unit: 'day' },
        order: 'strict',
      },
    },
  },
  {
    key: 'member-retention',
    type: 'retention',
    name: 'Member retention',
    description: 'Members who come back in the weeks after signing up.',
    query: {
      version: 2,
      countBy: 'person',
      retention: { startEvent: { kind: 'event', event: 'signed_up' }, returnEvent: { kind: 'all' }, period: 'week', periods: 8 },
    },
  },
  {
    key: 'shopper-lifecycle',
    type: 'lifecycle',
    name: 'Shopper lifecycle',
    description: 'New, returning, resurrecting and dormant shoppers per week.',
    query: { version: 2, interval: 'week', countBy: 'person', series: [{ kind: 'all', math: 'total' }] },
  },
  {
    key: 'product-stickiness',
    type: 'stickiness',
    name: 'Product browsing stickiness',
    description: 'On how many days people view products.',
    query: { version: 2, countBy: 'person', series: [{ kind: 'event', event: 'product_viewed', math: 'total' }] },
  },
  {
    key: 'daily-active-shoppers',
    type: 'trend',
    name: 'Daily active shoppers',
    description: 'Unique visitors per day, compared with the previous period.',
    query: { version: 2, interval: 'day', compare: true, series: [{ kind: 'all', math: 'unique_users', label: 'Active shoppers' }] },
  },
];

const DOCS_INSIGHTS: readonly DemoInsight[] = [
  {
    key: 'snippet-copies',
    type: 'trend',
    name: 'Snippet copies by language',
    description: 'Code copies per day, split by snippet language.',
    query: {
      version: 2,
      interval: 'day',
      series: [{ kind: 'event', event: 'code_copied', math: 'total', label: 'Copies' }],
      breakdown: { type: 'event', key: 'language' },
    },
  },
  {
    key: 'docs-to-trial',
    type: 'funnel',
    name: 'Docs to trial',
    description: 'Readers who search, copy a snippet and start a trial.',
    query: {
      version: 2,
      countBy: 'person',
      funnel: {
        steps: [
          { kind: 'pageview', url: { match: 'contains', value: '/docs/' } },
          { kind: 'event', event: 'code_copied' },
          { kind: 'event', event: 'trial_started' },
        ],
        window: { value: 7, unit: 'day' },
        order: 'strict',
      },
    },
  },
];

export function demoInsights(kind: SiteKind): readonly DemoInsight[] {
  return kind === 'store' ? STORE_INSIGHTS : DOCS_INSIGHTS;
}

export function insightId(websiteId: string, key: string) {
  return demoId(websiteId, 'insight', key);
}

export function boardId(websiteId: string) {
  return demoId(websiteId, 'board', 'main');
}

export function notebookId(websiteId: string) {
  return demoId(websiteId, 'notebook', 'checkout-experiment');
}

export function errorAlertRuleId(websiteId: string) {
  return demoId(websiteId, 'error-alert', 'checkout');
}

export function logAlertRuleId(websiteId: string) {
  return demoId(websiteId, 'log-alert', 'checkout-service');
}

export function annotationId(websiteId: string, key: string) {
  return demoId(websiteId, 'annotation', key);
}

/** Custom model of the shopping assistant, priced through the website's LLM price overrides. */
export const CUSTOM_MODEL = 'northwind-reranker-v2';
export const CUSTOM_MODEL_PRICE = { input: 0.2, output: 0.2 };

export type FlagPayload = FeatureFlagJsonValue;
