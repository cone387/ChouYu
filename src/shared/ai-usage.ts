export interface AIUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
export interface AIResponseMetadata { model?: string; usage?: AIUsage; finishReason?: string }

/** Merge cumulative SSE counters; missing counters remain unknown, never estimated. */
export function readAIUsage(payload: unknown, provider: 'openai' | 'claude', previous: AIResponseMetadata = {}): AIResponseMetadata {
  if (!payload || typeof payload !== 'object') return previous
  const data = payload as Record<string, any>
  const message = provider === 'claude' ? data.message : data
  const model = typeof message?.model === 'string' ? message.model : previous.model
  const source = provider === 'claude' ? data.message?.usage ?? data.usage : data.usage
  const stop = provider === 'claude' ? data.delta?.stop_reason ?? data.message?.stop_reason : data.choices?.[0]?.finish_reason
  const finishReason = typeof stop === 'string' && stop ? stop : previous.finishReason
  const metadata = { ...previous, model, ...(finishReason ? { finishReason } : {}) }
  if (!source || typeof source !== 'object') return metadata
  const usage: AIUsage = { ...previous.usage }
  const keys = provider === 'openai'
    ? { inputTokens: source.prompt_tokens, outputTokens: source.completion_tokens, totalTokens: source.total_tokens, cacheReadTokens: source.prompt_tokens_details?.cached_tokens }
    : { inputTokens: source.input_tokens, outputTokens: source.output_tokens, cacheReadTokens: source.cache_read_input_tokens, cacheWriteTokens: source.cache_creation_input_tokens }
  for (const [key, value] of Object.entries(keys)) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) usage[key as keyof AIUsage] = value
  }
  if (provider === 'claude' && usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  }
  return { ...metadata, usage: Object.keys(usage).length ? usage : undefined }
}
