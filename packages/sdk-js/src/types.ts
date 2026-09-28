/** Event and person properties. Nested objects are dropped by ingest; use flat values. */
export type Properties = Record<string, string | number | boolean | null | undefined>;

/** A flag's value: a variant key, `'control'`, `'test'` for enabled boolean flags, or a boolean. */
export type FlagValue = string | boolean;

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type AiObservation = {
  model: string;
  provider?: string;
  name?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status?: 'success' | 'error';
  quality?: string;
  release?: string;
  environment?: string;
  data?: Properties;
};

export type ExceptionContext = {
  severity?: 'fatal' | 'error' | 'warning' | 'info';
  handled?: boolean;
  release?: string;
  environment?: string;
  data?: Properties;
};

/**
 * Called when flags load and whenever they are re-evaluated (for example on SPA navigation).
 * `flags` lists the enabled keys; `variants` maps every key to its value; `payloads` holds the
 * payload of each flag's assigned variant, when the flag has one.
 */
export type FeatureFlagsCallback = (
  flags: string[],
  variants: Record<string, FlagValue>,
  payloads: Record<string, unknown>,
) => void;

export type FlareboardConfig = {
  /** Your ingest origin, for example `https://t.flareboard.dev`. The script loads from `${host}/script.js`. */
  host: string;
  /** Website id from Settings → Tracking code. One of `websiteId` or `projectKey` is required. */
  websiteId?: string;
  /** Project API key, resolved to a website by the ingest worker. */
  projectKey?: string;
  /**
   * Autocapture clicks, form submits and field changes (never field values). Defaults to the
   * website setting; `false` or `true` overrides it on this page.
   */
  autocapture?: boolean;
  /** `$pageleave` events with time on page and scroll depth. Defaults to `autocapture`. */
  capturePageleave?: boolean;
  /**
   * `false` never keeps an anonymous id in localStorage, even when the website has "Remember
   * visitors across sessions" on (for example until the visitor consents). Persistence itself is
   * turned on in the website settings; `true` or leaving it out follows that setting.
   */
  persistence?: boolean;
  /** Honor Do Not Track / Global Privacy Control. Defaults to the website setting. */
  respectDnt?: boolean;
  release?: string;
  environment?: string;
  /** 0–1: share of clicks and scrolls recorded for heatmaps until the website config loads. */
  heatmapSampleRate?: number;
  /** Load the script from somewhere other than `${host}/script.js`. */
  scriptUrl?: string;
  /** CSP nonce for the injected script tag. */
  nonce?: string;
};

/** The API of the tracker script (`window.flareboard`). */
export interface FlareboardApi {
  track(name: string, data?: Properties, tag?: string): void;
  page(): void;
  identify(distinctId: string, properties?: Properties): void;
  alias(alias: string, distinctId?: string): void;
  group(type: string, key: string, properties?: Properties): void;
  reset(): void;
  register(properties: Properties): void;
  registerOnce(properties: Properties): void;
  unregister(key: string): void;
  optOut(): void;
  optIn(): void;
  hasOptedOut(): boolean;
  getFeatureFlag(key: string, fallback?: FlagValue): FlagValue | undefined;
  isFeatureEnabled(key: string, fallback?: boolean): boolean;
  getFeatureFlagPayload(key: string): unknown;
  onFeatureFlags(callback: FeatureFlagsCallback): () => void;
  featureFlagsReady(): Promise<void>;
  captureException(error: unknown, context?: ExceptionContext): void;
  revenue(amount: number, currency?: string, extra?: { name?: string; data?: Properties }): void;
  log(level: LogLevel, message: string, data?: Properties): void;
  ai(observation: AiObservation): void;
  getDistinctId(): string;
  getSessionId(): string | null;
  getVisitId(): string | null;
}
