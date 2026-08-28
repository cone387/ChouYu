import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG, isAIConfigured, normalizeConfig, sanitizeConfigPatch } from './config'

describe('config', () => {
  it('migrates an old partial config with safe defaults', () => {
    const config = normalizeConfig({ model: 'custom-model', autoStart: true })

    expect(config.model).toBe('custom-model')
    expect(config.baseUrl).toBe('')
    expect(config.autoStart).toBe(true)
    expect(config.proactiveGreeting).toBe(true)
    expect(config.proactiveRestReminder).toBe(true)
    expect(config.clipboardWatch).toBe(false)
    expect(config.aiToolsEnabled).toBe(true)
    expect(config.memoryEnabled).toBe(true)
    expect(config.memoryEngineProvider).toBe('chouyu-sqlite')
    expect(config.memoryMaxItems).toBe(500)
    expect(config.memoryDefaultTtlDays).toBe(0)
    expect(config.memoryCompressionEnabled).toBe(true)
    expect(config.memorySyncProvider).toBe('none')
    expect(config.memorySyncBaseUrl).toBe('https://api.mem0.ai/v1')
    expect(config.embeddingEnabled).toBe(false)
    expect(config.embeddingProvider).toBe('none')
    expect(config.soulMd).toBe(DEFAULT_APP_CONFIG.soulMd)
    expect(isAIConfigured(config)).toBe(false)
    expect(isAIConfigured({ baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model' })).toBe(true)
    expect(normalizeConfig({ memorySyncProvider: 'mem0' }).memorySyncProvider).toBe('mem0-platform')
  })

  it('clamps and aligns pet size to the supported range', () => {
    expect(normalizeConfig({ petSize: 13 }).petSize).toBe(40)
    expect(normalizeConfig({ petSize: 167 }).petSize).toBe(160)
    expect(normalizeConfig({ petSize: 83 }).petSize).toBe(80)
    expect(normalizeConfig({ memoryMaxItems: 12 }).memoryMaxItems).toBe(50)
    expect(normalizeConfig({ memoryDefaultTtlDays: 9999 }).memoryDefaultTtlDays).toBe(3650)
  })

  it('accepts only known patch fields and valid primitive types', () => {
    const patch = sanitizeConfigPatch({
      provider: 'claude',
      autoStart: true,
      petSize: 96,
      aiToolsEnabled: false,
      memoryEnabled: false,
      memoryEngineProvider: 'chouyu-sqlite',
      memoryCompressionEnabled: false,
      memorySyncProvider: 'mem0-self-hosted',
      memorySyncBaseUrl: ' https://mem0.example/v1 ',
      memorySyncApiKey: 'secret',
      memorySyncUserId: ' user-1 ',
      embeddingEnabled: true,
      embeddingProvider: 'openai-compatible',
      unknown: 'ignored',
      model: 123
    })

    expect(patch).toEqual({ provider: 'claude', autoStart: true, petSize: 96, aiToolsEnabled: false, memoryEnabled: false, memoryEngineProvider: 'chouyu-sqlite', memoryCompressionEnabled: false, memorySyncProvider: 'mem0-self-hosted', memorySyncBaseUrl: 'https://mem0.example/v1', memorySyncApiKey: 'secret', memorySyncUserId: 'user-1', embeddingEnabled: true, embeddingProvider: 'openai-compatible' })
  })
})
