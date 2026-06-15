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
  },
});
