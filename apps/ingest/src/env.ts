export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  EVENT_QUEUE: Queue;
  REPLAY_BUCKET?: R2Bucket;
  APP_SECRET: string;
  ENVIRONMENT: string;
  HOSTED_MODE?: string;
}
