/**
 * A tiny browser for running the real recorder (RECORDER_SCRIPT) in Node, with a fake
 * `window.rrweb`. It records the options passed to rrweb.record, lets tests emit rrweb events,
 * and captures every chunk posted to /api/record. Timers are Node's (use vi fake timers).
 */
import { RECORDER_SCRIPT } from '../../src/tracker/recorder';
import { FakeStorage } from './fake-browser';

export const WEBSITE_ID = '11111111-2222-4333-8444-555555555555';
const INGEST = 'https://t.example.test';

const SIMPLE_PART = /^(\*|[a-z][a-z0-9]*|\.[\w-]+|#[\w-]+|\[[\w-]+(="[^"]*")?\])+$/i;

/** Validates and matches the small selector subset the tests use (tag, .class, #id, [attr], [attr="v"], *). */
function parseSelector(selector: string) {
  const parts = selector.split(',').map((part) => part.trim());
  for (const part of parts) {
    if (!SIMPLE_PART.test(part)) throw new SyntaxError(`'${selector}' is not a valid selector`);
  }
  return parts;
}

export class RecEl {
  parent: RecEl | null = null;
  attrs = new Map<string, string>();
  constructor(readonly tagName: string, attrs: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(attrs)) this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  get src() {
    return this.getAttribute('src') ?? '';
  }
  append(child: RecEl) {
    child.parent = this;
    return child;
  }
  private matchesPart(part: string) {
    if (part === '*') return true;
    const tokens = part.match(/\*|[a-z][a-z0-9]*|\.[\w-]+|#[\w-]+|\[[\w-]+(="[^"]*")?\]/gi) ?? [];
    return tokens.every((token) => {
      if (token === '*') return true;
      if (token.startsWith('.')) return (this.getAttribute('class') ?? '').split(/\s+/).includes(token.slice(1));
      if (token.startsWith('#')) return this.getAttribute('id') === token.slice(1);
      if (token.startsWith('[')) {
        const [, name, value] = token.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/)!;
        return value === undefined ? this.attrs.has(name!) : this.getAttribute(name!) === value;
      }
      return this.tagName.toLowerCase() === token.toLowerCase();
    });
  }
  matches(selector: string) {
    return parseSelector(selector).some((part) => this.matchesPart(part));
  }
  closest(selector: string): RecEl | null {
    parseSelector(selector);
    for (let el: RecEl | null = this; el; el = el.parent) if (el.matches(selector)) return el;
    return null;
  }
}

type Listener = (event: Record<string, unknown>) => void;

class Emitter {
  listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, event: Record<string, unknown> = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, ...event });
  }
}

export type RecordedChunk = {
  website: string;
  sessionId: string;
  visitId: string;
  chunkIndex: number;
  events: Array<{ type: number; data?: { tag?: string; payload?: Record<string, unknown> }; timestamp?: number }>;
};

export type RecorderEnvOptions = {
  script?: Record<string, string>;
  /** tracker-config response; null means the request fails. */
  config?: Record<string, unknown> | null;
  replay?: Record<string, unknown>;
  localStorage?: FakeStorage;
  sessionStorage?: FakeStorage;
  doNotTrack?: string;
  /** Other script tags on the page (e.g. the tracker with data-respect-dnt). */
  otherScripts?: Array<Record<string, string>>;
  /** Responses for fetch() calls the page makes (network capture tests). */
  pageFetch?: (url: string) => { status: number } | Error;
};

export function createRecorderEnv(options: RecorderEnvOptions = {}) {
  const sessionStorage =
    options.sessionStorage ?? new FakeStorage({ 'flareboard.sid': 'session-1', 'flareboard.vid': 'visit-1' });
  const localStorage = options.localStorage ?? new FakeStorage();
  const script = new RecEl('script', { src: `${INGEST}/recorder.js`, ...(options.script ?? { 'data-website-id': WEBSITE_ID }) });
  const otherScripts = (options.otherScripts ?? []).map((attrs) => new RecEl('script', attrs));
  const chunks: RecordedChunk[] = [];
  const configRequests: string[] = [];
  const pageRequests: string[] = [];
  const consoleCalls: Array<[string, unknown[]]> = [];
  const rrweb = {
    options: null as null | Record<string, unknown> & { emit: (event: unknown) => void },
    stopped: 0,
    record: Object.assign(
      (opts: Record<string, unknown> & { emit: (event: unknown) => void }) => {
        rrweb.options = opts;
        opts.emit({ type: 4, data: { href: 'https://shop.example.test/' }, timestamp: Date.now() });
        opts.emit({ type: 2, data: {}, timestamp: Date.now() });
        return () => {
          rrweb.stopped++;
        };
      },
      {
        addCustomEvent(tag: string, payload: unknown) {
          rrweb.options?.emit({ type: 5, data: { tag, payload }, timestamp: Date.now() });
        },
      },
    ),
  };

  const config =
    options.config === undefined
      ? {
          websiteId: WEBSITE_ID,
          respectDnt: false,
          replay: {
            sampleRate: 1,
            maskInputs: true,
            maskAllText: false,
            maskSelector: null,
            blockSelector: null,
            console: false,
            network: false,
            minDurationMs: 0,
            ...(options.replay ?? {}),
          },
        }
      : options.config;

  const response = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  const fetch = async (target: string, init?: { body?: string; method?: string }) => {
    if (target.startsWith(`${INGEST}/api/tracker-config`)) {
      configRequests.push(target);
      return config === null ? response(500, {}) : response(200, config);
    }
    if (target === `${INGEST}/api/record`) {
      chunks.push((JSON.parse(init?.body ?? '{}') as { payload: RecordedChunk }).payload);
      return response(200, { ok: true });
    }
    pageRequests.push(target);
    const result = options.pageFetch?.(target) ?? { status: 200 };
    if (result instanceof Error) throw result;
    return response(result.status, {});
  };

  class FakeXhr extends Emitter {
    status = 0;
    open(_method: string, _url: string) {}
    send() {}
    /** Test hook: finish the request. */
    finish(status: number) {
      this.status = status;
      this.emit('loadend');
    }
  }

  const baseConsole: Record<string, (...args: unknown[]) => void> = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    baseConsole[level] = (...args: unknown[]) => {
      consoleCalls.push([level, args]);
    };
  }

  const windowEmitter = new Emitter();
  const window = Object.assign(windowEmitter, {
    rrweb,
    localStorage,
    sessionStorage,
    fetch,
    console: { ...baseConsole },
    XMLHttpRequest: FakeXhr,
    performance: { now: () => Date.now(), getEntriesByName: () => [{ transferSize: 321 }] },
  });
  const documentEmitter = new Emitter();
  const document = Object.assign(documentEmitter, {
    currentScript: script,
    readyState: 'complete',
    visibilityState: 'visible',
    querySelector(selector: string) {
      parseSelector(selector);
      return [script, ...otherScripts].find((el) => el.matches(selector)) ?? null;
    },
  });
  const navigator = { doNotTrack: options.doNotTrack ?? null, globalPrivacyControl: undefined };
  const location = new URL('https://shop.example.test/checkout?step=2');

  function run() {
    const fn = new Function('window', 'document', 'navigator', 'location', RECORDER_SCRIPT);
    fn(window, document, navigator, location);
  }

  return {
    window,
    document,
    rrweb,
    chunks,
    configRequests,
    pageRequests,
    consoleCalls,
    localStorage,
    sessionStorage,
    run,
    /** Every event in every posted chunk. */
    events: () => chunks.flatMap((chunk) => chunk.events),
    custom: (tag: string) =>
      chunks.flatMap((chunk) => chunk.events).filter((event) => event.type === 5 && event.data?.tag === tag),
    pagehide: () => windowEmitter.emit('pagehide'),
    XMLHttpRequest: FakeXhr,
  };
}
