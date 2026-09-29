import type { FeatureFlagEvaluationContext, FeatureFlagEvaluationReason } from '@flareboard/shared';
import type { EvaluatedFlag } from '../feature-flags';
import { isRecord } from './events';

/**
 * Settings posthog-js reads from `/array/<token>/config`, `/decide` and `/flags`. Everything
 * Flareboard does not serve through this API (session recording, surveys, heatmaps, site apps,
 * extensions loaded from the assets host) is switched off so the SDK does not try to load it.
 */
export function remoteConfig(hasFeatureFlags: boolean) {
  return {
    supportedCompression: ['gzip', 'gzip-js'],
    config: { enable_collect_everything: true },
    toolbarParams: {},
    editorParams: {},
    isAuthenticated: false,
    autocapture_opt_out: false,
    autocaptureExceptions: false,
    capturePerformance: false,
    elementsChainAsString: true,
    sessionRecording: false,
    heatmaps: false,
    surveys: false,
    siteApps: [],
    defaultIdentifiedOnly: true,
    hasFeatureFlags,
  };
}

const REASONS: Record<FeatureFlagEvaluationReason, { code: string; description: string }> = {
  match: { code: 'condition_match', description: 'Matched conditions' },
  early_access_enrolled: { code: 'condition_match', description: 'Enrolled in early access' },
  early_access_opted_out: { code: 'no_condition_match', description: 'Opted out of early access' },
  targeting_mismatch: { code: 'no_condition_match', description: 'No matching condition set' },
  rollout_miss: { code: 'out_of_rollout_bound', description: 'Out of rollout bound' },
  disabled: { code: 'disabled', description: 'Feature flag is disabled' },
  missing: { code: 'unknown', description: 'Feature flag not found' },
};

/** PostHog sends payloads as JSON strings; SDKs parse them back. */
function encodePayload(payload: unknown): string | undefined {
  if (payload === undefined) return undefined;
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

/**
 * One response for `/decide` (v3/v4) and `/flags` (v2): the detailed `flags` map newer SDKs read
 * plus the flat `featureFlags` / `featureFlagPayloads` older ones read. Boolean flags carry no
 * `variant`, so SDKs report `true`/`false`; multivariate flags report the variant key.
 */
export function flagsResponse(flags: EvaluatedFlag[], hasFeatureFlags = flags.length > 0) {
  const featureFlags: Record<string, string | boolean> = {};
  const featureFlagPayloads: Record<string, string> = {};
  const details: Record<string, unknown> = {};
  for (const flag of flags) {
    const enabled = flag.evaluation.enabled;
    const variant = enabled && flag.multivariate ? String(flag.evaluation.variant) : undefined;
    const payload = enabled ? encodePayload(flag.payload) : undefined;
    featureFlags[flag.key] = variant ?? enabled;
    if (payload !== undefined) featureFlagPayloads[flag.key] = payload;
    details[flag.key] = {
      key: flag.key,
      enabled,
      variant,
      reason: REASONS[flag.evaluation.reason],
      metadata: { id: flag.flagId, version: undefined, payload, description: undefined },
    };
  }
  return {
    ...remoteConfig(hasFeatureFlags),
    featureFlags,
    featureFlagPayloads,
    flags: details,
    errorsWhileComputingFlags: false,
    quotaLimited: [] as string[],
    requestId: crypto.randomUUID(),
  };
}

function text(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

/** Flag evaluation context from a `/decide` or `/flags` request body. */
export function flagsContext(body: Record<string, unknown>): FeatureFlagEvaluationContext {
  const person = isRecord(body.person_properties) ? body.person_properties : {};
  const groups = isRecord(body.groups) ? body.groups : undefined;
  return {
    distinctId: text(body.distinct_id),
    anonymousId: text(body.$anon_distinct_id) ?? text(body.$device_id),
    url: text(person.$current_url),
    hostname: text(person.$host),
    referrer: text(person.$referrer),
    language: text(person.$browser_language),
    groups,
    properties: person,
  };
}

/** `flag_keys` (posthog-js) or `flag_keys_to_evaluate` (server SDKs) restrict the response. */
export function requestedFlagKeys(body: Record<string, unknown>): string[] | undefined {
  const raw = Array.isArray(body.flag_keys_to_evaluate) ? body.flag_keys_to_evaluate : body.flag_keys;
  if (!Array.isArray(raw)) return undefined;
  const keys = raw.map(text).filter((key): key is string => Boolean(key));
  return keys.length ? keys : undefined;
}
