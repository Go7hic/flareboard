export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
};

export type RateLimiterConsumeBody = {
  limit: number;
  windowSec: number;
};

export type LockoutBody = {
  op: 'check' | 'fail' | 'reset';
  /** Failures allowed before the first lock. */
  threshold: number;
  /** First lock duration; doubles with each further failure. */
  baseSec: number;
  maxSec: number;
  /** Failures are forgotten this long after the last one. */
  resetAfterSec: number;
};

export type LockoutResult = {
  locked: boolean;
  retryAfterSec: number;
  failures: number;
};
