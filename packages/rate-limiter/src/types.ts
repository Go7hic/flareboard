export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
};

export type RateLimiterConsumeBody = {
  limit: number;
  windowSec: number;
};
