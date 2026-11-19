import { defineConfig } from 'vitest/config';

// Only this project's tests: external/ holds upstream repositories with their own test runners.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], exclude: ['external/**', 'node_modules/**'] },
});
