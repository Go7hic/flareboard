/**
 * A deliberately small browser for running the real tracker script (TRACKER_SCRIPT) in Node.
 * It implements only what script.js touches: a DOM tree with attributes and text, event
 * listeners on window/document, Web Storage, location/history, fetch and sendBeacon. Requests
 * the tracker makes are recorded so tests can assert on the exact payloads it would send.
 */
import { TRACKER_SCRIPT } from '../../src/tracker/script';

type Listener = (event: FakeEvent) => void;
type FakeEvent = { type: string; target?: unknown; persisted?: boolean; [key: string]: unknown };

class Emitter {
  private listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== fn),
    );
  }
  emit(type: string, event: FakeEvent) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

export class FakeNode extends Emitter {
  parentElement: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  constructor(readonly nodeType: number) {
    super();
  }
  get parentNode() {
    return this.parentElement;
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentElement?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
}

export class FakeText extends FakeNode {
  constructor(public nodeValue: string) {
    super(3);
  }
}

/** The element that last received focus (document.activeElement). */
let focusedElement: FakeElement | null = null;

export class FakeElement extends FakeNode {
  readonly tagName: string;
  attributes: Array<{ name: string; value: string }> = [];
  style: Record<string, string> = {};
  onclick: (() => void) | null = null;
  oninput: (() => void) | null = null;
  onkeydown: ((event: { key: string }) => void) | null = null;
  checked = false;
  value = '';
  type = '';
  focus() {
    focusedElement = this;
  }
  contains(node: unknown): boolean {
    for (let n = node as FakeNode | null; n; n = n.parentElement) if (n === this) return true;
    return false;
  }
  constructor(tag: string) {
    super(1);
    this.tagName = tag.toUpperCase();
  }
  getAttribute(name: string) {
    return this.attributes.find((a) => a.name === name)?.value ?? null;
  }
  setAttribute(name: string, value: string) {
    const found = this.attributes.find((a) => a.name === name);
    if (found) found.value = String(value);
    else this.attributes.push({ name, value: String(value) });
  }
  hasAttribute(name: string) {
    return this.attributes.some((a) => a.name === name);
  }
  removeAttribute(name: string) {
    this.attributes = this.attributes.filter((a) => a.name !== name);
  }
  get id() {
    return this.getAttribute('id') ?? '';
  }
  set id(value: string) {
    this.setAttribute('id', value);
  }
  get src() {
    return this.getAttribute('src') ?? '';
  }
  appendChild<T extends FakeNode>(child: T): T {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.childNodes = this.parentElement.childNodes.filter((n) => n !== this);
    this.parentElement = null;
  }
  set textContent(value: string) {
    this.childNodes = [];
    this.appendChild(new FakeText(value));
  }
  get textContent(): string {
    return this.childNodes
      .map((n) => (n instanceof FakeText ? n.nodeValue : n instanceof FakeElement ? n.textContent : ''))
      .join('');
  }
  querySelectorAll(tag: string) {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const child of el.childNodes) {
        if (child instanceof FakeElement) {
          if (child.tagName === tag.toUpperCase()) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }
}

export class FakeStorage {
  map = new Map<string, string>();
  constructor(initial?: Record<string, string>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.map.set(k, v);
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  snapshot() {
    return Object.fromEntries(this.map);
  }
}

export type SentEvent = {
  via: 'fetch' | 'beacon';
  type: string;
  payload: Record<string, unknown> & { data?: Record<string, unknown> };
  cache?: string;
};

export type TrackerConfig = Record<string, unknown>;

export type BrowserOptions = {
  /** Attributes on the tracker's <script> tag. */
  script?: Record<string, string>;
  url?: string;
  title?: string;
  /** navigator.userAgent / navigator.language. */
  userAgent?: string;
  language?: string;
  localStorage?: FakeStorage;
  sessionStorage?: FakeStorage;
  doNotTrack?: string;
  globalPrivacyControl?: boolean;
  /** tracker-config response, or a promise to control when it arrives. Null means 500. */
  config?: TrackerConfig | Promise<TrackerConfig | null> | null;
  /** Results for /api/feature-flags/evaluate. */
  evaluate?: Record<string, string | boolean>;
  /** prefers-color-scheme: dark. */
  prefersDark?: boolean;
  /** Pre-existing window.flareboard (e.g. the @flareboard/js stub with a _q queue). */
  preload?: Record<string, unknown>;
  beacon?: boolean;
  documentHeight?: number;
  viewportHeight?: number;
};

export const WEBSITE_ID = '11111111-2222-4333-8444-555555555555';
const INGEST = 'https://t.example.test';

export function defaultConfig(overrides: TrackerConfig = {}): TrackerConfig {
  return {
    websiteId: WEBSITE_ID,
    autocapture: true,
    persistence: false,
    respectDnt: false,
    replay: { sampleRate: 1, maskInputs: true, blockSelector: null },
    heatmapSampleRate: 0,
    heatmapEnabled: false,
    featureFlags: [],
    surveys: [],
    ...overrides,
  };
}

export function createBrowser(options: BrowserOptions = {}) {
  focusedElement = null;
  const opened: Array<[string, string, string]> = [];
  const url = new URL(options.url ?? 'https://shop.example.test/pricing');
  const location = {
    get href() {
      return url.href;
    },
    get pathname() {
      return url.pathname;
    },
    get search() {
      return url.search;
    },
    get hash() {
      return url.hash;
    },
    get hostname() {
      return url.hostname;
    },
    get host() {
      return url.host;
    },
    get protocol() {
      return url.protocol;
    },
  };

  const sent: SentEvent[] = [];
  const requests: Array<{ url: string; body?: unknown }> = [];
  const localStorage = options.localStorage ?? new FakeStorage();
  const sessionStorage = options.sessionStorage ?? new FakeStorage();
  let sendCount = 0;
  let viewportHeight = options.viewportHeight ?? 800;
  let scrollY = 0;

  const html = new FakeElement('html');
  const head = html.appendChild(new FakeElement('head'));
  const body = html.appendChild(new FakeElement('body'));
  const script = head.appendChild(new FakeElement('script'));
  script.setAttribute('src', `${INGEST}/script.js`);
  for (const [name, value] of Object.entries(options.script ?? { 'data-website-id': WEBSITE_ID })) {
    script.setAttribute(name, value);
  }

  const documentHeight = options.documentHeight ?? 2000;
  const document = Object.assign(new Emitter(), {
    currentScript: script as FakeElement | null,
    activeElement: null as FakeElement | null,
    title: options.title ?? 'Pricing',
    referrer: '',
    visibilityState: 'visible' as 'visible' | 'hidden',
    readyState: 'complete',
    body: Object.assign(body, { scrollHeight: documentHeight }),
    documentElement: Object.assign(html, { scrollHeight: documentHeight, scrollTop: 0 }),
    createElement: (tag: string) => new FakeElement(tag),
    getElementById: (id: string) => {
      let found: FakeElement | null = null;
      const walk = (el: FakeElement) => {
        if (found) return;
        if (el.id === id) found = el;
        for (const child of el.childNodes) if (child instanceof FakeElement) walk(child);
      };
      walk(html);
      return found;
    },
    querySelector: () => script,
  });
  Object.defineProperty(document, 'activeElement', { get: () => focusedElement });

  const windowEmitter = new Emitter();
  const window = Object.assign(windowEmitter, {
    get innerWidth() {
      return 1280;
    },
    get innerHeight() {
      return viewportHeight;
    },
    get scrollY() {
      return scrollY;
    },
    localStorage,
    sessionStorage,
    crypto: globalThis.crypto,
    opened,
    open(target: string, name: string, features: string) {
      opened.push([target, name, features]);
      return null;
    },
    matchMedia: (query: string) => ({ matches: query.includes('dark') && options.prefersDark === true }),
    flareboard: options.preload as unknown,
    Flareboard: undefined as unknown,
  });

  const navigator = {
    language: options.language ?? 'en-US',
    userAgent: options.userAgent ?? 'Mozilla/5.0 (Macintosh) Chrome/128.0 Safari/537.36',
    doNotTrack: options.doNotTrack ?? null,
    globalPrivacyControl: options.globalPrivacyControl ?? undefined,
    sendBeacon:
      options.beacon === false
        ? undefined
        : (target: string, data: string) => {
            record('beacon', target, data);
            return true;
          },
  };

  const history = {
    pushState(_state: unknown, _title: string, next: string) {
      const target = new URL(next, url);
      url.href = target.href;
    },
    replaceState(_state: unknown, _title: string, next: string) {
      const target = new URL(next, url);
      url.href = target.href;
    },
  };

  function record(via: SentEvent['via'], target: string, raw: string) {
    requests.push({ url: target, body: raw });
    if (!target.endsWith('/api/send')) return;
    const parsed = JSON.parse(raw) as { type: string; payload: SentEvent['payload']; cache?: string };
    sent.push({ via, type: parsed.type, payload: parsed.payload, cache: parsed.cache });
  }

  function response(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  const fetch = async (target: string, init?: { body?: string }) => {
    if (target.includes('/api/tracker-config')) {
      requests.push({ url: target });
      const cfg = await (options.config === undefined ? defaultConfig() : options.config);
      return cfg == null ? response(500, { message: 'boom' }) : response(200, cfg);
    }
    if (target.endsWith('/api/feature-flags/evaluate')) {
      requests.push({ url: target, body: init?.body ? JSON.parse(init.body) : undefined });
      return response(200, { results: options.evaluate ?? {} });
    }
    if (target.endsWith('/api/send')) {
      record('fetch', target, init?.body ?? '{}');
      sendCount++;
      return response(200, { cache: `cache-${sendCount}`, sessionId: 'session-1', visitId: 'visit-1' });
    }
    requests.push({ url: target, body: init?.body ? JSON.parse(init.body) : undefined });
    if (target.endsWith('/api/surveys/response')) return response(200, { ok: true });
    return response(404, {});
  };

  function run() {
    const fn = new Function(
      'window',
      'document',
      'location',
      'navigator',
      'history',
      'screen',
      'fetch',
      TRACKER_SCRIPT,
    );
    fn(window, document, location, navigator, history, { width: 1280, height: 800 }, fetch);
    return window.flareboard as TrackerApi;
  }

  /** Let fetch promise chains and zero-delay timers settle. */
  async function flush(rounds = 6) {
    for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function el(tag: string, attrs: Record<string, string> = {}, ...children: Array<FakeElement | string>) {
    const node = new FakeElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    for (const child of children) node.appendChild(typeof child === 'string' ? new FakeText(child) : child);
    return node;
  }

  function mount<T extends FakeElement>(node: T): T {
    return body.appendChild(node);
  }

  function dispatch(type: string, target: FakeElement) {
    document.emit(type, { type, target });
  }

  return {
    window,
    document,
    navigator,
    history,
    localStorage,
    sessionStorage,
    sent,
    requests,
    run,
    flush,
    el,
    mount,
    click: (target: FakeElement) => dispatch('click', target),
    submit: (target: FakeElement) => dispatch('submit', target),
    change: (target: FakeElement) => dispatch('change', target),
    pagehide: () => windowEmitter.emit('pagehide', { type: 'pagehide', persisted: false }),
    setVisibility(state: 'visible' | 'hidden') {
      document.visibilityState = state;
      document.emit('visibilitychange', { type: 'visibilitychange' });
    },
    scrollTo(y: number) {
      scrollY = y;
      document.documentElement.scrollTop = y;
    },
    setViewportHeight(h: number) {
      viewportHeight = h;
    },
    /** Named events the tracker sent (pageviews have no name). */
    names: () => sent.filter((e) => e.type === 'event').map((e) => (e.payload.name as string | undefined) ?? 'pageview'),
    events: (name: string) => sent.filter((e) => e.type === 'event' && e.payload.name === name),
    pageviews: () => sent.filter((e) => e.type === 'event' && !e.payload.name),
  };
}

export type FakeBrowser = ReturnType<typeof createBrowser>;

export type TrackerApi = {
  track(name: string, data?: Record<string, unknown>, tag?: string): unknown;
  page(): unknown;
  identify(id: string, data?: Record<string, unknown>): unknown;
  alias(alias: string, distinctId?: string): unknown;
  group(type: string, key: string, data?: Record<string, unknown>): unknown;
  reset(): void;
  register(props: Record<string, unknown>): void;
  registerOnce(props: Record<string, unknown>): void;
  unregister(key: string): void;
  optOut(): void;
  optIn(): void;
  hasOptedOut(): boolean;
  getDistinctId(): string;
  getSessionId(): string | null;
  getFeatureFlag(key: string, fallback?: string | boolean): string | boolean;
  isFeatureEnabled(key: string, fallback?: boolean): boolean;
  getFeatureFlagPayload(key: string): unknown;
  onFeatureFlags(
    cb: (flags: string[], variants: Record<string, string | boolean>, payloads: Record<string, unknown>) => void,
  ): () => void;
  featureFlagsReady(): Promise<unknown>;
};
