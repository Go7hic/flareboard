import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          APP_SECRET: 'flareboard-test-secret',
          HOSTED_MODE: 'false',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.spec.ts'],
    // Website stores are Durable Objects: RPC round trips under a loaded machine exceed the 5s default.
    testTimeout: 20_000,
  },
});
