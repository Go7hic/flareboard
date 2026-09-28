import { defineConfig } from 'vitest/config';

// Unit tests for pure helpers in src/lib. Separate from vite.config.ts so tests do not load
// the app's build plugins.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
