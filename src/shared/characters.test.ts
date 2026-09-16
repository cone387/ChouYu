import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG, DEFAULT_SOUL_MD, type AppConfig } from './config'
import {
  DEFAULT_CHARACTER_ID, MAX_CHARACTER_COUNT, Character, CharacterDraft,
  createDefaultCharacter, isDefaultCharacter, normalizeCharacters,
  resolveCharacterConfig, sanitizeCharacterDraft
} from './characters'

const baseConfig: AppConfig = { ...DEFAULT_APP_CONFIG, baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'gpt-test' }

const customCharacter: Character = {
  id: 'c1', name: '小猫', avatar: '🐱', soulMd: '# 小猫人设',
  providerProfileId: 'default', model: 'claude-test', builtIn: false,
  createdAt: 1, updatedAt: 2
}

describe('sanitizeCharacterDraft', () => {
  it('requires name and model and fills defaults', () => {
    expect(sanitizeCharacterDraft({ name: ' 小猫 ', model: ' m1 ', soulMd: 'x', providerProfileId: 'default' }))
      .toEqual({ name: '小猫', avatar: '小', soulMd: 'x', providerProfileId: 'default', model: 'm1' })
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
    expect(characters.slice(1).map((c) => c.name)).toEqual(['小猫', '小猫 2'])
  })
  it('caps characters at the limit', () => {
    const many = Array.from({ length: MAX_CHARACTER_COUNT + 3 }, (_, index) => ({
      id: `c${index}`, name: `角色${index}`, model: 'm', providerProfileId: 'default'
    }))
    expect(normalizeCharacters(many)).toHaveLength(MAX_CHARACTER_COUNT)
  })
  it('suffixes a custom name colliding with a renamed default, in either order', () => {
    const renamedDefault = { id: DEFAULT_CHARACTER_ID, name: '小鱼干', avatar: '🐠', model: 'ignored', providerProfileId: 'default' }
    const sameNameCustom = { id: 'c1', name: '小鱼干', model: 'm', providerProfileId: 'default' }
    const defaultLast = normalizeCharacters([sameNameCustom, renamedDefault])
    expect(defaultLast.map((c) => c.name)).toEqual(['小鱼干', '小鱼干 2'])
    const defaultFirst = normalizeCharacters([renamedDefault, sameNameCustom])
    expect(defaultFirst.map((c) => c.name)).toEqual(['小鱼干', '小鱼干 2'])
  })
  it('returns a single default entry for non-array input', () => {
    for (const junk of [undefined, 'junk']) {
      const characters = normalizeCharacters(junk)
      expect(characters).toHaveLength(1)
      expect(characters[0]).toMatchObject({ id: DEFAULT_CHARACTER_ID, builtIn: true })
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
