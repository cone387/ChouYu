import type { AIChatMessage } from '../../shared/ai'
import type { AppConfig } from '../../shared/config'
import type { BackgroundHarnessInput } from './contracts'
import type { HarnessToolRuntime } from './tool-runtime'
import { createNativeModule } from './native'
const systemModel = createNativeModule().background!
/** Fixed native system interpretation/assistant work. Contact execution selects its own engine via the registry. */
export function streamSystemModel(messages: AIChatMessage[], systemPrompt: string, config: AppConfig,
  onChunk: BackgroundHarnessInput['onChunk'], signal: AbortSignal = new AbortController().signal, tools?: HarnessToolRuntime, options?: BackgroundHarnessInput['options']) {
  return systemModel.run({ messages, systemPrompt, config, onChunk, signal, tools, options })
}
