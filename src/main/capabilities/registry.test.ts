import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { capabilityRegistry } from './registry'

describe('capability registry', () => {
  beforeEach(() => capabilityRegistry.clearForTests())

  it('registers, lists and resolves capability plugins', () => {
    const runtime = { embed: async () => [[1]] }
    capabilityRegistry.register({ id: 'test-embedding', kind: 'embedding', name: 'Test', description: 'test', networkAccess: false, sendsMemoryData: false, requiresConfiguration: false, create: () => runtime })
    const config = { ...DEFAULT_APP_CONFIG, embeddingEnabled: true, embeddingProvider: 'test-embedding' }
    expect(capabilityRegistry.list(config)[0]).toMatchObject({ id: 'test-embedding', active: true, kind: 'embedding' })
    expect(capabilityRegistry.createEmbedding('test-embedding', config)).toBe(runtime)
  })

  it('rejects duplicate ids and missing capabilities', () => {
    const definition = { id: 'test-embedding', kind: 'embedding' as const, name: 'Test', description: 'test', networkAccess: false, sendsMemoryData: false, requiresConfiguration: false, create: () => ({ embed: async () => [[1]] }) }
    capabilityRegistry.register(definition)
    expect(() => capabilityRegistry.register(definition)).toThrow(/already registered/)
    expect(() => capabilityRegistry.createEmbedding('missing', DEFAULT_APP_CONFIG)).toThrow(/未安装/)
  })
})
