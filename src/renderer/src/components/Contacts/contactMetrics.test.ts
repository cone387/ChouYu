import { describe, expect, it } from 'vitest'
import type { AgentSummary } from '../../../../shared/agents'
import { compareMetrics } from './contactMetrics'
const summary = (tokens: number, tasks = 1, calls = 1, reported = 1): AgentSummary => ({ tokens, tasks, calls, reported, activeTasks: 0, memories: 0 })
describe('contact metric sorting', () => {
  it('never treats missing usage as zero and keeps unknown values last in both sort directions', () => {
    const unknown = summary(0, 1, 2, 0), zero = summary(0, 0, 0, 0)
    for (const sort of ['tokens-asc', 'tokens-desc'] as const) {
      expect(compareMetrics(unknown, zero, sort)).toBeGreaterThan(0)
      expect(compareMetrics(undefined, zero, sort)).toBeGreaterThan(0)
    }
  })
  it('sorts numeric usage and tasks in either direction', () => {
    expect(compareMetrics(summary(900, 5), summary(10000, 1), 'tokens-desc')).toBeGreaterThan(0)
    expect(compareMetrics(summary(900, 5), summary(10000, 1), 'tasks-desc')).toBeLessThan(0)
    expect(compareMetrics(summary(900, 5), summary(10000, 1), 'tasks-asc')).toBeGreaterThan(0)
  })
})
