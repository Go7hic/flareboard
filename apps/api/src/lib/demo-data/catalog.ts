import { DEMO_DOCS_WEBSITE_ID, PUBLIC_DEMO_WEBSITE_ID } from '@flareboard/shared';

/**
 * Static content of the two demo websites: who visits, from where, which pages exist and what
 * they sell or document. Everything the generator draws from lives here so the shapes stay
 * reviewable in one place.
 */

export type SiteKind = 'store' | 'docs';

export type Weighted<T> = T & { weight: number };

export type SiteProfile = {
  websiteId: string;
  kind: SiteKind;
  /** Used when the website row has no domain. */
  defaultDomain: string;
  /** Sessions per day before growth, weekday and campaign factors. */
  baseDailySessions: number;
  /** Share of sessions from people who visited before. */
  returningShare: number;
  /** Share of new people who sign up (and identify) on their first visit. */
  signupRate: number;
  /** Weekday factors, Sunday first. */
  weekday: readonly number[];
  /** Replays recorded per hour on average. */
  replaysPerHour: number;
};

export const STORE_PROFILE: SiteProfile = {
  websiteId: PUBLIC_DEMO_WEBSITE_ID,
  kind: 'store',
  defaultDomain: 'demo-store.example.com',
  baseDailySessions: 430,
  returningShare: 0.34,
  signupRate: 0.09,
  weekday: [0.86, 1.04, 1.1, 1.08, 1.04, 0.97, 0.82],
  replaysPerHour: 2,
};

export const DOCS_PROFILE: SiteProfile = {
  websiteId: DEMO_DOCS_WEBSITE_ID,
  kind: 'docs',
  defaultDomain: 'docs.example.com',
  baseDailySessions: 160,
  returningShare: 0.46,
  signupRate: 0.07,
  weekday: [0.58, 1.12, 1.18, 1.16, 1.12, 0.98, 0.52],
  replaysPerHour: 0.8,
};

export const DEMO_PROFILES: readonly SiteProfile[] = [STORE_PROFILE, DOCS_PROFILE];

export function profileFor(websiteId: string): SiteProfile | null {
  return DEMO_PROFILES.find((profile) => profile.websiteId === websiteId) ?? null;
}

export type Geo = { country: string; region: string; city: string; language: string; currency: string };

export const GEOS: ReadonlyArray<Weighted<Geo>> = [
  { country: 'US', region: 'California', city: 'San Francisco', language: 'en-US', currency: 'USD', weight: 9 },
  { country: 'US', region: 'New York', city: 'New York', language: 'en-US', currency: 'USD', weight: 8 },
  { country: 'US', region: 'Texas', city: 'Austin', language: 'en-US', currency: 'USD', weight: 5 },
  { country: 'US', region: 'Washington', city: 'Seattle', language: 'en-US', currency: 'USD', weight: 4 },
  { country: 'US', region: 'Illinois', city: 'Chicago', language: 'en-US', currency: 'USD', weight: 4 },
  { country: 'CA', region: 'Ontario', city: 'Toronto', language: 'en-CA', currency: 'USD', weight: 4 },
  { country: 'GB', region: 'England', city: 'London', language: 'en-GB', currency: 'GBP', weight: 8 },
  { country: 'GB', region: 'England', city: 'Manchester', language: 'en-GB', currency: 'GBP', weight: 2 },
  { country: 'DE', region: 'Berlin', city: 'Berlin', language: 'de-DE', currency: 'EUR', weight: 6 },
  { country: 'DE', region: 'Bavaria', city: 'Munich', language: 'de-DE', currency: 'EUR', weight: 3 },
  { country: 'FR', region: 'Île-de-France', city: 'Paris', language: 'fr-FR', currency: 'EUR', weight: 5 },
  { country: 'NL', region: 'North Holland', city: 'Amsterdam', language: 'nl-NL', currency: 'EUR', weight: 3 },
  { country: 'SE', region: 'Stockholm', city: 'Stockholm', language: 'sv-SE', currency: 'EUR', weight: 2 },
  { country: 'ES', region: 'Madrid', city: 'Madrid', language: 'es-ES', currency: 'EUR', weight: 2 },
  { country: 'JP', region: 'Tokyo', city: 'Tokyo', language: 'ja-JP', currency: 'USD', weight: 4 },
  { country: 'AU', region: 'New South Wales', city: 'Sydney', language: 'en-AU', currency: 'USD', weight: 3 },
  { country: 'IN', region: 'Karnataka', city: 'Bengaluru', language: 'en-IN', currency: 'USD', weight: 4 },
  { country: 'BR', region: 'São Paulo', city: 'São Paulo', language: 'pt-BR', currency: 'USD', weight: 2 },
  { country: 'CN', region: 'Shanghai', city: 'Shanghai', language: 'zh-CN', currency: 'USD', weight: 3 },
  { country: 'SG', region: 'Singapore', city: 'Singapore', language: 'en-SG', currency: 'USD', weight: 2 },
];

export type Client = { browser: string; os: string; device: 'desktop' | 'mobile' | 'tablet'; screen: string };

export const CLIENTS: ReadonlyArray<Weighted<Client>> = [
  { browser: 'Chrome', os: 'Windows', device: 'desktop', screen: '1920x1080', weight: 18 },
  { browser: 'Chrome', os: 'macOS', device: 'desktop', screen: '1440x900', weight: 12 },
  { browser: 'Safari', os: 'macOS', device: 'desktop', screen: '1512x982', weight: 9 },
  { browser: 'Edge', os: 'Windows', device: 'desktop', screen: '1536x864', weight: 6 },
  { browser: 'Firefox', os: 'Windows', device: 'desktop', screen: '1920x1080', weight: 3 },
  { browser: 'Firefox', os: 'Linux', device: 'desktop', screen: '2560x1440', weight: 2 },
  { browser: 'Chrome', os: 'ChromeOS', device: 'desktop', screen: '1366x768', weight: 1 },
  { browser: 'Mobile Safari', os: 'iOS', device: 'mobile', screen: '390x844', weight: 20 },
  { browser: 'Chrome', os: 'Android', device: 'mobile', screen: '412x915', weight: 16 },
  { browser: 'Samsung Internet', os: 'Android', device: 'mobile', screen: '360x780', weight: 3 },
  { browser: 'Safari', os: 'iOS', device: 'tablet', screen: '820x1180', weight: 4 },
];

/** Docs readers are developers: more desktop, more Firefox. */
export const DOCS_CLIENTS: ReadonlyArray<Weighted<Client>> = [
  { browser: 'Chrome', os: 'macOS', device: 'desktop', screen: '1728x1117', weight: 22 },
  { browser: 'Chrome', os: 'Windows', device: 'desktop', screen: '1920x1080', weight: 16 },
  { browser: 'Firefox', os: 'Linux', device: 'desktop', screen: '2560x1440', weight: 9 },
  { browser: 'Firefox', os: 'macOS', device: 'desktop', screen: '1512x982', weight: 5 },
  { browser: 'Safari', os: 'macOS', device: 'desktop', screen: '1512x982', weight: 8 },
  { browser: 'Edge', os: 'Windows', device: 'desktop', screen: '1536x864', weight: 5 },
  { browser: 'Mobile Safari', os: 'iOS', device: 'mobile', screen: '393x852', weight: 6 },
  { browser: 'Chrome', os: 'Android', device: 'mobile', screen: '412x915', weight: 4 },
];

/** Where a visit came from. `utm` is set for tagged traffic. */
export type Source = {
  key: string;
  referrer: string | null;
  utm?: { source: string; medium: string; campaign?: string; content?: string; term?: string };
  clickId?: 'gclid' | 'fbclid';
};

export const STORE_SOURCES: ReadonlyArray<Weighted<Source>> = [
  { key: 'direct', referrer: null, weight: 26 },
  { key: 'google', referrer: 'https://www.google.com/', weight: 24 },
  { key: 'bing', referrer: 'https://www.bing.com/', weight: 3 },
  { key: 'duckduckgo', referrer: 'https://duckduckgo.com/', weight: 2 },
  { key: 'instagram', referrer: 'https://l.instagram.com/', weight: 7 },
  { key: 'facebook', referrer: 'https://m.facebook.com/', weight: 4 },
  { key: 'pinterest', referrer: 'https://www.pinterest.com/', weight: 4 },
  { key: 'reddit', referrer: 'https://www.reddit.com/r/malefashionadvice/', weight: 2 },
  { key: 'tiktok', referrer: 'https://www.tiktok.com/', weight: 3 },
  {
    key: 'google-ads',
    referrer: 'https://www.google.com/',
    utm: { source: 'google', medium: 'cpc', campaign: 'brand-search', term: 'northwind supply' },
    clickId: 'gclid',
    weight: 8,
  },
  {
    key: 'meta-ads',
    referrer: 'https://m.facebook.com/',
    utm: { source: 'facebook', medium: 'paid_social', campaign: 'prospecting-lookalike', content: 'carousel' },
    clickId: 'fbclid',
    weight: 5,
  },
  { key: 'newsletter', referrer: null, utm: { source: 'newsletter', medium: 'email', campaign: 'weekly-edit' }, weight: 5 },
  { key: 'producthunt', referrer: 'https://www.producthunt.com/', weight: 1 },
  { key: 'blog-referral', referrer: 'https://www.goodonyou.eco/', weight: 2 },
];

export const DOCS_SOURCES: ReadonlyArray<Weighted<Source>> = [
  { key: 'google', referrer: 'https://www.google.com/', weight: 40 },
  { key: 'direct', referrer: null, weight: 22 },
  { key: 'github', referrer: 'https://github.com/', weight: 12 },
  { key: 'stackoverflow', referrer: 'https://stackoverflow.com/', weight: 7 },
  { key: 'bing', referrer: 'https://www.bing.com/', weight: 3 },
  { key: 'hn', referrer: 'https://news.ycombinator.com/', weight: 3 },
  { key: 'devto', referrer: 'https://dev.to/', weight: 3 },
  { key: 'app', referrer: 'https://app.example.com/', weight: 8 },
  { key: 'changelog-email', referrer: null, utm: { source: 'changelog', medium: 'email', campaign: 'monthly-changelog' }, weight: 2 },
];

export type Product = { id: string; slug: string; name: string; category: string; price: number };

export const PRODUCTS: readonly Product[] = [
  { id: 'NW-1001', slug: 'linen-overshirt', name: 'Linen Overshirt', category: 'apparel', price: 98 },
  { id: 'NW-1002', slug: 'merino-crew-sweater', name: 'Merino Crew Sweater', category: 'apparel', price: 128 },
  { id: 'NW-1003', slug: 'field-jacket', name: 'Waxed Field Jacket', category: 'apparel', price: 248 },
  { id: 'NW-1004', slug: 'selvedge-denim', name: 'Selvedge Denim', category: 'apparel', price: 145 },
  { id: 'NW-1005', slug: 'organic-tee', name: 'Organic Cotton Tee', category: 'apparel', price: 38 },
  { id: 'NW-1006', slug: 'trail-runner', name: 'Trail Runner', category: 'footwear', price: 165 },
  { id: 'NW-1007', slug: 'leather-chelsea-boot', name: 'Leather Chelsea Boot', category: 'footwear', price: 235 },
  { id: 'NW-1008', slug: 'canvas-tote', name: 'Canvas Tote', category: 'accessories', price: 42 },
  { id: 'NW-1009', slug: 'merino-beanie', name: 'Merino Beanie', category: 'accessories', price: 34 },
  { id: 'NW-1010', slug: 'leather-wallet', name: 'Leather Card Wallet', category: 'accessories', price: 58 },
  { id: 'NW-1011', slug: 'wool-throw', name: 'Wool Throw', category: 'home', price: 145 },
  { id: 'NW-1012', slug: 'ceramic-mug', name: 'Stoneware Mug', category: 'home', price: 28 },
  { id: 'NW-1013', slug: 'linen-bedding-set', name: 'Linen Bedding Set', category: 'home', price: 285 },
  { id: 'NW-1014', slug: 'cast-iron-pan', name: 'Cast Iron Pan', category: 'home', price: 89 },
  { id: 'NW-1015', slug: 'rain-shell', name: 'Packable Rain Shell', category: 'apparel', price: 158 },
  { id: 'NW-1016', slug: 'weekender-bag', name: 'Weekender Bag', category: 'accessories', price: 195 },
];

export const COLLECTIONS = ['new', 'apparel', 'footwear', 'accessories', 'home', 'sale'] as const;

export const STORE_BLOG_POSTS = [
  { slug: 'how-we-source-linen', title: 'How we source our linen' },
  { slug: 'merino-care-guide', title: 'The merino care guide' },
  { slug: 'autumn-lookbook', title: 'Autumn lookbook' },
  { slug: 'repair-program', title: 'Introducing our repair program' },
] as const;

export type DocsPage = { path: string; title: string; weight: number; section: string };

export const DOCS_PAGES: readonly DocsPage[] = [
  { path: '/', title: 'Acme Analytics Docs', weight: 10, section: 'home' },
  { path: '/docs/getting-started', title: 'Getting started', weight: 14, section: 'guides' },
  { path: '/docs/install', title: 'Install the tracker', weight: 12, section: 'guides' },
  { path: '/docs/tracking/pageviews', title: 'Pageviews', weight: 6, section: 'tracking' },
  { path: '/docs/tracking/events', title: 'Custom events', weight: 10, section: 'tracking' },
  { path: '/docs/tracking/identify', title: 'Identify users', weight: 7, section: 'tracking' },
  { path: '/docs/feature-flags', title: 'Feature flags', weight: 8, section: 'product' },
  { path: '/docs/experiments', title: 'Experiments', weight: 5, section: 'product' },
  { path: '/docs/session-replay', title: 'Session replay', weight: 6, section: 'product' },
  { path: '/docs/api/overview', title: 'API overview', weight: 7, section: 'api' },
  { path: '/docs/api/events', title: 'Events API', weight: 5, section: 'api' },
  { path: '/docs/sdk/javascript', title: 'JavaScript SDK', weight: 8, section: 'sdk' },
  { path: '/docs/sdk/react', title: 'React SDK', weight: 6, section: 'sdk' },
  { path: '/docs/self-hosting', title: 'Self-hosting', weight: 4, section: 'guides' },
  { path: '/changelog', title: 'Changelog', weight: 5, section: 'changelog' },
  { path: '/blog/measuring-activation', title: 'Measuring activation without cookies', weight: 3, section: 'blog' },
];

export const DOCS_SEARCH_QUERIES = [
  'install',
  'react',
  'identify',
  'feature flags',
  'api key',
  'webhook',
  'custom events',
  'next.js',
  'self host',
  'rate limit',
  'gdpr',
  'session replay privacy',
  'export data',
  'experiments sample size',
];

export type Company = { key: string; name: string; industry: string; employees: number; domain: string };

export const COMPANIES: readonly Company[] = [
  { key: 'acme-corp', name: 'Acme Corp', industry: 'Manufacturing', employees: 1200, domain: 'acme.example' },
  { key: 'globex', name: 'Globex', industry: 'Energy', employees: 5400, domain: 'globex.example' },
  { key: 'initech', name: 'Initech', industry: 'Software', employees: 310, domain: 'initech.example' },
  { key: 'umbrella', name: 'Umbrella Health', industry: 'Healthcare', employees: 8800, domain: 'umbrella.example' },
  { key: 'hooli', name: 'Hooli', industry: 'Software', employees: 12000, domain: 'hooli.example' },
  { key: 'stark-industries', name: 'Stark Industries', industry: 'Aerospace', employees: 20000, domain: 'stark.example' },
  { key: 'wayne-enterprises', name: 'Wayne Enterprises', industry: 'Conglomerate', employees: 15000, domain: 'wayne.example' },
  { key: 'piedmont', name: 'Piedmont Design Studio', industry: 'Design', employees: 45, domain: 'piedmont.example' },
  { key: 'bluebird', name: 'Bluebird Coffee', industry: 'Hospitality', employees: 220, domain: 'bluebird.example' },
  { key: 'northstar', name: 'Northstar Logistics', industry: 'Logistics', employees: 950, domain: 'northstar.example' },
  { key: 'lumen-labs', name: 'Lumen Labs', industry: 'Biotech', employees: 130, domain: 'lumen.example' },
  { key: 'tidewater', name: 'Tidewater Outfitters', industry: 'Retail', employees: 75, domain: 'tidewater.example' },
];

export const FIRST_NAMES = [
  'Ava', 'Liam', 'Mia', 'Noah', 'Emma', 'Lucas', 'Sofia', 'Mateo', 'Hana', 'Kenji', 'Amara', 'Omar', 'Chloé', 'Jonas',
  'Priya', 'Arjun', 'Lena', 'Felix', 'Isla', 'Theo', 'Zara', 'Leo', 'Maya', 'Elias', 'Nora', 'Sven', 'Yuki', 'Wei',
];

export const LAST_NAMES = [
  'Hartley', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Schneider', 'Patel', 'García', 'Kowalski', 'Nguyen', 'Brennan',
  'Rossi', 'Fischer', 'Novak', 'Haddad', 'Silva', 'Andersen', 'Kim', 'Dubois', 'Walsh', 'Ibrahim', 'Costa',
];

export const ROLES = ['Buyer', 'Designer', 'Engineer', 'Founder', 'Marketing lead', 'Operations manager', 'Student', 'Product manager'];
