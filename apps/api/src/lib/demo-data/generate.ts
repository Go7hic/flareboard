import {
  computeErrorFingerprint,
  ERROR_FINGERPRINT_PROPERTY,
  evaluateFeatureFlag,
  EVENT_TYPE,
  featureEnrollmentProperty,
  type FeatureFlagEvaluationContext,
} from '@flareboard/shared';
import {
  CLIENTS,
  COLLECTIONS,
  COMPANIES,
  DOCS_CLIENTS,
  DOCS_PAGES,
  DOCS_SEARCH_QUERIES,
  DOCS_SOURCES,
  FIRST_NAMES,
  GEOS,
  LAST_NAMES,
  PRODUCTS,
  ROLES,
  STORE_BLOG_POSTS,
  STORE_SOURCES,
  type Client,
  type Company,
  type Geo,
  type Product,
  type SiteProfile,
  type Source,
} from './catalog';
import { ASSISTANT_QUESTIONS, CHECKOUT_LOGS, DOCS_ERRORS, STORE_ERRORS, weeklyError, type DemoError } from './content';
import {
  ASSISTANT_FLAG,
  CHECKOUT_CONVERSION,
  CHECKOUT_START,
  CHECKOUT_FLAG,
  CUSTOM_MODEL,
  DOCS_HELPFUL_OPTIONS,
  DOCS_SEARCH_FLAG,
  HESITATION_OPTIONS,
  NPS_OPTIONS,
  RECOMMENDATIONS_FLAG,
  SHIPPING_FLAG,
  SIZE_GUIDE_FLAG,
  surveyId,
  workflowId,
  type DemoFlag,
} from './definitions';
import { demoId } from './ids';
import { buildReplayChunks, type ReplayChunk, type ReplayPage, type ReplayPageKind } from './replay';
import { hexHash, Rng, unitHash } from './rng';
import {
  campaignOn,
  DAY_MS,
  dayKey,
  dayNumber,
  docsReleaseOn,
  HOUR_MS,
  hourFloor,
  incidentOn,
  regressionErrorActive,
  storeReleaseOn,
  trafficFactor,
} from './schedule';

/**
 * Deterministic generator of one website-hour of demo analytics. `generateHour` is pure: the
 * same site and hour always give the same rows with the same ids, so writing an hour twice
 * (INSERT OR IGNORE / idempotent upserts) never duplicates anything.
 */

export type Props = Record<string, string | number | boolean>;

export type DemoSite = {
  websiteId: string;
  profile: SiteProfile;
  /** Hostname events are recorded on. */
  hostname: string;
  flags: readonly DemoFlag[];
};

export type EventRow = {
  id: string;
  sessionId: string;
  visitId: string;
  createdAt: number;
  urlPath: string;
  urlQuery: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrerPath: string | null;
  referrerQuery: string | null;
  referrerDomain: string | null;
  pageTitle: string | null;
  gclid: string | null;
  fbclid: string | null;
  eventType: number;
  eventName: string | null;
  tag: string | null;
  hostname: string | null;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
  properties: Props | null;
};

export type SessionRow = {
  sessionId: string;
  browser: string;
  os: string;
  device: string;
  screen: string;
  language: string;
  country: string;
  region: string;
  city: string;
  distinctId: string | null;
  createdAt: number;
};

export type SessionDataRow = {
  id: string;
  sessionId: string;
  key: string;
  stringValue: string | null;
  numberValue: number | null;
  dataType: number;
  distinctId: string | null;
  createdAt: number;
};

export type RevenueRow = { id: string; sessionId: string; eventId: string; eventName: string; currency: string; revenue: number; createdAt: number };

export type PersonRow = { personId: string; distinctId: string; properties: Props; firstSeenAt: number; lastSeenAt: number };

export type MembershipRow = { id: string; personId: string; groupType: string; groupKey: string; createdAt: number };

export type ReplayVisit = { sessionId: string; visitId: string; chunks: ReplayChunk[] };

export type LogRow = {
  id: string;
  createdAt: number;
  timeUs: number;
  severity: 'debug' | 'info' | 'warn' | 'error';
  severityNumber: number;
  body: string;
  service: string;
  serviceVersion: string;
  traceId: string | null;
  spanId: string | null;
  sessionId: string | null;
  attributes: Record<string, string | number | boolean>;
  resource: Record<string, string>;
};

export type SpanRow = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: 'server' | 'client' | 'internal';
  service: string;
  serviceVersion: string;
  startMs: number;
  durationMs: number;
  statusCode: 'ok' | 'error' | 'unset';
  statusMessage: string | null;
  sessionId: string | null;
  attributes: Record<string, string | number | boolean>;
  resource: Record<string, string>;
  events: Array<{ name: string; timeUs: number; attributes: Record<string, string> }> | null;
};

export type SurveyResponseRow = {
  id: string;
  surveyId: string;
  sessionId: string;
  visitId: string;
  answer: string;
  urlPath: string;
  answers: Record<string, string | number | string[]>;
  completed: boolean;
  distinctId: string | null;
  createdAt: number;
};

export type WorkflowExecutionRow = {
  id: string;
  workflowId: string;
  sessionId: string;
  visitId: string;
  eventId: string;
  eventName: string;
  status: 'recorded' | 'success' | 'stopped';
  distinctId: string | null;
  currentStep: number | null;
  attempts: number;
  createdAt: number;
  completedAt: number;
};

export type WorkflowAttemptRow = {
  id: string;
  executionId: string;
  workflowId: string;
  stepIndex: number;
  stepType: string;
  status: 'success' | 'passed' | 'stopped';
  durationMs: number;
  createdAt: number;
};

export type HourData = {
  sessions: SessionRow[];
  events: EventRow[];
  sessionData: SessionDataRow[];
  revenue: RevenueRow[];
  persons: PersonRow[];
  memberships: MembershipRow[];
  replays: ReplayVisit[];
  logs: LogRow[];
  spans: SpanRow[];
  surveyResponses: SurveyResponseRow[];
  workflowExecutions: WorkflowExecutionRow[];
  workflowAttempts: WorkflowAttemptRow[];
};

export type GenerateOptions = {
  /** Drop everything that happens after this moment (the hour in progress). */
  until?: number;
  /** Build replay recordings (only for complete hours). */
  replays?: boolean;
  /** OpenTelemetry logs and spans (the store keeps them 30 days). */
  otel?: boolean;
};

// ---------------------------------------------------------------------------------------------
// Hour plan and people
// ---------------------------------------------------------------------------------------------

type HourPlan = { count: number; isNew: boolean[]; newCount: number };

const planCache = new Map<string, HourPlan>();

/** Session count and which sessions are first visits, from a stream of its own. */
export function hourPlan(site: DemoSite, hourStart: number): HourPlan {
  const cacheKey = `${site.websiteId}:${hourStart}`;
  const cached = planCache.get(cacheKey);
  if (cached) return cached;
  const rng = new Rng(`${site.websiteId}:${hourStart}:plan`);
  const expected = (site.profile.baseDailySessions / 24) * trafficFactor(hourStart, site.profile.weekday, site.profile.kind === 'store');
  const count = rng.poisson(expected);
  const isNew: boolean[] = [];
  let newCount = 0;
  for (let i = 0; i < count; i++) {
    const fresh = rng.chance(1 - site.profile.returningShare);
    isNew.push(fresh);
    if (fresh) newCount++;
  }
  const plan = { count, isNew, newCount };
  if (planCache.size > 20_000) planCache.clear();
  planCache.set(cacheKey, plan);
  return plan;
}

type Plan = 'free' | 'plus' | 'pro';

type Person = {
  key: string;
  joinedAt: number;
  geo: Geo;
  client: Client;
  signsUp: boolean;
  distinctId: string | null;
  name: string;
  email: string;
  plan: Plan;
  company: Company | null;
  role: string;
  enrolledAssistant: boolean;
};

function personFor(site: DemoSite, key: string): Person {
  const rng = new Rng(`${site.websiteId}:person:${key}`);
  const joinedAt = Number(key.split(':')[0]);
  const geo = rng.weighted(GEOS);
  const client = rng.weighted(site.profile.kind === 'store' ? CLIENTS : DOCS_CLIENTS);
  const signsUp = unitHash(`${site.websiteId}:signup:${key}`) < site.profile.signupRate;
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  const company = rng.chance(site.profile.kind === 'store' ? 0.4 : 0.75) ? rng.pick(COMPANIES) : null;
  const handle = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[^a-z.]/g, '');
  const email = `${handle}${rng.int(1, 99)}@${company ? company.domain : 'mail.example'}`;
  const planRoll = rng.next();
  const plan: Plan = site.profile.kind === 'docs' ? 'free' : planRoll < 0.58 ? 'free' : planRoll < 0.84 ? 'plus' : 'pro';
  return {
    key,
    joinedAt,
    geo,
    client,
    signsUp,
    distinctId: signsUp ? `usr_${hexHash(`${site.websiteId}:${key}`, 12)}` : null,
    name: `${first} ${last}`,
    email,
    plan,
    company,
    role: rng.pick(ROLES),
    enrolledAssistant: signsUp && rng.chance(0.3),
  };
}

function personProperties(site: DemoSite, person: Person): Props {
  const props: Props = {
    email: person.email,
    name: person.name,
    role: person.role,
    plan: site.profile.kind === 'docs' ? 'trial' : person.plan,
    country: person.geo.country,
  };
  if (person.company) props.company = person.company.name;
  if (site.profile.kind === 'store' && person.enrolledAssistant) props[featureEnrollmentProperty(ASSISTANT_FLAG)] = true;
  return props;
}

/** A person who first visited on an earlier day (recent days more likely). */
function returningPersonKey(site: DemoSite, hourStart: number, rng: Rng): string | null {
  for (let attempt = 0; attempt < 5; attempt++) {
    const days = rng.chance(0.42) ? rng.int(1, 3) : 1 + Math.floor(-Math.log(1 - rng.next()) * 16);
    if (days > 80) continue;
    const joinedHour = hourFloor(hourStart - days * DAY_MS + rng.int(-10, 10) * HOUR_MS);
    const plan = hourPlan(site, joinedHour);
    if (!plan.newCount) continue;
    return `${joinedHour}:${rng.int(0, plan.newCount - 1)}`;
  }
  return null;
}

function monthKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------------------------

type PageContext = { path: string; query: string | null; title: string; kind: ReplayPageKind; startAt: number };

type Landing = {
  source: Source;
  query: string | null;
  utm: Source['utm'] | null;
  referrer: { domain: string; path: string; query: string } | null;
  clickId: { gclid: string | null; fbclid: string | null };
};

class Visit {
  readonly events: EventRow[] = [];
  readonly pages: ReplayPage[] = [];
  readonly revenue: RevenueRow[] = [];
  readonly sessionData: SessionDataRow[] = [];
  readonly logs: LogRow[] = [];
  readonly spans: SpanRow[] = [];
  readonly surveyResponses: SurveyResponseRow[] = [];
  readonly workflowExecutions: WorkflowExecutionRow[] = [];
  readonly workflowAttempts: WorkflowAttemptRow[] = [];
  t: number;
  page: PageContext | null = null;
  distinctId: string | null = null;
  private seq = 0;
  private pageCount = 0;
  purchased = false;
  checkoutStarted = false;
  errors = 0;

  constructor(
    readonly site: DemoSite,
    readonly person: Person,
    readonly sessionId: string,
    readonly visitId: string,
    readonly landing: Landing,
    readonly rng: Rng,
    start: number,
  ) {
    this.t = start;
  }

  get origin() {
    return `https://${this.site.hostname}`;
  }

  get pageviews() {
    return this.pageCount;
  }

  nextId(kind: string) {
    return demoId(this.site.websiteId, kind, this.visitId, this.seq++);
  }

  private closePage() {
    const last = this.pages[this.pages.length - 1];
    if (last) last.endAt = Math.max(last.startAt + 1500, this.t);
  }

  row(eventType: number, eventName: string | null): EventRow {
    const page = this.page!;
    const landingPage = this.pageCount === 1;
    const utm = landingPage ? this.landing.utm : null;
    return {
      id: this.nextId('event'),
      sessionId: this.sessionId,
      visitId: this.visitId,
      createdAt: this.t,
      urlPath: page.path,
      urlQuery: page.query,
      utmSource: utm?.source ?? null,
      utmMedium: utm?.medium ?? null,
      utmCampaign: utm?.campaign ?? null,
      utmContent: utm?.content ?? null,
      utmTerm: utm?.term ?? null,
      referrerPath: this.landing.referrer?.path ?? null,
      referrerQuery: this.landing.referrer?.query ?? null,
      referrerDomain: this.landing.referrer?.domain ?? null,
      pageTitle: page.title,
      gclid: landingPage ? this.landing.clickId.gclid : null,
      fbclid: landingPage ? this.landing.clickId.fbclid : null,
      eventType,
      eventName,
      tag: null,
      hostname: this.site.hostname,
      lcp: null,
      inp: null,
      cls: null,
      fcp: null,
      ttfb: null,
      properties: null,
    };
  }

  /** Moves to a new page: a pageview, maybe a web vitals sample, time on page afterwards. */
  view(path: string, title: string, kind: ReplayPageKind, dwellMedianMs: number, query: string | null = null) {
    if (this.page) this.t += this.rng.int(300, 1500);
    this.closePage();
    this.pageCount++;
    this.page = { path, query: this.pageCount === 1 ? (this.landing.query ?? query) : query, title, kind, startAt: this.t };
    this.events.push(this.row(EVENT_TYPE.pageView, null));
    this.pages.push({ path: this.page.query ? `${path}?${this.page.query}` : path, title, kind, startAt: this.t, endAt: this.t + 2000, console: [], network: [] });
    if (this.rng.chance(0.45)) this.vitals(kind);
    this.t += Math.min(Math.round(this.rng.logNormal(dwellMedianMs, 0.55)), 6 * 60 * 1000);
  }

  /** A custom event on the current page, a moment after the previous one. */
  track(name: string, properties: Props | null, options: { tag?: string; gapMs?: number } = {}): EventRow {
    this.t += options.gapMs ?? this.rng.int(800, 6000);
    const row = this.row(EVENT_TYPE.customEvent, name);
    row.properties = properties;
    row.tag = options.tag ?? null;
    this.events.push(row);
    return row;
  }

  private vitals(kind: ReplayPageKind) {
    const mobile = this.person.client.device === 'mobile';
    const heavy = kind === 'product' || kind === 'collection' ? 1.25 : kind === 'docs' ? 0.8 : 1;
    const lcp = Math.min(60000, Math.round(this.rng.logNormal((mobile ? 2350 : 1450) * heavy, 0.38)));
    const row = this.row(EVENT_TYPE.performance, null);
    row.createdAt = this.t + this.rng.int(2500, 9000);
    row.urlQuery = null;
    row.referrerDomain = null;
    row.referrerPath = null;
    row.referrerQuery = null;
    row.hostname = null;
    row.utmSource = row.utmMedium = row.utmCampaign = row.utmContent = row.utmTerm = null;
    row.gclid = row.fbclid = null;
    row.lcp = lcp;
    row.fcp = Math.round(lcp * this.rng.range(0.45, 0.75));
    row.ttfb = Math.round(this.rng.logNormal(mobile ? 260 : 170, 0.5));
    row.inp = Math.round(this.rng.logNormal(mobile ? 185 : 105, 0.55));
    row.cls = Math.round(Math.min(1.5, this.rng.logNormal(kind === 'product' ? 0.085 : 0.035, 0.8)) * 10000) / 10000;
    this.events.push(row);
  }

  flagExposure(flag: DemoFlag | undefined, personProps: Props | null): string {
    if (!flag) return 'control';
    const context: FeatureFlagEvaluationContext = {
      distinctId: this.distinctId ?? undefined,
      sessionId: this.sessionId,
      visitId: this.visitId,
      path: this.page?.path,
      hostname: this.site.hostname,
      language: this.person.geo.language,
      personProperties: personProps ?? undefined,
    };
    const result = evaluateFeatureFlag(flag, context);
    const variant = String(result.variant);
    this.track(
      '$feature_flag_called',
      { $feature_flag: flag.key, $feature_flag_response: variant, [`$feature/${flag.key}`]: variant },
      { tag: 'feature_flag', gapMs: this.rng.int(50, 400) },
    );
    return variant;
  }

  error(error: DemoError, release: string, custom?: string) {
    const origin = this.origin;
    const fill = (value: string) => value.replaceAll('{origin}', origin);
    const message = fill(error.message);
    const stack = fill(error.stack);
    const { fingerprint } = computeErrorFingerprint({ type: error.name, message, stack, custom });
    this.t += this.rng.int(200, 4000);
    const row = this.row(EVENT_TYPE.error, message);
    row.properties = {
      message,
      name: error.name,
      stack,
      source: fill(error.file),
      lineno: error.line,
      colno: error.column,
      severity: error.severity,
      handled: error.handled,
      release,
      environment: 'production',
      [ERROR_FINGERPRINT_PROPERTY]: fingerprint,
    };
    this.events.push(row);
    this.errors++;
    this.console('error', `${error.handled ? '' : 'Uncaught '}${error.name}: ${message}`);
    return row;
  }

  console(level: 'log' | 'info' | 'warn' | 'error' | 'debug', message: string) {
    this.pages[this.pages.length - 1]?.console?.push({ level, message, at: this.t });
  }

  network(method: string, path: string, status: number, durationMs: number, size: number | null) {
    this.pages[this.pages.length - 1]?.network?.push({ method, url: `${this.origin}${path}`, status, duration: durationMs, size, at: this.t - durationMs });
  }

  identify(props: Props, company: Company | null) {
    const distinctId = this.person.distinctId!;
    this.distinctId = distinctId;
    const at = this.t;
    const data: Array<[string, string | number]> = Object.entries(props)
      .filter(([, value]) => typeof value !== 'boolean')
      .map(([key, value]) => [key, value as string | number]);
    if (company) {
      data.push([`$group/company`, company.key], [`$group/company/name`, company.name], [`$group/company/industry`, company.industry], [`$group/company/employees`, company.employees]);
    }
    for (const [key, value] of data) {
      this.sessionData.push({
        id: demoId(this.site.websiteId, 'session-data', this.visitId, key),
        sessionId: this.sessionId,
        key,
        stringValue: typeof value === 'string' ? value : null,
        numberValue: typeof value === 'number' ? value : null,
        dataType: typeof value === 'number' ? 2 : 1,
        distinctId,
        createdAt: at,
      });
    }
  }

  finish() {
    this.closePage();
  }
}

function buildLanding(site: DemoSite, person: Person, returning: boolean, hourStart: number, rng: Rng): Landing {
  const sources = site.profile.kind === 'store' ? STORE_SOURCES : DOCS_SOURCES;
  let source: Source = returning && rng.chance(0.35) ? sources.find((item) => item.key === 'direct')! : rng.weighted(sources);
  let utm = source.utm ?? null;
  const running = site.profile.kind === 'store' ? campaignOn(dayNumber(hourStart)) : null;
  if (running && rng.chance(0.25 + (running.boost - 1) * 0.5)) {
    const { campaign } = running;
    const referrer =
      campaign.medium === 'email'
        ? null
        : campaign.source === 'instagram'
          ? 'https://l.instagram.com/'
          : campaign.source === 'tiktok'
            ? 'https://www.tiktok.com/'
            : 'https://www.pinterest.com/';
    source = { key: `campaign:${campaign.slug}`, referrer, utm: { source: campaign.source, medium: campaign.medium, campaign: campaign.slug } };
    utm = source.utm!;
  }
  const params = new URLSearchParams();
  if (utm) {
    params.set('utm_source', utm.source);
    params.set('utm_medium', utm.medium);
    if (utm.campaign) params.set('utm_campaign', utm.campaign);
    if (utm.content) params.set('utm_content', utm.content);
    if (utm.term) params.set('utm_term', utm.term);
  }
  const gclid = source.clickId === 'gclid' ? `Cj0KCQjw${hexHash(`${person.key}:${hourStart}:g`, 18)}` : null;
  const fbclid = source.clickId === 'fbclid' ? `IwAR${hexHash(`${person.key}:${hourStart}:f`, 20)}` : null;
  if (gclid) params.set('gclid', gclid);
  if (fbclid) params.set('fbclid', fbclid);
  let referrer: Landing['referrer'] = null;
  if (source.referrer) {
    const url = new URL(source.referrer);
    referrer = { domain: url.hostname.replace(/^www\./, ''), path: url.pathname, query: url.search.slice(1) };
  }
  return { source, query: params.size ? params.toString() : null, utm, referrer, clickId: { gclid, fbclid } };
}

// ---------------------------------------------------------------------------------------------
// Store visits
// ---------------------------------------------------------------------------------------------

function productPath(product: Product) {
  return `/products/${product.slug}`;
}

function collectionTitle(slug: string) {
  return slug === 'new' ? 'New arrivals' : `${slug[0]!.toUpperCase()}${slug.slice(1)}`;
}

type StoreOutcome = { visit: Visit; variant: string | null; assistant: boolean };

function storeVisit(site: DemoSite, visit: Visit, isNew: boolean, hourStart: number): StoreOutcome {
  const { rng, person } = visit;
  const day = dayNumber(hourStart);
  const release = `storefront@${storeReleaseOn(day)}`;
  const incident = incidentOn(day);
  const identifiedBefore = !isNew && person.signsUp;
  if (identifiedBefore) visit.distinctId = person.distinctId;
  const props = () => (visit.distinctId ? personProperties(site, person) : null);
  const flag = (key: string) => site.flags.find((item) => item.key === key);
  const currency = person.geo.currency;

  // Landing page depends on where the visit came from.
  const sourceKey = visit.landing.source.key;
  const landingRoll = rng.next();
  let next: 'home' | 'collection' | 'product' | 'blog' | 'pricing' | 'cart' = 'home';
  if (sourceKey.startsWith('campaign:') || sourceKey === 'newsletter') next = landingRoll < 0.7 ? 'collection' : 'product';
  else if (['instagram', 'tiktok', 'pinterest', 'meta-ads', 'facebook'].includes(sourceKey)) next = landingRoll < 0.65 ? 'product' : 'collection';
  else if (sourceKey === 'google' || sourceKey === 'bing' || sourceKey === 'duckduckgo')
    next = landingRoll < 0.35 ? 'home' : landingRoll < 0.65 ? 'product' : landingRoll < 0.82 ? 'collection' : 'blog';
  else if (sourceKey === 'blog-referral' || sourceKey === 'reddit') next = landingRoll < 0.6 ? 'blog' : 'product';
  else if (!isNew && landingRoll < 0.08) next = 'cart';

  let product: Product = rng.pick(PRODUCTS);
  let cartValue = 0;
  let cartItems = 0;
  let collection: string = rng.pick(COLLECTIONS);
  const bounce = isNew ? 0.4 : 0.28;
  let steps = 0;
  let viewedProducts = 0;
  let assistantOn: boolean | null = null;
  let assistantUsed = false;
  let variant: string | null = null;
  let signedUp = false;

  const shipping = rng.chance(0.2);
  const maxSteps = 3 + Math.floor(rng.logNormal(3, 0.6));

  while (steps < maxSteps) {
    steps++;
    switch (next) {
      case 'home': {
        visit.view('/', 'Northwind Supply — everyday essentials', 'home', 14000);
        visit.network('GET', '/api/products/featured', 200, rng.int(60, 220), rng.int(8000, 22000));
        if (steps === 1) visit.console('log', `[storefront] hydrated in ${rng.int(180, 900)}ms`);
        break;
      }
      case 'collection': {
        visit.view(`/collections/${collection}`, `${collectionTitle(collection)} — Northwind Supply`, 'collection', 16000);
        visit.network('GET', `/api/collections/${collection}`, 200, rng.int(70, 260), rng.int(12000, 40000));
        break;
      }
      case 'product': {
        visit.view(productPath(product), `${product.name} — Northwind Supply`, 'product', 26000);
        visit.pages[visit.pages.length - 1]!.heading = product.name;
        visit.pages[visit.pages.length - 1]!.price = `$${product.price}.00`;
        visit.network('GET', `/api/products/${product.id}`, 200, rng.int(40, 180), rng.int(3000, 9000));
        visit.track('product_viewed', { product_id: product.id, product_name: product.name, category: product.category, price: product.price, currency });
        viewedProducts++;
        if (viewedProducts === 1 && rng.chance(0.4)) visit.flagExposure(flag(RECOMMENDATIONS_FLAG), props());
        if ((product.category === 'apparel' || product.category === 'footwear') && rng.chance(0.3)) {
          const sizeGuide = visit.flagExposure(flag(SIZE_GUIDE_FLAG), props());
          if (sizeGuide !== 'control' && rng.chance(0.3)) visit.track('size_guide_opened', { product_id: product.id, version: 'v2' });
        }
        // The assistant widget loads lazily (when the visitor scrolls to it), so not every product view evaluates the flag.
        if (assistantOn === null && rng.chance(0.35)) {
          assistantOn = visit.flagExposure(flag(ASSISTANT_FLAG), props()) !== 'control';
        }
        if (assistantOn && !assistantUsed && rng.chance(0.7)) {
          assistantUsed = true;
          assistantTrace(site, visit, product);
        }
        if (rng.chance(0.012 * (person.client.browser.includes('Safari') ? 2.2 : 1))) visit.error(STORE_ERRORS.variantUndefined!, release);
        break;
      }
      case 'blog': {
        const post = rng.pick(STORE_BLOG_POSTS);
        visit.view(`/blog/${post.slug}`, `${post.title} — Northwind Journal`, 'blog', 70000);
        visit.pages[visit.pages.length - 1]!.heading = post.title;
        break;
      }
      case 'pricing': {
        visit.view('/pricing', 'Membership — Northwind Supply', 'pricing', 22000);
        if (visit.distinctId && person.plan !== 'free' && rng.chance(0.3)) visit.track('plan_viewed', { plan: person.plan });
        break;
      }
      case 'cart': {
        visit.view('/cart', 'Your cart — Northwind Supply', 'cart', 15000);
        visit.pages[visit.pages.length - 1]!.heading = product.name;
        visit.pages[visit.pages.length - 1]!.price = `$${(cartValue || product.price).toFixed(2)}`;
        if (rng.chance(0.006)) {
          visit.network('GET', '/api/cart', 0, rng.int(3000, 9000), null);
          visit.error(STORE_ERRORS.cartFetch!, release);
        } else {
          visit.network('GET', '/api/cart', 200, rng.int(40, 160), rng.int(1500, 4000));
        }
        break;
      }
    }

    if (person.client.device === 'mobile' && rng.chance(0.004)) visit.error(STORE_ERRORS.chunkLoad!, release);
    const week = Math.floor(day / 7);
    if (next === 'collection' && rng.chance(0.004)) visit.error(weeklyError(week), release, `weekly-issue-${week}`);

    // Shipping banner renders on the first page; the announcement nudges add-to-cart a little.
    if (steps === 1 && shipping) visit.flagExposure(flag(SHIPPING_FLAG), props());

    // First visit sign-ups happen early in the visit.
    if (isNew && person.signsUp && !signedUp && (steps === 1 || rng.chance(0.5))) {
      signedUp = true;
      visit.view('/account/signup', 'Create your account — Northwind Supply', 'account', 30000);
      const signup = visit.track('signed_up', { method: rng.weighted([{ v: 'email', weight: 6 }, { v: 'google', weight: 3 }, { v: 'apple', weight: 2 }]).v, plan: person.plan });
      visit.identify(personProperties(site, person), person.company);
      workflowForSignup(site, visit, signup);
      if (person.plan !== 'free') {
        visit.view('/pricing', 'Membership — Northwind Supply', 'pricing', 20000);
        const price = person.plan === 'plus' ? 9 : 19;
        const event = visit.track('subscription_started', { plan: person.plan, price, currency: 'USD', interval: 'month' });
        visit.revenue.push({ id: demoId(site.websiteId, 'revenue', event.id), sessionId: visit.sessionId, eventId: event.id, eventName: 'subscription_started', currency: 'USD', revenue: price, createdAt: event.createdAt });
      }
    }

    if (steps === 1 && visit.pageviews === 1 && !signedUp && rng.chance(bounce)) break;

    // Next page.
    const roll = rng.next();
    if (next === 'product') {
      const addRate = (shipping ? 0.36 : 0.32) * (visit.distinctId ? 1.2 : 1);
      if (rng.chance(addRate)) {
        const quantity = rng.chance(0.85) ? 1 : 2;
        cartItems += quantity;
        cartValue += product.price * quantity;
        visit.network('POST', '/api/cart/items', 201, rng.int(60, 240), rng.int(400, 1200));
        visit.track('add_to_cart', { product_id: product.id, product_name: product.name, price: product.price, quantity, currency });
        next = 'cart';
        continue;
      }
      if (roll < 0.35) product = rng.pick(PRODUCTS);
      else if (roll < 0.55) {
        collection = product.category === 'footwear' || product.category === 'apparel' ? 'apparel' : product.category;
        next = 'collection';
      } else break;
    } else if (next === 'cart') {
      if (cartItems === 0) {
        next = 'home';
        continue;
      }
      // The checkout flag is evaluated on the cart page (the experiment's exposure).
      variant = visit.flagExposure(flag(CHECKOUT_FLAG), props());
      if (rng.chance(CHECKOUT_START[variant] ?? CHECKOUT_START.control!)) {
        visit.view('/checkout', 'Checkout — Northwind Supply', 'checkout', 45000);
        visit.pages[visit.pages.length - 1]!.price = `$${cartValue.toFixed(2)}`;
        visit.checkoutStarted = true;
        visit.track('checkout_started', { cart_value: cartValue, items: cartItems, currency, checkout_version: variant === 'test' ? 'one-page' : 'classic' });
        if (currency !== 'USD' && rng.chance(0.03)) visit.error(STORE_ERRORS.currency!, release);
        const incidentNow = incident !== null && visit.t >= incident.startAt && visit.t <= incident.endAt;
        const timeout = regressionErrorActive(visit.t) && rng.chance(incidentNow ? 0.3 : 0.035);
        let conversion = CHECKOUT_CONVERSION[variant] ?? CHECKOUT_CONVERSION.control!;
        if (incidentNow) conversion *= 0.45;
        if (timeout) conversion = 0;
        const purchased = rng.chance(conversion);
        const declined = !purchased && !timeout && rng.chance(0.25);
        if (timeout) {
          visit.network('POST', '/api/checkout', 504, rng.int(15000, 15400), null);
          visit.error(STORE_ERRORS.paymentTimeout!, release);
        } else {
          visit.network('POST', '/api/checkout', purchased ? 200 : declined ? 402 : 200, rng.int(300, 1400), rng.int(600, 1800));
        }
        checkoutBackend(site, visit, { cartValue, cartItems, purchased, declined, timeout, incidentNow, release });
        if (purchased) {
          const orderId = `NW-${hexHash(visit.visitId, 8).toUpperCase()}`;
          visit.view('/checkout/success', 'Thank you — Northwind Supply', 'checkout', 20000);
          const tax = Math.round(cartValue * 0.08 * 100) / 100;
          const revenue = Math.round((cartValue + tax) * 100) / 100;
          const purchase = visit.track('purchase', { order_id: orderId, revenue, currency, items: cartItems, coupon: visit.landing.utm?.campaign ?? '', checkout_version: variant === 'test' ? 'one-page' : 'classic' });
          visit.revenue.push({ id: demoId(site.websiteId, 'revenue', purchase.id), sessionId: visit.sessionId, eventId: purchase.id, eventName: 'purchase', currency, revenue, createdAt: purchase.createdAt });
          visit.purchased = true;
          workflowForPurchase(site, visit, purchase, revenue);
          if (rng.chance(0.3)) hesitationSurvey(site, visit);
        }
      }
      break;
    } else if (next === 'home') {
      next = roll < 0.5 ? 'collection' : roll < 0.8 ? 'product' : roll < 0.9 ? 'pricing' : 'blog';
      if (next === 'product') product = rng.pick(PRODUCTS);
    } else if (next === 'collection') {
      if (roll < 0.72) {
        product = rng.pick(PRODUCTS.filter((item) => collection === 'new' || collection === 'sale' || item.category === collection).concat(PRODUCTS.slice(0, 1)));
        next = 'product';
      } else if (roll < 0.82) collection = rng.pick(COLLECTIONS);
      else break;
    } else if (next === 'blog') {
      if (roll < 0.35) {
        product = rng.pick(PRODUCTS);
        next = 'product';
      } else if (roll < 0.5) next = 'collection';
      else break;
    } else if (next === 'pricing') {
      if (roll < 0.4) next = 'collection';
      else break;
    }
  }

  if (visit.distinctId && !isNew && rng.chance(0.06)) npsSurvey(site, visit);
  visit.finish();
  return { visit, variant, assistant: assistantUsed };
}

// ---------------------------------------------------------------------------------------------
// Docs visits
// ---------------------------------------------------------------------------------------------

function docsVisit(site: DemoSite, visit: Visit, isNew: boolean, hourStart: number) {
  const { rng, person } = visit;
  const release = `docs@${docsReleaseOn(dayNumber(hourStart))}`;
  if (!isNew && person.signsUp) visit.distinctId = person.distinctId;
  const pick = () => rng.weighted(DOCS_PAGES);
  const sourceKey = visit.landing.source.key;
  let page = sourceKey === 'github' ? DOCS_PAGES[2]! : sourceKey === 'changelog-email' ? DOCS_PAGES.find((item) => item.path === '/changelog')! : pick();
  const pages = rng.chance(isNew ? 0.42 : 0.3) ? 1 : Math.min(9, 2 + Math.floor(rng.logNormal(1.6, 0.7)));
  let searched = false;
  for (let i = 0; i < pages; i++) {
    const kind: ReplayPageKind = page.path.startsWith('/docs') || page.path === '/' ? 'docs' : 'blog';
    visit.view(page.path, `${page.title} — Acme Docs`, kind, page.section === 'api' ? 95000 : 60000);
    visit.pages[visit.pages.length - 1]!.heading = page.title;
    if (i === 0) visit.console('info', `[docs] search index v${docsReleaseOn(dayNumber(hourStart))} ready`);
    if (!searched && rng.chance(0.16)) {
      searched = true;
      const query = rng.pick(DOCS_SEARCH_QUERIES);
      const answers = visit.flagExposure(site.flags.find((flag) => flag.key === DOCS_SEARCH_FLAG), null);
      if (rng.chance(0.008)) {
        visit.network('GET', '/search-index.json', 200, rng.int(80, 300), 612);
        visit.error(DOCS_ERRORS.searchIndex!, release);
      } else {
        visit.network('GET', '/search-index.json', 200, rng.int(60, 240), rng.int(180000, 260000));
      }
      visit.track('docs_search', { query, results: rng.int(0, 24), ai_answer: answers !== 'control' });
    }
    if (['guides', 'sdk', 'tracking', 'api'].includes(page.section) && rng.chance(0.38)) {
      const language = page.section === 'sdk' ? (page.path.endsWith('react') ? 'tsx' : 'javascript') : page.section === 'api' ? 'bash' : rng.pick(['html', 'javascript', 'bash']);
      if (rng.chance(0.01)) visit.error(DOCS_ERRORS.clipboard!, release);
      else visit.track('code_copied', { language, page: page.path });
    }
    if (rng.chance(0.05)) visit.track('feedback_submitted', { helpful: rng.chance(0.78), page: page.path });
    if (rng.chance(0.03)) helpfulSurvey(site, visit);
    if (rng.chance(0.06)) visit.track('outbound_click', { href: 'https://github.com/acme/analytics', page: page.path });
    page = rng.chance(0.4) ? DOCS_PAGES[Math.min(DOCS_PAGES.length - 1, DOCS_PAGES.indexOf(page) + 1)]! : pick();
  }
  if (isNew && person.signsUp) {
    visit.track('signup_started', { source: 'docs', page: visit.page?.path ?? '/' });
    visit.track('trial_started', { plan: 'trial' });
    visit.identify(personProperties(site, person), person.company);
  }
  visit.finish();
}

// ---------------------------------------------------------------------------------------------
// AI, backend telemetry, surveys and workflows attached to a visit
// ---------------------------------------------------------------------------------------------

function aiRow(visit: Visit, name: string, props: Props, at: number): EventRow {
  const row = visit.row(EVENT_TYPE.ai, name);
  row.createdAt = at;
  row.properties = { environment: 'production', release: 'assistant@1.8.2', ...props };
  return row;
}

function assistantTrace(site: DemoSite, visit: Visit, product: Product) {
  const { rng } = visit;
  const [question, answer] = rng.pick(ASSISTANT_QUESTIONS);
  const fill = (text: string) => text.replaceAll('{product}', product.name).replaceAll('{city}', visit.person.geo.city);
  const traceId = demoId(site.websiteId, 'ai-trace', visit.visitId);
  const start = visit.t + rng.int(2000, 8000);
  const rows: EventRow[] = [];
  let t = start;

  const retrieveId = demoId(traceId, 'retrieve');
  const embedLatency = rng.int(40, 140);
  const embedTokens = rng.int(9, 40);
  rows.push(
    aiRow(visit, '$ai_embedding', {
      aiKind: 'embedding',
      traceId,
      spanId: demoId(traceId, 'embed'),
      parentSpanId: retrieveId,
      spanName: 'embed_query',
      provider: 'openai',
      model: 'text-embedding-3-small',
      inputTokens: embedTokens,
      outputTokens: 0,
      totalTokens: embedTokens,
      latencyMs: embedLatency,
      status: 'success',
      httpStatus: 200,
    }, t + embedLatency),
  );
  const retrieveLatency = embedLatency + rng.int(30, 160);
  rows.push(aiRow(visit, '$ai_span', { aiKind: 'span', traceId, spanId: retrieveId, parentSpanId: traceId, spanName: 'retrieve_products', latencyMs: retrieveLatency, status: 'success' }, t + retrieveLatency));
  t += retrieveLatency;

  const rerankIn = rng.int(420, 900);
  const rerankLatency = rng.int(90, 260);
  rows.push(
    aiRow(visit, '$ai_generation', {
      aiKind: 'generation',
      traceId,
      spanId: demoId(traceId, 'rerank'),
      parentSpanId: traceId,
      spanName: 'rerank',
      provider: 'northwind',
      model: CUSTOM_MODEL,
      inputTokens: rerankIn,
      outputTokens: rng.int(12, 40),
      totalTokens: rerankIn + 30,
      latencyMs: rerankLatency,
      status: 'success',
      httpStatus: 200,
    }, t + rerankLatency),
  );
  t += rerankLatency;

  const model = rng.weighted([
    { model: 'claude-haiku-4-5', provider: 'anthropic', weight: 58 },
    { model: 'claude-sonnet-4-5', provider: 'anthropic', weight: 24 },
    { model: 'gpt-4o-mini', provider: 'openai', weight: 12 },
    { model: 'gpt-5-mini', provider: 'openai', weight: 6 },
  ]);
  const input = JSON.stringify([
    { role: 'system', content: 'You are Northwind Supply\'s shopping assistant. Answer briefly using the product context.' },
    { role: 'user', content: fill(question) },
  ]);
  const output = JSON.stringify([{ role: 'assistant', content: fill(answer) }]);
  // One answer, sometimes a second call with a tool result; a failed call is retried once.
  const calls: Array<{ name: string; error: boolean }> = [];
  const firstFails = rng.chance(0.04);
  if (firstFails) calls.push({ name: 'answer', error: true });
  calls.push({ name: 'answer', error: false });
  if (rng.chance(0.2)) calls.push({ name: 'answer_with_tool_result', error: false });
  calls.forEach((call, index) => {
    const inputTokens = Math.round(rng.logNormal(1500, 0.35)) + (call.name === 'answer' ? 0 : 320);
    const outputTokens = call.error ? 0 : Math.round(rng.logNormal(model.model.includes('sonnet') ? 260 : 180, 0.4));
    const latency = call.error ? rng.int(300, 1200) : Math.round(rng.logNormal(model.model.includes('sonnet') ? 2600 : 1200, 0.35));
    const cacheRead = model.provider === 'anthropic' && rng.chance(0.6) ? Math.round(inputTokens * 0.7) : 0;
    const httpStatus = call.error ? rng.pick([429, 529]) : 200;
    const props: Props = {
      aiKind: 'generation',
      traceId,
      spanId: demoId(traceId, 'answer', index),
      parentSpanId: traceId,
      spanName: call.name,
      provider: model.provider,
      model: model.model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs: latency,
      status: call.error ? 'error' : 'success',
      httpStatus,
      aiInput: input,
      aiModelParams: JSON.stringify({ temperature: 0.3, max_tokens: 600 }),
    };
    if (cacheRead) props.cacheReadTokens = cacheRead;
    if (call.error) {
      props.aiError = httpStatus === 429 ? 'rate_limit_error: Number of request tokens has exceeded your per-minute rate limit' : 'overloaded_error: Overloaded';
    } else {
      props.aiOutput = output;
    }
    rows.push(aiRow(visit, '$ai_generation', props, t + latency));
    t += latency + (call.error ? rng.int(400, 1200) : rng.int(20, 120));
  });

  rows.push(
    aiRow(visit, '$ai_trace', {
      aiKind: 'trace',
      traceId,
      spanId: traceId,
      spanName: 'shopping-assistant',
      latencyMs: t - start,
      status: 'success',
      aiInput: JSON.stringify([{ role: 'user', content: fill(question) }]),
      aiOutput: output,
    }, t),
  );
  visit.events.push(...rows);
  visit.network('POST', '/api/assistant', 200, t - start, rng.int(900, 2400));
  visit.t = Math.max(visit.t, t + rng.int(2000, 12000));
  visit.track('assistant_message_sent', { product_id: product.id, trace_id: traceId });
}

const CHECKOUT_RESOURCE = { 'deployment.region': 'us-east-1', 'host.name': 'checkout-7d9f4', 'telemetry.sdk.language': 'nodejs' };

function checkoutBackend(
  site: DemoSite,
  visit: Visit,
  outcome: { cartValue: number; cartItems: number; purchased: boolean; declined: boolean; timeout: boolean; incidentNow: boolean; release: string },
) {
  const { rng } = visit;
  const traceId = hexHash(`${visit.visitId}:checkout`, 32);
  const span = (name: string) => hexHash(`${traceId}:${name}`, 16);
  const version = `checkout-service@2.${14 + (dayNumber(visit.t) % 5)}.${dayNumber(visit.t) % 3}`;
  const start = visit.t - rng.int(400, 1500);
  const rootId = span('root');
  const paymentMs = outcome.timeout ? 15000 + rng.int(0, 300) : outcome.incidentNow ? rng.int(1800, 5200) : rng.int(140, 620);
  const total = paymentMs + rng.int(60, 240);
  const attributes = (extra: Record<string, string | number | boolean>) => ({ 'session.id': visit.sessionId, ...extra });
  const status = outcome.timeout ? 'error' : outcome.declined ? 'error' : 'ok';
  visit.spans.push(
    {
      traceId,
      spanId: rootId,
      parentSpanId: null,
      name: 'POST /api/checkout',
      kind: 'server',
      service: 'checkout-service',
      serviceVersion: version,
      startMs: start,
      durationMs: total,
      statusCode: status,
      statusMessage: outcome.timeout ? 'upstream timeout' : outcome.declined ? 'card_declined' : null,
      sessionId: visit.sessionId,
      attributes: attributes({ 'http.request.method': 'POST', 'http.route': '/api/checkout', 'http.response.status_code': outcome.timeout ? 504 : outcome.declined ? 402 : 200, 'cart.items': outcome.cartItems }),
      resource: CHECKOUT_RESOURCE,
      events: null,
    },
    {
      traceId,
      spanId: span('db-cart'),
      parentSpanId: rootId,
      name: 'SELECT carts',
      kind: 'client',
      service: 'checkout-service',
      serviceVersion: version,
      startMs: start + 4,
      durationMs: rng.int(3, 18),
      statusCode: 'ok',
      statusMessage: null,
      sessionId: visit.sessionId,
      attributes: attributes({ 'db.system': 'postgresql', 'db.operation': 'SELECT', 'db.sql.table': 'carts' }),
      resource: CHECKOUT_RESOURCE,
      events: null,
    },
    {
      traceId,
      spanId: span('reserve'),
      parentSpanId: rootId,
      name: 'inventory.reserve',
      kind: 'client',
      service: 'checkout-service',
      serviceVersion: version,
      startMs: start + 25,
      durationMs: rng.int(20, 70),
      statusCode: 'ok',
      statusMessage: null,
      sessionId: visit.sessionId,
      attributes: attributes({ 'rpc.service': 'inventory', 'rpc.method': 'reserve' }),
      resource: CHECKOUT_RESOURCE,
      events: null,
    },
    {
      traceId,
      spanId: span('reserve-server'),
      parentSpanId: span('reserve'),
      name: 'POST /reserve',
      kind: 'server',
      service: 'inventory-service',
      serviceVersion: 'inventory-service@1.9.4',
      startMs: start + 29,
      durationMs: rng.int(10, 40),
      statusCode: 'ok',
      statusMessage: null,
      sessionId: visit.sessionId,
      attributes: attributes({ 'http.request.method': 'POST', 'http.route': '/reserve', 'http.response.status_code': 200 }),
      resource: { 'deployment.region': 'us-east-1', 'host.name': 'inventory-2c81a', 'telemetry.sdk.language': 'go' },
      events: null,
    },
    {
      traceId,
      spanId: span('charge'),
      parentSpanId: rootId,
      name: 'payments.charge',
      kind: 'client',
      service: 'checkout-service',
      serviceVersion: version,
      startMs: start + 110,
      durationMs: paymentMs,
      statusCode: status,
      statusMessage: outcome.timeout ? 'deadline exceeded' : outcome.declined ? 'card_declined' : null,
      sessionId: visit.sessionId,
      attributes: attributes({ 'payment.provider': 'acmepay', 'payment.amount': Math.round(outcome.cartValue * 100) / 100 }),
      resource: CHECKOUT_RESOURCE,
      events: outcome.timeout
        ? [{ name: 'exception', timeUs: (start + 110 + paymentMs) * 1000, attributes: { 'exception.type': 'PaymentTimeoutError', 'exception.message': CHECKOUT_LOGS.timeout } }]
        : null,
    },
  );
  if (outcome.purchased) {
    visit.spans.push({
      traceId,
      spanId: span('db-order'),
      parentSpanId: rootId,
      name: 'INSERT orders',
      kind: 'client',
      service: 'checkout-service',
      serviceVersion: version,
      startMs: start + 120 + paymentMs,
      durationMs: rng.int(4, 25),
      statusCode: 'ok',
      statusMessage: null,
      sessionId: visit.sessionId,
      attributes: attributes({ 'db.system': 'postgresql', 'db.operation': 'INSERT', 'db.sql.table': 'orders' }),
      resource: CHECKOUT_RESOURCE,
      events: null,
    });
  }
  const log = (at: number, severity: LogRow['severity'], body: string, spanId: string, extra: Record<string, string | number | boolean> = {}, service = 'checkout-service', serviceVersion = version) => {
    visit.logs.push({
      id: hexHash(`${traceId}:${body}:${at}`, 32),
      createdAt: at,
      timeUs: at * 1000 + rng.int(0, 999),
      severity,
      severityNumber: severity === 'error' ? 17 : severity === 'warn' ? 13 : severity === 'debug' ? 5 : 9,
      body,
      service,
      serviceVersion,
      traceId,
      spanId,
      sessionId: visit.sessionId,
      attributes: { 'session.id': visit.sessionId, ...extra },
      resource: service === 'checkout-service' ? CHECKOUT_RESOURCE : { 'deployment.region': 'us-east-1', 'host.name': 'inventory-2c81a' },
    });
  };
  log(start + 2, 'info', CHECKOUT_LOGS.started, rootId, { 'cart.items': outcome.cartItems, 'cart.value': Math.round(outcome.cartValue * 100) / 100 });
  log(start + 40, 'info', CHECKOUT_LOGS.reserved, span('reserve-server'), { 'order.items': outcome.cartItems }, 'inventory-service', 'inventory-service@1.9.4');
  if (rng.chance(0.08)) log(start + 45, 'warn', CHECKOUT_LOGS.lowStock, span('reserve-server'), { sku: `NW-10${rng.int(10, 16)}`, remaining: rng.int(1, 4) }, 'inventory-service', 'inventory-service@1.9.4');
  if (outcome.incidentNow) log(start + 400, 'warn', CHECKOUT_LOGS.retry, span('charge'), { 'payment.provider': 'acmepay' });
  if (outcome.timeout) log(start + 110 + paymentMs, 'error', CHECKOUT_LOGS.timeout, span('charge'), { 'payment.provider': 'acmepay', 'error.type': 'PaymentTimeoutError' });
  else if (outcome.declined) log(start + 110 + paymentMs, 'warn', CHECKOUT_LOGS.declined, span('charge'), { 'payment.provider': 'acmepay', 'decline.code': 'card_declined' });
  else if (outcome.incidentNow && !outcome.purchased) log(start + 110 + paymentMs, 'error', 'payment provider unavailable after 3 attempts', span('charge'), { 'payment.provider': 'acmepay' });
  if (outcome.purchased) {
    log(start + 112 + paymentMs, 'info', CHECKOUT_LOGS.authorized, span('charge'), { 'payment.provider': 'acmepay' });
    log(start + 130 + paymentMs, 'info', CHECKOUT_LOGS.created, span('db-order'), { 'order.value': Math.round(outcome.cartValue * 100) / 100 });
  }
  void site;
}

function backgroundTelemetry(site: DemoSite, hourStart: number, rng: Rng, logs: LogRow[], spans: SpanRow[]) {
  if (site.profile.kind !== 'store') return;
  const runs = rng.int(1, 3);
  for (let i = 0; i < runs; i++) {
    const at = hourStart + rng.int(0, HOUR_MS - 60_000);
    const traceId = hexHash(`${site.websiteId}:${hourStart}:bg:${i}`, 32);
    const spanId = hexHash(`${traceId}:root`, 16);
    const duration = Math.round(rng.logNormal(820, 0.3));
    const resource = { 'deployment.region': 'us-east-1', 'host.name': 'recs-worker-1', 'telemetry.sdk.language': 'python' };
    spans.push({
      traceId,
      spanId,
      parentSpanId: null,
      name: 'rebuild-similarity-index',
      kind: 'internal',
      service: 'recommendations-worker',
      serviceVersion: 'recommendations-worker@0.12.1',
      startMs: at,
      durationMs: duration,
      statusCode: 'ok',
      statusMessage: null,
      sessionId: null,
      attributes: { 'job.name': 'similarity-index', 'products.count': 16 },
      resource,
      events: null,
    });
    logs.push({
      id: hexHash(`${traceId}:log`, 32),
      createdAt: at + duration,
      timeUs: (at + duration) * 1000,
      severity: rng.chance(0.07) ? 'warn' : 'info',
      severityNumber: 9,
      body: `rebuilt product similarity index in ${duration}ms`,
      service: 'recommendations-worker',
      serviceVersion: 'recommendations-worker@0.12.1',
      traceId,
      spanId,
      sessionId: null,
      attributes: { 'job.name': 'similarity-index', duration_ms: duration },
      resource,
    });
    const last = logs[logs.length - 1]!;
    if (last.severity === 'warn') {
      last.severityNumber = 13;
      last.body = `similarity index rebuild slow: ${duration}ms (budget 750ms)`;
    }
  }
}

function hesitationSurvey(site: DemoSite, visit: Visit) {
  const { rng } = visit;
  const picks = new Set<string>();
  if (rng.chance(0.42)) picks.add(HESITATION_OPTIONS[5]!);
  else {
    const count = rng.chance(0.7) ? 1 : 2;
    for (let i = 0; i < count; i++) picks.add(rng.weighted([
      { v: HESITATION_OPTIONS[0]!, weight: 8 },
      { v: HESITATION_OPTIONS[1]!, weight: 4 },
      { v: HESITATION_OPTIONS[2]!, weight: 6 },
      { v: HESITATION_OPTIONS[3]!, weight: 5 },
      { v: HESITATION_OPTIONS[4]!, weight: 2 },
    ]).v);
  }
  const answer = [...picks];
  visit.t += rng.int(3000, 15000);
  visit.surveyResponses.push({
    id: demoId(site.websiteId, 'survey-response', 'hesitation', visit.visitId),
    surveyId: surveyId(site.websiteId, 'hesitation'),
    sessionId: visit.sessionId,
    visitId: visit.visitId,
    answer: answer.join(', '),
    urlPath: '/checkout/success',
    answers: { hesitation: answer },
    completed: true,
    distinctId: visit.distinctId,
    createdAt: visit.t,
  });
}

const IMPROVE_TEXTS = [
  'Delivery took longer than promised.',
  'The size guide was confusing, had to return my jacket.',
  'Checkout kept timing out on my phone.',
  'Prices went up since last season.',
  'Would love more colours in the merino range.',
  'Customer service took three days to answer.',
];

function npsSurvey(site: DemoSite, visit: Visit) {
  const { rng } = visit;
  const score = rng.weighted([
    { v: 10, weight: 22 }, { v: 9, weight: 20 }, { v: 8, weight: 16 }, { v: 7, weight: 10 }, { v: 6, weight: 6 },
    { v: 5, weight: 5 }, { v: 4, weight: 3 }, { v: 3, weight: 2 }, { v: 2, weight: 1 }, { v: 1, weight: 1 }, { v: 0, weight: 1 },
  ]).v;
  const answers: SurveyResponseRow['answers'] = { nps: score };
  let completed = true;
  if (score <= 6) {
    if (rng.chance(0.75)) answers.improve = rng.pick(IMPROVE_TEXTS);
    else completed = false;
  } else if (score >= 9) {
    answers.love = rng.pick(NPS_OPTIONS);
  }
  visit.t += rng.int(3000, 20000);
  visit.surveyResponses.push({
    id: demoId(site.websiteId, 'survey-response', 'nps', visit.visitId),
    surveyId: surveyId(site.websiteId, 'nps'),
    sessionId: visit.sessionId,
    visitId: visit.visitId,
    answer: String(score),
    urlPath: visit.page?.path ?? '/',
    answers,
    completed,
    distinctId: visit.distinctId,
    createdAt: visit.t,
  });
}

function helpfulSurvey(site: DemoSite, visit: Visit) {
  const { rng } = visit;
  const choice = rng.weighted([{ v: DOCS_HELPFUL_OPTIONS[0]!, weight: 64 }, { v: DOCS_HELPFUL_OPTIONS[1]!, weight: 22 }, { v: DOCS_HELPFUL_OPTIONS[2]!, weight: 14 }]).v;
  const answers: SurveyResponseRow['answers'] = { helpful: choice };
  if (choice === 'No' && rng.chance(0.6)) answers.missing = rng.pick(['An example for Next.js app router', 'How to filter bots', 'Rate limits for the events API', 'A full list of autocapture properties']);
  visit.t += rng.int(2000, 9000);
  visit.surveyResponses.push({
    id: demoId(site.websiteId, 'survey-response', 'helpful', visit.visitId),
    surveyId: surveyId(site.websiteId, 'helpful'),
    sessionId: visit.sessionId,
    visitId: visit.visitId,
    answer: choice,
    urlPath: visit.page?.path ?? '/',
    answers,
    completed: true,
    distinctId: visit.distinctId,
    createdAt: visit.t,
  });
}

function workflowForPurchase(site: DemoSite, visit: Visit, purchase: EventRow, revenue: number) {
  if (revenue <= 150) return;
  const id = demoId(site.websiteId, 'workflow-execution', purchase.id, 'high-value-orders');
  visit.workflowExecutions.push({
    id,
    workflowId: workflowId(site.websiteId, 'high-value-orders'),
    sessionId: visit.sessionId,
    visitId: visit.visitId,
    eventId: purchase.id,
    eventName: 'purchase',
    status: 'recorded',
    distinctId: visit.distinctId,
    currentStep: null,
    attempts: 0,
    createdAt: purchase.createdAt + 400,
    completedAt: purchase.createdAt + 400,
  });
}

function workflowForSignup(site: DemoSite, visit: Visit, signup: EventRow) {
  const id = demoId(site.websiteId, 'workflow-execution', signup.id, 'member-onboarding');
  const wf = workflowId(site.websiteId, 'member-onboarding');
  const paid = visit.person.plan !== 'free';
  const start = signup.createdAt + 300;
  const checkedAt = start + 60 * 60 * 1000;
  visit.workflowExecutions.push({
    id,
    workflowId: wf,
    sessionId: visit.sessionId,
    visitId: visit.visitId,
    eventId: signup.id,
    eventName: 'signed_up',
    status: paid ? 'success' : 'stopped',
    distinctId: visit.person.distinctId,
    currentStep: 1,
    attempts: 2,
    createdAt: start,
    completedAt: checkedAt,
  });
  visit.workflowAttempts.push(
    { id: demoId(id, 'attempt', 0), executionId: id, workflowId: wf, stepIndex: 0, stepType: 'delay', status: 'success', durationMs: 3, createdAt: start },
    { id: demoId(id, 'attempt', 1), executionId: id, workflowId: wf, stepIndex: 1, stepType: 'condition', status: paid ? 'passed' : 'stopped', durationMs: 2, createdAt: checkedAt },
  );
}

// ---------------------------------------------------------------------------------------------
// The hour
// ---------------------------------------------------------------------------------------------

export function generateHour(site: DemoSite, hourStart: number, options: GenerateOptions = {}): HourData {
  const plan = hourPlan(site, hourStart);
  const until = options.until ?? Number.POSITIVE_INFINITY;
  const data: HourData = {
    sessions: [],
    events: [],
    sessionData: [],
    revenue: [],
    persons: [],
    memberships: [],
    replays: [],
    logs: [],
    spans: [],
    surveyResponses: [],
    workflowExecutions: [],
    workflowAttempts: [],
  };
  const visits: Array<{ visit: Visit; weight: number }> = [];
  let newIndex = 0;

  for (let i = 0; i < plan.count; i++) {
    const rng = new Rng(`${site.websiteId}:${hourStart}:visit:${i}`);
    let isNew = plan.isNew[i]!;
    let key: string;
    if (isNew) key = `${hourStart}:${newIndex++}`;
    else {
      const returning = returningPersonKey(site, hourStart, rng);
      if (returning) key = returning;
      else {
        isNew = true;
        key = `${hourStart}:x${i}`;
      }
    }
    const person = personFor(site, key);
    const start = hourStart + rng.int(0, HOUR_MS - 1000);
    const identifiedSession = !isNew && person.signsUp && person.distinctId;
    const sessionId = identifiedSession
      ? demoId(site.websiteId, 'session', person.distinctId!)
      : demoId(site.websiteId, 'session', key, monthKey(start));
    const visitId = demoId(site.websiteId, 'visit', hourStart, i);
    const landing = buildLanding(site, person, !isNew, hourStart, rng);
    const visit = new Visit(site, person, sessionId, visitId, landing, rng, start);
    if (site.profile.kind === 'store') storeVisit(site, visit, isNew, hourStart);
    else docsVisit(site, visit, isNew, hourStart);

    const events = visit.events.filter((event) => event.createdAt <= until);
    if (!events.length) continue;
    const firstAt = Math.min(...events.map((event) => event.createdAt));
    const lastAt = Math.max(...events.map((event) => event.createdAt));
    const distinctId = person.signsUp && (visit.distinctId || !isNew) ? person.distinctId : null;
    const identifiedNow = visit.distinctId !== null && visit.sessionData.every((row) => row.createdAt <= until);
    data.sessions.push({
      sessionId,
      browser: person.client.browser,
      os: person.client.os,
      device: person.client.device,
      screen: person.client.screen,
      language: person.geo.language,
      country: person.geo.country,
      region: person.geo.region,
      city: person.geo.city,
      distinctId: identifiedNow ? distinctId : null,
      createdAt: firstAt,
    });
    data.events.push(...events);
    data.sessionData.push(...visit.sessionData.filter((row) => row.createdAt <= until));
    data.revenue.push(...visit.revenue.filter((row) => row.createdAt <= until));
    if (options.otel) {
      data.logs.push(...visit.logs.filter((row) => row.createdAt <= until));
      data.spans.push(...visit.spans.filter((row) => row.startMs + row.durationMs <= until));
    }
    data.surveyResponses.push(...visit.surveyResponses.filter((row) => row.createdAt <= until));
    const executions = visit.workflowExecutions.filter((row) => row.createdAt <= until);
    data.workflowExecutions.push(...executions);
    const executionIds = new Set(executions.map((row) => row.id));
    data.workflowAttempts.push(...visit.workflowAttempts.filter((row) => executionIds.has(row.executionId)));
    if (identifiedNow && distinctId) {
      const personId = demoId(site.websiteId, 'person', distinctId);
      data.persons.push({ personId, distinctId, properties: personProperties(site, person), firstSeenAt: firstAt, lastSeenAt: lastAt });
      if (person.company) {
        data.memberships.push({ id: demoId(site.websiteId, 'membership', distinctId, 'company'), personId, groupType: 'company', groupKey: person.company.key, createdAt: firstAt });
      }
    }
    if (lastAt <= until && visit.pages.length) {
      const weight = (visit.pages.length >= 2 ? 1 : 0.15) * (visit.purchased ? 3 : visit.checkoutStarted ? 2 : 1) * (visit.errors ? 2 : 1);
      visits.push({ visit, weight });
    }
  }

  if (options.otel) {
    const rng = new Rng(`${site.websiteId}:${hourStart}:background`);
    backgroundTelemetry(site, hourStart, rng, data.logs, data.spans);
    data.logs = data.logs.filter((row) => row.createdAt <= until);
    data.spans = data.spans.filter((row) => row.startMs + row.durationMs <= until);
  }

  if (options.replays && visits.length) {
    const rng = new Rng(`${site.websiteId}:${hourStart}:replays`);
    const wanted = Math.min(visits.length, rng.poisson(site.profile.replaysPerHour));
    const pool = [...visits];
    for (let n = 0; n < wanted && pool.length; n++) {
      const chosen = rng.weighted(pool);
      pool.splice(pool.indexOf(chosen), 1);
      const { visit } = chosen;
      const pages = visit.pages.slice(0, 6);
      const chunks = buildReplayChunks({
        origin: visit.origin,
        docs: site.profile.kind === 'docs',
        mobile: visit.person.client.device === 'mobile',
        pages,
        rng: new Rng(`${visit.visitId}:replay`),
      });
      data.replays.push({ sessionId: visit.sessionId, visitId: visit.visitId, chunks });
    }
  }

  return data;
}

// ---------------------------------------------------------------------------------------------
// Heatmaps (per day, absolute counts)
// ---------------------------------------------------------------------------------------------

export type HeatmapCellRow = { urlPath: string; day: string; kind: 'click' | 'scroll'; normX: number; normY: number; deviceClass: string; viewportW: number; viewportH: number; count: number };

type Hotspot = { x: number; y: number; weight: number; spread: number };

const STORE_HEATMAP_PAGES: Record<string, { views: number; desktop: Hotspot[]; mobile: Hotspot[] }> = {
  '/': {
    views: 0.3,
    desktop: [{ x: 140, y: 380, weight: 5, spread: 25 }, { x: 590, y: 40, weight: 3, spread: 30 }, { x: 920, y: 40, weight: 2, spread: 12 }, { x: 180, y: 700, weight: 3, spread: 60 }, { x: 430, y: 700, weight: 2, spread: 60 }, { x: 690, y: 700, weight: 2, spread: 60 }],
    mobile: [{ x: 500, y: 520, weight: 6, spread: 40 }, { x: 900, y: 45, weight: 3, spread: 15 }, { x: 500, y: 820, weight: 2, spread: 80 }],
  },
  '/collections/new': {
    views: 0.14,
    desktop: [{ x: 180, y: 380, weight: 3, spread: 50 }, { x: 430, y: 380, weight: 3, spread: 50 }, { x: 690, y: 380, weight: 2, spread: 50 }, { x: 900, y: 380, weight: 2, spread: 50 }, { x: 430, y: 760, weight: 1, spread: 60 }],
    mobile: [{ x: 250, y: 400, weight: 3, spread: 60 }, { x: 750, y: 400, weight: 3, spread: 60 }, { x: 500, y: 800, weight: 2, spread: 90 }],
  },
  '/products/linen-overshirt': {
    views: 0.08,
    desktop: [{ x: 640, y: 520, weight: 6, spread: 20 }, { x: 700, y: 410, weight: 3, spread: 15 }, { x: 260, y: 420, weight: 3, spread: 70 }, { x: 930, y: 40, weight: 2, spread: 12 }],
    mobile: [{ x: 500, y: 860, weight: 6, spread: 25 }, { x: 500, y: 300, weight: 3, spread: 90 }],
  },
  '/products/merino-crew-sweater': {
    views: 0.06,
    desktop: [{ x: 640, y: 520, weight: 5, spread: 20 }, { x: 700, y: 410, weight: 3, spread: 15 }, { x: 260, y: 420, weight: 3, spread: 70 }],
    mobile: [{ x: 500, y: 860, weight: 5, spread: 25 }, { x: 500, y: 300, weight: 3, spread: 90 }],
  },
  '/cart': {
    views: 0.07,
    desktop: [{ x: 110, y: 330, weight: 7, spread: 15 }, { x: 860, y: 210, weight: 2, spread: 30 }],
    mobile: [{ x: 500, y: 620, weight: 7, spread: 25 }],
  },
  '/checkout': {
    views: 0.045,
    desktop: [{ x: 300, y: 200, weight: 4, spread: 30 }, { x: 300, y: 300, weight: 4, spread: 30 }, { x: 110, y: 380, weight: 5, spread: 15 }],
    mobile: [{ x: 500, y: 260, weight: 4, spread: 40 }, { x: 500, y: 400, weight: 4, spread: 40 }, { x: 500, y: 560, weight: 5, spread: 25 }],
  },
  '/pricing': {
    views: 0.04,
    desktop: [{ x: 500, y: 420, weight: 5, spread: 20 }, { x: 800, y: 420, weight: 3, spread: 20 }, { x: 200, y: 420, weight: 1, spread: 20 }],
    mobile: [{ x: 500, y: 520, weight: 4, spread: 40 }],
  },
};

const DOCS_HEATMAP_PAGES: Record<string, { views: number; desktop: Hotspot[]; mobile: Hotspot[] }> = {
  '/': {
    views: 0.15,
    desktop: [{ x: 310, y: 50, weight: 5, spread: 40 }, { x: 70, y: 150, weight: 3, spread: 20 }, { x: 70, y: 190, weight: 2, spread: 20 }],
    mobile: [{ x: 500, y: 60, weight: 5, spread: 60 }],
  },
  '/docs/getting-started': {
    views: 0.2,
    desktop: [{ x: 700, y: 330, weight: 6, spread: 12 }, { x: 70, y: 180, weight: 2, spread: 25 }, { x: 310, y: 50, weight: 2, spread: 40 }, { x: 480, y: 520, weight: 1, spread: 15 }],
    mobile: [{ x: 850, y: 420, weight: 5, spread: 20 }, { x: 500, y: 60, weight: 2, spread: 60 }],
  },
  '/docs/install': {
    views: 0.16,
    desktop: [{ x: 700, y: 330, weight: 7, spread: 12 }, { x: 70, y: 210, weight: 2, spread: 25 }],
    mobile: [{ x: 850, y: 420, weight: 6, spread: 20 }],
  },
  '/docs/tracking/events': {
    views: 0.1,
    desktop: [{ x: 700, y: 330, weight: 5, spread: 12 }, { x: 70, y: 250, weight: 2, spread: 25 }],
    mobile: [{ x: 850, y: 420, weight: 5, spread: 20 }],
  },
  '/docs/api/overview': {
    views: 0.08,
    desktop: [{ x: 700, y: 420, weight: 4, spread: 12 }, { x: 70, y: 330, weight: 3, spread: 25 }],
    mobile: [{ x: 850, y: 520, weight: 4, spread: 20 }],
  },
};

/** Share of page views that reach each depth bucket (10 % steps). */
const SCROLL_REACH = [1, 0.93, 0.82, 0.7, 0.58, 0.47, 0.38, 0.3, 0.23, 0.17];

/**
 * Click and scroll cells of one UTC day, scaled to `fraction` of the day for the day in
 * progress. Counts are absolute, so rewriting a day replaces its cells.
 */
export function heatmapDay(site: DemoSite, dayStart: number, fraction = 1): HeatmapCellRow[] {
  const pages = site.profile.kind === 'store' ? STORE_HEATMAP_PAGES : DOCS_HEATMAP_PAGES;
  const rng = new Rng(`${site.websiteId}:${dayStart}:heatmap`);
  let factor = 0;
  for (let h = 0; h < 24; h++) factor += trafficFactor(dayStart + h * HOUR_MS, site.profile.weekday, site.profile.kind === 'store');
  const dailyViews = (site.profile.baseDailySessions * factor) / 24 * 3.2 * Math.max(0, Math.min(1, fraction));
  const day = dayKey(dayStart);
  const cells = new Map<string, HeatmapCellRow>();
  const add = (row: Omit<HeatmapCellRow, 'count'>, count: number) => {
    if (count <= 0) return;
    const key = `${row.urlPath}|${row.kind}|${row.normX}|${row.normY}|${row.deviceClass}`;
    const existing = cells.get(key);
    if (existing) existing.count += count;
    else cells.set(key, { ...row, count });
  };
  for (const [path, page] of Object.entries(pages)) {
    for (const device of ['desktop', 'mobile'] as const) {
      const share = device === 'desktop' ? (site.profile.kind === 'store' ? 0.52 : 0.84) : site.profile.kind === 'store' ? 0.48 : 0.16;
      const views = Math.round(dailyViews * page.views * share * rng.range(0.85, 1.15));
      if (!views) continue;
      const viewportW = device === 'desktop' ? 1440 : 390;
      const viewportH = device === 'desktop' ? 900 : 844;
      const hotspots = device === 'desktop' ? page.desktop : page.mobile;
      const clicks = Math.round(views * rng.range(0.9, 1.4));
      const total = hotspots.reduce((sum, spot) => sum + spot.weight, 0);
      for (let c = 0; c < Math.min(clicks, 4000); c++) {
        let roll = rng.next() * (total + 1.2);
        let spot: Hotspot | null = null;
        for (const candidate of hotspots) {
          roll -= candidate.weight;
          if (roll < 0) {
            spot = candidate;
            break;
          }
        }
        const x = spot ? rng.normal(spot.x, spot.spread) : rng.range(20, 980);
        const y = spot ? rng.normal(spot.y, spot.spread * 0.6) : rng.range(60, 980);
        const normX = Math.max(0, Math.min(999, Math.round(x / 8) * 8));
        const normY = Math.max(0, Math.min(999, Math.round(y / 8) * 8));
        add({ urlPath: path, day, kind: 'click', normX, normY, deviceClass: device, viewportW, viewportH }, 1);
      }
      for (let bucket = 0; bucket < SCROLL_REACH.length; bucket++) {
        const reach = SCROLL_REACH[bucket]!;
        const nextReach = SCROLL_REACH[bucket + 1] ?? 0;
        const count = Math.round(views * (reach - nextReach));
        add({ urlPath: path, day, kind: 'scroll', normX: 0, normY: (bucket + 1) * 100, deviceClass: device, viewportW: 0, viewportH: 0 }, count);
      }
    }
  }
  return [...cells.values()];
}
