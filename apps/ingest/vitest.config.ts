import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// `SITE_STORE` is bound to the API worker's EventStore (script_name "flareboard-api"). Tests run
// the real store class in an auxiliary worker bundled from the API sources.
const siteStoreWorker = fileURLToPath(new URL('./.wrangler/test/site-store-worker.mjs', import.meta.url));
buildSync({
  entryPoints: [fileURLToPath(new URL('./test/helpers/site-store-worker.ts', import.meta.url))],
  outfile: siteStoreWorker,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:*', 'node:*'],
  logLevel: 'error',
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          APP_SECRET: 'flareboard-test-secret',
          HOSTED_MODE: 'false',
        },
        workers: [
          {
            name: 'flareboard-api',
            modules: true,
            scriptPath: siteStoreWorker,
            compatibilityDate: '2025-06-01',
            compatibilityFlags: ['nodejs_compat_v2'],
            durableObjects: { SITE_STORE: { className: 'EventStore', useSQLite: true } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['test/**/*.spec.ts'],
  },
});
