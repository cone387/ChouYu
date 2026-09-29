import { describe, expect, it } from 'vitest'
import { readAIUsage } from './ai-usage'

describe('provider-reported token usage', () => {
  it.each(['openai', 'claude'] as const)('preserves %s stop reasons across a later usage-only chunk', provider => {
    const stopped = readAIUsage(provider === 'openai'
      ? { choices: [{ finish_reason: 'length' }] }
      : { delta: { stop_reason: 'max_tokens' } }, provider)
    const final = readAIUsage({ usage: provider === 'openai' ? { completion_tokens: 8192 } : { output_tokens: 8192 } }, provider, stopped)
    expect(final.finishReason).toBe(provider === 'openai' ? 'length' : 'max_tokens')
    expect(final.usage?.outputTokens).toBe(8192)
  })
  it('reads the final OpenAI usage-only chunk and preserves the resolved model', () => {
    const initial = readAIUsage({ model: 'resolved-model', choices: [], usage: null }, 'openai')
    expect(readAIUsage({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125, prompt_tokens_details: { cached_tokens: 70 } } }, 'openai', initial)).toEqual({ model: 'resolved-model', usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125, cacheReadTokens: 70 } })
  })
  it('merges Claude cumulative counters without counting deltas twice', () => {
    const initial = readAIUsage({ message: { model: 'claude-model', usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } } }, 'claude')
    const final = readAIUsage({ usage: { output_tokens: 30 } }, 'claude', initial)
    expect(final.usage).toEqual({ inputTokens: 10, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 20, totalTokens: 160 })
    expect(readAIUsage({ usage: { output_tokens: 30 } }, 'claude', final)).toEqual(final)
  })
  it('keeps absent and invalid counters unknown but accepts an explicit zero', () => {
    expect(readAIUsage({ usage: { prompt_tokens: -1, completion_tokens: '25', total_tokens: null } }, 'openai').usage).toBeUndefined()
    expect(readAIUsage({ usage: { completion_tokens: 0 } }, 'openai').usage).toEqual({ outputTokens: 0 })
  })
})
