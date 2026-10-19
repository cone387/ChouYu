import type { AIResponseMetadata, AIUsage } from '../../../shared/ai-usage'

/** SDK input/cache counters are disjoint; the host input counter includes cache. */
export function dshMetadata(raw: unknown, finish?: unknown): AIResponseMetadata {
  const usage: AIUsage = {}, value = raw as Record<string, unknown> | null
  if (value && typeof value === 'object') {
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
      const n = value[key]
      if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) usage[key] = n
    }
    if (usage.inputTokens !== undefined) usage.inputTokens += (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    if (usage.totalTokens === undefined && usage.inputTokens !== undefined && usage.outputTokens !== undefined) usage.totalTokens = usage.inputTokens + usage.outputTokens
  }
  const reason = (finish as { kind?: string } | undefined)?.kind
  const finishReason = reason === 'stop' ? 'stop' : reason === 'tool-calls' ? 'tool_calls' : reason === 'max-tokens' ? 'length' : undefined
  // SDK adapters may synthesize zero counters when a stream supplied no usage.
  return { usage: Object.values(usage).some(n => n! > 0) ? usage : undefined, ...(finishReason ? { finishReason } : {}) }
}
