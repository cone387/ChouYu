import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    maxWorkers: 4,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: true
  }
})
