import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the TypeScript sources: a stale `dist/` from older builds may still hold compiled tests.
    include: ['src/**/*.test.ts'],
  },
});
