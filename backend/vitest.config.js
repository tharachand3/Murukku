import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ['./tests/setup.js'],
    testTimeout: 60000,
    hookTimeout: 60000
  }
});
