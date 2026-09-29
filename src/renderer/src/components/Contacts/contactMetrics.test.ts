import { describe, expect, it } from 'vitest'
import type { AgentSummary } from '../../../../shared/agents'
import { compareMetrics, matchesMetrics } from './contactMetrics'
const summary = (tokens: number, tasks = 1, calls = 1, reported = 1): AgentSummary => ({ tokens, tasks, calls, reported, activeTasks: 0, memories: 0 })
describe('contact metric filters', () => {
  it('combines task count and token boundaries without dropping exact thresholds', () => {
    expect(matchesMetrics(summary(9999, 5), 'under10k', '1to5')).toBe(true)
    expect(matchesMetrics(summary(10000, 5), 'under10k', '1to5')).toBe(false)
    expect(matchesMetrics(summary(10000, 6), '10kTo100k', 'over5')).toBe(true)
    expect(matchesMetrics(summary(100000, 6), '10kTo100k', 'over5')).toBe(false)
    expect(matchesMetrics(summary(100000, 6), 'over100k', 'over5')).toBe(true)
    expect(matchesMetrics(summary(100000, 0), 'over100k', 'over5')).toBe(false)
  })
  it('never treats missing usage as zero and keeps unknown values last in both sort directions', () => {
    const unknown = summary(0, 1, 2, 0), zero = summary(0, 0, 0, 0)
    expect(matchesMetrics(unknown, 'zero', 'all')).toBe(false)
    expect(matchesMetrics(unknown, 'unreported', 'all')).toBe(true)
    expect(matchesMetrics(zero, 'zero', 'zero')).toBe(true)
    for (const sort of ['tokens-asc', 'tokens-desc'] as const) {
      expect(compareMetrics(unknown, zero, sort)).toBeGreaterThan(0)
      expect(compareMetrics(undefined, zero, sort)).toBeGreaterThan(0)
    }
    expect(matchesMetrics(undefined, 'all', 'all')).toBe(true)
    expect(matchesMetrics(undefined, 'all', 'zero')).toBe(false)
  })
  it('sorts numeric usage and tasks in either direction', () => {
    expect(compareMetrics(summary(900, 5), summary(10000, 1), 'tokens-desc')).toBeGreaterThan(0)
    expect(compareMetrics(summary(900, 5), summary(10000, 1), 'tasks-desc')).toBeLessThan(0)
    expect(compareMetrics(summary(900, 5), summary(10000, 1), 'tasks-asc')).toBeGreaterThan(0)
  })
})
