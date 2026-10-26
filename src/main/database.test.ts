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
  appendAgentNotice, appendContactAction, appendAssistantMessage, createCharacter, createChatSession, deleteCharacter, deleteChatSession, flushDatabase, closeDatabase, backupDatabase,
  getActiveSession, getAssistantUnreadCount, getAssistantUnreadPreview, getConfig, getSession, getSessionWorkspace, getSessions,
  getStorageStatus, initDatabase, listCharacters, markSessionRead, onStorageStatus, saveConfig, saveSessionMessages,
  selectChatSession, setState, searchSessions, updateCharacter, getContactProfile, updateContactProfile, getState, contactSearchCredential, saveContactSearchCredential
} from './database'
import { ASSISTANT_CHARACTER_ID, DEFAULT_CHARACTER_ID, MAX_CHARACTER_COUNT, PRESET_CHARACTERS } from '../shared/characters'
import { DEFAULT_APP_CONFIG } from '../shared/config'
import { AttachmentStore } from './attachment-store'
import Database from 'better-sqlite3'
import { openApplicationDatabase } from './storage/application-database'
import { readApplicationSnapshot } from './storage/legacy-migration'
import { getContactIdentityRevision, getContactIdentityConversation, onContactIdentityChanged } from './database'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1kAAAAASUVORK5CYII='
it('invalidates only the changed identity for message edits and default-model followers', () => {
  saveConfig({ baseUrl: 'https://example.com', apiKey: 'identity-test-key', model: 'old-default-model' })
  const alice = createCharacter({ name: 'Alice', providerProfileId: 'default', model: 'fixed-model', soulMd: '' })
  const beforeAlice = getContactIdentityRevision(alice.id), beforeDefault = getContactIdentityRevision(DEFAULT_CHARACTER_ID)
  saveConfig({ model: 'new-default-model' })
  expect(getContactIdentityRevision(alice.id)).toBe(beforeAlice)
  expect(getContactIdentityRevision(DEFAULT_CHARACTER_ID)).not.toBe(beforeDefault)
  const changed = vi.fn(), off = onContactIdentityChanged(changed)
  try {
    const session = getActiveSession()
    const before = getContactIdentityRevision(session.characterId!)
    saveSessionMessages(session.id, [message('edit', 'before')]); flushDatabase()
    expect(getContactIdentityRevision(session.characterId!)).not.toBe(before)
    const edited = getContactIdentityRevision(session.characterId!)
    saveSessionMessages(session.id, [message('edit', 'after!')]); flushDatabase()
    expect(getContactIdentityRevision(session.characterId!)).not.toBe(edited)
    expect(changed.mock.calls.every(([owner]) => owner === session.characterId)).toBe(true)
    expect(getContactIdentityConversation(session.characterId!).messages[0].content).toBe('after!')
    const policy = getContactIdentityRevision(alice.id)
    setState('tool:read_contact_material:enabled', 'false')
    expect(getContactIdentityRevision(alice.id)).not.toBe(policy)
  } finally { off() }
})
const message = (id: string, content = id) => ({ id, role: 'user' as const, content, timestamp: 1 })
const storePath = () => path.join(environment.directory, 'chouyu-data.json')
const sqlitePath = () => path.join(environment.directory, 'chouyu-application.db')
const fixtureDirectories: string[] = []
function persisted() {
  const db = openApplicationDatabase(environment.directory)
  try { return readApplicationSnapshot(db) as { config: any; characters: any[]; sessions: any[]; activeSessionId: string; state: Record<string, string> } }
  finally { db.close() }
}
function persistedText() { return JSON.stringify(persisted()) }
function installLegacy(value: unknown) {
  closeDatabase(true)
  environment.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-database-test-'))
  fixtureDirectories.push(environment.directory)
  fs.writeFileSync(storePath(), JSON.stringify(value))
}
function failWrites() {
  const db = new Database(sqlitePath())
  for (const table of ['sessions', 'messages', 'metadata', 'state', 'delivery_receipts']) {
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER fail_${table}_${action} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'disk full'); END`)
  }
  db.close()
  return { mockRestore() {
    const db = new Database(sqlitePath())
    for (const table of ['sessions', 'messages', 'metadata', 'state', 'delivery_receipts']) for (const action of ['INSERT', 'UPDATE', 'DELETE']) db.exec(`DROP TRIGGER IF EXISTS fail_${table}_${action}`)
    db.close()
  } }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  environment.encryptionAvailable = false
  environment.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-database-test-'))
  fixtureDirectories.push(environment.directory)
  initDatabase()
})

afterEach(async () => {
  await closeDatabase(true)
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
  for (const directory of fixtureDirectories.splice(0)) {
  const relative = path.relative(os.tmpdir(), path.resolve(directory))
  if (path.dirname(relative) !== '.' || !path.basename(relative).startsWith('chouyu-database-test-')) {
    throw new Error('Refusing to clean an unexpected test directory')
  }
  fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('durable conversations', () => {
  it('blocks product writes until the legacy barrier is durable, then retries pending receipts exactly once', () => {
    installLegacy({ version: 4, ...persisted() })
    const source = storePath(), rename = fs.renameSync.bind(fs)
    const failure = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === source) throw new Error('marker locked'); rename(from, to) })
    initDatabase()
    expect(getStorageStatus().error).toContain('保存失败')
    const before = persistedText()
    expect(() => appendAssistantMessage('pending barrier', undefined, 'rest', { receiptIds: ['barrier:1'] })).toThrow('保存失败')
    expect(persistedText()).toBe(before)
    failure.mockRestore()
    expect(flushDatabase().error).toBeNull()
    initDatabase()
    appendAssistantMessage('pending barrier', undefined, 'rest', { receiptIds: ['barrier:1'] })
    expect(getActiveSession().messages.filter(m => m.content === 'pending barrier')).toHaveLength(1)
    expect(getState('reminder-receipt:barrier:1')).toBe('delivered')
    expect(JSON.parse(fs.readFileSync(source, 'utf8')).version).toBe(5)
  })
  it('keeps unrelated message rows untouched through the real database API', () => {
    const id = getActiveSession().id
    saveSessionMessages(id, [message('one'), message('two')]); flushDatabase()
    const db = new Database(sqlitePath())
    try {
      db.exec('CREATE TABLE writes(id TEXT); CREATE TRIGGER count_writes AFTER UPDATE ON messages BEGIN INSERT INTO writes VALUES(new.id); END')
      saveConfig({ model: 'metadata only' })
      setState('some-preference', 'value')
      expect(db.prepare('SELECT * FROM writes').all()).toEqual([])
      saveSessionMessages(id, [message('one'), message('two', 'changed')]); flushDatabase()
      expect(db.prepare('SELECT * FROM writes').all()).toEqual([{ id: 'two' }])
    } finally { db.close() }
  })
  it('persists an independent background engine and rejects stale or failed changes', () => {
    const other = listCharacters().find(c => !c.builtIn)!, initial = getContactProfile(other.id)
    const selected = updateContactProfile(other.id, { backgroundHarnessEngine: 'dsh' }, initial.revision, '后台使用DSH')
    expect(selected.profile.backgroundHarnessEngine).toBe('dsh')
    expect(selected.profile.harnessEngine).toBe('native')
    expect(() => updateContactProfile(other.id, { backgroundHarnessEngine: 'native' }, initial.revision, '旧设置')).toThrow('变化')
    const builtin = getContactProfile(DEFAULT_CHARACTER_ID)
    updateContactProfile(DEFAULT_CHARACTER_ID, { backgroundHarnessEngine: 'dsh' }, builtin.revision, '后台使用DSH')
    initDatabase()
    expect(getContactProfile(other.id).profile.backgroundHarnessEngine).toBe('dsh')
    expect(getContactProfile(DEFAULT_CHARACTER_ID).profile.backgroundHarnessEngine).toBe('dsh')
    const current = getContactProfile(other.id)
    updateContactProfile(other.id, { backgroundHarnessEngine: 'native' }, current.revision, '切回原生')
    expect(getContactProfile(DEFAULT_CHARACTER_ID).profile.backgroundHarnessEngine).toBe('dsh')
    const before = getContactProfile(DEFAULT_CHARACTER_ID)
    failWrites()
    expect(() => updateContactProfile(DEFAULT_CHARACTER_ID, { backgroundHarnessEngine: 'native' }, before.revision, '切回原生')).toThrow('保存失败')
    expect(getContactProfile(DEFAULT_CHARACTER_ID)).toEqual(before)
  })
  it('persists each contact engine including ChouYu and preserves it during unrelated edits', () => {
    const other = listCharacters().find(c => !c.builtIn)!
    const initial = getContactProfile(other.id)
    const saved = updateContactProfile(other.id, { harnessEngine: 'dsh' }, initial.revision, '使用 DSH')
    expect(saved.profile.harnessEngine).toBe('dsh')
    expect(getContactProfile(DEFAULT_CHARACTER_ID).profile.harnessEngine ?? 'native').toBe('native')
    expect(() => updateContactProfile(other.id, { harnessEngine: 'native' }, initial.revision, '过期设置')).toThrow('变化')
    // Simulate an older caller that sends no engine field.
    const { harnessEngine: _engine, ...oldDraft } = getContactProfile(other.id).profile
    updateCharacter(other.id, { ...oldDraft, name: '改名保留引擎' })
    const builtIn = getContactProfile(DEFAULT_CHARACTER_ID)
    updateContactProfile(DEFAULT_CHARACTER_ID, { harnessEngine: 'dsh' }, builtIn.revision, '使用 DSH')
    initDatabase()
    expect(getContactProfile(other.id).profile.harnessEngine).toBe('dsh')
    expect(getContactProfile(DEFAULT_CHARACTER_ID).profile.harnessEngine).toBe('dsh')
    const current = getContactProfile(other.id)
    updateContactProfile(other.id, { harnessEngine: 'native' }, current.revision, '切回原生')
    initDatabase()
    expect(getContactProfile(other.id).profile.harnessEngine).toBe('native')
    expect(getContactProfile(DEFAULT_CHARACTER_ID).profile.harnessEngine).toBe('dsh')
  })
  it.each(['built-in', 'custom'])('does not publish an engine change when persistence fails: %s', kind => {
    const id = kind === 'built-in' ? DEFAULT_CHARACTER_ID : listCharacters().find(c => !c.builtIn)!.id
    const before = getContactProfile(id)
    failWrites()
    expect(() => updateContactProfile(id, { harnessEngine: 'dsh' }, before.revision, '使用 DSH')).toThrow('保存失败')
    expect(getContactProfile(id)).toEqual(before)
  })
  it('saves a credential and its version atomically without returning the secret and rejects stale saves', () => {
    const owner = listCharacters().find(c => !c.builtIn)!.id
    expect(contactSearchCredential(owner)).toEqual({ configured: false, revision: 0 })
    const saved = saveContactSearchCredential(owner, 'private-search-value', 0)
    expect(saved).toEqual({ configured: true, revision: 1 })
    expect(JSON.stringify(saved)).not.toContain('private-search-value')
    initDatabase()
    expect(contactSearchCredential(owner)).toEqual(saved)
    expect(() => saveContactSearchCredential(owner, 'old-overwrite', 0)).toThrow('变化')
    expect(getState(`agent-search:${owner}:api_key`)).toBe('private-search-value')
    const write = failWrites()
    expect(() => saveContactSearchCredential(owner, 'failed-value', 1)).toThrow('保存失败')
    write.mockRestore()
    expect(contactSearchCredential(owner)).toEqual(saved)
    expect(getState(`agent-search:${owner}:api_key`)).toBe('private-search-value')
  })
  it('delivers action cards to their original session, preserves unread and survives stale autosaves without duplicating', () => {
    const owner = listCharacters().find(c => !c.builtIn)!.id
    const session = createChatSession('原请求', owner).activeSession.id
    saveSessionMessages(session, [message('request', '改个名字')]); flushDatabase()
    const second = createChatSession('另一个话题', owner).activeSession.id
    const card: import('../shared/contact-actions').ContactActionInteraction = { id: 'action:one', version: 'v1', kind: 'action', characterId: owner, topicTitle: '修改名称', status: 'pending', createdAt: Date.now(), budgets: [], request: { title: '修改名称', body: '改为 Alice', purpose: 'configuration', sessionId: session, subject: { kind: 'contact' }, actions: [{ id: 'apply', label: '确认', tool: 'edit_contact_profile', arguments: { name: 'Alice' } }] } }
    appendContactAction(card)
    expect(getSession(session)!.messages.at(-1)?.communication?.source.kind).toBe('interaction')
    expect(getSession(second)!.messages).toEqual([])
    expect(getSessions().find(s => s.id === session)!.unreadCount).toBe(1)
    saveSessionMessages(session, [message('request', '改个名字')]); flushDatabase(); initDatabase()
    expect(getSession(session)!.messages.at(-1)?.id).toBe(card.id)
    appendContactAction(card)
    expect(getSession(session)!.messages.filter(m => m.id === card.id)).toHaveLength(1)
    saveSessionMessages(session, []); flushDatabase(); appendContactAction(card)
    expect(getSession(session)!.messages).toEqual([])
  })
  it('saves partial contact profile changes and request receipts durably with optimistic concurrency', () => {
    const character = listCharacters().find(c => !c.builtIn)!
    const before = getContactProfile(character.id)
    const saved = updateContactProfile(character.id, { name: '测试新名字', soulMd: '独立的新要求' }, before.revision, '以后叫测试新名字，使用独立的新要求')
    expect(saved.profile).toMatchObject({ name: '测试新名字', soulMd: '独立的新要求', model: before.profile.model, avatar: before.profile.avatar })
    expect(saved.revision).not.toBe(before.revision)
    expect(() => updateContactProfile(character.id, { name: '过期名字' }, before.revision, '过期修改')).toThrow('变化')
    initDatabase()
    expect(getContactProfile(character.id)).toEqual(saved)
    expect(getState(`contact-profile-change:${character.id}`)).toContain('以后叫测试新名字')
  })
  it('updates built-in effective model/persona once and protects manual edits with the same revision', () => {
    saveConfig({ model: 'old-model', soulMd: '原始系统人设' })
    const before = getContactProfile(DEFAULT_CHARACTER_ID)
    const saved = updateContactProfile(DEFAULT_CHARACTER_ID, { model: 'new-model', soulMd: '新的系统人设' }, before.revision, '修改我的模型和人设')
    expect(getConfig()).toMatchObject({ model: 'new-model', soulMd: '新的系统人设' })
    expect(saved.profile).toMatchObject({ model: 'new-model', soulMd: '新的系统人设' })
    expect(() => updateCharacter(DEFAULT_CHARACTER_ID, { ...before.profile, revision: before.revision })).toThrow('变化')
    saveConfig({ model: 'third-model' })
    expect(() => updateContactProfile(DEFAULT_CHARACTER_ID, { avatar: '🐠' }, saved.revision, '换个头像')).toThrow('变化')
  })
  it('rolls back profile, built-in config and receipt in memory when durable storage fails', () => {
    const before = getContactProfile(DEFAULT_CHARACTER_ID), config = getConfig()
    const write = failWrites()
    expect(() => updateContactProfile(DEFAULT_CHARACTER_ID, { name: '未保存的名字', model: 'not-saved' }, before.revision, '修改名字和模型')).toThrow('保存失败')
    expect(getContactProfile(DEFAULT_CHARACTER_ID)).toEqual(before)
    expect(getConfig()).toEqual(config)
    expect(getState(`contact-profile-change:${DEFAULT_CHARACTER_ID}`)).toBeNull()
    write.mockRestore()
    initDatabase()
    expect(getContactProfile(DEFAULT_CHARACTER_ID)).toEqual(before)
  })
  it('persists exact contact citation versions across reload and rejects malformed or foreign references', () => {
    const session = getActiveSession()
    const citation = { ref: { characterId: session.characterId, topicId: 'topic', version: 1, sectionId: 'section' }, anchor: { start: 0, end: 2, quote: '原文', textHash: 'a'.repeat(64) } }
    saveSessionMessages(session.id, [{ ...message('cited'), contactCitations: [citation] }])
    flushDatabase(); initDatabase()
    expect(getActiveSession().messages[0].contactCitations?.[0].ref.version).toBe(1)
    expect(getActiveSession().messages[0].content).toBe('cited')
    expect(() => saveSessionMessages(session.id, [{ ...message('bad'), contactCitations: [{ ...citation, ref: { ...citation.ref, characterId: 'someone-else' } }] }])).toThrow()
    expect(() => saveSessionMessages(session.id, [{ ...message('bad'), contactCitations: Array(5).fill(citation) }])).toThrow()
    expect(getActiveSession().messages[0].id).toBe('cited')
  })
  it('reuses the current blank on repeated new-chat requests and after restart', () => {
    const initial = getActiveSession().id
    for (let i = 0; i < 10; i++) expect(createChatSession().activeSession.id).toBe(initial)
    expect(getSessions()).toHaveLength(1)
    flushDatabase(); initDatabase()
    expect(createChatSession().activeSession.id).toBe(initial)
  })

  it('reuses only the same contact blank, preserving named sessions and real messages', () => {
    const firstBlank = getActiveSession().id
    const named = createChatSession('有意保留的工作区').activeSession.id
    expect(createChatSession().activeSession.id).toBe(firstBlank)
    expect(getSession(named)?.title).toBe('有意保留的工作区')
    saveSessionMessages(firstBlank, [{ ...message('image-only', ''), imageUrl: image }])
    const blank = createChatSession().activeSession.id
    expect(blank).not.toBe(firstBlank)
    const count = getSessions().length
    selectChatSession(firstBlank)
    expect(createChatSession().activeSession.id).toBe(blank)
    expect(getSessions()).toHaveLength(count)
    const contact = createCharacter({ name: '另一个联系人', avatar: '', soulMd: '', category: '', model: 'test-model' })
    const other = createChatSession(undefined, contact.id).activeSession.id
    expect(other).not.toBe(blank)
    expect(createChatSession(undefined, contact.id).activeSession.id).toBe(other)
    expect(createChatSession().activeSession.id).toBe(blank)
    expect(getSession(firstBlank)?.messages[0].imageUrl).toBe(image)
  })
  it('prefers the active blank without deleting legacy empty conversations', () => {
    const first = getActiveSession().id
    vi.advanceTimersByTime(1000)
    const newer = createChatSession('新对话').activeSession.id
    selectChatSession(first)
    expect(createChatSession().activeSession.id).toBe(first)
    expect(getSession(newer)).not.toBeNull()
    const named = createChatSession('named').activeSession.id
    expect(createChatSession().activeSession.id).toBe(newer)
    expect(getSession(named)).not.toBeNull()
  })
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
    const saved = persistedText()
    expect(saved).not.toContain('base64')
    expect(saved).toContain('chouyu-attachment:')
    expect(fs.readdirSync(path.join(environment.directory, 'attachments'))).toHaveLength(1)
    initDatabase()
    expect(getSession(id)?.messages.map((item) => item.imageUrl)).toEqual([image, image])
  })

  it('preserves the original file and restores the previous valid snapshot', async () => {
    const id = getActiveSession().id
    saveSessionMessages(id, [message('recover-me')])
    flushDatabase()
    await backupDatabase()
    setState('next-change', 'yes')
    closeDatabase(true)
    fs.writeFileSync(sqlitePath(), '{broken')
    initDatabase()
    expect(getSession(id)?.messages[0].content).toBe('recover-me')
    expect(getStorageStatus().notice).toContain('备份')
    const preserved = fs.readdirSync(environment.directory).find((name) => name.includes('.corrupt-'))!
    expect(fs.readFileSync(path.join(environment.directory, preserved), 'utf8')).toBe('{broken')
  })

  it('preserves both damaged snapshots when no valid backup is available', () => {
    installLegacy({ version: 4, sessions: [] })
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
    const before = persistedText()
    const changes: Array<string | null> = []
    const unsubscribe = onStorageStatus((status) => changes.push(status.error))
    const spy = failWrites()
    saveSessionMessages(id, [message('still-here')])
    vi.advanceTimersByTime(500)
    expect(getStorageStatus().error).toContain('保存失败')
    expect(getSession(id)?.messages[0].content).toBe('still-here')
    expect(persistedText()).toBe(before)
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
    expect(persistedText()).toContain('chouyu-attachment:')
  })

  it('preserves the conversation snapshot when an image cannot be stored', () => {
    const id = getActiveSession().id
    const before = persistedText()
    saveSessionMessages(id, [{ ...message('bad-image'), imageUrl: 'data:image/png;base64,!' }])
    expect(flushDatabase().error).not.toBeNull()
    expect(persistedText()).toBe(before)
    expect(getSession(id)?.messages[0].imageUrl).toBe('data:image/png;base64,!')
  })

  it('keeps the original and backup if committing the new state fails', async () => {
    await backupDatabase()
    const before = persistedText(), backup = fs.readFileSync(sqlitePath() + '.bak')
    const spy = failWrites()
    expect(() => setState('pending', 'value')).toThrow()
    expect(persistedText()).toBe(before)
    expect(fs.readFileSync(sqlitePath() + '.bak')).toEqual(backup)
    spy.mockRestore()
    expect(flushDatabase().error).toBeNull()
  })

  it('retains a later dirty generation and waits for an active backup before close', async () => {
    const original = Database.prototype.backup
    let copied!: () => void, release!: () => void
    const ready = new Promise<void>(resolve => { copied = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const spy = vi.spyOn(Database.prototype, 'backup').mockImplementationOnce(async function (this: Database.Database, ...args) {
      const result = await original.apply(this, args)
      copied()
      await gate
      return result
    })
    setState('revision', 'one')
    const first = backupDatabase()
    await ready
    setState('revision', 'two')
    let closed = false
    const closing = closeDatabase().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    release()
    await first
    await closing
    expect(spy).toHaveBeenCalledTimes(2)
    const backup = new Database(sqlitePath() + '.bak', { readonly: true })
    try { expect(backup.prepare("SELECT value FROM state WHERE key='revision'").get()).toEqual({ value: 'two' }) }
    finally { backup.close() }
  })

  it('does not rotate away the previous backup when saving an identical snapshot', async () => {
    setState('revision', 'one')
    await backupDatabase()
    setState('revision', 'two')
    flushDatabase()
    const backup = new Database(sqlitePath() + '.bak', { readonly: true })
    try { expect(backup.prepare("SELECT value FROM state WHERE key='revision'").get()).toEqual({ value: 'one' }) }
    finally { backup.close() }
  })

  it('recovers a structurally invalid JSON document instead of silently normalizing it', () => {
    setState('revision', 'one')
    const previous = { version: 4, ...persisted() }
    installLegacy({})
    fs.writeFileSync(storePath() + '.bak', JSON.stringify(previous))
    fs.writeFileSync(storePath(), '{}')
    initDatabase()
    expect(getStorageStatus().notice).toContain('备份')
    expect(persisted().state.revision).toBe('one')
  })

  it('uses the backup when the primary file is absent', async () => {
    const id = getActiveSession().id
    saveSessionMessages(id, [message('recover')])
    flushDatabase()
    await backupDatabase()
    setState('next', 'value')
    closeDatabase(true)
    fs.unlinkSync(sqlitePath())
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
    installLegacy({
      version: 3,
      config: { ...DEFAULT_APP_CONFIG },
      sessions: [{ id: 'legacy-1', title: '旧会话', messages: [], createdAt: 1, updatedAt: 2 }],
      activeSessionId: 'legacy-1',
      state: {}
    })
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

  it('stores the industry category on create and update, defaulting to none', () => {
    const created = createCharacter({ ...draft, category: 'tech' })
    expect(created.category).toBe('tech')
    expect(updateCharacter(created.id, { ...draft, category: 'legal' }).category).toBe('legal')
    expect(createCharacter({ ...draft, name: '无分类' }).category).toBe('')
    expect(createCharacter({ ...draft, name: '坏分类', category: 'nope' }).category).toBe('')
  })

  it('backfills preset categories on legacy stores and keeps manual re-categorization', () => {
    // 旧版本播种的预设没有 category：按 id 幂等补齐。
    const legacy = persisted()
    for (const character of legacy.characters) delete character.category
    installLegacy({ version: 4, ...legacy })
    initDatabase()
    let current = listCharacters()
    for (const preset of PRESET_CHARACTERS) {
      expect(current.find((character) => character.id === preset.id)?.category).toBe(preset.category)
    }
    // 手动改过行业的预设不被回填覆盖。
    const manual = current.find((character) => character.id === PRESET_CHARACTERS[0].id)!
    updateCharacter(manual.id, { name: manual.name, avatar: manual.avatar, soulMd: manual.soulMd, providerProfileId: manual.providerProfileId, model: manual.model, category: 'writing' })
    const rewritten = persisted()
    for (const character of rewritten.characters) {
      if (character.id !== manual.id) delete character.category
    }
    installLegacy({ version: 4, ...rewritten })
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
    const restoredCharacter = listCharacters().find((character) => character.name === '小猫')
    expect(restoredCharacter?.providerProfileId).toBe('p1')
    expect(getConfig().providerProfiles[0]).toMatchObject({ id: 'p1', apiKey: 'secret-key' })
    const raw = persisted()
    expect(raw.config.providerProfiles[0].apiKey).toMatch(/^safe:v1:/)
    expect(Array.isArray(raw.characters)).toBe(true)
  })
})

describe('assistant messages', () => {
  it('moves former assistant histories to ChouYu without losing IDs, unread receipts or snooze sources', () => {
    flushDatabase()
    const data = persisted()
    data.sessions.push({ id: 'legacy-assistant', title: '助手消息', characterId: ASSISTANT_CHARACTER_ID,
      messages: [{ id: 'old-read', role: 'assistant', content: '早上的问候', timestamp: 1000 }, { id: 'old-unread', role: 'assistant', content: '记得休息', timestamp: 3000 }],
      createdAt: 1000, updatedAt: 3000, lastReadAt: 2000 })
    data.state['assistant-snoozes'] = JSON.stringify([{ sessionId: 'legacy-assistant', messageId: 'old-unread' }])
    installLegacy({ version: 4, ...data })
    initDatabase()
    expect(getSession('legacy-assistant')).toMatchObject({ characterId: DEFAULT_CHARACTER_ID, lastReadAt: 2000 })
    expect(getSessions().find(s => s.id === 'legacy-assistant')!.unreadCount).toBe(1)
    expect(getSession('legacy-assistant')!.messages.map(m => m.id)).toEqual(['old-read', 'old-unread'])
    expect(listCharacters().some(c => c.id === ASSISTANT_CHARACTER_ID)).toBe(false)
    initDatabase()
    expect(getSession('legacy-assistant')!.messages).toHaveLength(2)
    expect(getSessions().find(s => s.id === 'legacy-assistant')!.unreadCount).toBe(1)
  })
  it('preserves reminder types through save and restart', () => {
    const workspace = appendAssistantMessage('喝杯水', 1000, 'rest')
    const id = workspace.sessions.find(session => session.characterId === DEFAULT_CHARACTER_ID)!.id
    appendAssistantMessage('该交周报了', 2000, 'task')
    saveSessionMessages(id, getSession(id)!.messages)
    flushDatabase()
    initDatabase()
    expect(getSession(id)!.messages.map(message => message.assistantKind)).toEqual(['rest', 'task'])
  })
  it('creates the assistant session on first append and appends in order', () => {
    const preAppendActiveId = getSessionWorkspace().activeSession.id
    const first = appendAssistantMessage('问候一', 1000)
    const summary = first.sessions.find((session) => session.characterId === DEFAULT_CHARACTER_ID)
    const assistantSessionId = summary!.id
    expect(first.activeSession.id).toBe(assistantSessionId)
    expect(first.activeSession.id).toBe(preAppendActiveId)
    expect(summary?.characterId).toBe(DEFAULT_CHARACTER_ID)
    expect(summary?.messageCount).toBe(1)
    expect(summary?.unreadCount).toBe(1)
    appendAssistantMessage('问候二', 2000)
    const id = assistantSessionId
    expect(getSession(id)?.messages.map((item) => [item.content, item.role, item.timestamp]))
      .toEqual([['问候一', 'assistant', 1000], ['问候二', 'assistant', 2000]])
    expect(getSession(id)?.updatedAt).toBe(2000)
    expect(getSessions().find((session) => session.id === id)?.unreadCount).toBe(2)
  })

  it('only clears unread with an explicit read receipt, not session selection', () => {
    const workspace = appendAssistantMessage('新消息', Date.now())
    const id = workspace.sessions.find((session) => session.characterId === DEFAULT_CHARACTER_ID)!.id
    expect(getAssistantUnreadCount()).toBe(1)
    expect(markSessionRead(id).sessions.find((session) => session.id === id)?.unreadCount).toBe(0)
    expect(getAssistantUnreadCount()).toBe(0)
    appendAssistantMessage('又一条', Date.now() + 10)
    expect(getAssistantUnreadCount()).toBe(1)
    selectChatSession(id)
    expect(getAssistantUnreadCount()).toBe(1)
    markSessionRead(id)
    expect(getAssistantUnreadCount()).toBe(0)
    expect(getSessions().find((session) => session.id === id)?.unreadCount).toBe(0)
  })

  it('previews only the newest unread message and clears the preview after reading', () => {
    expect(getAssistantUnreadPreview()).toBe('')
    const workspace = appendAssistantMessage('旧提醒', Date.now())
    const id = workspace.sessions.find(session => session.characterId === DEFAULT_CHARACTER_ID)!.id
    appendAssistantMessage('新提醒\n记得休息', Date.now() + 10)
    expect(getAssistantUnreadPreview()).toBe('丑鱼：新提醒 记得休息')
    selectChatSession(id)
    expect(getAssistantUnreadPreview()).toContain('新提醒')
    markSessionRead(id)
    expect(getAssistantUnreadPreview()).toBe('')
  })

  it('does not count outgoing messages as unread', () => {
    const id = getActiveSession().id
    saveSessionMessages(id, [message('普通消息')])
    expect(getSessions().find((session) => session.id === id)?.unreadCount).toBe(0)
    expect(getAssistantUnreadCount()).toBe(0)
  })

  it('notifies once for a completed contact reply, retains it across restart, and clears on read', () => {
    const id = getActiveSession().id
    const at = Date.now()
    const reply = { id: 'reply', role: 'assistant' as const, content: '已写好第二章', timestamp: at }
    // Existing history and partial streaming content must not become new notifications.
    saveSessionMessages(id, [message('question'), reply])
    expect(getAssistantUnreadCount()).toBe(0)
    const completed = { ...reply, replyCompletedAt: at + 1000 }
    saveSessionMessages(id, [message('question'), completed])
    expect(getAssistantUnreadCount()).toBe(1)
    expect(getAssistantUnreadPreview()).toContain('已写好第二章')
    saveSessionMessages(id, [message('question'), completed])
    expect(getAssistantUnreadCount()).toBe(1)
    flushDatabase(); initDatabase()
    expect(getAssistantUnreadCount()).toBe(1)
    selectChatSession(id)
    expect(getAssistantUnreadCount()).toBe(1)
    markSessionRead(id, 'reply')
    expect(getAssistantUnreadCount()).toBe(0)
    expect(getAssistantUnreadPreview()).toBe('')
    saveSessionMessages(id, [message('question'), completed])
    expect(getAssistantUnreadCount()).toBe(0)
  })

  it('notifies for completion after a partial reply was read before closing the panel', () => {
    const id = getActiveSession().id
    const at = Date.now()
    const reply = { id: 'reply', role: 'assistant' as const, content: '正在写', timestamp: at }
    saveSessionMessages(id, [reply])
    markSessionRead(id, reply.id)
    saveSessionMessages(id, [{ ...reply, content: '写完了', replyCompletedAt: at + 1000 }])
    expect(getAssistantUnreadCount()).toBe(1)
    markSessionRead(id, reply.id)
    expect(getAssistantUnreadCount()).toBe(0)
  })

  it('saves a visible reply as read atomically without a transient unread count or stale autosave resurrection', () => {
    const id = getActiveSession().id
    const at = Date.now()
    const reply = { id: 'visible', role: 'assistant' as const, content: '正在看的回复', timestamp: at, replyCompletedAt: at + 1000 }
    const workspace = saveSessionMessages(id, [reply], reply.id)
    expect(workspace.sessions.find(session => session.id === id)?.unreadCount).toBe(0)
    expect(getAssistantUnreadCount()).toBe(0)
    expect(getAssistantUnreadPreview()).toBe('')
    saveSessionMessages(id, [reply])
    expect(getAssistantUnreadCount()).toBe(0)
    flushDatabase(); initDatabase()
    expect(getAssistantUnreadCount()).toBe(0)
    // A later completion of the same message (continuation) needs a new receipt.
    saveSessionMessages(id, [{ ...reply, content: '稍后续写的内容', replyCompletedAt: at + 2000 }])
    expect(getAssistantUnreadCount()).toBe(1)
  })

  it('a visible reply receipt does not mark unseen messages in the same session as read', () => {
    const id = getActiveSession().id
    const at = Date.now()
    const earlier = { id: 'unseen', role: 'assistant' as const, content: '仍未读的回复', timestamp: at, replyCompletedAt: at + 100 }
    const visible = { id: 'visible', role: 'assistant' as const, content: '当前回复', timestamp: at + 200, replyCompletedAt: at + 300 }
    saveSessionMessages(id, [earlier, visible], visible.id)
    expect(getAssistantUnreadCount()).toBe(1)
    expect(getAssistantUnreadPreview()).toContain('仍未读的回复')
  })

  it('excludes errors, stopped responses, empty replies and tool cards from reply notifications', () => {
    const id = getActiveSession().id
    const base = { role: 'assistant' as const, content: '回复', timestamp: Date.now(), replyCompletedAt: Date.now() + 1000 }
    saveSessionMessages(id, [
      { ...base, id: 'outgoing', role: 'user' },
      { ...base, id: 'error', responseStatus: 'error' },
      { ...base, id: 'stopped', responseStatus: 'stopped' },
      { ...base, id: 'empty', content: '' },
      { ...base, id: 'tool', toolData: { callId: 'call', name: 'tool', displayName: '工具', risk: 'safe', status: 'completed' } }
    ])
    expect(getAssistantUnreadCount()).toBe(0)
    expect(getAssistantUnreadPreview()).toBe('')
  })

  it('chooses the preview by reply completion time and preserves other sessions when reading one', () => {
    const id = createChatSession('另一位联系人', PRESET_CHARACTERS[0].id).activeSession.id
    const at = Date.now()
    appendAssistantMessage('休息提醒', at + 500)
    saveSessionMessages(id, [{ id: 'reply', role: 'assistant', content: '联系人刚刚写完', timestamp: at, replyCompletedAt: at + 1000 }])
    expect(getAssistantUnreadCount()).toBe(2)
    expect(getAssistantUnreadPreview()).toContain('联系人刚刚写完')
    markSessionRead(id, 'reply')
    expect(getAssistantUnreadCount()).toBe(1)
    expect(getAssistantUnreadPreview()).toBe('丑鱼：休息提醒')
  })

  it('keeps lastReadAt across restart', () => {
    const workspace = appendAssistantMessage('重启前', Date.now())
    const id = workspace.sessions.find((session) => session.characterId === DEFAULT_CHARACTER_ID)!.id
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
    installLegacy({
      version: 4,
      config: { ...DEFAULT_APP_CONFIG },
      characters: [],
      sessions: [],
      activeSessionId: '',
      state: { 'proactive-messages': legacy }
    })
    initDatabase()
    const assistant = getSessions().find((session) => session.characterId === DEFAULT_CHARACTER_ID)
    expect(assistant?.messageCount).toBe(2)
    const id = assistant!.id
    expect(getSession(id)?.messages.map((item) => item.content)).toEqual(['旧提醒', '旧问候'])
    // 迁移语义锁定：历史消息保持未读，升级后首次启动的一次性未读爆发（托盘闪烁+角标）是预期行为。
    expect(getAssistantUnreadCount()).toBe(2)
    initDatabase()
    expect(getSession(id)?.messages).toHaveLength(2)
  })

  it('keeps ChouYu editable, non-deletable, and allows deleting its sessions', () => {
    const workspace = appendAssistantMessage('守卫', Date.now())
    const id = workspace.sessions.find((session) => session.characterId === DEFAULT_CHARACTER_ID)!.id
    expect(updateCharacter(DEFAULT_CHARACTER_ID, { name: '改名', avatar: 'x', soulMd: '', providerProfileId: 'default', model: 'm' }).name).toBe('改名')
    expect(() => deleteCharacter(DEFAULT_CHARACTER_ID)).toThrow('不可删除')
    expect(deleteChatSession(id).sessions.some((session) => session.id === id)).toBe(false)
  })

  it('rejects creating a custom character named after the assistant', () => {
    expect(() => createCharacter({ name: '丑鱼', avatar: '🐟', soulMd: '', providerProfileId: 'default', model: 'm' })).toThrow(/同名/)
  })

  it('keeps proactive appends newer than the renderer list when saving', () => {
    const w1 = appendAssistantMessage('旧问候', 1000)
    const assistantId = w1.sessions.find((s) => s.characterId === DEFAULT_CHARACTER_ID)!.id
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
    const assistantId = w1.sessions.find((s) => s.characterId === DEFAULT_CHARACTER_ID)!.id
    const w2 = saveSessionMessages(assistantId, [])
    expect(getSession(assistantId)!.messages).toHaveLength(0)
    expect(w2.sessions.find((s) => s.characterId === DEFAULT_CHARACTER_ID)!.messageCount).toBe(0)
  })

  it('preserves durable reminders omitted by a stale renderer retry', () => {
    const w1 = appendAssistantMessage('问候', 1000)
    const assistantId = w1.sessions.find((s) => s.characterId === DEFAULT_CHARACTER_ID)!.id
    appendAssistantMessage('被重试覆盖的提醒', 1600)
    saveSessionMessages(assistantId, [
      { id: 'u1', role: 'user', content: '重来', timestamp: 1500 },
      { id: 'a2', role: 'assistant', content: '新回复', timestamp: 3000 }
    ])
    const contents = getSession(assistantId)!.messages.map((m) => m.content)
    expect(contents).toContain('被重试覆盖的提醒')
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
    const firstId = w1.sessions.find((s) => s.characterId === DEFAULT_CHARACTER_ID)!.id
    const created = createChatSession('第二个助手会话', 'assistant')
    const secondId = created.activeSession.id
    appendAssistantMessage('第二条', 3000)
    expect(getSession(firstId)!.messages.map((m) => m.content)).toEqual(['第一条'])
    expect(getSession(secondId)!.messages.map((m) => m.content)).toEqual(['第二条'])
    appendAssistantMessage('第三条', 4000)
    expect(getSession(secondId)!.messages.map((m) => m.content)).toEqual(['第二条', '第三条'])
  })
})


describe('contact progress delivery', () => {
  const notice = { id: 'run:progress', characterId: DEFAULT_CHARACTER_ID, topicId: 'topic', runId: 'run', topicRevision: 2, kind: 'progress' as const, content: '新证据改变了判断', createdAt: 1 }
  it('gives new custom contacts the same message contract and protects delivered prose from stale autosaves', () => {
    const character = createCharacter({ name: '新建的地图师', soulMd: '说话简洁，擅长地图。' })
    const id = createChatSession('地图', character.id).activeSession.id
    const communication = { version: 1 as const, characterId: character.id, intent: 'delivery' as const,
      source: { kind: 'task' as const, topicId: 'atlas', runId: 'run', artifact: { version: 1, sectionId: 'map' } } }
    appendAgentNotice({ ...notice, characterId: character.id, topicId: 'atlas', content: '地图\n\n已保存的完整正文。', communication })
    const saved = getSession(id)!.messages[0]
    saveSessionMessages(id, [{ ...saved, role: 'user', content: '旧缓存篡改正文', communication: undefined }, { ...message('reply', '这是我的看法。'), role: 'assistant', communication }])
    flushDatabase(); initDatabase()
    expect(getSession(id)!.messages.find(m => m.id === saved.id)).toMatchObject({ content: '地图\n\n已保存的完整正文。', role: 'assistant', communication })
    expect(getSession(id)!.messages.find(m => m.id === 'reply')!.communication).toEqual({ version: 1, characterId: character.id, intent: 'reply', source: { kind: 'conversation', sessionId: id } })
    saveSessionMessages(id, []); flushDatabase()
    appendAgentNotice({ ...notice, characterId: character.id, topicId: 'atlas', communication })
    expect(getSession(id)!.messages).toEqual([])
  })
  it('rejects mismatched provenance and oversized/blank proactive messages without receipts or unread changes', () => {
    const id = createChatSession('投递校验', DEFAULT_CHARACTER_ID).activeSession.id
    for (const content of [' ', 'x'.repeat(20001)]) {
      expect(() => appendAgentNotice({ ...notice, content })).toThrow()
      expect(() => appendAssistantMessage(content, undefined, 'rest', { receiptIds: ['invalid-retry'] })).toThrow()
    }
    expect(() => appendAgentNotice({ ...notice, communication: { version: 1, characterId: 'foreign', intent: 'status', source: { kind: 'task', topicId: 'topic', runId: 'run' } } })).toThrow('不匹配')
    expect(getSession(id)!.messages).toEqual([])
    appendAssistantMessage('休息一下吧。', undefined, 'rest', { receiptIds: ['invalid-retry'] })
    expect(getSession(id)!.messages[0].communication).toMatchObject({ intent: 'reminder', source: { kind: 'proactive', eventIds: ['invalid-retry'] } })
    expect(getSessions().find(s => s.id === id)!.unreadCount).toBe(1)
  })
  it('delivers to the owner without switching chats, survives reload and never resurrects a cleared message', () => {
    const ownerSession = createChatSession('联系人进展', DEFAULT_CHARACTER_ID).activeSession.id
    const other = createChatSession('正在看的聊天', PRESET_CHARACTERS[0].id).activeSession.id
    appendAgentNotice(notice)
    expect(getActiveSession().id).toBe(other)
    expect(getSession(ownerSession)!.messages).toHaveLength(1)
    expect(getSessions().find(s => s.id === ownerSession)!.unreadCount).toBe(1)
    initDatabase()
    appendAgentNotice(notice)
    expect(getSession(ownerSession)!.messages).toHaveLength(1)
    selectChatSession(ownerSession)
    expect(getAssistantUnreadCount()).toBeGreaterThan(0)
    markSessionRead(ownerSession)
    expect(getSessions().find(s => s.id === ownerSession)!.unreadCount).toBe(0)
    saveSessionMessages(ownerSession, []); flushDatabase()
    appendAgentNotice(notice)
    expect(getSession(ownerSession)!.messages).toEqual([])
  })
  it('preserves incoming progress during streaming saves and protects its reference metadata', () => {
    const id = createChatSession('生成中的聊天', DEFAULT_CHARACTER_ID).activeSession.id
    saveSessionMessages(id, [message('user')])
    appendAgentNotice(notice)
    saveSessionMessages(id, [message('user'), { ...message('reply'), role: 'assistant', timestamp: Date.now() + 100 }])
    expect(getSession(id)!.messages.filter(m => m.agentNotice)).toHaveLength(1)
    const messages = getSession(id)!.messages.map(m => ({ ...m, agentNotice: undefined }))
    saveSessionMessages(id, messages)
    expect(getSession(id)!.messages.find(m => m.agentNotice)!.agentNotice!.topicId).toBe('topic')
  })
  it('retries a failed disk write without appending a second message', () => {
    const id = createChatSession('磁盘恢复', DEFAULT_CHARACTER_ID).activeSession.id
    const fail = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('disk failure') })
    expect(() => appendAgentNotice(notice)).toThrow('保存失败')
    fail.mockRestore()
    appendAgentNotice(notice); initDatabase()
    expect(getSession(id)!.messages.filter(m => m.agentNotice)).toHaveLength(1)
  })
})


describe('reminder delivery receipts', () => {
  it('keeps task identity across renderer saves and restart, deduplicating delivery retries', () => {
    const ref = { taskId: 'task-1', reminderAt: 1200 }
    appendAssistantMessage('task', 2000, 'task', { receiptIds: ['task-event'], taskReminder: ref })
    appendAssistantMessage('duplicate', 2000, 'task', { receiptIds: ['task-event'], taskReminder: ref })
    const id = getSessions().find(s => s.characterId === DEFAULT_CHARACTER_ID)!.id
    const messages = getSession(id)!.messages.map(m => ({ ...m, taskReminder: undefined }))
    saveSessionMessages(id, messages); flushDatabase(); initDatabase()
    expect(getSession(id)!.messages).toHaveLength(1)
    expect(getSession(id)!.messages[0].taskReminder).toEqual(ref)
    expect(getAssistantUnreadCount()).toBe(1)
    saveSessionMessages(id, []); flushDatabase(); initDatabase()
    appendAssistantMessage('must not resurrect', 2000, 'task', { receiptIds: ['task-event'], taskReminder: ref })
    expect(getSession(id)!.messages).toEqual([])
  })
  it('read receipt stops at rendered message and never clears a later delivery', () => {
    appendAssistantMessage('first', 1000, 'rest')
    const id = getSessions().find(s => s.characterId === DEFAULT_CHARACTER_ID)!.id
    const first = getSession(id)!.messages[0].id
    appendAssistantMessage('later', 2000, 'rest')
    markSessionRead(id, first)
    expect(getAssistantUnreadCount()).toBe(1)
    markSessionRead(id, 'missing'); expect(getAssistantUnreadCount()).toBe(1)
  })
})


it('retries failed assistant persistence without duplicating its event', () => {
  const fail = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('disk failure') })
  expect(() => appendAssistantMessage('event', undefined, 'rest', { receiptIds: ['rest:retry'] })).toThrow('保存失败')
  fail.mockRestore()
  appendAssistantMessage('event', undefined, 'rest', { receiptIds: ['rest:retry'] }); initDatabase()
  const id = getSessions().find(s => s.characterId === DEFAULT_CHARACTER_ID)!.id
  expect(getSession(id)!.messages).toHaveLength(1)
})


it('a new reminder in the same millisecond as reading is still unread', () => {
  appendAssistantMessage('one', undefined, 'rest')
  const id = getSessions().find(s => s.characterId === DEFAULT_CHARACTER_ID)!.id
  markSessionRead(id); appendAssistantMessage('two', undefined, 'rest')
  expect(getAssistantUnreadCount()).toBe(1)
})
