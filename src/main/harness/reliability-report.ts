import type { AIResponseMetadata } from '../../shared/ai-usage'
export interface ReliabilityEvidence {
  sourceCommit: string; model: string; engine: 'native' | 'dsh'; scenario: string
  passed: boolean; attempts: number; calls: number; metadata: AIResponseMetadata[]; elapsedMs: number
  category?: 'semantic' | 'provider' | 'unavailable' | 'timeout' | 'persistence'
}
/** Whitelist projection. Never serialize model output, request text or Error objects. */
export function reliabilityReport(input: ReliabilityEvidence) {
  if (!['native', 'dsh'].includes(input.engine) || !/^[a-f0-9]{40}$/.test(input.sourceCommit) || !/^[a-z0-9-]{1,64}$/.test(input.scenario)
    || !Number.isSafeInteger(input.attempts) || input.attempts < 0 || input.attempts > 2 || !Number.isSafeInteger(input.calls) || input.calls < 0 || input.calls > 12) throw new Error('Invalid reliability evidence')
  const values = input.metadata.map(item => item.usage?.totalTokens)
  const usageComplete = values.length === input.calls && values.every(value => Number.isFinite(value) && value! >= 0)
  const reportedTokens = values.reduce<number>((sum, value) => sum + (Number.isFinite(value) && value! >= 0 ? value! : 0), 0)
  return { sourceCommit: input.sourceCommit, model: /^[\w./:-]{1,100}$/.test(input.model) && !/^(sk-|Bearer)/i.test(input.model) ? input.model : 'redacted-model',
    engine: input.engine, scenario: input.scenario, outcome: input.passed ? input.attempts > 1 ? 'corrected' : 'first-pass' : 'failed',
    attempts: input.attempts, calls: input.calls, tokens: usageComplete ? reportedTokens : null, reportedTokens, usageComplete,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)), category: input.passed ? undefined : ['semantic', 'provider', 'unavailable', 'timeout', 'persistence'].includes(input.category ?? '') ? input.category : 'semantic' }
}
