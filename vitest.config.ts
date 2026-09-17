import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    maxWorkers: 4,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: true
  }
})
