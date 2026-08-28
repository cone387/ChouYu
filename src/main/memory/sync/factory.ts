import type { AppConfig } from '../../../shared/config'
import type { MemorySyncAdapter } from './adapter'
import { Mem0MemorySyncAdapter } from './mem0-adapter'

export function createMemorySyncAdapter(config: AppConfig): MemorySyncAdapter {
  if (config.memorySyncProvider !== 'mem0') throw new Error('尚未启用远程记忆适配器。')
  return new Mem0MemorySyncAdapter({
    baseUrl: config.memorySyncBaseUrl,
    apiKey: config.memorySyncApiKey,
    userId: config.memorySyncUserId
  })
}
