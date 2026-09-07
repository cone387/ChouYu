import { createHash } from 'crypto'
import type { AppConfig } from '../../shared/config'

/** Credentials can rotate without changing the owner of a cache. */
export function memoryConnectionScope(config: AppConfig): string {
  const engine = config.memoryEngineProvider
  if (engine !== 'mem0-platform-engine' && engine !== 'mem0-self-hosted-engine') return engine
  let endpoint = config.memorySyncBaseUrl.trim().replace(/\/+$/, '')
  try { endpoint = new URL(endpoint).toString().replace(/\/+$/, '') } catch { /* Validation reports invalid URLs at request time. */ }
  return createHash('sha256').update(JSON.stringify([engine, endpoint, config.memorySyncUserId])).digest('hex')
}
