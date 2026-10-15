import { streamAIChat } from '../ai'
import type { HarnessAdapter } from './contracts'

export function createLegacyAdapter(model: typeof streamAIChat = streamAIChat): HarnessAdapter {
  return {
    async run(input, emit) {
      let text = '', round = 0
      await model(input.messages, input.systemPrompt, input.config, (chunk) => {
        input.signal.throwIfAborted()
        if (chunk) { text += chunk; emit({ type: 'text', text: chunk, operation: 'append' }) }
      }, input.signal, input.tools, {
        beforeRound: async () => { await input.assertContext(); input.signal.throwIfAborted(); round++; return undefined },
        onMetadata: metadata => { input.onMetadata?.(metadata); emit({ type: 'usage', providerRequestId: `${input.attemptId}:${round}`, metadata }) }
      })
      input.signal.throwIfAborted()
      await input.assertContext()
      return { state: 'completed', text }
    }
  }
}
