import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'

const state = vi.hoisted(() => ({ directory: '', handlers: new Map<string, (...args: any[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => unknown) => state.handlers.set(name, handler),
    removeHandler: (name: string) => state.handlers.delete(name)
  },
  app: { getPath: () => state.directory }, safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: {}, dialog: {}, shell: {}
}))
vi.mock('../harness/service', () => ({ acknowledgeHarnessMessages: vi.fn(), purgeHarnessData: vi.fn() }))
vi.mock('../skills', () => ({ contactSkillLibrary: vi.fn(), registerSkillHandlers: vi.fn() }))
vi.mock('../assistant-routines', () => ({ appendCompanionBriefing: vi.fn() }))
vi.mock('../journal', () => ({ notifyJournalConfig: vi.fn() }))
vi.mock('../agents', () => ({ removeContactAgent: vi.fn() }))
vi.mock('../tray', () => ({ setTrayUnread: vi.fn() }))
vi.mock('../reminder-events', () => ({ notifyReminderChanges: vi.fn() }))
vi.mock('../chat/runtime', () => ({ createChatRuntime: vi.fn() }))
vi.mock('./memory', () => ({ registerMemoryHandlers: vi.fn() }))
vi.mock('./config', () => ({ registerConfigHandlers: vi.fn() }))
vi.mock('./capture', () => ({ registerCaptureHandlers: vi.fn() }))
vi.mock('./desktop', () => ({ registerDesktopHandlers: vi.fn() }))
vi.mock('./tools', () => ({ registerToolsHandlers: vi.fn() }))

import { registerSessionsHandlers } from './sessions'
import { closeChatHarness } from '../ipc'
import { initDatabase, closeDatabase, flushDatabase, getState, getSessions, getSession } from '../database'
import { StorageQuitGuard } from '../storage/quit-guard'

afterEach(async () => {
  vi.restoreAllMocks()
  await closeDatabase(true)
  state.handlers.clear()
  if (state.directory) rmSync(state.directory, { recursive: true, force: true })
})

it('rejects a renderer rest reminder after final flush while the database backup is still pending', async () => {
  state.directory = mkdtempSync(join(tmpdir(), 'chouyu-proactive-shutdown-'))
  initDatabase()
  const window = { once: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false, webContents: { send: vi.fn() } }
  const dispose = registerSessionsHandlers(window as never)
  const invoke = async (name: string, ...args: unknown[]) => {
    const handler = state.handlers.get(name)
    if (!handler) throw new Error(`IPC unavailable: ${name}`)
    return handler({}, ...args)
  }
  // Exercise the real IPC -> delivery -> SQLite route before sealing it.
  await invoke('proactive:append', 'before shutdown', undefined, 'rest', 'before')
  expect(getState('reminder-receipt:companion:before')).toBe('delivered')
  const before = getSessions().flatMap(session => getSession(session.id)!.messages.map(message => message.content))
  let release!: () => void
  const backup = new Promise<void>(resolve => { release = resolve })
  let backingUp = false, closed = false
  const originalBackup = Database.prototype.backup
  vi.spyOn(Database.prototype, 'backup').mockImplementation(async function (this: Database.Database, ...args) {
    backingUp = true
    await backup
    return originalBackup.apply(this, args)
  })
  const guard = new StorageQuitGuard(flushDatabase, () => false)
  let closing: Promise<unknown> | undefined
  try {
    await closeChatHarness(false)
    await guard.finish(async () => {}, async () => 'retry')
    closing = closeDatabase().then(() => { closed = true })
    await vi.waitFor(() => expect(backingUp).toBe(true))
    const result = await invoke('proactive:append', 'late rest', undefined, 'rest', 'late').then(() => 'delivered', () => 'rejected')
    expect(closed).toBe(false)
    expect(getSessions().flatMap(session => getSession(session.id)!.messages.map(message => message.content))).toEqual(before)
    expect(getState('reminder-receipt:companion:late')).toBeNull()
    expect(result).toBe('rejected')
    expect((await invoke('db:retry-save') as { error: string | null }).error).toBeNull()
  } finally {
    release()
    await closing
    dispose()
  }
})
