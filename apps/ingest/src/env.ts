export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  EVENT_QUEUE: Queue;
  REPLAY_BUCKET?: R2Bucket;
  APP_SECRET: string;
  ENVIRONMENT: string;
  HOSTED_MODE?: string;
  /** Service binding to the API worker (production); preferred over API_URL. */
  API?: Fetcher;
  /** API base URL fallback for local dev when no `API` binding exists. */
  API_URL?: string;
  /** Requests per minute allowed per project key (default 30000). */
  PROJECT_KEY_RATE_LIMIT?: string;
}
