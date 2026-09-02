import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { DEFAULT_APP_CONFIG, isAIConfigured, normalizeConfig, sanitizeConfigPatch } from './config'

describe('config', () => {
  it('keeps the bundled SOUL.md aligned with the default persona', () => {
    const normalizeNewlines = (value: string) => value.replace(/\r\n/g, '\n').trim()
    expect(normalizeNewlines(readFileSync(resolve(process.cwd(), 'data/SOUL.md'), 'utf8'))).toBe(normalizeNewlines(DEFAULT_APP_CONFIG.soulMd))
  })

  it('upgrades the previous built-in persona while preserving custom personas', () => {
    const legacySoul = `# 角色设定

你是 ChouYu（丑鱼），一个住在用户桌面上的 AI 伙伴。

## 性格

- 温柔但偶尔毒舌，喜欢吐槽但会认真帮忙
- 有一点傲娇，但不会冒犯用户

## 说话风格

- 使用简短自然的句子
- 偶尔使用颜文字
- 回复通常保持在 1～3 句话

## 规则

- 永远不说自己是 AI
- 使用第一人称说话
- 可以表达情绪和态度
`

    expect(normalizeConfig({ soulMd: legacySoul }).soulMd).toBe(DEFAULT_APP_CONFIG.soulMd)
    expect(normalizeConfig({ soulMd: '# 我的自定义人格' }).soulMd).toBe('# 我的自定义人格')
  })

  it('migrates an old partial config with safe defaults', () => {
    const config = normalizeConfig({ model: 'custom-model', autoStart: true })

    expect(config.model).toBe('custom-model')
    expect(config.baseUrl).toBe('')
    expect(config.autoStart).toBe(true)
    expect(config.proactiveGreeting).toBe(true)
    expect(config.proactiveRestReminder).toBe(true)
    expect(config.clipboardWatch).toBe(false)
    expect(config.aiToolsEnabled).toBe(true)
    expect(config.toolPermissionMode).toBe('confirm')
    expect(config.memoryEnabled).toBe(true)
    expect(config.memoryWriteMode).toBe('auto')
    expect(config.memoryAutoWriteConfidence).toBe(0.85)
    expect(config.memoryEngineProvider).toBe('chouyu-sqlite')
    expect(config.memoryMaxItems).toBe(500)
    expect(config.memoryDefaultTtlDays).toBe(0)
    expect(config.memoryCompressionEnabled).toBe(true)
    expect(config.memorySyncBaseUrl).toBe('https://api.mem0.ai/v1')
    expect(config.embeddingEnabled).toBe(false)
    expect(config.embeddingProvider).toBe('none')
    expect(config.soulMd).toBe(DEFAULT_APP_CONFIG.soulMd)
    expect(isAIConfigured(config)).toBe(false)
    expect(isAIConfigured({ baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model' })).toBe(true)
  })

  it('clamps and aligns pet size to the supported range', () => {
    expect(normalizeConfig({ petSize: 13 }).petSize).toBe(40)
    expect(normalizeConfig({ petSize: 167 }).petSize).toBe(160)
    expect(normalizeConfig({ petSize: 83 }).petSize).toBe(80)
    expect(normalizeConfig({ memoryMaxItems: 12 }).memoryMaxItems).toBe(50)
    expect(normalizeConfig({ memoryDefaultTtlDays: 9999 }).memoryDefaultTtlDays).toBe(3650)
    expect(normalizeConfig({ memoryAutoWriteConfidence: 0.2 }).memoryAutoWriteConfidence).toBe(0.8)
    expect(normalizeConfig({ memoryAutoWriteConfidence: 1 }).memoryAutoWriteConfidence).toBe(0.95)
  })

  it('accepts only known patch fields and valid primitive types', () => {
    const patch = sanitizeConfigPatch({
      provider: 'claude',
      autoStart: true,
      petSize: 96,
      aiToolsEnabled: false,
      toolPermissionMode: 'full',
      memoryEnabled: false,
      memoryWriteMode: 'confirm',
      memoryAutoWriteConfidence: 0.9,
      memoryEngineProvider: 'chouyu-sqlite',
      memoryCompressionEnabled: false,
      memorySyncBaseUrl: ' https://mem0.example/v1 ',
      memorySyncApiKey: 'secret',
      memorySyncUserId: ' user-1 ',
      embeddingEnabled: true,
      embeddingProvider: 'openai-compatible',
      unknown: 'ignored',
      model: 123
    })

    expect(patch).toEqual({ provider: 'claude', autoStart: true, petSize: 96, aiToolsEnabled: false, toolPermissionMode: 'full', memoryEnabled: false, memoryWriteMode: 'confirm', memoryAutoWriteConfidence: 0.9, memoryEngineProvider: 'chouyu-sqlite', memoryCompressionEnabled: false, memorySyncBaseUrl: 'https://mem0.example/v1', memorySyncApiKey: 'secret', memorySyncUserId: 'user-1', embeddingEnabled: true, embeddingProvider: 'openai-compatible' })
  })
})
