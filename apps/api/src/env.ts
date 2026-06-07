export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  REPLAY_BUCKET?: R2Bucket;
  /** Cloudflare Email Sending binding (optional). */
  EMAIL?: SendEmail;
  APP_SECRET: string;
  ENVIRONMENT: string;
  /** When "true", enable public registration, billing, and plan limits. */
  HOSTED_MODE?: string;
  /** Sender address (domain must be onboarded for Email Sending). */
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  /** HMAC secret for POST /api/auth/sso (required in production when SSO is used). */
  SSO_SECRET?: string;
  /** Comma-separated dashboard origins for production CORS. */
  CORS_ORIGINS?: string;
  /** Public dashboard URL for share links (optional). */
  SHARE_URL?: string;
  /** When "true", config.disableLogin is set and login may be hidden in dashboard. */
  DISABLE_LOGIN?: string;
  /** OAuth — Google */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** OAuth — GitHub */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Public dashboard URL for password reset links (optional). */
  DASHBOARD_URL?: string;
  /** Stripe (hosted billing) */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_CLOUD?: string;
  /** @deprecated Legacy — maps to Cloud plan */
  STRIPE_PRICE_HOBBY?: string;
  /** @deprecated Legacy — maps to Cloud plan */
  STRIPE_PRICE_PRO?: string;
}
