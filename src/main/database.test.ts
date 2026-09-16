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
  createCharacter, createChatSession, deleteCharacter, flushDatabase, getActiveSession, getConfig, getSession,
  getSessionWorkspace, getSessions, getStorageStatus, initDatabase, listCharacters, onStorageStatus, saveConfig,
  saveSessionMessages, setState, searchSessions, updateCharacter
} from './database'
import { DEFAULT_CHARACTER_ID, MAX_CHARACTER_COUNT, PRESET_CHARACTERS } from '../shared/characters'
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
    expect(characters).toHaveLength(PRESET_CHARACTERS.length + 1)
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
    expect(listCharacters()).toHaveLength(MAX_CHARACTER_COUNT)
    expect(() => createCharacter({ ...draft, name: '超限角色' })).toThrow(/最多支持/)
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
