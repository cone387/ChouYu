import { expect, it, vi } from 'vitest'
import { StorageQuitGuard } from '../storage/quit-guard'

const state = vi.hoisted(() => ({ handlers: new Set<string>(), close: vi.fn(async () => {}) }))
vi.mock('electron', () => ({ ipcMain: { removeHandler: (channel: string) => state.handlers.delete(channel) } }))
vi.mock('../chat/runtime', () => ({ createChatRuntime: () => ({ service: { close: state.close } }) }))
vi.mock('../skills', () => ({ registerSkillHandlers: () => () => {} }))
vi.mock('./registration', () => ({ registerDomain: () => () => {} }))
vi.mock('./chat', () => ({ registerChatHandlers: () => { state.handlers.add('chat'); return () => state.handlers.delete('chat') } }))
vi.mock('./sessions', () => ({ registerSessionsHandlers: () => { state.handlers.add('db:retry-save'); return () => state.handlers.delete('db:retry-save') } }))
vi.mock('./memory', () => ({ registerMemoryHandlers: () => () => {} }))
vi.mock('./config', () => ({ registerConfigHandlers: () => () => {} }))
vi.mock('./capture', () => ({ registerCaptureHandlers: () => () => {} }))
vi.mock('./desktop', () => ({ registerDesktopHandlers: () => () => {} }))
vi.mock('./tools', () => ({ registerToolsHandlers: () => () => {} }))
import { closeChatHarness, registerIpcHandlers } from '../ipc'

it('keeps recovery transport until late writes are saved, then disposes exactly once', async () => {
  let error: string | null = 'initial failure'
  const guard = new StorageQuitGuard(() => ({ error, notice: null, revision: 0 }), () => false)
  const dispose = registerIpcHandlers({} as never)
  try {
    expect(guard.mayExit()).toBe(false)
    expect(state.close).not.toHaveBeenCalled()
    error = null
    expect(guard.mayExit()).toBe(true)
    await closeChatHarness(false)
    expect(state.handlers.has('db:retry-save')).toBe(true)
    let recovering = false
    await guard.finish(async () => { error = 'late write failure' }, async () => {
      recovering = true
      expect(state.handlers.has('db:retry-save')).toBe(true)
      error = null
      return 'retry'
    })
    expect(recovering).toBe(true)
    expect(state.close).toHaveBeenCalledOnce()
    dispose()
    expect(state.handlers.size).toBe(0)
  } finally { dispose() }
})
