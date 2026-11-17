import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    // These suites include real Windows SQLite/fsync and SDK child processes.
    // Hosted runners share fewer CPU/IO resources than development machines.
    maxWorkers: process.env.CI ? 2 : 4,
    testTimeout: process.env.CI ? 15_000 : 5_000,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: true
  }
})
