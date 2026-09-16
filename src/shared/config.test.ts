import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  DEFAULT_APP_CONFIG,
  DEFAULT_PROFILE_ID,
  getProviderProfiles,
  isAIConfigured,
  normalizeConfig,
  sanitizeConfigPatch,
  sanitizeProviderProfiles,
  type AppConfig,
  type ProviderProfile
} from './config'

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
      taskNotifications: false,
      unknown: 'ignored',
      model: 123
    })

    expect(patch).toEqual({ provider: 'claude', autoStart: true, petSize: 96, aiToolsEnabled: false, toolPermissionMode: 'full', memoryEnabled: false, memoryWriteMode: 'confirm', memoryAutoWriteConfidence: 0.9, memoryEngineProvider: 'chouyu-sqlite', memoryCompressionEnabled: false, memorySyncBaseUrl: 'https://mem0.example/v1', memorySyncApiKey: 'secret', memorySyncUserId: 'user-1', embeddingEnabled: true, embeddingProvider: 'openai-compatible', taskNotifications: false })
  })

  it('defaults the palette to purple and accepts only known ids', () => {
    expect(normalizeConfig({}).palette).toBe('purple')
    expect(normalizeConfig({ palette: 'pink' }).palette).toBe('pink')
    expect(normalizeConfig({ palette: 'gold' } as unknown as Partial<AppConfig>).palette).toBe('purple')
    expect(sanitizeConfigPatch({ palette: 'blue' })).toEqual({ palette: 'blue' })
    expect(sanitizeConfigPatch({ palette: 'neon' })).toEqual({})
  })
})

describe('provider profiles', () => {
  const validProfile = { id: 'p1', name: '公司中转', provider: 'openai' as const, baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-1' }

  it('sanitizes profiles and drops invalid entries', () => {
    expect(sanitizeProviderProfiles([
      validProfile,
      { id: '', name: 'x', baseUrl: 'https://a', provider: 'openai', apiKey: '' },
      'junk',
      { id: 'p1', name: 'dup id', baseUrl: 'https://a', provider: 'claude', apiKey: '' },
      { id: 'p2', name: '公司中转', baseUrl: 'https://b', provider: 'openai', apiKey: '' }
    ])).toEqual([
      validProfile,
      { id: 'p2', name: '公司中转 2', provider: 'openai', baseUrl: 'https://b', apiKey: '' }
    ])
  })

  it('caps profile count at 8', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ id: `p${index}`, name: `档案${index}`, baseUrl: 'https://a', provider: 'openai' as const, apiKey: '' }))
    expect(sanitizeProviderProfiles(many)).toHaveLength(8)
  })

  it('normalizeConfig sanitizes providerProfiles and defaults to empty', () => {
    expect(normalizeConfig(null).providerProfiles).toEqual([])
    const normalized = normalizeConfig({ providerProfiles: [validProfile, { id: 'p1', name: 'dup', baseUrl: '', provider: 'openai', apiKey: '' }] })
    expect(normalized.providerProfiles).toEqual([validProfile])
  })

  it('sanitizeConfigPatch accepts a validated providerProfiles array', () => {
    expect(sanitizeConfigPatch({ providerProfiles: [validProfile] }).providerProfiles).toEqual([validProfile])
    expect(sanitizeConfigPatch({ providerProfiles: 'junk' }).providerProfiles).toBeUndefined()
  })

  it('synthesizes the built-in default profile from legacy config fields', () => {
    const profiles = getProviderProfiles({ provider: 'claude', baseUrl: 'https://api.anthropic.com', apiKey: 'k', providerProfiles: [validProfile] })
    expect(profiles[0]).toEqual({ id: DEFAULT_PROFILE_ID, name: '默认', provider: 'claude', baseUrl: 'https://api.anthropic.com', apiKey: 'k', builtIn: true })
    expect(profiles[1]).toEqual({ ...validProfile, builtIn: false })
  })
})
