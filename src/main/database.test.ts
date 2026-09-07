import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory },
  safeStorage: { isEncryptionAvailable: () => false }
}))

import {
  createChatSession, flushDatabase, getActiveSession, getSession, getSessions,
  getStorageStatus, initDatabase, onStorageStatus, saveConfig, saveSessionMessages, setState, searchSessions
} from './database'
import { AttachmentStore } from './attachment-store'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1kAAAAASUVORK5CYII='
const message = (id: string, content = id) => ({ id, role: 'user' as const, content, timestamp: 1 })
const storePath = () => path.join(environment.directory, 'chouyu-data.json')

beforeEach(() => {
  vi.useFakeTimers()
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
