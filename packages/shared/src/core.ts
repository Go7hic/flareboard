export type FlareEnvironment = 'production' | 'preview' | 'staging' | 'development' | string;

export interface FlareProjectRef {
  projectId: string;
  name?: string;
  environment?: FlareEnvironment;
  release?: string;
}

export interface FlareSessionContext {
  sessionId?: string;
  visitId?: string;
  anonymousId?: string;
  userId?: string;
}

export interface FlareEventEnvelope<TProperties extends Record<string, unknown> = Record<string, unknown>> {
  projectId: string;
  type: string;
  timestamp: number;
  sessionId?: string;
  userId?: string;
  anonymousId?: string;
  release?: string;
  environment?: FlareEnvironment;
  properties?: TProperties;
}

export interface FlareErrorProperties {
  message: string;
  name?: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  severity?: 'fatal' | 'error' | 'warning' | 'info';
  handled?: boolean;
  release?: string;
  environment?: FlareEnvironment;
  url?: string;
}

export interface FlareLogProperties {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  release?: string;
  environment?: FlareEnvironment;
  url?: string;
  [key: string]: unknown;
}

export interface FlareAiObservation {
  provider?: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status?: 'success' | 'error';
  quality?: string;
  release?: string;
  environment?: FlareEnvironment;
  metadata?: Record<string, unknown>;
}

export interface FlareFeatureFlagConfig {
  key: string;
  enabled: boolean;
  rollout: number;
}

export interface FlareExperimentRef {
  experimentId: string;
  featureFlagKey: string;
  goalEvent: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
}

export interface FlareBrowserClient {
  track(name: string, data?: Record<string, unknown>, tag?: string): Promise<unknown> | undefined;
  identify(id: string, data?: Record<string, unknown>): Promise<unknown> | undefined;
  alias(alias: string, distinctId?: string): Promise<unknown> | undefined;
  group(type: string, key: string, data?: Record<string, unknown>): Promise<unknown> | undefined;
  reset(): void;
  revenue(amount: number, currency?: string, extra?: Record<string, unknown>): Promise<unknown> | undefined;
  log(
    level: NonNullable<FlareLogProperties['level']>,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<unknown> | undefined;
  ai(data: FlareAiObservation): Promise<unknown> | undefined;
  captureException(error: unknown, extra?: Partial<FlareErrorProperties>): Promise<unknown> | undefined;
  page(): Promise<unknown> | undefined;
  getDistinctId(): string;
  getSessionId(): string | null;
  getVisitId(): string | null;
  getFeatureFlag(key: string, fallback?: string | boolean): string | boolean;
  getFeatureFlagVariant(key: string, fallback?: string | boolean): string | boolean;
  isFeatureEnabled(key: string, fallback?: boolean): boolean;
  featureFlagsReady(): Promise<FlareFeatureFlagConfig[]>;
  showSurvey(): void;
}
