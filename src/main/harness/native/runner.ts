import type { AIChatMessage } from '../../../shared/ai'
import type { AppConfig } from '../../../shared/config'
import type { HarnessToolRuntime } from '../tool-runtime'
import type { NativeRoundResult, NativeStreamCallback, NativeStreamOptions } from './types'
import { createOpenAIConversation } from './providers/openai'
import { createClaudeConversation } from './providers/claude'

export async function streamNativeChat(messages: AIChatMessage[], systemPrompt: string, config: AppConfig, onChunk: NativeStreamCallback,
  signal?: AbortSignal, tools?: HarnessToolRuntime, options: NativeStreamOptions = {}): Promise<void> {
  signal?.throwIfAborted()
  if (!config.baseUrl.trim()) {
    throw new Error('尚未配置 Base URL，请先打开设置完成配置。')
  }
  if (!config.apiKey.trim()) {
    throw new Error('尚未配置 API Key，请先打开设置完成配置。')
  }
  if (!config.model.trim()) {
    throw new Error('尚未配置模型，请先在设置或模型菜单中选择模型。')
  }

  const conversation = (config.provider === 'claude' ? createClaudeConversation : createOpenAIConversation)(messages, systemPrompt, tools?.definitions)
  const chunk: NativeStreamCallback = (text, done) => { signal?.throwIfAborted(); onChunk(text, done) }
  for (let round = 0; round < 6; round++) {
    signal?.throwIfAborted()
    const maxOutputTokens = await options.beforeRound?.(round, conversation.serialize()) ?? options.maxOutputTokens
    let result: NativeRoundResult
    try {
      signal?.throwIfAborted()
      result = await conversation.request(config, chunk, signal, { ...options, maxOutputTokens })
    } finally { await options.afterRound?.() }
    signal?.throwIfAborted()
    if (!result.toolCalls.length || !tools) { chunk('', true); return }
    const results: string[] = []
    for (const call of result.toolCalls) {
      signal?.throwIfAborted()
      results.push(await tools.execute(call))
      signal?.throwIfAborted()
    }
    conversation.append(result, results)
  }
  throw new Error('工具调用次数超过安全上限。')
}
