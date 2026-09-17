import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG, DEFAULT_SOUL_MD, type AppConfig } from './config'
import {
  ASSISTANT_CHARACTER_ID, ASSISTANT_SOUL_MD, DEFAULT_CHARACTER_ID, INDUSTRIES, INDUSTRY_LABELS,
  MAX_CHARACTER_COUNT, PRESET_CHARACTERS, Character, CharacterDraft,
  createAssistantCharacter, createDefaultCharacter, isDefaultCharacter, normalizeCharacters,
  resolveCharacterConfig, sanitizeCharacterDraft
} from './characters'

const baseConfig: AppConfig = { ...DEFAULT_APP_CONFIG, baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'gpt-test' }

const customCharacter: Character = {
  id: 'c1', name: '小猫', avatar: '🐱', category: '', soulMd: '# 小猫人设',
  providerProfileId: 'default', model: 'claude-test', builtIn: false,
  createdAt: 1, updatedAt: 2
}

describe('sanitizeCharacterDraft', () => {
  it('requires name and model and fills defaults', () => {
    expect(sanitizeCharacterDraft({ name: ' 小猫 ', model: ' m1 ', soulMd: 'x', providerProfileId: 'default' }))
      .toEqual({ name: '小猫', avatar: '小', category: '', soulMd: 'x', providerProfileId: 'default', model: 'm1' })
  })
  it('rejects missing name or model', () => {
    expect(sanitizeCharacterDraft({ name: '', model: 'm' })).toBeNull()
    expect(sanitizeCharacterDraft({ name: 'a', model: '' })).toBeNull()
    expect(sanitizeCharacterDraft('junk')).toBeNull()
  })
  it('keeps the full emoji when deriving the avatar from an astral name', () => {
    const draft = sanitizeCharacterDraft({ name: '🐱猫', model: 'm' })
    expect(draft?.avatar).toBe('🐱')
    expect(draft?.avatar.length).toBe(2)
  })
  it('keeps a known industry category and drops unknown values', () => {
    expect(sanitizeCharacterDraft({ name: '小猫', model: 'm', category: 'tech' })?.category).toBe('tech')
    expect(sanitizeCharacterDraft({ name: '小猫', model: 'm', category: 'nope' })?.category).toBe('')
    expect(sanitizeCharacterDraft({ name: '小猫', model: 'm' })?.category).toBe('')
  })
})

describe('industries', () => {
  it('offers a multi-industry catalog with unique ids and labels', () => {
    expect(INDUSTRIES.length).toBeGreaterThanOrEqual(8)
    expect(new Set(INDUSTRIES.map((industry) => industry.id)).size).toBe(INDUSTRIES.length)
    expect(new Set(INDUSTRIES.map((industry) => industry.label)).size).toBe(INDUSTRIES.length)
    for (const industry of INDUSTRIES) {
      expect(industry.id).toMatch(/^[a-z]+$/)
      expect(industry.label.length).toBeGreaterThanOrEqual(2)
      expect(INDUSTRY_LABELS[industry.id]).toBe(industry.label)
    }
  })
})

describe('preset characters', () => {
  it('ships ten-plus industry presets with unique ids, names, avatars and personas', () => {
    expect(PRESET_CHARACTERS.length).toBeGreaterThanOrEqual(10)
    const ids = new Set(PRESET_CHARACTERS.map((preset) => preset.id))
    const names = new Set(PRESET_CHARACTERS.map((preset) => preset.name))
    expect(ids.size).toBe(PRESET_CHARACTERS.length)
    expect(names.size).toBe(PRESET_CHARACTERS.length)
    for (const preset of PRESET_CHARACTERS) {
      expect(preset.id).toMatch(/^preset-/)
      expect(Array.from(preset.avatar).length).toBeGreaterThanOrEqual(1)
      expect(preset.name.length).toBeLessThanOrEqual(24)
      expect(preset.soulMd.trim().length).toBeGreaterThan(10)
      expect(preset.category in INDUSTRY_LABELS).toBe(true)
    }
    // 每个行业至少有一个预设，保证行业 tab 不落空。
    for (const industry of INDUSTRIES) {
      expect(PRESET_CHARACTERS.some((preset) => preset.category === industry.id)).toBe(true)
    }
  })
  it('normalizes seeded presets as regular editable characters', () => {
    const seeded = PRESET_CHARACTERS.map((preset) => ({
      ...preset, model: 'gpt-test', providerProfileId: 'default', builtIn: false, createdAt: 1, updatedAt: 1
    }))
    const characters = normalizeCharacters(seeded)
    expect(characters[0]?.id).toBe(DEFAULT_CHARACTER_ID)
    expect(characters).toHaveLength(PRESET_CHARACTERS.length + 2)
    for (const preset of PRESET_CHARACTERS) {
      const match = characters.find((character) => character.id === preset.id)
      expect(match).toMatchObject({ name: preset.name, avatar: preset.avatar, category: preset.category, soulMd: preset.soulMd, builtIn: false })
    }
  })
})

describe('normalizeCharacters', () => {
  it('always keeps the built-in default first and preserves its name/avatar edits', () => {
    const characters = normalizeCharacters([
      { id: DEFAULT_CHARACTER_ID, name: '小鱼干', avatar: '🐠', soulMd: 'ignored', model: 'ignored', providerProfileId: 'default' },
      { ...customCharacter },
      { id: 'c1', name: 'dup id', model: 'm', providerProfileId: 'default' },
      { id: 'c2', name: '小猫', model: 'm2', providerProfileId: 'default' }
    ])
    expect(characters[0]).toMatchObject({ id: DEFAULT_CHARACTER_ID, name: '小鱼干', avatar: '🐠', builtIn: true })
    expect(characters.slice(2).map((c) => c.name)).toEqual(['小猫', '小猫 2'])
  })
  it('caps characters at the limit', () => {
    const many = Array.from({ length: MAX_CHARACTER_COUNT + 3 }, (_, index) => ({
      id: `c${index}`, name: `角色${index}`, model: 'm', providerProfileId: 'default'
    }))
    expect(normalizeCharacters(many)).toHaveLength(MAX_CHARACTER_COUNT + 1)
  })
  it('suffixes a custom name colliding with a renamed default, in either order', () => {
    const renamedDefault = { id: DEFAULT_CHARACTER_ID, name: '小鱼干', avatar: '🐠', model: 'ignored', providerProfileId: 'default' }
    const sameNameCustom = { id: 'c1', name: '小鱼干', model: 'm', providerProfileId: 'default' }
    const defaultLast = normalizeCharacters([sameNameCustom, renamedDefault])
    expect(defaultLast.map((c) => c.name)).toEqual(['小鱼干', '助手', '小鱼干 2'])
    const defaultFirst = normalizeCharacters([renamedDefault, sameNameCustom])
    expect(defaultFirst.map((c) => c.name)).toEqual(['小鱼干', '助手', '小鱼干 2'])
  })
  it('returns a single default entry for non-array input', () => {
    for (const junk of [undefined, 'junk']) {
      const characters = normalizeCharacters(junk)
      expect(characters).toHaveLength(2)
      expect(characters[0]).toMatchObject({ id: DEFAULT_CHARACTER_ID, builtIn: true })
      expect(characters[1]).toMatchObject({ id: ASSISTANT_CHARACTER_ID, builtIn: true })
    }
  })
})

describe('resolveCharacterConfig', () => {
  it('resolves the default character live from global config', () => {
    const result = resolveCharacterConfig(createDefaultCharacter(), baseConfig)
    expect(result).toEqual({
      ok: true,
      config: { provider: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'gpt-test', soulMd: DEFAULT_SOUL_MD }
    })
  })
  it('reports unconfigured global config for the default character', () => {
    const result = resolveCharacterConfig(undefined, DEFAULT_APP_CONFIG)
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain('设置页')
  })
  it('resolves a custom character through its profile', () => {
    const config = { ...baseConfig, providerProfiles: [{ id: 'p1', name: '中转', provider: 'claude' as const, baseUrl: 'https://relay', apiKey: 'rk' }] }
    const character = { ...customCharacter, providerProfileId: 'p1' }
    const result = resolveCharacterConfig(character, config)
    expect(result).toEqual({
      ok: true,
      config: { provider: 'claude', baseUrl: 'https://relay', apiKey: 'rk', model: 'claude-test', soulMd: '# 小猫人设' }
    })
  })
  it('errors when the referenced profile is missing or incomplete', () => {
    const missing = resolveCharacterConfig({ ...customCharacter, providerProfileId: 'p1' }, baseConfig)
    expect(missing.ok).toBe(false)
    expect((missing as { error: string }).error).toContain('供应商档案')
    const emptyProfile = resolveCharacterConfig({ ...customCharacter, providerProfileId: 'p1' }, { ...baseConfig, providerProfiles: [{ id: 'p1', name: 'x', provider: 'openai', baseUrl: '', apiKey: '' }] })
    expect(emptyProfile.ok).toBe(false)
  })
  it('falls back to the default soul when a custom character has none', () => {
    const result = resolveCharacterConfig({ ...customCharacter, soulMd: '' }, baseConfig)
    expect(result.ok && result.config.soulMd).toBe(DEFAULT_SOUL_MD)
  })
  it('errors when a custom character has a blank model', () => {
    const result = resolveCharacterConfig({ ...customCharacter, model: '   ' }, baseConfig)
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain('尚未设置模型')
  })
  it('isDefaultCharacter matches only the built-in id', () => {
    expect(isDefaultCharacter(DEFAULT_CHARACTER_ID)).toBe(true)
    expect(isDefaultCharacter('c1')).toBe(false)
  })
})

describe('assistant character', () => {
  it('always seeds the assistant second, outside the custom cap', () => {
    const characters = normalizeCharacters(undefined)
    expect(characters).toHaveLength(2)
    expect(characters[1]).toMatchObject({ id: ASSISTANT_CHARACTER_ID, name: '助手', avatar: '🔔', builtIn: true, soulMd: ASSISTANT_SOUL_MD })
    const many = Array.from({ length: MAX_CHARACTER_COUNT + 3 }, (_, index) => ({
      id: `c${index}`, name: `角色${index}`, model: 'm', providerProfileId: 'default'
    }))
    const capped = normalizeCharacters(many)
    expect(capped.filter((character) => !character.builtIn)).toHaveLength(MAX_CHARACTER_COUNT - 1)
    expect(capped.some((character) => character.id === ASSISTANT_CHARACTER_ID)).toBe(true)
  })
  it('drops tampered or duplicate assistant entries from persisted data', () => {
    const characters = normalizeCharacters([
      { id: ASSISTANT_CHARACTER_ID, name: '改名', avatar: '😈', soulMd: 'x', model: 'm', providerProfileId: 'default' },
      { id: ASSISTANT_CHARACTER_ID, name: '再来', model: 'm', providerProfileId: 'default' },
      { ...customCharacter }
    ])
    expect(characters).toHaveLength(3)
    expect(characters[1]).toMatchObject({ name: '助手', avatar: '🔔', soulMd: ASSISTANT_SOUL_MD })
  })
  it('suffixes a custom character colliding with the assistant name', () => {
    const characters = normalizeCharacters([{ ...customCharacter, name: '助手' }])
    expect(characters.slice(2).map((character) => character.name)).toEqual(['助手 2'])
  })
  it('resolves the assistant live from global config with its own soul', () => {
    const resolved = resolveCharacterConfig(createAssistantCharacter(), baseConfig)
    expect(resolved).toEqual({
      ok: true,
      config: { provider: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'gpt-test', soulMd: ASSISTANT_SOUL_MD }
    })
    const unconfigured = resolveCharacterConfig(createAssistantCharacter(), DEFAULT_APP_CONFIG)
    expect(unconfigured.ok).toBe(false)
    expect((unconfigured as { error: string }).error).toContain('设置页')
  })
})
