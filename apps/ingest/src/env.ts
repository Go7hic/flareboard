export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  EVENT_QUEUE: Queue;
  REPLAY_BUCKET?: R2Bucket;
  APP_SECRET: string;
  ENVIRONMENT: string;
  HOSTED_MODE?: string;
  /** API worker base URL for workflow email delivery (optional). */
  API_URL?: string;
}
