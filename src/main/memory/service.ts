import { app } from 'electron'
import path from 'path'
import { SQLiteMemoryProvider } from './sqlite-provider'
import type { MemoryProvider } from './provider'

let provider: MemoryProvider | null = null

export function initializeMemory(): void {
  if (provider) return
  provider = new SQLiteMemoryProvider(path.join(app.getPath('userData'), 'chouyu-memory.db'))
  provider.initialize()
}

export function getMemoryProvider(): MemoryProvider {
  if (!provider) throw new Error('Memory service is not initialized')
  return provider
}

export function closeMemory(): void {
  provider?.close()
  provider = null
}
