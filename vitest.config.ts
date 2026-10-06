import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Windows CI runners are slow on a cold start (the first PDF render loads a native
    // canvas, test files run in parallel); 5 s timed out there while locally these take ~1 s.
    // A test that really hangs still fails.
    testTimeout: 30_000,
  },
});
