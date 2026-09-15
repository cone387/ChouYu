import type { AppConfig } from './config'
import { DEFAULT_PROFILE_ID, DEFAULT_SOUL_MD, getProviderProfiles, isAIConfigured } from './config'

export const DEFAULT_CHARACTER_ID = 'chouyu'
export const DEFAULT_CHARACTER_NAME = '丑鱼'
export const MAX_CHARACTER_NAME_LENGTH = 24
export const MAX_CHARACTER_COUNT = 12

/** 按 Unicode 码点截断，避免把 emoji 等代理对从中间切开。 */
function clampCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('')
}

export interface Character {
  id: string
  name: string
  avatar: string
  soulMd: string
  providerProfileId: string
  model: string
  builtIn: boolean
  createdAt: number
  updatedAt: number
}

export interface CharacterStats extends Character {
  sessionCount: number
  lastActiveAt: number
}

export interface CharacterDraft {
  name: string
  avatar: string
  soulMd: string
  providerProfileId: string
  model: string
}

export function isDefaultCharacter(id: string): boolean {
  return id === DEFAULT_CHARACTER_ID
}

export function sanitizeCharacterDraft(value: unknown): CharacterDraft | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const name = typeof input.name === 'string' ? clampCodePoints(input.name.replace(/\s+/g, ' ').trim(), MAX_CHARACTER_NAME_LENGTH) : ''
  if (!name) return null
  const model = typeof input.model === 'string' ? input.model.trim().slice(0, 256) : ''
  if (!model) return null
  const providerProfileId = typeof input.providerProfileId === 'string' && input.providerProfileId.trim()
    ? input.providerProfileId.trim().slice(0, 128)
    : DEFAULT_PROFILE_ID
  const avatar = typeof input.avatar === 'string' && input.avatar.trim() ? clampCodePoints(input.avatar.trim(), 8) : Array.from(name)[0] ?? ''
  const soulMd = typeof input.soulMd === 'string' ? input.soulMd.slice(0, 50_000) : ''
  return { name, avatar, soulMd, providerProfileId, model }
}

export function createDefaultCharacter(now = Date.now()): Character {
  return {
    id: DEFAULT_CHARACTER_ID,
    name: DEFAULT_CHARACTER_NAME,
    avatar: '🐟',
    soulMd: '',
    providerProfileId: DEFAULT_PROFILE_ID,
    model: '',
    builtIn: true,
    createdAt: now,
    updatedAt: now
  }
}

/** 内置角色是人设/模型的实时视图：仅保留 name/avatar 编辑，其余字段运行期解析。 */
export function normalizeCharacters(value: unknown): Character[] {
  const items: Record<string, unknown>[] = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object') items.push(item as Record<string, unknown>)
    }
  }
  let defaultCharacter = createDefaultCharacter()
  for (const input of items) {
    const id = typeof input.id === 'string' ? input.id.trim().slice(0, 128) : ''
    if (!id || !isDefaultCharacter(id)) continue
    const name = typeof input.name === 'string' && input.name.trim()
      ? clampCodePoints(input.name.replace(/\s+/g, ' ').trim(), MAX_CHARACTER_NAME_LENGTH)
      : DEFAULT_CHARACTER_NAME
    const avatar = typeof input.avatar === 'string' && input.avatar.trim() ? clampCodePoints(input.avatar.trim(), 8) : defaultCharacter.avatar
    defaultCharacter = { ...defaultCharacter, name, avatar }
  }
  const names = new Set<string>([defaultCharacter.name])
  const ids = new Set<string>([DEFAULT_CHARACTER_ID])
  const custom: Character[] = []
  const now = Date.now()
  for (const input of items) {
    const id = typeof input.id === 'string' ? input.id.trim().slice(0, 128) : ''
    if (!id || isDefaultCharacter(id)) continue
    if (ids.has(id)) continue
    const draft = sanitizeCharacterDraft(input)
    if (!draft) continue
    let characterName = draft.name
    let suffix = 2
    while (names.has(characterName)) characterName = `${draft.name} ${suffix++}`
    names.add(characterName)
    ids.add(id)
    const createdAt = typeof input.createdAt === 'number' && Number.isFinite(input.createdAt) ? input.createdAt : now
    const updatedAt = typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : createdAt
    custom.push({ id, ...draft, name: characterName, builtIn: false, createdAt, updatedAt })
    if (custom.length >= MAX_CHARACTER_COUNT - 1) break
  }
  return [defaultCharacter, ...custom]
}

export interface EffectiveChatConfig {
  provider: 'openai' | 'claude'
  baseUrl: string
  apiKey: string
  model: string
  soulMd: string
}

export type CharacterResolution = { ok: true; config: EffectiveChatConfig } | { ok: false; error: string }

export function resolveCharacterConfig(character: Character | undefined | null, config: AppConfig): CharacterResolution {
  if (!character || isDefaultCharacter(character.id)) {
    if (!isAIConfigured(config)) {
      return { ok: false, error: '默认角色使用设置页的 AI 配置，请先完成 Base URL、API Key 和模型设置。' }
    }
    return {
      ok: true,
      config: { provider: config.provider, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, soulMd: config.soulMd }
    }
  }
  const profile = getProviderProfiles(config).find((item) => item.id === character.providerProfileId)
  if (!profile) return { ok: false, error: `角色「${character.name}」引用的供应商档案已不存在，请在通讯录中重新选择。` }
  if (!profile.baseUrl.trim() || !profile.apiKey.trim()) {
    return { ok: false, error: `档案「${profile.name}」缺少 Base URL 或 API Key，请到设置页补全。` }
  }
  if (!character.model.trim()) return { ok: false, error: `角色「${character.name}」尚未设置模型，请在通讯录中补全。` }
  return {
    ok: true,
    config: { provider: profile.provider, baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: character.model, soulMd: character.soulMd || DEFAULT_SOUL_MD }
  }
}
