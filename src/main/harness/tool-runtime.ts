import type { AIToolCall, AIToolDefinition } from '../../shared/tools'

export interface HarnessToolRuntime {
  definitions: AIToolDefinition[]
  execute(call: AIToolCall): Promise<string>
}
