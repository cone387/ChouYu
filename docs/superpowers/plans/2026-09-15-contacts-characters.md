# AI 角色与通讯录（一期）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ChouYu 增加多 AI 角色（人设 + 各自模型档案）与工作区「通讯录」页：浏览/搜索/管理角色，点击角色进入该角色专属会话聊天。

**Architecture:** 供应商档案存 `AppConfig.providerProfiles`（首个「默认」档案为 legacy 全局配置的实时视图）；角色存 JSON 主库 `StoreData.characters`（内置不可删的「丑鱼」为全局配置的实时视图）；会话加 `characterId` 归属；聊天时渲染层把 `characterId` 随 `AIStreamRequest` 传给主进程，主进程解析出有效 provider/baseUrl/apiKey/model/soulMd，key 不进渲染进程新路径。

**Tech Stack:** Electron + React 18 + TypeScript（electron-vite）、Vitest、better-sqlite3 不涉及（复用 JSON 主库）。

**基点说明（重要）:** 本分支基于本地 master `92d3411`，**没有任务模块**。spec 中引用的 tasks 先例全部替换为 journal/memory 先例；通讯录导航位次为「会话」之后（spec 写「会话/任务之间」基于含任务模块的旧工作区）。spec: `docs/superpowers/specs/2026-09-15-contacts-characters-design.md`。

**门禁:** 每任务 `npx vitest --run <file>` + `npm run typecheck`；Task 10 跑全量 vitest、生产构建、Electron 冒烟。

---

### Task 1: 供应商档案类型与档案列表合成（shared/config）

**Files:**
- Modify: `src/shared/config.ts`
- Test: `src/shared/config.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/shared/config.test.ts` 末尾追加（文件已存在，沿用其现有 import；若未导入新符号则补充）：

```ts
import {
  DEFAULT_PROFILE_ID,
  getProviderProfiles,
  sanitizeProviderProfiles,
  type ProviderProfile
} from './config'

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
```

注意：若 `config.test.ts` 已从 `./config` 具名导入，把新符号并入现有 import 语句，不要重复 import。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest --run src/shared/config.test.ts`
Expected: FAIL（`DEFAULT_PROFILE_ID` 等导出不存在，编译报错或断言失败）

- [ ] **Step 3: 实现**

`src/shared/config.ts` 三处修改：

(1) 接口与常量——加在 `AppConfig` 定义之前：

```ts
export interface ProviderProfile {
  id: string
  name: string
  provider: 'openai' | 'claude'
  baseUrl: string
  apiKey: string
}

export const DEFAULT_PROFILE_ID = 'default'
export const MAX_PROVIDER_PROFILES = 8

export interface ResolvedProviderProfile extends ProviderProfile {
  builtIn: boolean
}
```

(2) `AppConfig` 增加 `providerProfiles: ProviderProfile[]`（放在 `soulMd: string` 之前）；`DEFAULT_APP_CONFIG` 增加 `providerProfiles: []`（同样放在 `soulMd` 行前）。

(3) 档案工具函数——加在 `isAIConfigured` 之前：

```ts
export function sanitizeProviderProfile(value: unknown): ProviderProfile | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const id = typeof input.id === 'string' ? input.id.trim().slice(0, 128) : ''
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 64) : ''
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim().slice(0, 2048) : ''
  if (!id || id === DEFAULT_PROFILE_ID || !name || !baseUrl) return null
  return {
    id,
    name,
    provider: input.provider === 'claude' ? 'claude' : 'openai',
    baseUrl,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey.slice(0, 8192) : ''
  }
}

export function sanitizeProviderProfiles(value: unknown): ProviderProfile[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>([DEFAULT_PROFILE_ID])
  const names = new Set<string>()
  const profiles: ProviderProfile[] = []
  for (const item of value) {
    const profile = sanitizeProviderProfile(item)
    if (!profile || ids.has(profile.id)) continue
    let name = profile.name
    let suffix = 2
    while (names.has(name)) name = `${profile.name} ${suffix++}`
    ids.add(profile.id)
    names.add(name)
    profiles.push({ ...profile, name })
    if (profiles.length >= MAX_PROVIDER_PROFILES) break
  }
  return profiles
}

export function getProviderProfiles(config: Pick<AppConfig, 'provider' | 'baseUrl' | 'apiKey' | 'providerProfiles'>): ResolvedProviderProfile[] {
  return [
    { id: DEFAULT_PROFILE_ID, name: '默认', provider: config.provider, baseUrl: config.baseUrl, apiKey: config.apiKey, builtIn: true },
    ...config.providerProfiles.map((profile) => ({ ...profile, builtIn: false }))
  ]
}
```

(4) `normalizeConfig` 返回对象中（`soulMd` 之后加一行）：

```ts
    providerProfiles: sanitizeProviderProfiles(source.providerProfiles),
```

(5) `sanitizeConfigPatch` 末尾 `return patch` 之前加：

```ts
  if (Array.isArray(input.providerProfiles)) patch.providerProfiles = sanitizeProviderProfiles(input.providerProfiles)
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest --run src/shared/config.test.ts`
Expected: PASS（原有用例 + 新用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/shared/config.ts src/shared/config.test.ts
git commit -m "feat(contacts): add provider profile type with legacy default synthesis"
```

---

### Task 2: 角色共享核心（shared/characters）

**Files:**
- Create: `src/shared/characters.ts`
- Test: Create `src/shared/characters.test.ts`

- [ ] **Step 1: 写失败测试**

`src/shared/characters.test.ts`：

```ts
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
  it('isDefaultCharacter matches only the built-in id', () => {
    expect(isDefaultCharacter(DEFAULT_CHARACTER_ID)).toBe(true)
    expect(isDefaultCharacter('c1')).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest --run src/shared/characters.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/shared/characters.ts`：

```ts
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest --run src/shared/characters.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/shared/characters.ts src/shared/characters.test.ts
git commit -m "feat(contacts): add character model, sanitization and chat config resolution"
```

---

### Task 3: 主库角色存储与会话归属（main/database）

**Files:**
- Modify: `src/main/database.ts`
- Test: `src/main/database.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/main/database.test.ts` 中：现有 import 来自 `./database` 的列表里追加 `createCharacter, deleteCharacter, listCharacters, updateCharacter`；顶部新增 `import { DEFAULT_CHARACTER_ID } from '../shared/characters'`。文件末尾追加：

```ts
describe('characters', () => {
  const draft = { name: '小猫', avatar: '🐱', soulMd: '# 小猫', providerProfileId: 'default', model: 'm1' }

  it('always exposes the built-in default character with live-view fields', () => {
    const characters = listCharacters()
    expect(characters[0]).toMatchObject({ id: DEFAULT_CHARACTER_ID, name: '丑鱼', builtIn: true, providerProfileId: 'default' })
  })

  it('assigns existing sessions to the default character on migration', () => {
    const id = getActiveSession().id
    flushDatabase()
    initDatabase()
    const workspace = getSessionWorkspace()
    expect(workspace.sessions.every((session) => session.characterId === DEFAULT_CHARACTER_ID)).toBe(true)
    expect(getSession(id)?.characterId).toBe(DEFAULT_CHARACTER_ID)
  })

  it('creates characters, binds sessions and counts stats', () => {
    const created = createCharacter(draft)
    expect(created).toMatchObject({ name: '小猫', model: 'm1', sessionCount: 0 })
    const workspace = createChatSession(undefined, created.id)
    expect(workspace.activeSession.characterId).toBe(created.id)
    const stats = listCharacters().find((character) => character.id === created.id)
    expect(stats?.sessionCount).toBe(1)
    expect(stats?.lastActiveAt).toBeGreaterThan(0)
  })

  it('rejects duplicate names, unknown profiles and default deletion', () => {
    expect(() => createCharacter({ ...draft, name: '丑鱼' })).toThrow('同名')
    expect(() => createCharacter({ ...draft, name: '坏档案', providerProfileId: 'missing' })).toThrow('档案')
    expect(() => deleteCharacter(DEFAULT_CHARACTER_ID)).toThrow('不可删除')
  })

  it('updates characters and write-through default persona/model to config', () => {
    const created = createCharacter(draft)
    const updated = updateCharacter(created.id, { ...draft, model: 'm2' })
    expect(updated.model).toBe('m2')
    const before = getConfig().soulMd
    updateCharacter(DEFAULT_CHARACTER_ID, { name: '丑鱼', avatar: '🐟', soulMd: '# 新人设', providerProfileId: 'default', model: 'live-model' })
    expect(getConfig().soulMd).toBe('# 新人设')
    expect(getConfig().model).toBe('live-model')
    expect(getConfig()).not.toEqual(before)
    expect(() => updateCharacter(DEFAULT_CHARACTER_ID, { name: '丑鱼', avatar: '🐟', soulMd: '', providerProfileId: 'p9', model: 'm' })).toThrow('默认档案')
  })

  it('deleting a character cascades its sessions and repairs the active session', () => {
    const created = createCharacter(draft)
    const owned = createChatSession('猫会话', created.id)
    expect(owned.activeSession.characterId).toBe(created.id)
    const workspace = deleteCharacter(created.id)
    expect(listCharacters().some((character) => character.id === created.id)).toBe(false)
    expect(workspace.sessions.some((session) => session.id === owned.activeSession.id)).toBe(false)
    expect(workspace.activeSession.id).toBeTruthy()
  })

  it('persists characters and profile api keys across restart', () => {
    saveConfig({ providerProfiles: [{ id: 'p1', name: '中转', provider: 'claude', baseUrl: 'https://relay', apiKey: 'secret-key' }] })
    createCharacter(draft)
    const created = listCharacters().find((character) => character.name === '小猫')!
    updateCharacter(created.id, { ...draft, providerProfileId: 'p1' })
    flushDatabase()
    initDatabase()
    const persisted = listCharacters().find((character) => character.name === '小猫')
    expect(persisted?.providerProfileId).toBe('p1')
    expect(getConfig().providerProfiles[0]).toMatchObject({ id: 'p1', apiKey: 'secret-key' })
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf-8'))
    expect(raw.config.providerProfiles[0].apiKey).toMatch(/^safe:v1:/)
    expect(raw.characters).toBeUndefined
  })
})
```

注意最后一个断言 `raw.characters` 是故意写成 `.toBeUndefined`（无括号）的占位检查——实现时删除该行，改为：`expect(Array.isArray(raw.characters)).toBe(true)`。除这一行外测试即写即用。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest --run src/main/database.test.ts`
Expected: FAIL（`createCharacter` 等导出不存在）

- [ ] **Step 3: 实现 database.ts**

(1) import 区追加：

```ts
import {
  Character, CharacterStats, DEFAULT_CHARACTER_ID, MAX_CHARACTER_COUNT,
  normalizeCharacters, sanitizeCharacterDraft
} from '../shared/characters'
import { getProviderProfiles, DEFAULT_PROFILE_ID, type ProviderProfile } from '../shared/config'
```

（`AppConfig, DEFAULT_APP_CONFIG, normalizeConfig` 已在现有 import 中，合并进同一行。）

(2) 类型与版本：

- `ChatSession` 与 `ChatSessionSummary` 各加一行 `characterId: string`
- `StoreData` 加 `characters: Character[]`
- `const STORE_VERSION = 4`

(3) `createSession`（原 L175）改为：

```ts
function createSession(messages: Message[] = [], title?: string, now = Date.now(), characterId: string = DEFAULT_CHARACTER_ID): ChatSession {
  return {
    id: randomUUID(),
    title: title ? normalizeSessionTitle(title) : deriveSessionTitle(messages),
    messages: sanitizeMessages(messages),
    characterId,
    createdAt: now,
    updatedAt: now
  }
}
```

(4) `normalizeSessions` 返回对象中加：

```ts
        characterId: typeof input.characterId === 'string' && input.characterId.trim() ? input.characterId.trim().slice(0, 128) : DEFAULT_CHARACTER_ID,
```

(5) `toSummary` 返回对象加 `characterId: session.characterId,`。

(6) `load()`：

- 已载入分支的返回对象加 `characters: normalizeCharacters(data.characters),`
- `persistedConfig` 解密处（`apiKey: unprotect(...)` 一带）追加档案 key 解密：

```ts
    const persistedProfiles: Partial<AppConfig> = {
      ...persistedConfig,
      providerProfiles: Array.isArray(persistedConfig.providerProfiles)
        ? persistedConfig.providerProfiles.map((profile) => ({ ...profile, apiKey: unprotect(profile.apiKey) }))
        : []
    }
```

并把 `normalizeConfig({ ...persistedConfig, ... })` 改为 `normalizeConfig({ ...persistedProfiles, ... })`（三处 unprotect 参数保持不变）。

- 全新空库分支返回对象加 `characters: normalizeCharacters(undefined),`。
- `load()` 里 v2 legacy 迁移的 `createSession(legacyMessages, ...)` 调用不传 characterId，走默认值即可。

(7) `serializeStore()`：

- `config` 对象加：

```ts
      providerProfiles: store.config.providerProfiles.map((profile) => ({ ...profile, apiKey: protect(profile.apiKey) })),
```

- 顶层加 `characters: store.characters,`（与 `sessions` 同级）。

(8) 角色读写 API——加在 `deleteChatSession` 之后：

```ts
export function listCharacters(): CharacterStats[] {
  return store.characters.map((character) => {
    const sessions = store.sessions.filter((session) => session.characterId === character.id)
    return {
      ...character,
      sessionCount: sessions.length,
      lastActiveAt: sessions.reduce((latest, session) => Math.max(latest, session.updatedAt), character.createdAt)
    }
  })
}

export function getCharacter(id: string): Character | null {
  const character = store.characters.find((item) => item.id === id)
  return character ? { ...character } : null
}

function findCharacterByIdOrThrow(id: string): Character {
  const character = store.characters.find((item) => item.id === id)
  if (!character) throw new Error('角色不存在或已被删除。')
  return character
}

export function createCharacter(draft: unknown): CharacterStats {
  const input = sanitizeCharacterDraft(draft)
  if (!input) throw new Error('角色名称和模型为必填项。')
  if (store.characters.length >= MAX_CHARACTER_COUNT) throw new Error(`最多支持 ${MAX_CHARACTER_COUNT} 个角色。`)
  if (!getProviderProfiles(store.config).some((profile) => profile.id === input.providerProfileId)) {
    throw new Error('所选供应商档案不存在，请先到设置页创建。')
  }
  if (store.characters.some((character) => character.name.toLowerCase() === input.name.toLowerCase())) {
    throw new Error('已存在同名角色，请换一个名字。')
  }
  const now = Date.now()
  const character: Character = { id: randomUUID(), ...input, builtIn: false, createdAt: now, updatedAt: now }
  store.characters.push(character)
  persist()
  return listCharacters().find((item) => item.id === character.id)!
}

export function updateCharacter(id: string, draft: unknown): CharacterStats {
  const character = findCharacterByIdOrThrow(id)
  const input = sanitizeCharacterDraft(draft)
  if (!input) throw new Error('角色名称和模型为必填项。')
  if (store.characters.some((item) => item.id !== id && item.name.toLowerCase() === input.name.toLowerCase())) {
    throw new Error('已存在同名角色，请换一个名字。')
  }
  if (character.builtIn) {
    if (input.providerProfileId !== DEFAULT_PROFILE_ID) throw new Error('内置角色固定使用默认档案。')
    if (!getProviderProfiles(store.config).some((profile) => profile.id === input.providerProfileId)) {
      throw new Error('所选供应商档案不存在，请先到设置页创建。')
    }
    character.name = input.name
    character.avatar = input.avatar
    character.updatedAt = Date.now()
    // 内置角色的人设与模型写入全局配置，保持单一数据源（saveConfig 自带 persist）。
    saveConfig({ soulMd: input.soulMd, model: input.model })
    return listCharacters().find((item) => item.id === id)!
  }
  if (!getProviderProfiles(store.config).some((profile) => profile.id === input.providerProfileId)) {
    throw new Error('所选供应商档案不存在，请先到设置页创建。')
  }
  Object.assign(character, input, { updatedAt: Date.now() })
  persist()
  return listCharacters().find((item) => item.id === id)!
}

export function deleteCharacter(id: string): SessionWorkspace {
  const character = findCharacterByIdOrThrow(id)
  if (character.builtIn) throw new Error('内置角色不可删除。')
  const hadActive = store.sessions.some((session) => session.characterId === id && session.id === store.activeSessionId)
  store.sessions = store.sessions.filter((session) => session.characterId !== id)
  store.characters = store.characters.filter((item) => item.id !== id)
  if (store.sessions.length === 0) store.sessions.push(createSession())
  if (hadActive || !store.sessions.some((session) => session.id === store.activeSessionId)) {
    store.activeSessionId = store.sessions[0].id
  }
  persist()
  return getSessionWorkspace()
}
```

(9) `createChatSession` 改为：

```ts
export function createChatSession(title?: string, characterId: string = DEFAULT_CHARACTER_ID): SessionWorkspace {
  const owner = getCharacter(characterId) ? characterId : DEFAULT_CHARACTER_ID
  const session = createSession([], title, Date.now(), owner)
  store.sessions.unshift(session)
  store.activeSessionId = session.id
  persist()
  return getSessionWorkspace()
}
```

(10) `getActiveSessionInternal` 中兜底 `createSession()` 不变（默认归属内置角色）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest --run src/main/database.test.ts`
Expected: PASS（含既有用例；`STORE_VERSION` 提升后旧数据路径用例仍绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/database.ts src/main/database.test.ts
git commit -m "feat(contacts): store characters in main database and bind sessions"
```

---

### Task 4: AI 流按角色解析（shared/ai + renderer 引擎 + main IPC）

**Files:**
- Modify: `src/shared/ai.ts`（AIStreamRequest 加 characterId）
- Modify: `src/renderer/src/core/ai-engine.ts`
- Modify: `src/main/ipc.ts`（parseAIStreamRequest + ai:stream 解析）
- Test: `src/shared/characters.test.ts` 已覆盖解析；本任务以类型检查为主

- [ ] **Step 1: shared/ai.ts**

`AIStreamRequest` 加字段：

```ts
export interface AIStreamRequest {
  requestId: string
  messages: AIChatMessage[]
  systemPrompt: string
  characterId?: string
}
```

- [ ] **Step 2: renderer ai-engine.ts**

`streamChat` 签名与预检改为（`onRequestStart` 之后新增 `characterId?: string` 参数；预检仅对无角色的默认路径生效——角色路径由主进程校验并返回可操作错误）：

```ts
export async function streamChat(
  messages: Message[],
  systemPrompt: string,
  config: AppConfig,
  onChunk: StreamCallback,
  signal?: AbortSignal,
  onRequestStart?: (requestId: string) => void,
  characterId?: string
): Promise<void> {
  if (!characterId && !config.apiKey.trim()) {
    throw new Error('尚未配置 API Key，请先打开设置完成配置。')
  }
  if (!characterId && !config.model.trim()) {
    throw new Error('尚未配置模型，请先在设置或模型菜单中选择模型。')
  }
  if (signal?.aborted) throw createAbortError()
```

`AIStreamRequest` 构造处加 `characterId,`（undefined 会被 JSON 序列化丢弃，无碍）。

- [ ] **Step 3: main/ipc.ts**

(1) import 区追加：

```ts
import { resolveCharacterConfig } from '../shared/characters'
import { getCharacter } from './database'
```

（`getConfig` 已有 import。）

(2) `parseAIStreamRequest` 的返回行改为：

```ts
  const characterId = typeof input.characterId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.characterId) ? input.characterId : undefined
  return { requestId: input.requestId, systemPrompt: input.systemPrompt, messages, characterId }
```

(3) `ai:stream` 处理器中 `const config = getConfig()` 之后插入：

```ts
    let effectiveConfig = config
    if (request.characterId) {
      const resolution = resolveCharacterConfig(getCharacter(request.characterId), config)
      if (!resolution.ok) return { ok: false, error: resolution.error }
      effectiveConfig = { ...config, ...resolution.config }
    }
```

并把下方 `streamAIChat(request.messages, request.systemPrompt, config, ...)` 的 `config` 实参换成 `effectiveConfig`（`config.aiToolsEnabled`、`config.toolPermissionMode` 等工具配置仍用原 `config` 读取，不动）。

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: 0 错误（preload/渲染层的 AIStreamRequest 来自 shared/ai，自动获得新字段）

- [ ] **Step 5: 提交**

```bash
git add src/shared/ai.ts src/renderer/src/core/ai-engine.ts src/main/ipc.ts
git commit -m "feat(contacts): resolve per-character model config in ai stream"
```

---

### Task 5: 角色/档案 IPC 与 preload 暴露

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/shared/types.ts`

- [ ] **Step 1: main/ipc.ts 注册处理器**

import 区追加（部分已在 Task 4 引入，合并）：`listCharacters, createCharacter, updateCharacter, deleteCharacter`（并入现有 `./database` import）、`getProviderProfiles, sanitizeProviderProfile, type ResolvedProviderProfile`（并入 `../shared/config` import）、`listCharacters` 用于档案删除引用检查。

在 `db:create-session`（L769）附近，把该 handler 改为：

```ts
  ipcMain.handle('db:create-session', (_event, title?: string, characterId?: string) =>
    guardDatabaseErrors(createChatSession(title, characterId)))
```

（若现有 handler 无 `guardDatabaseErrors` 包裹，则保持原有裸调用形式，仅加第二个参数。以文件现状为准。）

其余新 handler 加在 `db:create-session` 之后：

```ts
  const notifyCharactersChanged = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('characters:changed')
  }

  ipcMain.handle('characters:list', () => listCharacters())
  ipcMain.handle('characters:create', (_event, draft: unknown) => {
    const result = createCharacter(draft)
    notifyCharactersChanged()
    return result
  })
  ipcMain.handle('characters:update', (_event, id: string, draft: unknown) => {
    const result = updateCharacter(id, draft)
    notifyCharactersChanged()
    if (result.builtIn) {
      const config = getConfig()
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('config:changed', config)
      notifyJournalConfig(config)
    }
    return result
  })
  ipcMain.handle('characters:delete', (_event, id: string) => {
    const workspace = deleteCharacter(id)
    notifyCharactersChanged()
    return workspace
  })
  ipcMain.handle('characters:fetch-models', async (_event, profileId: string): Promise<AIModelListResult> => {
    const profile = getProviderProfiles(getConfig()).find((item) => item.id === profileId)
    if (!profile) {
      return { ok: false, models: [], baseUrl: '', baseUrlAdjusted: false, configuredModelValid: false, errorCode: 'invalid-url', message: '供应商档案不存在。' }
    }
    // 档案级模型列表只读，不回写 baseUrl（区别于全局 fetch-models 的自动修正）。
    return fetchProviderModels({ ...getConfig(), provider: profile.provider, baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: '' })
  })

  ipcMain.handle('provider-profiles:list', (): ResolvedProviderProfile[] => getProviderProfiles(getConfig()))
  ipcMain.handle('provider-profiles:save', (_event, rawProfile: unknown): ResolvedProviderProfile[] => {
    const profile = sanitizeProviderProfile(rawProfile)
    if (!profile) throw new Error('档案名称和 Base URL 为必填项。')
    const config = getConfig()
    const next = [...config.providerProfiles.filter((item) => item.id !== profile.id), profile]
    saveConfig({ providerProfiles: next })
    notifyJournalConfig(getConfig())
    return getProviderProfiles(getConfig())
  })
  ipcMain.handle('provider-profiles:delete', (_event, profileId: string): ResolvedProviderProfile[] => {
    const config = getConfig()
    if (!config.providerProfiles.some((item) => item.id === profileId)) throw new Error('档案不存在或已被删除。')
    const referencing = listCharacters().filter((character) => character.providerProfileId === profileId)
    if (referencing.length > 0) {
      throw new Error(`档案正被角色「${referencing.map((character) => character.name).join('、')}」使用，请先调整这些角色。`)
    }
    saveConfig({ providerProfiles: config.providerProfiles.filter((item) => item.id !== profileId) })
    return getProviderProfiles(getConfig())
  })
```

`notifyJournalConfig` 为文件内既有函数（L189 附近使用过）；若它在 handler 之外不可达，按文件现状将其调用点对齐现有模式。

- [ ] **Step 2: preload/index.ts**

`api` 对象中 `db` 之前加：

```ts
  characters: {
    list: () => ipcRenderer.invoke('characters:list'),
    create: (draft: unknown) => ipcRenderer.invoke('characters:create', draft),
    update: (id: string, draft: unknown) => ipcRenderer.invoke('characters:update', id, draft),
    remove: (id: string) => ipcRenderer.invoke('characters:delete', id),
    fetchModels: (profileId: string) => ipcRenderer.invoke('characters:fetch-models', profileId) as Promise<import('../shared/ai').AIModelListResult>,
    onChanged: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('characters:changed', handler)
      return () => { ipcRenderer.removeListener('characters:changed', handler) }
    }
  },
  providerProfiles: {
    list: () => ipcRenderer.invoke('provider-profiles:list'),
    save: (profile: unknown) => ipcRenderer.invoke('provider-profiles:save', profile),
    remove: (id: string) => ipcRenderer.invoke('provider-profiles:delete', id)
  },
```

`db.createSession` 改为：

```ts
    createSession: (title?: string, characterId?: string) => ipcRenderer.invoke('db:create-session', title, characterId),
```

- [ ] **Step 3: renderer types.ts**

(1) 顶部加类型 re-export：

```ts
export type { Character, CharacterStats } from '../../../shared/characters'
export type { ProviderProfile, ResolvedProviderProfile } from '../../../shared/config'
import type { Character, CharacterStats } from '../../../shared/characters'
import type { ResolvedProviderProfile } from '../../../shared/config'
```

(2) 本文件内 `ChatSession`、`ChatSessionSummary` 接口各加 `characterId: string`。

(3) `ElectronAPI` 接口：`db.createSession: (title?: string, characterId?: string) => Promise<SessionWorkspace>`，并在 `db` 之前加：

```ts
  characters: {
    list: () => Promise<CharacterStats[]>
    create: (draft: unknown) => Promise<CharacterStats>
    update: (id: string, draft: unknown) => Promise<CharacterStats>
    remove: (id: string) => Promise<SessionWorkspace>
    fetchModels: (profileId: string) => Promise<AIModelListResult>
    onChanged: (callback: () => void) => () => void
  }
  providerProfiles: {
    list: () => Promise<ResolvedProviderProfile[]>
    save: (profile: unknown) => Promise<ResolvedProviderProfile[]>
    remove: (id: string) => Promise<ResolvedProviderProfile[]>
  }
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: 0 错误

- [ ] **Step 5: 提交**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/shared/types.ts
git commit -m "feat(contacts): expose character and provider profile IPC to renderer"
```

---

### Task 6: 会话工作区接入角色

**Files:**
- Modify: `src/renderer/src/components/ChatPanel/useSessionWorkspace.ts`

- [ ] **Step 1: 状态与加载**

import 区追加：

```ts
import { DEFAULT_CHARACTER_ID, type CharacterStats } from '../../../../shared/characters'
```

`useSessionWorkspace` 体内（`activeSessionId` state 之后）加：

```ts
  const [characters, setCharacters] = useState<CharacterStats[]>([])
  const [activeCharacterId, setActiveCharacterId] = useState(DEFAULT_CHARACTER_ID)
  const charactersRef = useRef<CharacterStats[]>([])
  const activeCharacterIdRef = useRef(DEFAULT_CHARACTER_ID)
  charactersRef.current = characters
```

初始化 effect（L158 一带）的 `Promise.all` 改为：

```ts
    Promise.all([
      loadSessionWorkspace(),
      window.electronAPI.db.getConfig(),
      window.electronAPI.characters.list()
    ]).then(([workspace, loadedConfig, characters]) => {
      if (!active) return
      setCharacters(characters)
      applyWorkspace(workspace)
      onConfigLoaded(loadedConfig)
      initializedRef.current = true
      setWorkspaceLoaded(true)
    })
```

新增订阅 effect（放在初始化 effect 之后）：

```ts
  useEffect(() => {
    let active = true
    const load = () => {
      void window.electronAPI.characters.list().then((list) => { if (active) setCharacters(list) }).catch(() => {})
    }
    const unsubscribe = window.electronAPI.characters.onChanged(load)
    return () => { active = false; unsubscribe() }
  }, [])
```

`applyWorkspace` 回调内（`setActiveSessionId(sessionId)` 附近）加：

```ts
    const characterId = workspace.activeSession.characterId || DEFAULT_CHARACTER_ID
    activeCharacterIdRef.current = characterId
    setActiveCharacterId(characterId)
```

- [ ] **Step 2: 发送链路带角色**

`generateAIResponse` 内 `systemPrompt` 行（L282）之前取角色，并替换 systemPrompt 构造：

```ts
    const activeCharacter = charactersRef.current.find((character) => character.id === activeCharacterIdRef.current)
    const soulMd = !activeCharacter || activeCharacter.builtIn ? config.soulMd : (activeCharacter.soulMd || config.soulMd)
    const systemPrompt = buildSystemPrompt(soulMd, [memoryContext, memoryConversationPolicy, continuationPolicy].filter(Boolean).join('\n\n'))
```

`streamChat(...)` 调用（L332-362）在最后一个实参 `(requestId) => {...}` 之后追加：

```ts
        activeCharacter && !activeCharacter.builtIn ? activeCharacter.id : undefined
```

- [ ] **Step 3: 新建会话带角色**

`createSession` 回调改为（默认归当前角色；点通讯录新角色开聊时显式传入）：

```ts
  const createSession = useCallback(async (characterId: string = activeCharacterIdRef.current) => {
    await persistCurrentSession()
    const workspace = await window.electronAPI.db.createSession(undefined, characterId)
    applyWorkspace(workspace)
    requestComposerFocus()
  }, [applyWorkspace, persistCurrentSession, requestComposerFocus])
```

返回对象追加 `characters, activeCharacterId,`。

- [ ] **Step 4: 类型检查与既有测试**

Run: `npm run typecheck && npx vitest --run src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts src/renderer/src/components/ChatPanel/stream-render.test.ts`
Expected: 0 类型错误，测试 PASS（`createSession()` 无参调用仍兼容）

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/ChatPanel/useSessionWorkspace.ts
git commit -m "feat(contacts): stream chat with active character persona and model"
```

---

### Task 7: 通讯录页 UI 与聊天页接线

**Files:**
- Modify: `src/renderer/src/components/Workspace/WorkspaceNav.tsx`
- Create: `src/renderer/src/components/Contacts/ContactsView.tsx`
- Create: `src/renderer/src/components/Contacts/Contacts.css`
- Modify: `src/renderer/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/renderer/src/components/ChatPanel/ChatPanel.css`
- Modify: `src/renderer/src/components/ChatPanel/InputArea.tsx`

- [ ] **Step 1: 导航项**

`WorkspaceNav.tsx`：`WorkspacePage` 类型改为 `'chat' | 'contacts' | 'journal' | 'memory' | 'settings'`；`pages` 数组在 `chat` 之后插入：

```ts
  { id: 'contacts', label: '通讯录', path: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
```

- [ ] **Step 2: ContactsView 组件**

`src/renderer/src/components/Contacts/ContactsView.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CharacterStats } from '../../../../shared/characters'
import { DEFAULT_PROFILE_ID } from '../../../../shared/config'
import type { ResolvedProviderProfile } from '../../../../shared/config'
import './Contacts.css'

interface ContactsViewProps {
  active: boolean
  onOpenChat: (characterId: string) => void
  onDeleted: (workspace: import('../../shared/types').SessionWorkspace) => void
}

interface FormState {
  id: string | null
  name: string
  avatar: string
  soulMd: string
  providerProfileId: string
  model: string
}

const EMPTY_FORM: FormState = { id: null, name: '', avatar: '', soulMd: '', providerProfileId: DEFAULT_PROFILE_ID, model: '' }

export default function ContactsView({ active, onOpenChat, onDeleted }: ContactsViewProps) {
  const [characters, setCharacters] = useState<CharacterStats[]>([])
  const [profiles, setProfiles] = useState<ResolvedProviderProfile[]>([])
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelStatus, setModelStatus] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<CharacterStats | null>(null)

  const refresh = useCallback(() => {
    void window.electronAPI.characters.list().then(setCharacters).catch(() => {})
    void window.electronAPI.providerProfiles.list().then(setProfiles).catch(() => {})
  }, [])

  useEffect(() => {
    if (!active) return
    refresh()
    return window.electronAPI.characters.onChanged(refresh)
  }, [active, refresh])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return characters
    return characters.filter((character) =>
      character.name.toLowerCase().includes(normalized) || character.model.toLowerCase().includes(normalized))
  }, [characters, query])

  const openForm = useCallback((character?: CharacterStats) => {
    setError('')
    setModels([])
    setModelStatus('')
    if (!character) {
      setForm({ ...EMPTY_FORM, providerProfileId: profiles[0]?.id ?? DEFAULT_PROFILE_ID })
      return
    }
    setForm({
      id: character.id,
      name: character.name,
      avatar: character.avatar,
      soulMd: character.builtIn ? (window.__chouyuConfig?.soulMd ?? '') : character.soulMd,
      providerProfileId: character.builtIn ? DEFAULT_PROFILE_ID : character.providerProfileId,
      model: character.builtIn ? (window.__chouyuConfig?.model ?? '') : character.model
    })
  }, [profiles])

  const loadModels = useCallback(async () => {
    if (!form) return
    setBusy(true)
    setModelStatus('正在获取模型列表…')
    try {
      const result = await window.electronAPI.characters.fetchModels(form.providerProfileId)
      setModels(result.models)
      setModelStatus(result.ok ? `获取到 ${result.models.length} 个模型` : result.message)
    } catch (loadError) {
      setModels([])
      setModelStatus(loadError instanceof Error ? loadError.message : '获取模型列表失败。')
    } finally {
      setBusy(false)
    }
  }, [form])

  const saveForm = useCallback(async () => {
    if (!form) return
    setBusy(true)
    setError('')
    try {
      if (form.id) await window.electronAPI.characters.update(form.id, form)
      else await window.electronAPI.characters.create(form)
      setForm(null)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，请重试。')
    } finally {
      setBusy(false)
    }
  }, [form])

  const deleteCharacter = useCallback(async () => {
    if (!confirmDelete) return
    setBusy(true)
    try {
      const workspace = await window.electronAPI.characters.remove(confirmDelete.id)
      onDeleted(workspace)
      setConfirmDelete(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败，请重试。')
    } finally {
      setBusy(false)
    }
  }, [confirmDelete, onDeleted])

  return <div className="contacts-view" data-contacts-root>
    <div className="contacts-toolbar">
      <input data-contacts-search className="contacts-search" type="search" placeholder="搜索角色或模型"
        value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索角色" />
      <button type="button" data-contacts-new className="contacts-new" onClick={() => openForm()}>新建角色</button>
    </div>
    {error && <div className="contacts-error" role="alert">{error}</div>}
    <ul className="contacts-list" role="list">
      {filtered.map((character) => <li key={character.id}>
        <button type="button" data-contacts-item={character.id} className="contacts-item"
          onClick={() => onOpenChat(character.id)}>
          <span className="contacts-avatar" aria-hidden="true">{character.avatar}</span>
          <span className="contacts-meta">
            <span className="contacts-name">{character.name}{character.builtIn && <em className="contacts-builtin">内置</em>}</span>
            <span className="contacts-sub">{character.model || '跟随设置页默认模型'} · {character.sessionCount} 个会话</span>
          </span>
        </button>
        <button type="button" data-contacts-edit={character.id} className="contacts-edit" aria-label={`编辑 ${character.name}`}
          onClick={() => openForm(character)}>编辑</button>
        {!character.builtIn && <button type="button" data-contacts-delete={character.id} className="contacts-delete"
          aria-label={`删除 ${character.name}`} onClick={() => { setError(''); setConfirmDelete(character) }}>删除</button>}
      </li>)}
      {filtered.length === 0 && <li className="contacts-empty">没有匹配的角色</li>}
    </ul>
    {confirmDelete && <div className="contacts-confirm" role="alertdialog" aria-label="删除角色确认">
      <p>删除角色「{confirmDelete.name}」将同时删除它的 {confirmDelete.sessionCount} 个会话，无法恢复。</p>
      <div>
        <button type="button" autoFocus onClick={() => setConfirmDelete(null)}>取消</button>
        <button type="button" className="danger" data-contacts-confirm-delete onClick={() => { void deleteCharacter() }}>确认删除</button>
      </div>
    </div>}
    {form && <form className="contacts-form" data-contacts-form onSubmit={(event) => { event.preventDefault(); void saveForm() }}>
      <h3>{form.id ? '编辑角色' : '新建角色'}</h3>
      <label>名字<input data-contacts-name value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={24} /></label>
      <label>头像（emoji 或单字）<input data-contacts-avatar value={form.avatar} onChange={(event) => setForm({ ...form, avatar: event.target.value })} maxLength={8} placeholder="留空用名字首字" /></label>
      <label>供应商档案
        <select data-contacts-profile value={form.providerProfileId} disabled={form.id === 'chouyu'}
          onChange={(event) => setForm({ ...form, providerProfileId: event.target.value })}>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.builtIn ? '（设置页默认）' : ''}</option>)}
        </select>
      </label>
      {form.id === 'chouyu' && <p className="contacts-hint">内置角色的人设与模型会写回设置页的全局配置。</p>}
      <label>模型<input data-contacts-model value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} required list="contacts-model-options} />
        <datalist id="contacts-model-options">{models.map((model) => <option key={model} value={model} />)}</datalist>
      </label>
      <button type="button" data-contacts-fetch-models onClick={() => { void loadModels() }} disabled={busy}>获取模型列表</button>
      {modelStatus && <p className="contacts-hint" role="status">{modelStatus}</p>}
      <label>人设（系统提示词）<textarea data-contacts-soulmd rows={8} value={form.soulMd}
        onChange={(event) => setForm({ ...form, soulMd: event.target.value })} placeholder="留空使用默认丑鱼人格" /></label>
      <div className="contacts-form-actions">
        <button type="button" onClick={() => setForm(null)}>取消</button>
        <button type="submit" data-contacts-save disabled={busy}>保存</button>
      </div>
    </form>}
  </div>
}
```

注意两处实现期修正：(a) `list="contacts-model-options}` 有个笔误引号，落地时写成 `list="contacts-model-options"`；(b) 内置角色编辑时需要全局 soulMd/model 预填——不用 `window.__chouyuConfig`，改为给 `ContactsViewProps` 加 `config: AppConfig` prop，由 ChatPanel 传入，`openForm` 用 `config.soulMd`/`config.model`。按修正后的版本实现。

- [ ] **Step 3: Contacts.css**

`src/renderer/src/components/Contacts/Contacts.css`（保持克制的浅暗色兼容样式，色值沿用 ConversationSidebar 现有观感，375px 不横向滚动）：

```css
.contacts-view { display: flex; flex-direction: column; gap: 10px; height: 100%; overflow-y: auto; padding: 12px; min-width: 0; }
.contacts-toolbar { display: flex; gap: 8px; }
.contacts-search { flex: 1; min-width: 0; }
.contacts-new { white-space: nowrap; }
.contacts-error { color: #dc2626; }
.contacts-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.contacts-list li { display: flex; align-items: center; gap: 6px; }
.contacts-item { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; text-align: left; }
.contacts-avatar { flex: none; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: rgba(127, 127, 127, .15); font-size: 18px; }
.contacts-meta { min-width: 0; display: flex; flex-direction: column; }
.contacts-name { font-weight: 600; }
.contacts-builtin { margin-left: 6px; font-size: 11px; font-style: normal; opacity: .7; }
.contacts-sub { font-size: 12px; opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contacts-empty { opacity: .7; }
.contacts-confirm { border: 1px solid #dc2626; border-radius: 8px; padding: 10px 12px; }
.contacts-confirm > div { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.contacts-form { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid rgba(127, 127, 127, .3); padding-top: 10px; }
.contacts-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.contacts-form input, .contacts-form textarea, .contacts-form select { width: 100%; }
.contacts-hint { font-size: 12px; opacity: .7; }
.contacts-form-actions { display: flex; gap: 8px; justify-content: flex-end; }
button.danger { color: #dc2626; }
[data-theme='dark'] .contacts-error, [data-theme='dark'] button.danger { color: #f87171; }
[data-theme='dark'] .contacts-confirm { border-color: #f87171; }
@media (prefers-reduced-motion: reduce) { .contacts-view * { transition: none; } }
```

（实现期允许按现有 token 微调颜色；不得引入横向滚动。）

- [ ] **Step 4: ChatPanel 接线**

(1) import 区：`import ContactsView from '../Contacts/ContactsView'`、`import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'`。

(2) 从 `useSessionWorkspace` 返回值解构中追加 `characters, activeCharacterId, applyWorkspace`（`applyWorkspace` 已在返回对象中）。

(3) 角色派生与过滤（放在 `const isChat = ...` 附近）：

```ts
  const activeCharacter = characters.find((character) => character.id === activeCharacterId) ?? null
  const visibleSessions = useMemo(() => sessions.filter((session) =>
    (session.characterId || DEFAULT_CHARACTER_ID) === activeCharacterId), [sessions, activeCharacterId])
```

（`useMemo` 若未导入则补。）

(4) ConversationSidebar 的 `sessions={sessions}` 改为 `sessions={visibleSessions}`；`onCreate` 中 `await createSession()` 保持（Task 6 已默认当前角色）。

(5) 打开角色聊天（放在 `openAISettings` 附近）：

```ts
  const openCharacterChat = useCallback(async (characterId: string) => {
    const latest = [...visibleSessionsRef.current]
      .filter((session) => (session.characterId || DEFAULT_CHARACTER_ID) === characterId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (latest) await selectSession(latest.id)
    else await createSession(characterId)
    navigate('chat')
  }, [selectSession, createSession, navigate])
```

`visibleSessions` 需要随回调保鲜：在组件体内加 `const visibleSessionsRef = useRef(visibleSessions); visibleSessionsRef.current = visibleSessions`，回调依赖数组留 `[selectSession, createSession, navigate]`。

(6) 角色上下文 chip——`.chat-panel-main` 内、`{showOnboarding && ...}` 之前加：

```ts
            {activeCharacter && !activeCharacter.builtIn && (
              <div className="character-context-chip" role="status" data-character-chip={activeCharacter.id}>
                <span aria-hidden="true">{activeCharacter.avatar}</span> 正在与 {activeCharacter.name}（{activeCharacter.model}）对话
              </div>
            )}
```

(7) 页面挂载——`workspace-journal` section 之前加：

```tsx
        <section className="workspace-page workspace-contacts" hidden={activePage !== 'contacts'} aria-label="通讯录工作区">
          {visitedPages.contacts && <ContactsView active={visible && activePage === 'contacts'} config={config}
            onOpenChat={(characterId) => { void openCharacterChat(characterId) }}
            onDeleted={(workspace) => applyWorkspace(workspace)} />}
        </section>
```

(8) InputArea 模型显示——`model={config.model}` 改为：

```ts
              model={activeCharacter && !activeCharacter.builtIn ? activeCharacter.model : config.model}
```

`onModelChange={handleModelChange}` 保持（见下一步 InputArea 扩展后，自定义角色下模型列表来自其档案）。

- [ ] **Step 5: InputArea 按档案取模型列表**

`InputArea.tsx`：props 加 `fetchModels?: () => Promise<AIModelListResult>`（类型从 `../../../../shared/ai` 导入）；组件内取模型列表的那处 `window.electronAPI.fetchModels()` 调用（L142 一带）改为 `void (fetchModels ?? window.electronAPI.fetchModels)()...`，保持原有 then/catch 逻辑不变。

ChatPanel 中 InputArea 挂载处追加：

```ts
              fetchModels={activeCharacter && !activeCharacter.builtIn
                ? () => window.electronAPI.characters.fetchModels(activeCharacter.providerProfileId)
                : undefined}
```

- [ ] **Step 6: ChatPanel.css 追加 chip 样式**

```css
.character-context-chip { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; margin: 6px 10px 0; padding: 2px 10px; border-radius: 999px; font-size: 12px; background: rgba(127, 127, 127, .15); }
```

- [ ] **Step 7: 类型检查与布局回归**

Run: `npm run typecheck && npx vitest --run src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts src/renderer/src/components/Ui.regression.test.ts`
Expected: 0 类型错误，测试 PASS

- [ ] **Step 8: 提交**

```bash
git add src/renderer/src/components/Workspace/WorkspaceNav.tsx src/renderer/src/components/Contacts src/renderer/src/components/ChatPanel/ChatPanel.tsx src/renderer/src/components/ChatPanel/ChatPanel.css src/renderer/src/components/ChatPanel/InputArea.tsx
git commit -m "feat(contacts): add workspace contacts page with character chat wiring"
```

---

### Task 8: 设置页供应商档案管理

**Files:**
- Create: `src/renderer/src/components/Settings/ProviderProfilesCard.tsx`
- Modify: `src/renderer/src/components/Settings/Settings.tsx`

- [ ] **Step 1: ProviderProfilesCard 组件**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { ResolvedProviderProfile } from '../../../../shared/config'

interface ProfileDraft { id: string; name: string; provider: 'openai' | 'claude'; baseUrl: string; apiKey: string }

const EMPTY: ProfileDraft = { id: `p-${Date.now()}`, name: '', provider: 'openai', baseUrl: '', apiKey: '' }

export default function ProviderProfilesCard() {
  const [profiles, setProfiles] = useState<ResolvedProviderProfile[]>([])
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    void window.electronAPI.providerProfiles.list().then(setProfiles).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])

  const save = useCallback(async () => {
    if (!draft) return
    try {
      setProfiles(await window.electronAPI.providerProfiles.save(draft))
      setDraft(null)
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，请重试。')
    }
  }, [draft])

  const remove = useCallback(async (id: string) => {
    try {
      setProfiles(await window.electronAPI.providerProfiles.remove(id))
      setError('')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败，请重试。')
    }
  }, [])

  return <section className="settings-card provider-profiles-card" aria-label="供应商档案">
    <h3>供应商档案</h3>
    <p className="settings-hint">角色可选用不同的档案；「默认」档案即上方的 AI 配置。</p>
    <ul>
      {profiles.map((profile) => <li key={profile.id}>
        <strong>{profile.name}</strong>
        <span> {profile.provider === 'claude' ? 'Claude' : 'OpenAI 兼容'} · {profile.baseUrl}</span>
        {!profile.builtIn && <>
          <button type="button" onClick={() => setDraft({ id: profile.id, name: profile.name, provider: profile.provider, baseUrl: profile.baseUrl, apiKey: profile.apiKey })}>编辑</button>
          <button type="button" className="danger" onClick={() => { void remove(profile.id) }}>删除</button>
        </>}
      </li>)}
    </ul>
    {error && <p role="alert" className="settings-error">{error}</p>}
    {draft
      ? <div className="provider-profile-form">
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="档案名称" maxLength={64} />
          <select value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value as 'openai' | 'claude' })}>
            <option value="openai">OpenAI 兼容</option>
            <option value="claude">Claude</option>
          </select>
          <input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="Base URL" />
          <input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="API Key" />
          <div>
            <button type="button" onClick={() => setDraft(null)}>取消</button>
            <button type="button" onClick={() => { void save() }} disabled={!draft.name.trim() || !draft.baseUrl.trim()}>保存</button>
          </div>
        </div>
      : <button type="button" onClick={() => setDraft({ ...EMPTY, id: `p-${Date.now()}` })}>新建档案</button>}
  </section>
}
```

- [ ] **Step 2: Settings.tsx 挂载**

import 区加 `import ProviderProfilesCard from './ProviderProfilesCard'`。在 AI Provider 配置卡片（含 Base URL L385 / API Key L397 输入的卡片，L370-420 一带）的 JSX 末尾、该卡片闭合标签之前插入：

```tsx
        <ProviderProfilesCard />
```

（Settings.tsx 采用 blur 即存的现有交互；档案卡自带保存按钮，不冲突。）

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 0 错误

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/Settings/ProviderProfilesCard.tsx src/renderer/src/components/Settings/Settings.tsx
git commit -m "feat(contacts): manage named provider profiles in settings"
```

---

### Task 9: Electron 冒烟测试

**Files:**
- Create: `src/main/smoke/contacts-smoke.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: 写冒烟**

`src/main/smoke/contacts-smoke.ts`（结构对照 `chat-smoke.ts`：loopback provider + DOM 驱动；helper 复制自 chat-smoke 的 input/click，`waitForRenderer` 从 `./storage-smoke` 导入）：

```ts
import { BrowserWindow } from 'electron'
import { createServer, type ServerResponse } from 'http'
import { getCharacter, getConfig, saveConfig, listCharacters, DEFAULT_IMPORT_FALLDOWN } from '../database'
import { waitForRenderer } from './storage-smoke'

async function input(window: BrowserWindow, selector: string, value: string): Promise<void> {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing input ' + ${JSON.stringify(selector)});
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : (element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`).catch(error => { throw new Error(`Could not fill ${selector}: ${String(error)}`) })
}

async function click(window: BrowserWindow, selector: string): Promise<void> {
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) throw new Error('Missing or disabled control ' + ${JSON.stringify(selector)});
    button.click();
  })()`).catch(error => { throw new Error(`Could not click ${selector}: ${String(error)}`) })
}

/** Contacts page, character CRUD and per-character stream resolution against a loopback provider. */
export async function runContactsSmoke(window: BrowserWindow): Promise<void> {
  const originalConfig = getConfig()
  let chatBody: Record<string, unknown> | undefined
  let prompt = ''
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      if (request.url?.endsWith('/chat/completions')) {
        const payload = JSON.parse(body || '{}')
        chatBody = payload
        prompt = String((payload.messages ?? [])[0]?.content ?? '')
        response.setHeader('Content-Type', 'text/event-stream')
        response.write('data: {"choices":[{"delta":{"content":"喵"}}]}\n\n')
        response.write('data: [DONE]\n\n')
      }
      response.end()
      void (request as { socket?: { end?: () => void } }).socket
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`
  try {
    saveConfig({ provider: 'openai', baseUrl, apiKey: 'smoke-key', model: 'default-model' })

    // 1) 通讯录页可达
    await click(window, '[data-workspace-nav="contacts"]')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contacts-root]'))")

    // 2) 通过 UI 建角色
    await click(window, '[data-contacts-new]')
    await input(window, '[data-contacts-name]', '冒烟猫')
    await input(window, '[data-contacts-model]', 'cat-model')
    await input(window, '[data-contacts-soulmd]', '# 冒烟猫人设，仅测试用。')
    await click(window, '[data-contacts-save]')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contacts-form]') === false)")
    const character = listCharacters().find((item) => item.name === '冒烟猫')
    if (!character) throw new Error('Character was not created')

    // 3) 点击角色进入会话页，chip 可见
    await click(window, `[data-contacts-item="${character.id}"]`)
    await waitForRenderer(window, `document.querySelector('[data-workspace-page]')?.getAttribute('data-workspace-page') === 'chat'`)
    await waitForRenderer(window, `Boolean(document.querySelector('[data-character-chip="${character.id}"]'))`)

    // 4) 角色流解析：请求命中 loopback 且使用角色模型与人设
    const streamResult = await window.webContents.executeJavaScript(`window.electronAPI.ai.startStream({
      requestId: 'contacts-smoke-1',
      messages: [{ role: 'user', content: '你好' }],
      systemPrompt: 'prompt-placeholder',
      characterId: ${JSON.stringify(character.id)}
    }).then((result) => JSON.stringify(result))`)
    if (!/ok/.test(streamResult)) throw new Error(`Character stream failed: ${streamResult}`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (!chatBody || chatBody.model !== 'cat-model') throw new Error(`Expected character model on loopback, got ${JSON.stringify(chatBody?.model)}`)

    // 5) 删除角色并确认
    await click(window, '[data-workspace-nav="contacts"]')
    await click(window, `[data-contacts-delete="${character.id}"]`)
    await click(window, '[data-contacts-confirm-delete]')
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (getCharacter(character.id)) throw new Error('Character was not deleted')
    if (getConfig().baseUrl !== baseUrl) { /* config restored below regardless */ }
  } finally {
    saveConfig(originalConfig)
    server.close()
  }
}
```

实现期修正两点：(a) 删除 `DEFAULT_IMPORT_FALLDOWN` 这个不存在的导入，`database` 只导入 `getCharacter, getConfig, saveConfig, listCharacters`；(b) systemPrompt 占位 `'prompt-placeholder'` 保留即可（主进程会覆盖模型/密钥，但 systemPrompt 由调用方给什么发什么——断言只看 model，不校验 prompt，`prompt` 变量仅调试用可删）。streamResult 判断改为解析 JSON：`const parsed = JSON.parse(streamResult); if (!parsed.ok) throw ...`。

- [ ] **Step 2: 注册**

`src/main/index.ts`：import 区加 `import { runContactsSmoke } from './smoke/contacts-smoke'`；`await runChatRuntimeSmoke(mainWindow!)` 之后插入：

```ts
        await runContactsSmoke(mainWindow!)
```

- [ ] **Step 3: 运行冒烟**

Run: `npm run test:smoke`
Expected: `Electron smoke test passed.`（既有已知环境问题：runtime-ui 拖拽断言在本机历史恒失败——若仅该项失败按既有基线放行并记录，其余失败必须修）

- [ ] **Step 4: 提交**

```bash
git add src/main/smoke/contacts-smoke.ts src/main/index.ts
git commit -m "test(contacts): smoke contacts page, character stream and cascade delete"
```

---

### Task 10: 全量门禁与文档

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: 全量验证**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全部通过（vitest 450+ 用例含新增；构建产物生成）

- [ ] **Step 2: roadmap 记录**

`docs/roadmap.md` 在任务/主线进度区（「当前主线：桌面工作日志」章节之前或最新进度段落之后，按文件现有排版）追加一段：

```markdown
通讯录与 AI 角色一期已实现：供应商档案（设置页具名管理，首个「默认」档案为全局配置实时视图）、角色 CRUD（内置「丑鱼」不可删，人设/模型写回全局配置）、会话 characterId 归属与旧会话迁移（STORE_VERSION 4）、聊天流按角色解析档案/模型/人设、工作区「通讯录」页（搜索/点击开聊/级联删除会话）。设计见 [角色通讯录 spec](superpowers/specs/2026-09-15-contacts-characters-design.md)。二期候选：分组/置顶/未读计数、头像图片上传、角色导入导出。
```

- [ ] **Step 3: 提交**

```bash
git add docs/roadmap.md
git commit -m "docs: record contacts and characters phase one in roadmap"
```

---

## 自审记录（Self-Review）

1. **Spec 覆盖**：档案类型与合成（Task 1）、角色模型/解析（Task 2）、存储/迁移/级联（Task 3）、聊天链路（Task 4）、IPC（Task 5）、渲染接线与 soulMd（Task 6）、通讯录页+导航+点击开聊+删除确认（Task 7）、档案管理 UI（Task 8）、冒烟+门禁+roadmap（Task 9/10）。Spec 的「每角色会话列表过滤」由 Task 7 Step 4(3) 覆盖；「解析失败不静默回退」由 Task 2 错误分支 + Task 4 返回 `{ok:false,error}` 覆盖。
2. **占位符**：Task 3/7/9 中标注「实现期修正」的三处代码笔误已显式给出修正说明，无 TBD。
   **Task 2 实现期修正（已镜像）**：(a) 原测试第 8 例用 `providerProfileId:'default'` 断言档案缺失——但 Task 1 的 `getProviderProfiles` 会从已配置全局字段无条件合成可用的 default 档案，该断言与第 10 例（同输入期待 ok:true）自相矛盾；夹具改为 `'p1'`。(b) 原 `normalizeCharacters` 声明了 `ids` 却未查重（重复 id 会多出一个角色），后缀公式 `filter(...).length + 2` 首个冲突即得「小猫 3」；改为 ids 查重 + while 循环后缀（与 sanitizeProviderProfiles 同构）。(c) 原实现每次 normalize 用 `Date.now()` 覆盖 createdAt/updatedAt，Task 3 落库后每次重启都会重置时间戳；改为保留有限持久值、缺失时回退。(d) 质量审修正（f77f5ca）：名称查重种子改用「解析后的默认角色名」而非常量「丑鱼」（两遍扫描，消除默认角色改名后的重名漏网与顺序依赖）；新增 `clampCodePoints` 按码点截断名字/头像、头像回退取首个完整码点（防 emoji 代理对截断）；默认分支复用 `isAIConfigured`。
   **Task 3 实现期修正（已镜像）**：(a) 测试文件的 electron mock 原本 `isEncryptionAvailable: () => false` 使 protect() 直通明文、`safe:v1:` 落盘断言必失败；为 hoisted mock 增加 `encryptionAvailable` 开关（默认 false 保持既有用例语义）+ 可用的 encryptString/decryptString，仅持久化用例开启。(b) `updateCharacter` 内置分支的「默认档案」守卫需先于通用档案存在性检查，否则 p9 用例抛错信息错误。(c) 质量审修正（92c2ee1）：`getCharacter` 返回浅拷贝、`findCharacterByIdOrThrow` 直接在 store.characters 上查找（updateCharacter 仍改活引用）；删除内置分支 saveConfig 后冗余的 persist()；新增真实 v3→v4 落盘迁移用例（version:3、无 characterId、无 characters 键）与契约用例（上限 12、大小写去重排除自身、未知角色回退默认、内置 stats 的 soulMd/model 恒为空串——UI 从 config 解析实时值）。
   **Task 4 实现期修正（已镜像）**：解析失败的 early-return 放在 `activeAIRequests.set` 与 destroyed 监听注册之前（失败时不注册 controller，免清理）；补充 ai-engine 测试（8426fa3）固定「带 characterId 时跳过渲染层预检并透传」。characterId 校验正则与 requestId 同族：`/^[a-zA-Z0-9_-]{1,128}$/`。
   **Task 5 实现期修正（已镜像）**：(a) `db:create-session` 保持文件既有裸调用 + `title.slice(0,80)` 形式，仅加 characterId 透传（文件中不存在 guardDatabaseErrors）。(b) `notifyJournalConfig(config)` 实签名在 `src/main/journal/index.ts`，调用传 `getConfig()`。(c) `src/renderer/src/core/session-order.test.ts` 的 ChatSessionSummary 夹具需补 `characterId`（必填字段编译修复，随任务提交）。(d) 质量审修正（8fc81cf）：`provider-profiles:save` 在 saveConfig 前加 `next.length > MAX_PROVIDER_PROFILES` 守卫并抛「最多支持 8 个供应商档案。」——否则 sanitizeProviderProfiles 静默截断时，追加在末尾的新档案会被丢弃而前端收到成功。
3. **类型一致性**：`CharacterStats`/`CharacterDraft`/`ResolvedProviderProfile`/`DEFAULT_CHARACTER_ID='chouyu'`/`DEFAULT_PROFILE_ID='default'` 全计划一致；`createChatSession(title?, characterId?)`、`createSession(characterId?)`、`streamChat(..., characterId?)` 签名前后一致。
