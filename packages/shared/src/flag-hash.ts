/**
 * Canonical feature-flag bucketing, shared by the server evaluator and (verbatim, as inline JS)
 * the tracker script. Client and server must assign the same variant to the same person, so
 * any change here must be mirrored in the tracker and covered by the parity test.
 *
 * Bucketing id: the distinct id (identified user, or the persistent anonymous id when the site
 * enables persistence), else the session id, else 'anonymous'.
 */
export function flagBucketingId(ids: {
  distinctId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  visitId?: string | null;
  anonymousId?: string | null;
}): string {
  return ids.distinctId || ids.userId || ids.anonymousId || ids.sessionId || ids.visitId || 'anonymous';
}

/** 0–99 bucket for a string (FNV-1a variant used since the first tracker release). */
export function flagHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0) % 100;
}

export function rolloutBucket(flagKey: string, bucketingId: string): number {
  return flagHash(`${flagKey}:${bucketingId}`);
}

export function variantBucket(flagKey: string, bucketingId: string): number {
  return flagHash(`${flagKey}:variant:${bucketingId}`);
}

/**
 * The same algorithm as a self-contained JS source string for the tracker script. The parity
 * test evaluates this string and compares it with the functions above.
 */
export const FLAG_HASH_JS =
  "function hashFlag(str){var h=2166136261,i;for(i=0;i<str.length;i++){h^=str.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)}return Math.abs(h>>>0)%100}";
