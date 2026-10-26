import { expect, it } from 'vitest'
import { reliabilityReport } from './reliability-report'
it('keeps partial usage unknown and records actual engine and bounded attempts', () => {
  const report = reliabilityReport({ sourceCommit: 'a'.repeat(40), model: 'model-v1', engine: 'dsh', scenario: 'deadline', passed: true, attempts: 2, calls: 2,
    metadata: [{ usage: { totalTokens: 20 } }, {}], elapsedMs: 30 })
  expect(report).toMatchObject({ engine: 'dsh', outcome: 'corrected', calls: 2, tokens: null, reportedTokens: 20, usageComplete: false })
  expect(() => reliabilityReport({ ...report, engine: 'other' } as any)).toThrow()
})
it('projects only safe evidence fields, never raw requests, errors or credentials', () => {
  const report = reliabilityReport({ sourceCommit: 'b'.repeat(40), model: 'https://host/?key=secret', engine: 'native', scenario: 'ongoing', passed: false, attempts: 1,
    calls: 1, metadata: [], elapsedMs: 1, category: 'semantic', raw: 'private request', error: 'Bearer secret' } as any)
  expect(report.model).toBe('redacted-model')
  expect(JSON.stringify(report)).not.toMatch(/private|Bearer|secret/)
})
