export interface UsageTotals {
  calls: number; samples: number; reported: number; tokens: number; input: number; output: number; inputReported: number; outputReported: number
  executionMs: number; waitingMs: number; reports: number; failures: number
}
export interface UsageBucket extends UsageTotals { start: number; end: number }
export interface ActivitySpan { runId: string; topicId: string | null; start: number; end: number; state: 'running' | 'waiting' | 'queued' | 'interrupted'; approximate: boolean }
export interface UsageActivity { runId: string; topicId: string | null; at: number; kind: 'report' | 'failed' }
export interface AgentAnalytics {
  runSummaries?: { runId: string; title: string }[]
  heartbeats?: { id: number; topicId: string; start: number; end: number }[]
  logs?: { id: number; runId: string; topicId: string | null; at: number; kind: string; text: string }[]
  logsTruncated?: boolean
  start: number; end: number; measuredAt: number; totals: UsageTotals
  buckets: UsageBucket[]; spans: ActivitySpan[]; activity: UsageActivity[]
  tasks: (UsageTotals & { id: string | null; title: string })[]
  legacyCalls: number
}
export interface AnalyticsQuery { date: string; days: 1 | 7 | 30; topicId?: string; timeline?: boolean }
export const emptyUsage = (): UsageTotals => ({ calls: 0, samples: 0, reported: 0, tokens: 0, input: 0, output: 0, inputReported: 0, outputReported: 0, executionMs: 0, waitingMs: 0, reports: 0, failures: 0 })
