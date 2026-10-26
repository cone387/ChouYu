import type { AppConfig } from '../../../shared/config'
import type { AIResponseMetadata } from '../../../shared/ai-usage'
import type { AIToolCall } from '../../../shared/tools'

export type NativeStreamCallback = (chunk: string, done: boolean) => void
// Explicit timeout is a round deadline; interactive streams use an inactivity deadline.
export interface NativeStreamOptions {
  timeoutMs?: number
  maxOutputTokens?: number
  onMetadata?(metadata: AIResponseMetadata): void
  beforeRound?(round: number, input: string): number | undefined | Promise<number | undefined>
  afterRound?(): void | Promise<void>
}
export interface NativeRoundResult { text: string; toolCalls: AIToolCall[] }
export interface NativeConversation {
  serialize(): string
  request(config: AppConfig, onChunk: NativeStreamCallback, signal: AbortSignal | undefined, options: NativeStreamOptions): Promise<NativeRoundResult>
  append(result: NativeRoundResult, results: string[]): void
}
