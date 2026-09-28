import { defineConfig } from 'vitest/config';

/**
 * Plain Node tests (no Workers runtime): the tracker script runs in a small fake browser via
 * `new Function`, which workerd does not allow.
 */
export default defineConfig({
  test: {
    include: ['test-node/**/*.test.ts'],
    environment: 'node',
  },
});
