import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const environment = vi.hoisted(() => ({ directory: '', encryptionAvailable: false }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory },
  safeStorage: {
    isEncryptionAvailable: () => environment.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`s:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf8')
      return text.startsWith('s:') ? text.slice(2) : ''
    }
  }
}))

import {
  appendAssistantMessage, createCharacter, createChatSession, deleteCharacter, deleteChatSession, flushDatabase,
  getActiveSession, getAssistantUnreadCount, getConfig, getSession, getSessionWorkspace, getSessions,
  getStorageStatus, initDatabase, listCharacters, markSessionRead, onStorageStatus, saveConfig, saveSessionMessages,
  selectChatSession, setState, searchSessions, updateCharacter
} from './database'
import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID, MAX_CHARACTER_COUNT, PRESET_CHARACTERS } from '../shared/characters'
import { DEFAULT_APP_CONFIG } from '../shared/config'
import { AttachmentStore } from './attachment-store'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1kAAAAASUVORK5CYII='
const message = (id: string, content = id) => ({ id, role: 'user' as const, content, timestamp: 1 })
const storePath = () => path.join(environment.directory, 'chouyu-data.json')

beforeEach(() => {
  vi.useFakeTimers()
  environment.encryptionAvailable = false
  environment.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-database-test-'))
  initDatabase()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
  const relative = path.relative(os.tmpdir(), path.resolve(environment.directory))
  if (path.dirname(relative) !== '.' || !path.basename(relative).startsWith('chouyu-database-test-')) {
    throw new Error('Refusing to clean an unexpected test directory')
  }
  fs.rmSync(environment.directory, { recursive: true, force: true })
})

describe('durable conversations', () => {
  it('preserves navigable task query sources across restart', () => {
    const id = getActiveSession().id
    const taskRefs = [{ id: 'task-a', title: '周报', detail: '工作清单 · 明天' }, { id: 'task-b', title: '周报', detail: '个人清单 · 下周' }]
    saveSessionMessages(id, [{ id: 'task-search', role: 'assistant', content: '', timestamp: 1,
      toolData: { callId: 'call-tasks', name: 'search_tasks', displayName: '查询任务', risk: 'read', status: 'completed', taskRefs } }])
    flushDatabase()
    initDatabase()
    expect(getSession(id)?.messages[0].toolData?.taskRefs).toEqual(taskRefs)
  })
  it('finds old messages outside titles, previews and the model context after restart', () => {
    const id = getActiveSession().id
    const messages = Array.from({ length: 510 }, (_, index) => message(`history-${index}`, index === 120 ? '唯一的全文命中' : '普通消息'))
    saveSessionMessages(id, messages)
    flushDatabase()
    initDatabase()
    const result = searchSessions('全文命中')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(id)
    expect(result[0].preview).toContain('全文命中')
    expect(searchSessions('从未出现')).toHaveLength(0)
  })
  it('keeps more than 100 sessions across restart', () => {
    const first = getActiveSession().id
    for (let index = 0; index < 100; index++) createChatSession(`session ${index}`)
    initDatabase()
    expect(getSessions()).toHaveLength(101)
    expect(getSession(first)).not.toBeNull()
  })

  it('keeps more than 500 messages and does not truncate long content', () => {
    const id = getActiveSession().id
    const messages = Array.from({ length: 501 }, (_, index) => message(`m${index}`))
    messages[0].content = 'x'.repeat(200_001)
    saveSessionMessages(id, messages)
    flushDatabase()
    initDatabase()
    expect(getSession(id)?.messages).toEqual(messages)
  })

  it('stores images separately, deduplicates them and restores them after restart', () => {
    const id = getActiveSession().id
    saveSessionMessages(id, [{ ...message('image1'), imageUrl: image }, { ...message('image2'), imageUrl: image }])
    expect(flushDatabase().error).toBeNull()
    const saved = fs.readFileSync(storePath(), 'utf8')
    expect(saved).not.toContain('base64')
    expect(saved).toContain('chouyu-attachment:')
    expect(fs.readdirSync(path.join(environment.directory, 'attachments'))).toHaveLength(1)
    initDatabase()
    expect(getSession(id)?.messages.map((item) => item.imageUrl)).toEqual([image, image])
  })

  it('preserves the original file and restores the previous valid snapshot', () => {
    const id = getActiveSession().id
    saveSessionMessages(id, [message('recover-me')])
    flushDatabase()
    setState('next-change', 'yes')
    fs.writeFileSync(storePath(), '{broken')
    initDatabase()
    expect(getSession(id)?.messages[0].content).toBe('recover-me')
    expect(getStorageStatus().notice).toContain('备份')
    const preserved = fs.readdirSync(environment.directory).find((name) => name.includes('.corrupt-'))!
    expect(fs.readFileSync(path.join(environment.directory, preserved), 'utf8')).toBe('{broken')
  })

  it('preserves both damaged snapshots when no valid backup is available', () => {
    fs.writeFileSync(storePath(), '{broken-main')
    fs.writeFileSync(`${storePath()}.bak`, '{broken-backup')
    initDatabase()
    expect(getStorageStatus().error).toBeNull()
    expect(getStorageStatus().notice).toContain('空白工作区')
    const preserved = fs.readdirSync(environment.directory).filter((name) => name.includes('.corrupt-'))
    expect(preserved.map((name) => fs.readFileSync(path.join(environment.directory, name), 'utf8')).sort())
      .toEqual(['{broken-backup', '{broken-main'])
  })

  it('does not overwrite a newer store version, including on manual retry', () => {
    const future = JSON.stringify({ version: 999, sessions: [] })
    fs.writeFileSync(storePath(), future)
    initDatabase()
    expect(flushDatabase().error).not.toBeNull()
    expect(fs.readFileSync(storePath(), 'utf8')).toBe(future)
    expect(() => saveConfig({ model: 'unsaved' })).toThrow()
    expect(fs.readFileSync(storePath(), 'utf8')).toBe(future)
  })

  it('blocks writes after read permission failure without quarantining the file', () => {
    const original = fs.readFileSync(storePath(), 'utf8')
    const read = fs.readFileSync.bind(fs)
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(((filename: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (filename === storePath()) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return (read as Function)(filename, ...args)
    }) as typeof fs.readFileSync)
    initDatabase()
    spy.mockRestore()
    expect(flushDatabase().error).not.toBeNull()
    expect(fs.readFileSync(storePath(), 'utf8')).toBe(original)
    expect(fs.readdirSync(environment.directory).some((name) => name.includes('.corrupt-'))).toBe(false)
  })

  it('reports delayed save failure and retries without losing runtime changes', () => {
    const id = getActiveSession().id
    const before = fs.readFileSync(storePath(), 'utf8')
    const changes: Array<string | null> = []
    const unsubscribe = onStorageStatus((status) => changes.push(status.error))
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    })
    saveSessionMessages(id, [message('still-here')])
    vi.advanceTimersByTime(500)
    expect(getStorageStatus().error).toContain('保存失败')
    expect(getSession(id)?.messages[0].content).toBe('still-here')
    expect(fs.readFileSync(storePath(), 'utf8')).toBe(before)
    spy.mockRestore()
    expect(flushDatabase().error).toBeNull()
    initDatabase()
    expect(getSession(id)?.messages[0].content).toBe('still-here')
    expect(changes.some(Boolean)).toBe(true)
    expect(changes.at(-1)).toBeNull()
    unsubscribe()
  })

  it('keeps a missing attachment reference when saving text updates', () => {
    const id = getActiveSession().id
    saveSessionMessages(id, [{ ...message('image'), imageUrl: image }])
    flushDatabase()
    const directory = path.join(environment.directory, 'attachments')
    fs.unlinkSync(path.join(directory, fs.readdirSync(directory)[0]))
    const loaded = getSession(id)!
    expect(loaded.messages[0].imageUrl).toBeUndefined()
    expect(getStorageStatus().notice).toContain('图片附件')
    loaded.messages[0].content = 'updated text'
    saveSessionMessages(id, loaded.messages)
    flushDatabase()
    expect(fs.readFileSync(storePath(), 'utf8')).toContain('chouyu-attachment:')
  })

  it('preserves the conversation snapshot when an image cannot be stored', () => {
    const id = getActiveSession().id
    const before = fs.readFileSync(storePath(), 'utf8')
    saveSessionMessages(id, [{ ...message('bad-image'), imageUrl: 'data:image/png;base64,!' }])
    expect(flushDatabase().error).not.toBeNull()
    expect(fs.readFileSync(storePath(), 'utf8')).toBe(before)
    expect(getSession(id)?.messages[0].imageUrl).toBe('data:image/png;base64,!')
  })

  it('keeps the original and backup if replacing the final snapshot fails', () => {
    const before = fs.readFileSync(storePath(), 'utf8')
    const rename = fs.renameSync.bind(fs)
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === storePath()) throw new Error('File locked')
      rename(from, to)
    })
    expect(() => setState('pending', 'value')).toThrow()
    expect(fs.readFileSync(storePath(), 'utf8')).toBe(before)
    expect(fs.readFileSync(`${storePath()}.bak`, 'utf8')).toBe(before)
    spy.mockRestore()
    expect(flushDatabase().error).toBeNull()
  })

  it('does not rotate away the previous backup when saving an identical snapshot', () => {
    setState('revision', 'one')
    setState('revision', 'two')
    flushDatabase()
    expect(JSON.parse(fs.readFileSync(`${storePath()}.bak`, 'utf8')).state.revision).toBe('one')
  })

  it('recovers a structurally invalid JSON document instead of silently normalizing it', () => {
    setState('revision', 'one')
    setState('revision', 'two')
    fs.writeFileSync(storePath(), '{}')
    initDatabase()
    expect(getStorageStatus().notice).toContain('备份')
    expect(JSON.parse(fs.readFileSync(storePath(), 'utf8')).state.revision).toBe('one')
  })

  it('uses the backup when the primary file is absent', () => {
    const id = getActiveSession().id
    saveSessionMessages(id, [message('recover')])
    flushDatabase()
    setState('next', 'value')
    fs.unlinkSync(storePath())
    initDatabase()
    expect(getSession(id)?.messages[0].id).toBe('recover')
    expect(getStorageStatus().notice).toContain('原数据文件缺失')
  })

  it('rejects attachment traversal and detects damaged image contents', () => {
    const directory = path.join(environment.directory, 'attachments')
    const attachments = new AttachmentStore(directory)
    expect(() => attachments.read('chouyu-attachment:../chouyu-data.json')).toThrow()
    const reference = attachments.persist(image)
    fs.writeFileSync(path.join(directory, fs.readdirSync(directory)[0]), 'damaged')
    expect(() => attachments.read(reference)).toThrow('Damaged attachment')
  })
})

describe('characters', () => {
  const draft = { name: '小猫', avatar: '🐱', soulMd: '# 小猫', providerProfileId: 'default', model: 'm1' }

  it('always exposes the built-in default character with live-view fields', () => {
    const characters = listCharacters()
    expect(characters[0]).toMatchObject({ id: DEFAULT_CHARACTER_ID, name: '丑鱼', builtIn: true, providerProfileId: 'default', soulMd: '', model: '' })
  })

  it('assigns existing sessions to the default character on migration', () => {
    const id = getActiveSession().id
    flushDatabase()
    initDatabase()
    const workspace = getSessionWorkspace()
    expect(workspace.sessions.every((session) => session.characterId === DEFAULT_CHARACTER_ID)).toBe(true)
    expect(getSession(id)?.characterId).toBe(DEFAULT_CHARACTER_ID)
  })

  it('migrates a v3 store by assigning legacy sessions to the built-in character', () => {
    fs.writeFileSync(storePath(), JSON.stringify({
      version: 3,
      config: { ...DEFAULT_APP_CONFIG },
      sessions: [{ id: 'legacy-1', title: '旧会话', messages: [], createdAt: 1, updatedAt: 2 }],
      activeSessionId: 'legacy-1',
      state: {}
    }))
    initDatabase()
    const workspace = getSessionWorkspace()
    expect(workspace.sessions.find((session) => session.id === 'legacy-1')?.characterId).toBe(DEFAULT_CHARACTER_ID)
    expect(workspace.activeSession.characterId).toBe(DEFAULT_CHARACTER_ID)
    const characters = listCharacters()
    expect(characters).toHaveLength(PRESET_CHARACTERS.length + 2)
    expect(characters[0].id).toBe(DEFAULT_CHARACTER_ID)
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

  it('falls back to the default character when creating a session for an unknown character', () => {
    const workspace = createChatSession('t', 'unknown-id')
    expect(workspace.activeSession.characterId).toBe(DEFAULT_CHARACTER_ID)
  })

  it('rejects duplicate names, unknown profiles and default deletion', () => {
    expect(() => createCharacter({ ...draft, name: '丑鱼' })).toThrow('同名')
    expect(() => createCharacter({ ...draft, name: '坏档案', providerProfileId: 'missing' })).toThrow('档案')
    expect(() => deleteCharacter(DEFAULT_CHARACTER_ID)).toThrow('不可删除')
  })

  it('caps characters at the limit once presets are seeded', () => {
    for (let index = 1; index <= MAX_CHARACTER_COUNT - 1 - PRESET_CHARACTERS.length; index++) {
      createCharacter({ ...draft, name: `角色${index}` })
    }
    expect(listCharacters()).toHaveLength(MAX_CHARACTER_COUNT + 1)
    expect(() => createCharacter({ ...draft, name: '超限角色' })).toThrow(/最多支持/)
  })

  it('stores the industry category on create and update, defaulting to none', () => {
    const created = createCharacter({ ...draft, category: 'tech' })
    expect(created.category).toBe('tech')
    expect(updateCharacter(created.id, { ...draft, category: 'legal' }).category).toBe('legal')
    expect(createCharacter({ ...draft, name: '无分类' }).category).toBe('')
    expect(createCharacter({ ...draft, name: '坏分类', category: 'nope' }).category).toBe('')
  })

  it('backfills preset categories on legacy stores and keeps manual re-categorization', () => {
    // 旧版本播种的预设没有 category：按 id 幂等补齐。
    const legacy = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    for (const character of legacy.characters) delete character.category
    fs.writeFileSync(storePath(), JSON.stringify(legacy))
    initDatabase()
    let current = listCharacters()
    for (const preset of PRESET_CHARACTERS) {
      expect(current.find((character) => character.id === preset.id)?.category).toBe(preset.category)
    }
    // 手动改过行业的预设不被回填覆盖。
    const manual = current.find((character) => character.id === PRESET_CHARACTERS[0].id)!
    updateCharacter(manual.id, { name: manual.name, avatar: manual.avatar, soulMd: manual.soulMd, providerProfileId: manual.providerProfileId, model: manual.model, category: 'writing' })
    const rewritten = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    for (const character of rewritten.characters) {
      if (character.id !== manual.id) delete character.category
    }
    fs.writeFileSync(storePath(), JSON.stringify(rewritten))
    initDatabase()
    current = listCharacters()
    expect(current.find((character) => character.id === manual.id)?.category).toBe('writing')
    for (const preset of PRESET_CHARACTERS) {
      if (preset.id === manual.id) continue
      expect(current.find((character) => character.id === preset.id)?.category).toBe(preset.category)
    }
  })

  it('updates characters and write-through default persona/model to config', () => {
    const created = createCharacter(draft)
    const updated = updateCharacter(created.id, { ...draft, model: 'm2' })
    expect(updated.model).toBe('m2')
    updateCharacter(DEFAULT_CHARACTER_ID, { name: '丑鱼', avatar: '🐟', soulMd: '# 新人设', providerProfileId: 'default', model: 'live-model' })
    expect(getConfig().soulMd).toBe('# 新人设')
    expect(getConfig().model).toBe('live-model')
    expect(() => updateCharacter(DEFAULT_CHARACTER_ID, { name: '丑鱼', avatar: '🐟', soulMd: '', providerProfileId: 'p9', model: 'm' })).toThrow('默认档案')
  })

  it('rejects duplicate names case-insensitively while allowing same-character case renames', () => {
    createCharacter({ ...draft, name: 'Alpha' })
    const beta = createCharacter({ ...draft, name: 'Beta' })
    expect(() => updateCharacter(beta.id, { ...draft, name: 'ALPHA' })).toThrow(/同名/)
    expect(updateCharacter(beta.id, { ...draft, name: 'BETA' }).name).toBe('BETA')
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
    environment.encryptionAvailable = true
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
    expect(Array.isArray(raw.characters)).toBe(true)
  })
})

describe('assistant messages', () => {
  it('preserves reminder types through save and restart', () => {
    const workspace = appendAssistantMessage('喝杯水', 1000, 'rest')
    const id = workspace.sessions.find(session => session.characterId === ASSISTANT_CHARACTER_ID)!.id
    appendAssistantMessage('该交周报了', 2000, 'task')
    saveSessionMessages(id, getSession(id)!.messages)
    flushDatabase()
    initDatabase()
    expect(getSession(id)!.messages.map(message => message.assistantKind)).toEqual(['rest', 'task'])
  })
  it('creates the assistant session on first append and appends in order', () => {
    const preAppendActiveId = getSessionWorkspace().activeSession.id
    const first = appendAssistantMessage('问候一', 1000)
    const summary = first.sessions.find((session) => session.characterId === 'assistant')
    const assistantSessionId = summary!.id
    expect(first.activeSession.id).not.toBe(assistantSessionId)
    expect(first.activeSession.id).toBe(preAppendActiveId)
    expect(summary?.title).toBe('助手消息')
    expect(summary?.messageCount).toBe(1)
    expect(summary?.unreadCount).toBe(1)
    appendAssistantMessage('问候二', 2000)
    const id = assistantSessionId
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
      { id: 'blank', message: '   ', createdAt: 4000 },
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
    // 迁移语义锁定：历史消息保持未读，升级后首次启动的一次性未读爆发（托盘闪烁+角标）是预期行为。
    expect(getAssistantUnreadCount()).toBe(2)
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

  it('rejects creating a custom character named after the assistant', () => {
    expect(() => createCharacter({ name: '助手', avatar: '🔔', soulMd: '', providerProfileId: 'default', model: 'm' })).toThrow(/同名/)
  })

  it('keeps proactive appends newer than the renderer list when saving', () => {
    const w1 = appendAssistantMessage('旧问候', 1000)
    const assistantId = w1.sessions.find((s) => s.characterId === 'assistant')!.id
    // 渲染层缓存带着已加载的历史（旧问候）流式回复；主进程稍后的追加不在缓存里。
    saveSessionMessages(assistantId, [
      { id: 'p1', role: 'assistant', content: '旧问候', timestamp: 1000 },
      { id: 'u1', role: 'user', content: '在吗', timestamp: 1500 },
      { id: 'a1', role: 'assistant', content: '正在回复', timestamp: 1600 }
    ])
    appendAssistantMessage('稍后提醒：喝水', 2000)
    saveSessionMessages(assistantId, [
      { id: 'p1', role: 'assistant', content: '旧问候', timestamp: 1000 },
      { id: 'u1', role: 'user', content: '在吗', timestamp: 1500 },
      { id: 'a1', role: 'assistant', content: '回复完毕', timestamp: 1600 }
    ])
    const contents = getSession(assistantId)!.messages.map((m) => m.content)
    expect(contents).toContain('旧问候')
    expect(contents).toContain('稍后提醒：喝水')
  })

  it('still clears the assistant session when the renderer saves an empty list', () => {
    const w1 = appendAssistantMessage('会被清掉', 1000)
    const assistantId = w1.sessions.find((s) => s.characterId === 'assistant')!.id
    const w2 = saveSessionMessages(assistantId, [])
    expect(getSession(assistantId)!.messages).toHaveLength(0)
    expect(w2.sessions.find((s) => s.characterId === 'assistant')!.messageCount).toBe(0)
  })

  it('does not resurrect older db messages the renderer dropped on retry', () => {
    const w1 = appendAssistantMessage('问候', 1000)
    const assistantId = w1.sessions.find((s) => s.characterId === 'assistant')!.id
    appendAssistantMessage('被重试覆盖的提醒', 1600)
    saveSessionMessages(assistantId, [
      { id: 'u1', role: 'user', content: '重来', timestamp: 1500 },
      { id: 'a2', role: 'assistant', content: '新回复', timestamp: 3000 }
    ])
    const contents = getSession(assistantId)!.messages.map((m) => m.content)
    expect(contents).not.toContain('被重试覆盖的提醒')
  })

  it('does not preserve trailing db messages for non-assistant sessions', () => {
    const workspace = createChatSession('普通会话')
    const id = workspace.activeSession.id
    saveSessionMessages(id, [{ id: 'm1', role: 'user', content: '第一条', timestamp: 1000 }])
    const w2 = saveSessionMessages(id, [{ id: 'm2', role: 'user', content: '更旧但替换', timestamp: 500 }])
    expect(w2.activeSession.messages.map((m) => m.id)).toEqual(['m2'])
  })

  it('appends to the most recently updated assistant session', () => {
    const w1 = appendAssistantMessage('第一条', 1000)
    const firstId = w1.sessions.find((s) => s.characterId === 'assistant')!.id
    const created = createChatSession('第二个助手会话', 'assistant')
    const secondId = created.activeSession.id
    appendAssistantMessage('第二条', 3000)
    expect(getSession(firstId)!.messages.map((m) => m.content)).toEqual(['第一条'])
    expect(getSession(secondId)!.messages.map((m) => m.content)).toEqual(['第二条'])
    appendAssistantMessage('第三条', 4000)
    expect(getSession(secondId)!.messages.map((m) => m.content)).toEqual(['第二条', '第三条'])
  })
})
