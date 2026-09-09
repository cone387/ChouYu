import { describe, expect, it } from 'vitest'
import { cpuFromCounter, percentile, summarizeTimings } from './soak-stats'

describe('soak measurement accounting', () => {
  it('keeps missing observations distinct from a measured zero', () => {
    expect(summarizeTimings([]).meanMs).toBeNull()
    expect(summarizeTimings([0]).meanMs).toBe(0)
    expect(percentile([NaN, Infinity], .95)).toBeNull()
  })
  it('reports nearest-rank percentiles without mutating samples', () => {
    const values = [100, 1, 50, 2]
    expect(summarizeTimings(values)).toEqual({ count: 4, meanMs: 38.25, p50Ms: 2, p95Ms: 100, maxMs: 100 })
    expect(values).toEqual([100, 1, 50, 2])
  })
  it('uses elapsed wall time and rejects a restarted or reset process counter', () => {
    const previous = { pid: 1, seconds: 10, at: 1000 }
    expect(cpuFromCounter(previous, { pid: 1, seconds: 11, at: 3000 })).toBe(50)
    expect(cpuFromCounter(null, previous)).toBeNull()
    expect(cpuFromCounter(previous, { pid: 2, seconds: 11, at: 3000 })).toBeNull()
    expect(cpuFromCounter(previous, { pid: 1, seconds: 9, at: 3000 })).toBeNull()
    expect(cpuFromCounter(previous, previous)).toBeNull()
  })
  it('summarizes the maximum supported 48 hour workload without argument overflow', () => {
    const result = summarizeTimings(Array.from({ length: 48 * 3600 }, (_, index) => index))
    expect(result.count).toBe(172800)
    expect(result.maxMs).toBe(172799)
  })
})
