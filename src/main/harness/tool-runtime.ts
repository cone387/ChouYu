import type { AIToolCall, AIToolDefinition, ToolExecutionEvent } from '../../shared/tools'

export interface HarnessToolRuntime {
  definitions: AIToolDefinition[]
  execute(call: AIToolCall): Promise<string>
  subscribe?(listener: (event: ToolExecutionEvent) => void): () => void
}
