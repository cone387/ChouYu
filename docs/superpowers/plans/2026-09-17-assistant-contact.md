# 助手内置联系人与会话化主动消息 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 助手成为内置联系人（微信"文件传输助手"式），一切主动消息以真实聊天消息进入混合最近会话列表（含未读徽标、托盘闪动、红点、稍后提醒），删除独立消息中心 ProactiveCenter 与 8 秒宠物气泡，旧 proactive-messages 历史一次性迁入助手会话。

**Architecture:** 三层改造——① 数据层（`shared/characters.ts` 播种助手角色 + `main/database.ts` 的 `appendAssistantMessage`/`lastReadAt`/未读/迁移）；② 管道层（`proactive:append` IPC 落库 + 主进程广播 `sessions:changed`/`assistant-unread-changed`，托盘未读改由主进程驱动）；③ 渲染层（ProactiveEngine 重构为纯调度器、App 重接、ChatPanel 增量接线、会话未读徽标、消息 hover"稍后提醒"）。

**Tech Stack:** Electron 33（main/preload/renderer）、React 18 + TS、vitest（fake timers）、源码契约测试（读源文件字符串断言）。

**Spec:** `docs/superpowers/specs/2026-09-17-assistant-contact-design.md`

**基线分支:** 从 `fix/workspace-session-list-toggle`（HEAD cb38073）切出 `feat/assistant-contact`。

**硬约束（每个任务收尾必须满足）:**
- `npm run typecheck` 与 `npm test` 全绿后才 commit（依赖性变更捆绑在同一任务内，禁止中间态红提交——7ceffcb 教训）。
- 源码契约测试（读源文件断言）必须与源码改动同任务更新。
- 命令统一：`npm test -- <file>` 跑单文件，`npm run typecheck` 双端类型检查。

---

### Task 1: 内置助手角色（shared/characters.ts）

**Files:**
- Modify: `src/shared/characters.ts`
- Test: `src/shared/characters.test.ts`
- Test: `src/main/database.test.ts`（既有计数断言随助手 +1 更新）

- [ ] **Step 1: 建分支**

```bash
git checkout -b feat/assistant-contact
```

- [ ] **Step 2: 写失败测试**

在 `src/shared/characters.test.ts` 末尾追加（并在顶部 import 花括号内加入 `ASSISTANT_CHARACTER_ID, ASSISTANT_SOUL_MD, createAssistantCharacter`）：

```ts
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
    expect(characters.slice(1).map((character) => character.name)).toEqual(['助手 2'])
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
```

同时更新既有断言（助手使总数 +1）：
- 第 77 行 `expect(characters).toHaveLength(PRESET_CHARACTERS.length + 1)` → `+ 2`
- 第 94 行 `expect(characters.slice(1).map((c) => c.name)).toEqual(['小猫', '小猫 2'])` → `characters.slice(2)`
- 第 100 行 `expect(normalizeCharacters(many)).toHaveLength(MAX_CHARACTER_COUNT)` → `toHaveLength(MAX_CHARACTER_COUNT + 1)`
- 第 112-114 行 'returns a single default entry' 测试：`expect(characters).toHaveLength(1)` → `toHaveLength(2)`，并在其后加 `expect(characters[1]).toMatchObject({ id: ASSISTANT_CHARACTER_ID, builtIn: true })`

- [ ] **Step 3: 跑测试确认失败**

```bash
npm test -- src/shared/characters.test.ts
```
Expected: FAIL（`ASSISTANT_CHARACTER_ID` 不存在）。

- [ ] **Step 4: 实现 characters.ts**

在 `createDefaultCharacter`（104-117 行）之后加：

```ts
export const ASSISTANT_CHARACTER_ID = 'assistant'
export const ASSISTANT_CHARACTER_NAME = '助手'
export const ASSISTANT_SOUL_MD = '你是丑鱼桌面助手，负责把问候、休息与任务提醒送到用户眼前。语气简短温暖，每条消息一到两句话，不啰嗦、不追问；用户回复时给务实的小建议。'

export function createAssistantCharacter(now = Date.now()): Character {
  return {
    id: ASSISTANT_CHARACTER_ID,
    name: ASSISTANT_CHARACTER_NAME,
    avatar: '🔔',
    category: '',
    soulMd: ASSISTANT_SOUL_MD,
    providerProfileId: DEFAULT_PROFILE_ID,
    model: '',
    builtIn: true,
    createdAt: now,
    updatedAt: now
  }
}

export function isAssistantCharacter(id: string): boolean {
  return id === ASSISTANT_CHARACTER_ID
}
```

`normalizeCharacters`（120-158 行）三处修改：

```ts
  const names = new Set<string>([defaultCharacter.name, ASSISTANT_CHARACTER_NAME])
  const ids = new Set<string>([DEFAULT_CHARACTER_ID, ASSISTANT_CHARACTER_ID])
```

第二个循环的跳过条件（143 行）：

```ts
    if (!id || isDefaultCharacter(id) || isAssistantCharacter(id)) continue
```

返回值（157 行）：

```ts
  return [defaultCharacter, createAssistantCharacter(), ...custom]
```

`resolveCharacterConfig`（170-179 行）的内置分支改为统一走 `builtIn`（默认角色 soulMd 恒空回落全局；助手优先自身 soulMd）：

```ts
export function resolveCharacterConfig(character: Character | undefined | null, config: AppConfig): CharacterResolution {
  if (!character || character.builtIn) {
    if (!isAIConfigured(config)) {
      return { ok: false, error: '内置角色使用设置页的 AI 配置，请先完成 Base URL、API Key 和模型设置。' }
    }
    return {
      ok: true,
      config: { provider: config.provider, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, soulMd: character?.soulMd || config.soulMd }
    }
  }
```

（其余 custom 分支 180-189 行不动。默认角色现有断言 `soulMd: DEFAULT_SOUL_MD`、错误文案含'设置页'仍通过。）

- [ ] **Step 5: 更新 database.test.ts 既有计数断言**

`src/main/database.test.ts` 24 行 import 加入 `ASSISTANT_CHARACTER_ID`（若 Task 2 之前暂不用可不加）：
- 第 268 行 `expect(characters).toHaveLength(PRESET_CHARACTERS.length + 1)` → `+ 2`
- 第 297 行 `expect(listCharacters()).toHaveLength(MAX_CHARACTER_COUNT)` → `toHaveLength(MAX_CHARACTER_COUNT + 1)`
  （该测试第 294 行循环造满 `MAX_CHARACTER_COUNT - 1` 个自定义角色——上限语义由 Task 2 的 createCharacter 改动保持，此处只是助手常驻使总数 +1。**本任务先只改 268/297 行让套件绿；若 298 行 `toThrow(/最多支持/)` 失败，说明 createCharacter 的 `store.characters.length >= MAX_CHARACTER_COUNT` 判断被助手挤爆——此时把 Task 2 Step 5 的 createCharacter 上限改动提前到本任务一并提交。**）

- [ ] **Step 6: 跑测试确认通过**

```bash
npm test -- src/shared/characters.test.ts src/main/database.test.ts && npm run typecheck
```
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/shared/characters.ts src/shared/characters.test.ts src/main/database.test.ts
git commit -m "feat(characters): seed built-in assistant contact with fixed soul"
```

---

### Task 2: 数据库层——助手会话、未读、迁移（main/database.ts）

**Files:**
- Modify: `src/main/database.ts`
- Modify: `src/renderer/src/shared/types.ts`（renderer 侧 ChatSessionSummary 加 unreadCount）
- Test: `src/main/database.test.ts`

- [ ] **Step 1: 写失败测试**

`src/main/database.test.ts` 顶部 import（19-23 行块）加入 `appendAssistantMessage, getAssistantUnreadCount, markSessionRead`，文件末尾追加：

```ts
describe('assistant messages', () => {
  it('creates the assistant session on first append and appends in order', () => {
    const first = appendAssistantMessage('问候一', 1000)
    const summary = first.sessions.find((session) => session.characterId === 'assistant')
    expect(summary?.title).toBe('助手消息')
    expect(summary?.messageCount).toBe(1)
    expect(summary?.unreadCount).toBe(1)
    appendAssistantMessage('问候二', 2000)
    const id = first.sessions.find((session) => session.characterId === 'assistant')!.id
    expect(getSession(id)?.messages.map((item) => [item.content, item.role, item.timestamp]))
      .toEqual([['问候一', 'assistant', 1000], ['问候二', 'assistant', 2000]])
    expect(getSession(id)?.updatedAt).toBe(2000)
    expect(getSessions().find((session) => session.id === id)?.unreadCount).toBe(2)
  })

  it('clears unread via markSessionRead and via selecting the assistant session', () => {
    const workspace = appendAssistantMessage('新消息', Date.now())
    const id = workspace.sessions.find((session) => session.characterId === 'assistant')!.id
    expect(getAssistantUnreadCount()).toBe(1)
    expect(markSessionRead(id).sessions.find((session) => session.id === id)?.unreadCount).toBe(0)
    expect(getAssistantUnreadCount()).toBe(0)
    appendAssistantMessage('又一条', Date.now() + 10)
    expect(getAssistantUnreadCount()).toBe(1)
    selectChatSession(id)
    expect(getAssistantUnreadCount()).toBe(0)
    expect(getSessions().find((session) => session.id === id)?.unreadCount).toBe(0)
  })

  it('keeps unread badges exclusive to assistant sessions', () => {
    const id = getActiveSession().id
    saveSessionMessages(id, [message('普通消息')])
    expect(getSessions().find((session) => session.id === id)?.unreadCount).toBe(0)
    expect(getAssistantUnreadCount()).toBe(0)
  })

  it('keeps lastReadAt across restart', () => {
    const workspace = appendAssistantMessage('重启前', Date.now())
    const id = workspace.sessions.find((session) => session.characterId === 'assistant')!.id
    markSessionRead(id)
    appendAssistantMessage('重启后', Date.now() + 100)
    flushDatabase()
    initDatabase()
    const summary = getSessions().find((session) => session.id === id)
    expect(summary?.unreadCount).toBe(1)
  })

  it('migrates legacy proactive-messages once, ordered, skipping malformed entries', () => {
    const legacy = JSON.stringify([
      { id: 'p1', message: '旧问候', createdAt: 2000 },
      { id: 'p2', message: '旧提醒', createdAt: 1000 },
      { id: 'bad', message: 42, createdAt: 3000 },
      'junk'
    ])
    fs.writeFileSync(storePath(), JSON.stringify({
      version: 4,
      config: { ...DEFAULT_APP_CONFIG },
      characters: [],
      sessions: [],
      activeSessionId: '',
      state: { 'proactive-messages': legacy }
    }))
    initDatabase()
    const assistant = getSessions().find((session) => session.characterId === 'assistant')
    expect(assistant?.messageCount).toBe(2)
    const id = assistant!.id
    expect(getSession(id)?.messages.map((item) => item.content)).toEqual(['旧提醒', '旧问候'])
    initDatabase()
    expect(getSession(id)?.messages).toHaveLength(2)
  })

  it('rejects editing the assistant but allows deleting its sessions', () => {
    const workspace = appendAssistantMessage('守卫', Date.now())
    const id = workspace.sessions.find((session) => session.characterId === 'assistant')!.id
    expect(() => updateCharacter(ASSISTANT_CHARACTER_ID, { name: '改名', avatar: 'x', soulMd: '', providerProfileId: 'default', model: 'm' })).toThrow('不可编辑')
    expect(() => deleteCharacter(ASSISTANT_CHARACTER_ID)).toThrow('不可删除')
    expect(deleteChatSession(id).sessions.some((session) => session.id === id)).toBe(false)
  })
})
```

（`selectChatSession` 需加入顶部 import；`updateCharacter` 已在。）

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- src/main/database.test.ts
```
Expected: FAIL（`appendAssistantMessage` 不存在）。

- [ ] **Step 3: 实现 database.ts**

3a. import 块（11-14 行）加入助手标识：

```ts
import {
  ASSISTANT_CHARACTER_ID, Character, CharacterStats, DEFAULT_CHARACTER_ID, MAX_CHARACTER_COUNT, PRESET_CHARACTERS,
  isAssistantCharacter, normalizeCharacters, sanitizeCharacterDraft
} from '../shared/characters'
```

3b. `ChatSession`（36-43 行）加字段：`lastReadAt?: number`；`ChatSessionSummary`（45-53 行）加字段：`unreadCount: number`。

3c. `normalizeSessions` 返回对象（205-212 行）保留 lastReadAt：

```ts
      const lastReadAt = Number.isFinite(input.lastReadAt) ? Number(input.lastReadAt) : undefined
      return {
        id,
        title: normalizeSessionTitle(typeof input.title === 'string' ? input.title : deriveSessionTitle(messages)),
        messages,
        characterId: typeof input.characterId === 'string' && input.characterId.trim() ? input.characterId.trim().slice(0, 128) : DEFAULT_CHARACTER_ID,
        createdAt,
        updatedAt,
        ...(lastReadAt !== undefined ? { lastReadAt } : {})
      }
```

3d. `toSummary`（228-238 行）：

```ts
function toSummary(session: ChatSession): ChatSessionSummary {
  return {
    id: session.id,
    title: session.title,
    preview: buildSessionPreview(session.messages),
    messageCount: session.messages.length,
    characterId: session.characterId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    unreadCount: isAssistantCharacter(session.characterId)
      ? session.messages.filter((message) => message.timestamp > (session.lastReadAt ?? 0)).length
      : 0
  }
}
```

3e. 新函数放在 `selectChatSession`（462-467 行）之后：

```ts
export function appendAssistantMessage(content: string, timestamp?: number): SessionWorkspace {
  const at = Number.isFinite(timestamp) ? Number(timestamp) : Date.now()
  let session = store.sessions.find((candidate) => isAssistantCharacter(candidate.characterId))
  if (!session) {
    session = createSession([], '助手消息', at, ASSISTANT_CHARACTER_ID)
    store.sessions.unshift(session)
  }
  session.messages.push({ id: randomUUID(), role: 'assistant', content: content.slice(0, 20_000), timestamp: at })
  session.updatedAt = at
  persist(false)
  return getSessionWorkspace()
}

export function markSessionRead(id: string): SessionWorkspace {
  const session = store.sessions.find((candidate) => candidate.id === id)
  if (!session) throw new Error('会话不存在或已被删除。')
  session.lastReadAt = Date.now()
  persist(false)
  return getSessionWorkspace()
}

export function getAssistantUnreadCount(): number {
  return store.sessions
    .filter((session) => isAssistantCharacter(session.characterId))
    .reduce((total, session) => total + session.messages.filter((message) => message.timestamp > (session.lastReadAt ?? 0)).length, 0)
}
```

3f. `selectChatSession` 选中助手会话时顺手标读：

```ts
export function selectChatSession(id: string): SessionWorkspace {
  const session = store.sessions.find((candidate) => candidate.id === id)
  if (!session) throw new Error('会话不存在或已被删除。')
  store.activeSessionId = id
  if (isAssistantCharacter(session.characterId)) session.lastReadAt = Date.now()
  persist()
  return getSessionWorkspace()
}
```

3g. `updateCharacter`（528 行起）加守卫（`findCharacterByIdOrThrow` 之后）：

```ts
  if (isAssistantCharacter(id)) throw new Error('内置助手不可编辑。')
```

3h. `createCharacter` 上限改为数自定义角色（助手/默认不占上限，512-514 行）：

```ts
  const customCount = store.characters.filter((item) => !item.builtIn).length
  if (customCount >= MAX_CHARACTER_COUNT - 1) throw new Error(`最多支持 ${MAX_CHARACTER_COUNT} 个角色。`)
```

3i. `seedPresetCharacters`（372-390 行）同样的计数修正——374 行后算 `const customCount = () => store.characters.filter((item) => !item.builtIn).length`，循环内 379 行 `if (store.characters.length >= MAX_CHARACTER_COUNT) break` → `if (customCount() >= MAX_CHARACTER_COUNT - 1) break`。

3j. `saveSessionMessages`（566-579 行）在 `session.updatedAt = Date.now()` 之后加一行——渲染层保存消息即意味着用户正在助手会话里对话，AI 回复不当未读：

```ts
  if (isAssistantCharacter(session.characterId)) session.lastReadAt = Date.now()
```

3k. 历史迁移：`backfillPresetCategories`（393-403 行）之后加：

```ts
/** 旧版消息中心的 proactive-messages 历史一次性迁入助手会话，幂等。 */
function migrateProactiveMessages(): void {
  if (store.state['proactive-migrated']) return
  const raw = store.state['proactive-messages']
  store.state['proactive-migrated'] = String(Date.now())
  if (!raw) return
  let entries: unknown[] = []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) entries = parsed
  } catch { /* malformed legacy payload: drop it */ }
  const legacy = entries
    .flatMap((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).message === 'string'
      && Number.isFinite((item as Record<string, unknown>).createdAt)
      ? [{ message: (item as Record<string, unknown>).message as string, createdAt: Number((item as Record<string, unknown>).createdAt) }]
      : [])
    .sort((a, b) => a.createdAt - b.createdAt)
  for (const item of legacy) appendAssistantMessage(item.message, item.createdAt)
}
```

`initDatabase`（405-414 行）在 `backfillPresetCategories()` 之后调用：

```ts
  store = load()
  seedPresetCharacters()
  backfillPresetCategories()
  migrateProactiveMessages()
  persist(false)
```

3l. renderer 类型：`src/renderer/src/shared/types.ts` 的 `ChatSessionSummary`（237-246 行）加 `unreadCount?: number`。

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- src/main/database.test.ts && npm run typecheck
```
Expected: PASS（Task 1 提前改过 268/297 行则直接绿；若 Task 1 未提前改 createCharacter 上限，此处一并绿）。

- [ ] **Step 5: 跑全量测试防回归**

```bash
npm test
```
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/database.ts src/main/database.test.ts src/renderer/src/shared/types.ts
git commit -m "feat(db): assistant session append, unread model and legacy migration"
```

---

### Task 3: 托盘未读主进程化 + open-assistant-chat 通道（main/tray.ts + index.ts）

**Files:**
- Modify: `src/main/tray.ts`
- Modify: `src/main/index.ts:11,13,295-299`
- Test: `src/shared/pet-icon.test.ts`

- [ ] **Step 1: 更新源码契约测试**

`src/shared/pet-icon.test.ts` 第 19 行：

```ts
    expect(traySource).toContain("mainWindow.webContents.send('open-assistant-chat')")
    expect(traySource).not.toContain('proactive-unread-changed')
```

（替换原 `open-messages-center` 断言；其余断言不动。）

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- src/shared/pet-icon.test.ts
```
Expected: FAIL（tray.ts 仍发送 open-messages-center）。

- [ ] **Step 3: 改造 tray.ts**

3a. 模块级状态（6-8 行区域）：

```ts
let tray: Tray | null = null
let petVisibilityItem: MenuItem | null = null
let trayUnreadCount = 0
let trayFlasher: TrayFlasher | null = null
let updateTrayStatus: (() => void) | null = null
```

3b. 新模块级导出（放在 `setTrayPetVisible` 之后）：

```ts
export function setTrayUnread(count: number): void {
  const next = Math.max(0, Math.floor(count) || 0)
  trayUnreadCount = next
  if (!tray || tray.isDestroyed()) return
  if (trayFlasher) {
    if (next > 0) trayFlasher.start()
    else trayFlasher.stop()
  }
  updateTrayStatus?.()
}
```

3c. `setupTray` 内：
- 20 行 `const flasher = new TrayFlasher({...})` 之后加 `trayFlasher = flasher`
- `openMessages` 改名 `openAssistantChat`，39 行发送通道改 `mainWindow.webContents.send('open-assistant-chat')`；菜单项 `{ label: '助手消息', click: openAssistantChat }`
- 87 行 `const updateJournalStatus = () => {...}` 之后加 `updateTrayStatus = updateJournalStatus`
- 删除局部 `const setTrayUnread = ...`（99-106 行）、`ipcMain.removeAllListeners('proactive-unread-changed')` 与其 `ipcMain.on`（107-110 行）
- `onTrayClick`（117-120 行）中 `openMessages()` 改 `openAssistantChat()`
- 顶部 import 去掉不再使用的 `ipcMain`（保留——`pet-visibility-changed` 仍在用，实际只删 proactive 相关两行）

3d. `src/main/index.ts`：
- 11 行 `import { setupTray } from './tray'` → `import { setTrayUnread, setupTray } from './tray'`
- 13 行 database import 加入 `getAssistantUnreadCount`
- 295-299 行：

```ts
  if (!isSmokeTest) {
    setupTray(mainWindow!)
    setTrayUnread(getAssistantUnreadCount())
    registerHotkey(mainWindow!)
    setClipboardWatcherEnabled(mainWindow!, getConfig().clipboardWatch)
  }
```

（启动竞态自愈：早于 setupTray 的 append 已更新 trayUnreadCount，此处重放真值。）

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- src/shared/pet-icon.test.ts && npm run typecheck && npm test
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/tray.ts src/main/index.ts src/shared/pet-icon.test.ts
git commit -m "feat(tray): drive unread flashing from main process via open-assistant-chat"
```

---

### Task 4: IPC 处理器与 preload 增量（纯增量，渲染层尚未使用）

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/shared/types.ts`

- [ ] **Step 1: ipc.ts 新增处理器**

1a. import：`./database` 块（70-95 行）加入 `appendAssistantMessage, getAssistantUnreadCount, markSessionRead`；文件顶部加 `import { setTrayUnread } from './tray'`。

1b. `notifyCharactersChanged`（787-789 行）之后加：

```ts
  const notifyAssistantUnread = () => {
    const count = getAssistantUnreadCount()
    setTrayUnread(count)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('assistant-unread-changed', count)
  }
```

1c. `db:create-session` 处理器（784-785 行）之后加：

```ts
  ipcMain.handle('proactive:append', (_event, content: unknown, timestamp?: unknown) => {
    if (typeof content !== 'string' || !content.trim() || content.length > 20_000) throw new Error('Invalid proactive content')
    const at = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : undefined
    appendAssistantMessage(content, at)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sessions:changed')
    notifyAssistantUnread()
  })
  ipcMain.handle('proactive:get-unread', () => getAssistantUnreadCount())
  ipcMain.handle('db:mark-session-read', (_event, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
    const workspace = markSessionRead(id)
    notifyAssistantUnread()
    return workspace
  })
```

1d. 既有 `db:delete-session`（851-854 行）与 `db:save-session-messages`（855-859 行）处理器改为返回前刷新未读：

```ts
  ipcMain.handle('db:delete-session', (_event, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
    const workspace = deleteChatSession(id)
    notifyAssistantUnread()
    return workspace
  })
  ipcMain.handle('db:save-session-messages', (_event, id: string, messages) => {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
    if (!Array.isArray(messages)) throw new Error('Invalid session messages')
    const workspace = saveSessionMessages(id, messages)
    notifyAssistantUnread()
    return workspace
  })
```

- [ ] **Step 2: preload/index.ts 增量**

`notifyPetVisible`（229-231 行）之后加：

```ts
  proactiveAppend: (content: string, timestamp?: number) => ipcRenderer.invoke('proactive:append', content, timestamp) as Promise<void>,
  getAssistantUnread: () => ipcRenderer.invoke('proactive:get-unread') as Promise<number>,
  onSessionsChanged: (callback: () => void) => {
    ipcRenderer.on('sessions:changed', callback)
    return () => { ipcRenderer.removeListener('sessions:changed', callback) }
  },
  onAssistantUnread: (callback: (count: number) => void) => {
    const handler = (_e: unknown, count: number) => callback(count)
    ipcRenderer.on('assistant-unread-changed', handler)
    return () => { ipcRenderer.removeListener('assistant-unread-changed', handler) }
  },
  onOpenAssistantChat: (callback: () => void) => {
    ipcRenderer.on('open-assistant-chat', callback)
    return () => { ipcRenderer.removeListener('open-assistant-chat', callback) }
  },
```

`db` 对象 `saveSessionMessages`（291 行）之后加：

```ts
    markSessionRead: (id: string) => ipcRenderer.invoke('db:mark-session-read', id),
```

- [ ] **Step 3: types.ts ElectronAPI 增量**

`src/renderer/src/shared/types.ts` 143-154 行区域（`notifyPetVisible` 之后）加：

```ts
  proactiveAppend: (content: string, timestamp?: number) => Promise<void>
  getAssistantUnread: () => Promise<number>
  onSessionsChanged: (callback: () => void) => () => void
  onAssistantUnread: (callback: (count: number) => void) => () => void
  onOpenAssistantChat: (callback: () => void) => () => void
```

`db` 块 `saveSessionMessages`（185 行）之后加：

```ts
    markSessionRead: (id: string) => Promise<SessionWorkspace>
```

- [ ] **Step 4: 验证**

```bash
npm run typecheck && npm test
```
Expected: PASS（纯增量，旧 API 仍在）。

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/shared/types.ts
git commit -m "feat(ipc): proactive append/get-unread/mark-read channels with preload bridge"
```

---

### Task 5: ChatPanel 增量接线 + 会话未读徽标

**Files:**
- Modify: `src/renderer/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/renderer/src/components/ConversationSidebar/ConversationSidebar.tsx:186-189`
- Modify: `src/renderer/src/components/ConversationSidebar/ConversationSidebar.css`
- Test: `src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts`

- [ ] **Step 1: 写失败测试**

`ChatPanel.layout.test.ts` 顶部加 `const messageSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/MessageArea.tsx'), 'utf8')`，文件末尾追加：

```ts
describe('assistant contact wiring', () => {
  it('focuses the assistant session on demand and follows main-side session updates', () => {
    expect(panelSource).toContain('assistantFocusRequest?: number')
    expect(panelSource).toContain('openCharacterChat(ASSISTANT_CHARACTER_ID)')
    expect(panelSource).toContain('onSessionsChanged')
    expect(panelSource).toContain('db.markSessionRead(activeSessionId)')
  })
  it('badges assistant unread on session cards', () => {
    expect(sidebarSource).toContain('conversation-item-unread')
    expect(sidebarSource).toContain("session.unreadCount > 99 ? '99+'")
    expect(sidebarStylesheet).toContain('#ff4d4f')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 ChatPanel.tsx**

3a. 21 行 import 加入助手 id：

```ts
import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID, INDUSTRY_LABELS } from '../../../../shared/characters'
```

3b. `ChatPanelProps` 末尾（63 行 `onPendingMessageConsumed?: () => void` 之后）加 `assistantFocusRequest?: number`；66 行解构参数末尾加 `assistantFocusRequest`。

3c. `openCharacterChat`（625-632 行）之后加三个 effect（`useRef` 已在顶部 import）：

```ts
  // 主进程在别的入口追加了助手消息（或会话结构变化）：重拉工作区，保留侧栏顺序。
  useEffect(() => window.electronAPI.onSessionsChanged(() => {
    void window.electronAPI.db.getSessionWorkspace()
      .then((workspace) => applyWorkspace(workspace, true))
      .catch(() => { /* 保留现有工作区，下次事件重试 */ })
  }), [applyWorkspace])

  // 托盘/宠物入口请求聚焦助手会话：只消费递增的那一次，不随 sessions 变化重放。
  const handledAssistantFocusRef = useRef(0)
  useEffect(() => {
    if (!assistantFocusRequest || assistantFocusRequest === handledAssistantFocusRef.current) return
    handledAssistantFocusRef.current = assistantFocusRequest
    void openCharacterChat(ASSISTANT_CHARACTER_ID)
  }, [assistantFocusRequest, openCharacterChat])

  // 阅读中不累计未读：当前会话是助手、面板展开且有新消息时自动标读。
  const activeAssistantUnread = sessions.find((session) => session.id === activeSessionId)?.unreadCount ?? 0
  useEffect(() => {
    if (!visible || !workspaceLoaded || !activeAssistantUnread) return
    if (activeCharacterId !== ASSISTANT_CHARACTER_ID) return
    void window.electronAPI.db.markSessionRead(activeSessionId)
      .then((workspace) => applyWorkspace(workspace, true))
      .catch(() => { /* 存储故障提示机制兜底 */ })
  }, [visible, workspaceLoaded, activeAssistantUnread, activeCharacterId, activeSessionId, applyWorkspace])
```

- [ ] **Step 4: ConversationSidebar 徽标**

`ConversationSidebar.tsx` title-row（187-189 行）在 streaming 标记之后加：

```tsx
                      {session.unreadCount ? <span className="conversation-item-unread" aria-label={`${session.unreadCount} 条未读`}>{session.unreadCount > 99 ? '99+' : session.unreadCount}</span> : null}
```

`ConversationSidebar.css` 末尾追加：

```css
.conversation-item-unread {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ff4d4f;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}
```

- [ ] **Step 5: 验证**

```bash
npm test -- src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts && npm run typecheck && npm test
```
Expected: PASS（App 尚未传 assistantFocusRequest，prop 可选不影响）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ChatPanel/ChatPanel.tsx src/renderer/src/components/ConversationSidebar/ConversationSidebar.tsx src/renderer/src/components/ConversationSidebar/ConversationSidebar.css src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts
git commit -m "feat(chat): assistant focus wiring, live session refresh and unread badges"
```

---

### Task 6: 渲染层管道切换（原子）+ 稍后提醒操作

两个 commit：6a 切管道（引擎重写 + App 重接 + Pet 改名 + preload/types 删旧 + ProactiveCenter 删除）；6b 消息 hover"稍后提醒"。

**Files (6a):**
- Modify: `src/renderer/src/core/proactive.ts`（重写）
- Test: `src/renderer/src/core/proactive.test.ts`（重写）
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Pet/Pet.tsx`
- Modify: `src/preload/index.ts`（删旧 API）
- Modify: `src/renderer/src/shared/types.ts`（删旧声明）
- Delete: `src/renderer/src/components/ProactiveCenter/`（组件 + CSS）
- Test: `src/renderer/src/App.layout.test.ts`

- [ ] **Step 1: 重写 proactive.test.ts（先写测试）**

全文替换为：

```ts
import { describe, expect, test, vi } from 'vitest'
import { ProactiveEngine, SNOOZE_PREFIX } from './proactive'

describe('ProactiveEngine', () => {
  test('greeting fires once through the callback only', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 8, 0))
    try {
      const engine = new ProactiveEngine()
      const seen: string[] = []
      engine.start((message) => { seen.push(message) }, { greeting: true, restReminder: false })
      expect(seen).toHaveLength(0)
      vi.advanceTimersByTime(3000)
      expect(seen).toHaveLength(1)
      expect(seen[0]).toContain('早上好')
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(seen).toHaveLength(1)
      engine.stop()
    } finally { vi.useRealTimers() }
  })

  test('rest reminders respect the cooldown window', () => {
    vi.useFakeTimers()
    try {
      const engine = new ProactiveEngine()
      const seen: string[] = []
      engine.start((message) => { seen.push(message) }, { greeting: false, restReminder: true })
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(seen).toHaveLength(0)
      vi.advanceTimersByTime(10 * 60 * 1000)
      expect(seen).toHaveLength(1)
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(seen).toHaveLength(1)
      vi.advanceTimersByTime(10 * 60 * 1000)
      expect(seen).toHaveLength(2)
      engine.stop()
    } finally { vi.useRealTimers() }
  })

  test('snoozeContent fires at the deadline with the prefix and stop cancels it', () => {
    vi.useFakeTimers()
    try {
      const engine = new ProactiveEngine()
      const seen: string[] = []
      engine.start((message) => { seen.push(message) }, { greeting: false, restReminder: false })
      engine.snoozeContent('喝水', 10)
      vi.advanceTimersByTime(10 * 60 * 1000 - 1)
      expect(seen).toHaveLength(0)
      vi.advanceTimersByTime(1)
      expect(seen).toEqual([`${SNOOZE_PREFIX}喝水`])
      engine.snoozeContent('取消我', 10)
      engine.stop()
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(seen).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })

  test('restoreSnoozes re-arms future items and fires overdue ones immediately', () => {
    vi.useFakeTimers()
    try {
      const engine = new ProactiveEngine()
      const seen: string[] = []
      engine.start((message) => { seen.push(message) }, { greeting: false, restReminder: false })
      engine.restoreSnoozes([
        { id: 'past', content: '错过的提醒', dueAt: Date.now() - 5000 },
        { id: 'future', content: '稍后的提醒', dueAt: Date.now() + 60_000 },
        { id: 'bad', content: '', dueAt: 1 },
        'junk'
      ])
      vi.advanceTimersByTime(1)
      expect(seen).toEqual([`${SNOOZE_PREFIX}错过的提醒`])
      vi.advanceTimersByTime(60_000)
      expect(seen).toEqual([`${SNOOZE_PREFIX}错过的提醒`, `${SNOOZE_PREFIX}稍后的提醒`])
      engine.stop()
    } finally { vi.useRealTimers() }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- src/renderer/src/core/proactive.test.ts
```
Expected: FAIL（SNOOZE_PREFIX/snoozeContent 不存在）。

- [ ] **Step 3: 重写 proactive.ts（纯调度器）**

全文替换为（保留问候文案、休息文案、冷却/间隔常量、欢迎回来逻辑；删除消息存储/localStorage messages/水合/markAllRead/remove/clearMessages/postExternal）：

```ts
/**
 * Proactive Engine - schedules the assistant's spontaneous messages.
 *
 * - Greet on first launch of the day (configurable)
 * - Remind the user to rest after 60 minutes of continuous use (configurable)
 * - At most one new proactive event per 60 minutes
 * - Delivered via callback; persistence lives in the assistant chat session
 */

const COOLDOWN = 60 * 60 * 1000 // 60 minutes
const REST_REMINDER_INTERVAL = 60 * 60 * 1000 // 60 minutes

export type ProactiveKind = 'greeting' | 'rest' | 'return' | 'task'
type ProactiveCallback = (message: string, kind?: ProactiveKind) => void

export interface ProactiveOptions {
  greeting: boolean
  restReminder: boolean
}

export const SNOOZE_PREFIX = '⏰ 稍后提醒：'

export interface AssistantSnooze {
  id: string
  content: string
  dueAt: number
}

export class ProactiveEngine {
  private lastProactiveTime = 0
  private restTimer: ReturnType<typeof setTimeout> | null = null
  private callback: ProactiveCallback | null = null
  private greetedDate: string | null = null
  private greetingTimer: ReturnType<typeof setTimeout> | null = null
  private snoozes = new Map<string, AssistantSnooze>()
  private snoozeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private interrupted = false
  private options: ProactiveOptions = { greeting: true, restReminder: true }

  start(callback: ProactiveCallback, options?: ProactiveOptions): void {
    this.stop()
    this.callback = callback
    this.snoozes.forEach((item) => this.scheduleSnooze(item))
    this.scheduleIdleCheck()
    this.options = options || { greeting: true, restReminder: true }
    this.greetedDate = this.readGreetingDate()

    // Greet after a short delay
    if (this.options.greeting && this.greetedDate !== this.today()) {
      this.greetingTimer = setTimeout(() => this.tryGreet(), 3000)
    }

    // Start rest reminder timer
    if (this.options.restReminder) {
      this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
    }
  }

  stop(): void {
    this.callback = null
    if (this.restTimer) {
      clearTimeout(this.restTimer)
      this.restTimer = null
    }
    if (this.greetingTimer) { clearTimeout(this.greetingTimer); this.greetingTimer = null }
    this.snoozeTimers.forEach(timer => clearTimeout(timer))
    this.snoozeTimers.clear()
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  /** Call this when user interacts to reset rest timer */
  userActivity(): void {
    if (!this.options.restReminder) return
    if (this.restTimer) clearTimeout(this.restTimer)
    this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
  }

  snoozeContent(content: string, minutes = 10): void {
    if (!content.trim()) return
    const item: AssistantSnooze = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content: content.slice(0, 20_000),
      dueAt: Date.now() + minutes * 60_000
    }
    this.snoozes.set(item.id, item)
    this.scheduleSnooze(item)
    this.persistSnoozes()
  }

  /** 启动时从 db state 恢复待提醒项：未来项重挂定时器，过期项立即触发。 */
  restoreSnoozes(items: unknown): void {
    this.snoozes.clear()
    this.snoozeTimers.forEach(timer => clearTimeout(timer))
    this.snoozeTimers.clear()
    if (Array.isArray(items)) {
      for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as Partial<AssistantSnooze>
        if (typeof item.id !== 'string' || !item.id) continue
        if (typeof item.content !== 'string' || !item.content.trim()) continue
        if (!Number.isFinite(item.dueAt)) continue
        this.snoozes.set(item.id, { id: item.id.slice(0, 128), content: item.content.slice(0, 20_000), dueAt: Number(item.dueAt) })
      }
    }
    this.snoozes.forEach((item) => this.scheduleSnooze(item))
    this.persistSnoozes()
  }

  private canSpeak(): boolean {
    return Date.now() - this.lastProactiveTime > COOLDOWN
  }

  private speak(message: string, kind: ProactiveKind = 'rest'): void {
    if (!this.callback) return
    this.lastProactiveTime = Date.now()
    this.callback(message, kind)
  }

  private persistSnoozes(): void {
    if (typeof window === 'undefined' || !window.electronAPI?.db) return
    try {
      void window.electronAPI.db.setState('assistant-snoozes', JSON.stringify([...this.snoozes.values()]))
        .catch(() => { /* storage notice covers persistence failures */ })
    } catch { /* unavailable */ }
  }

  private scheduleSnooze(item: AssistantSnooze): void {
    const existing = this.snoozeTimers.get(item.id)
    if (existing) clearTimeout(existing)
    const delay = Math.max(0, item.dueAt - Date.now())
    const timer = setTimeout(() => {
      this.snoozes.delete(item.id)
      this.snoozeTimers.delete(item.id)
      this.persistSnoozes()
      this.callback?.(`${SNOOZE_PREFIX}${item.content}`)
    }, delay)
    this.snoozeTimers.set(item.id, timer)
  }

  private today(): string {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }

  private tryGreet(): void {
    const today = this.today()
    if (this.greetedDate === today || !this.canSpeak()) return
    this.greetedDate = today
    try { localStorage.setItem('chouyu.proactive.greetingDate', today) } catch { /* unavailable */ }

    const hour = new Date().getHours()
    let greeting: string
    if (hour < 6) greeting = '这么晚还没睡呀...要注意休息哦 (´-ω-`)'
    else if (hour < 9) greeting = '早上好～新的一天开始啦 ☀️'
    else if (hour < 12) greeting = '上午好，今天也要加油鸭～'
    else if (hour < 14) greeting = '中午好～吃饭了没？'
    else if (hour < 18) greeting = '下午好，继续努力 (ง •_•)ง'
    else if (hour < 22) greeting = '晚上好～今天辛苦了'
    else greeting = '夜深了，别太晚睡哦 🌙'

    this.speak(greeting, 'greeting')
  }

  private readGreetingDate(): string | null {
    try { return localStorage.getItem('chouyu.proactive.greetingDate') } catch { return null }
  }

  private remindRest(): void {
    if (!this.canSpeak()) {
      this.restTimer = setTimeout(() => this.remindRest(), 10 * 60 * 1000)
      return
    }

    const messages = [
      '你已经连续工作一小时了，起来活动活动吧～ 🧘',
      '该休息一下了，看看远处放松眼睛 👀',
      '久坐不好哦，站起来伸个懒腰吧～',
      '喝杯水休息一下？你已经坐了好一会儿了 ☕'
    ]
    const msg = messages[Math.floor(Math.random() * messages.length)]
    this.speak(msg, 'rest')

    this.restTimer = setTimeout(() => this.remindRest(), REST_REMINDER_INTERVAL)
  }

  private scheduleIdleCheck(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => void this.checkIdle(), 15_000)
  }

  private async checkIdle(): Promise<void> {
    if (!this.callback || typeof window === 'undefined' || !window.electronAPI?.getSystemIdleSeconds) return
    try {
      const idleSeconds = await window.electronAPI.getSystemIdleSeconds()
      if (idleSeconds >= 600) this.interrupted = true
      else if (this.interrupted && idleSeconds < 30 && this.canSpeak()) {
        this.interrupted = false
        this.speak('欢迎回来。要接着刚才的工作吗？', 'return')
      }
    } catch { /* system idle is optional on unsupported platforms */ }
    this.scheduleIdleCheck()
  }
}

export const proactiveEngine = new ProactiveEngine()
```

- [ ] **Step 4: 跑引擎测试确认通过**

```bash
npm test -- src/renderer/src/core/proactive.test.ts
```
Expected: PASS（此时 App.tsx 还引用已删 API，typecheck 暂红——App 重接在同一步提交块内完成）。

- [ ] **Step 5: 重接 App.tsx**

5a. 删 import：第 7 行 ProactiveCenter；第 10 行改为 `import { proactiveEngine } from './core/proactive'`。

5b. 状态（31-33 行）替换为：

```ts
  const [assistantUnread, setAssistantUnread] = useState(0)
  const [assistantFocusRequest, setAssistantFocusRequest] = useState(0)
```

5c. 引擎 effect（128-165 行）整体替换为（问候/休息/回归经 `proactiveAppend` 落库；启动恢复 snoozes）：

```ts
  // Proactive engine - respect config
  useEffect(() => {
    const append = (message: string) => {
      void window.electronAPI.proactiveAppend(message).catch(() => { /* storage notice covers persistence failures */ })
    }
    proactiveEngine.start((msg, kind) => {
      if (kind === 'return') {
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        const to = Date.now()
        const from = to - 30 * 60_000
        void Promise.all([
          window.electronAPI.journal.overview({ from: start, to }),
          window.electronAPI.journal.list({ from, to, offset: 0 })
        ]).then(([day, recent]) => {
          const titles = [...new Set(recent.items.map(item => item.title.trim()).filter(Boolean))].slice(0, 3)
          const where = titles.length ? `刚才停在：${titles.join('、')}。` : ''
          append(day.activityCount > 0
            ? `欢迎回来。今天已经记录 ${day.activityCount} 段工作。${where}要接着刚才的工作吗？`
            : `欢迎回来。${where}要接着刚才的工作吗？`)
        }).catch(() => append(msg))
      } else {
        append(msg)
      }
    }, { greeting: config.proactiveGreeting, restReminder: config.proactiveRestReminder })
    void window.electronAPI.db.getState('assistant-snoozes').then(value => {
      if (!value) return
      try { proactiveEngine.restoreSnoozes(JSON.parse(value)) } catch { /* ignore malformed snooze history */ }
    }).catch(() => {})
    return () => proactiveEngine.stop()
  }, [config.proactiveGreeting, config.proactiveRestReminder])
```

5d. 删除 `persistProactiveMessages`（167-171 行）、未读推送 effect（173-176 行）、`onOpenMessages` effect（178-182 行）、8 秒气泡 effect（184-189 行）。

5e. 原位置加宠物红点状态 effect：

```ts
  // 助手未读驱动宠物红点；托盘由主进程驱动。
  useEffect(() => {
    void window.electronAPI.getAssistantUnread().then(setAssistantUnread).catch(() => {})
    return window.electronAPI.onAssistantUnread(setAssistantUnread)
  }, [])
```

5f. 任务提醒 effect（191-202 行）改为直写管道（文案不变）：

```ts
  // Task reminders from the main-process scheduler land in the assistant session.
  useEffect(() => {
    const cleanup = window.electronAPI.tasks.onTasksReminder(payload => {
      if ('task' in payload) void window.electronAPI.proactiveAppend(`任务提醒：${payload.task.title}`)
      else if (payload.backlog > 0) void window.electronAPI.proactiveAppend(`错过了 ${payload.backlog} 条任务提醒`)
    })
    const rebuiltCleanup = window.electronAPI.tasks.onTasksStoreRebuilt(() => {
      void window.electronAPI.proactiveAppend('任务数据文件无法读取，已重建空库，原文件已隔离保存。')
    })
    window.electronAPI.tasks.ready()
    return () => { cleanup(); rebuiltCleanup() }
  }, [])
```

5g. `onOpenChatPanel` effect（378-381 行）之后加：

```ts
  useEffect(() => {
    const cleanup = window.electronAPI.onOpenAssistantChat(() => {
      openChatPanel()
      setAssistantFocusRequest(current => current + 1)
    })
    return cleanup
  }, [openChatPanel])
```

5h. Pet props（537-552 行）：`onOpenMessages` 处理器替换、`hasUnread` 换源：

```tsx
          onOpenAssistantChat={() => {
            openChatPanel()
            setAssistantFocusRequest(current => current + 1)
          }}
          state={petState}
          size={config.petSize}
          onFileDrop={handleFileDrop}
          onFileDropError={setFileDropError}
          hasUnread={assistantUnread > 0}
```

5i. 删除 ProactiveCenter 渲染块（554-578 行）与气泡渲染块（579-593 行，含注释）。

5j. ChatPanel 渲染（624-645 行）props 末尾加 `assistantFocusRequest={assistantFocusRequest}`。

- [ ] **Step 6: Pet.tsx prop 改名**

`onOpenMessages` → `onOpenAssistantChat`：interface 13 行、解构 21 行、右键菜单 226 行按钮处理器。

- [ ] **Step 7: preload/types 删旧 API**

`src/preload/index.ts` 删 232-240 行（`setProactiveUnread` + `onOpenMessages`）。
`src/renderer/src/shared/types.ts` 删 146-147 行（`setProactiveUnread`、`onOpenMessages` 声明）。

- [ ] **Step 8: 删除 ProactiveCenter**

```bash
git rm -r src/renderer/src/components/ProactiveCenter
```

（若 Pet.css/App.css 有 `proactive-bubble` 专属样式一并删除，只删气泡专属规则。）

- [ ] **Step 9: 更新 App.layout.test.ts**

末尾追加：

```ts
describe('assistant message pipeline', () => {
  it('routes proactive messages into the assistant session instead of a standalone center', () => {
    expect(source).toContain('proactiveAppend')
    expect(source).toContain('restoreSnoozes')
    expect(source).toContain('onAssistantUnread(setAssistantUnread)')
    expect(source).toContain('hasUnread={assistantUnread > 0}')
    expect(source).toContain('onOpenAssistantChat(')
    expect(source).toContain('assistantFocusRequest={assistantFocusRequest}')
    expect(source).not.toContain('ProactiveCenter')
    expect(source).not.toContain('proactiveMsg')
    expect(source).not.toContain('proactive-bubble')
    expect(source).not.toContain('setProactiveUnread')
    expect(source).not.toContain('onOpenMessages')
  })
})
```

- [ ] **Step 10: 验证 6a 并提交**

```bash
npm run typecheck && npm test
```
Expected: PASS（ScrollCapture.regression.test 断言的 startScrollScreenshot/handleScrollCapture 均保留，不受影响）。

```bash
git add -A
git commit -m "feat!: route proactive messages into the assistant chat session, drop ProactiveCenter"
```

**Files (6b):**
- Modify: `src/renderer/src/components/ChatPanel/MessageArea.tsx`
- Modify: `src/renderer/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/renderer/src/components/ChatPanel/ChatPanel.css`
- Test: `src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts`

- [ ] **Step 11: 写失败测试**

`ChatPanel.layout.test.ts` 的 `assistant contact wiring` describe 内追加：

```ts
  it('offers snooze only on assistant replies', () => {
    expect(messageSource).toContain('canSnooze?: boolean')
    expect(messageSource).toContain('onSnoozeContent?.(msg.content)')
    expect(panelSource).toContain('canSnooze={activeCharacterId === ASSISTANT_CHARACTER_ID}')
    expect(panelSource).toContain('proactiveEngine.snoozeContent')
    expect(stylesheet).toContain('.message-snooze-btn')
  })
```

- [ ] **Step 12: 跑测试确认失败**

```bash
npm test -- src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts
```
Expected: FAIL。

- [ ] **Step 13: 实现**

13a. `MessageArea.tsx` props（14-26 行 interface 末尾）加：

```ts
  canSnooze?: boolean
  onSnoozeContent?: (content: string) => void
```

message-meta 内 CopyButton 块（284-286 行）之后加：

```tsx
              {canSnooze && msg.role === 'assistant' && msg.content && !msg.toolData && !msg.pluginData && onSnoozeContent && (
                <button
                  className="message-snooze-btn"
                  onClick={() => onSnoozeContent(msg.content)}
                  aria-label="十分钟后再次提醒"
                >
                  稍后提醒
                </button>
              )}
```

13b. `ChatPanel.tsx`：顶部加 `import { proactiveEngine } from '../../core/proactive'`；`<MessageArea`（748-761 行）props 末尾加：

```tsx
                canSnooze={activeCharacterId === ASSISTANT_CHARACTER_ID}
                onSnoozeContent={(content) => proactiveEngine.snoozeContent(content)}
```

13c. `ChatPanel.css`：911-913 行与 927-929 行两个按钮分组选择器各加一行 `.message-snooze-btn,`；932 行（hover 分组后）加显隐规则：

```css
.message-snooze-btn {
  visibility: hidden;
}

.message:hover .message-snooze-btn,
.message-snooze-btn:focus-visible {
  visibility: visible;
}
```

- [ ] **Step 14: 验证 6b 并提交**

```bash
npm test -- src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts && npm run typecheck && npm test
```
Expected: PASS。

```bash
git add src/renderer/src/components/ChatPanel/MessageArea.tsx src/renderer/src/components/ChatPanel/ChatPanel.tsx src/renderer/src/components/ChatPanel/ChatPanel.css src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts
git commit -m "feat(chat): snooze action on assistant messages"
```

---

### Task 7: 联系人页置顶助手卡片

**Files:**
- Modify: `src/renderer/src/components/Contacts/ContactsView.tsx`
- Modify: `src/renderer/src/components/Contacts/ContactsView.css`

- [ ] **Step 1: 实现**

1a. import 区（文件顶部 `shared/characters` 导入处）加入 `ASSISTANT_CHARACTER_ID`。

1b. `filtered` useMemo（212-222 行）第一行过滤加排除（助手走置顶卡，不进普通网格）：

```ts
    return characters
      .filter((character) => character.id !== ASSISTANT_CHARACTER_ID)
      .filter((character) => category === 'all'
```

1c. `contacts-scroll`（345 行）与 `contacts-grid`（346 行）之间插置顶卡片（仿既有卡片结构）：

```tsx
    <div className="contacts-scroll">
      <button type="button" className="contacts-card contacts-assistant-card" data-contacts-item={ASSISTANT_CHARACTER_ID}
        onClick={() => onOpenChat(ASSISTANT_CHARACTER_ID)}>
        <span className="contacts-card-head">
          <span className="contacts-card-avatar contacts-card-avatar-default" aria-hidden="true">🔔</span>
          <span className="contacts-card-title">
            <span className="contacts-card-name">助手<em className="contacts-builtin">内置</em></span>
            <span className="contacts-card-subtitle">主动提醒都发到这里</span>
          </span>
        </span>
        <span className="contacts-card-desc">问候、休息与任务提醒会以聊天消息出现，可以随时回复。</span>
      </button>
      <div className="contacts-grid">
```

1d. `ContactsView.css` 末尾追加：

```css
.contacts-assistant-card {
  width: 100%;
  margin-bottom: var(--space-3, 8px);
  cursor: pointer;
}
```

- [ ] **Step 2: 验证**

```bash
npm run typecheck && npm test
```
Expected: PASS（contacts-smoke 只按具体 preset id 查询 `[data-contacts-item="..."]`，无计数断言，不受影响）。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Contacts/ContactsView.tsx src/renderer/src/components/Contacts/ContactsView.css
git commit -m "feat(contacts): pin the assistant card on top of the directory"
```

---

### Task 8: chat-smoke 断言更新

**Files:**
- Modify: `src/main/smoke/chat-smoke.ts`

- [ ] **Step 1: 实现**

1a. import（5-8 行）加入 `getSessions`：

```ts
import {
  createChatSession, deleteChatSession, flushDatabase, getActiveSession, getConfig, getSessions,
  saveConfig, saveSessionMessages, selectChatSession, type Message
} from '../database'
```

1b. 438 行 `await waitForRenderer(window, "document.querySelector('.workspace-sessions:not([hidden])')")` 之后插入（确定性直调 IPC，不依赖 3 秒问候时序；当前活跃会话非助手 → 无自动标读 → 徽标持续存在）：

```ts
    await window.webContents.executeJavaScript("window.electronAPI.proactiveAppend('冒烟助手消息')")
    await waitForRenderer(window, "[...document.querySelectorAll('.conversation-item-title')].some(el => el.textContent.includes('助手消息'))")
    await waitForRenderer(window, "Boolean(document.querySelector('.conversation-item .conversation-item-unread'))")
```

1c. finally 块（458 行 `selectChatSession(originalSession)` 之前）加助手会话清理：

```ts
    for (const summary of getSessions().filter((session) => session.characterId === 'assistant')) {
      deleteChatSession(summary.id)
    }
```

- [ ] **Step 2: 验证**

```bash
npm run typecheck && npm test
```
Expected: PASS（冒烟属 test:smoke，Task 9 跑）。

- [ ] **Step 3: Commit**

```bash
git add src/main/smoke/chat-smoke.ts
git commit -m "test(smoke): assert assistant session appears in the session list with unread badge"
```

---

### Task 9: 全量验证 + out/ 重建 + 交付

- [ ] **Step 1: 全量验证**

```bash
npm run typecheck && npm test
```
Expected: PASS。

- [ ] **Step 2: 冒烟**

```bash
npm run test:smoke
```
Expected: 各阶段输出 `CHOUYU_*_PASSED` 标记；已知本机基线：chat 拖拽与 journal-search 间歇失败（见记忆 project_smoke_baseline），判定只看标记；`CHOUYU_CHAT_SMOKE_PASSED` 必须出现且包含新断言路径。

- [ ] **Step 3: 重建 out/ 并字符串验证进包**

```bash
npm run build
grep -c "proactive:append" out/main/index.js
grep -c "assistant-unread-changed" out/main/index.js
grep -c "sessions:changed" out/main/index.js
grep -c "open-assistant-chat" out/main/index.js
grep -c "db:mark-session-read" out/main/index.js
grep -rc "conversation-item-unread" out/renderer
grep -rc "message-snooze-btn" out/renderer
grep -rc "contacts-assistant-card" out/renderer
```
Expected: 每个 grep 计数 ≥1（main 打包后为压缩产物，字面量字符串必须存在；renderer 目录内命中）。

- [ ] **Step 4: 收尾提交与汇报**

```bash
git add -A
git commit -m "chore: rebuild out for assistant contact verification" --allow-empty
```

（仅在有未提交产物变更时实际提交。）向用户汇报完成情况并给出手动验收清单（spec §9.6）：
1. 删 `%APPDATA%\chouyu\Local Storage` 与 `chouyu-data.json` 中旧数据重启 → 问候以助手消息进入会话列表顶部，托盘闪、红点亮、旧 9 条历史在助手会话
2. 托盘单击/托盘右键"助手消息"/宠物右键 → 打开助手会话，未读清零、停闪、红点灭
3. 助手会话输入消息 → AI 正常回复（全局配置）
4. 消息 hover"稍后提醒" → 10 分钟后收到"⏰ 稍后提醒"新消息
5. 无未读时托盘单击 → 仍开聊天面板（不回归）

分支保持 `feat/assistant-contact`，用户手验通过后才合 master（工作流约定）。

---

## 自审记录（writing-plans Self-Review）

- **Spec 覆盖**：§1 助手角色→Task 1/7；§2 消息管道→Task 2/4/5(sessions:changed)；§3 未读模型→Task 2(lastReadAt/unread/标读三处)/5(徽标+自动标读)/3(托盘主进程)/4(broadcast)；§4 托盘与入口→Task 3(open-assistant-chat、托盘单击路由、移除旧通道)/6a(宠物右键、App 监听)；§5 稍后提醒→Task 6a(引擎 snoozeContent/restoreSnoozes)/6b(UI)/6a(任务提醒改 proactiveAppend)；§6 历史迁移→Task 2(migrateProactiveMessages)；§7 移除清单→Task 6a；§8 错误处理→persist(false)+catch 模式内嵌；§9 测试→各任务 TDD + Task 8/9。
- **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性**：`appendAssistantMessage(content, timestamp?)`（database.ts↔测试）、`setTrayUnread(count)`（tray.ts↔index.ts↔ipc.ts）、`proactiveAppend(content, timestamp?)`（ipc↔preload↔types↔App）、`snoozeContent(content, minutes=10)`（引擎↔ChatPanel）、`SNOOZE_PREFIX`（引擎↔测试）、`assistantFocusRequest`（types 无需——纯 prop 传递 App→ChatPanel）核对一致。
