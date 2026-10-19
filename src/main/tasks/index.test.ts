import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const state = vi.hoisted(() => ({ dir: '', handlers: new Map<string, (...args: any[]) => any>(), tools: new Map<string, any>() }))
vi.mock('electron', () => ({ app: { getPath: () => state.dir }, BrowserWindow: { getAllWindows: () => [] }, dialog: {}, Notification: { isSupported: () => false },
  ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => state.handlers.set(name, fn), removeHandler: (name: string) => state.handlers.delete(name), on: () => {}, removeAllListeners: () => {} } }))
vi.mock('../database', () => ({ getState: () => null, getSession: (id: string) => id === 'chat' ? { id, title: 'Work chat' } : undefined, appendAssistantMessage: () => {}, flushDatabase: () => ({}) }))
vi.mock('../reminder-events', () => ({ notifyReminderChanges: () => {} }))
vi.mock('../tools/registry', () => ({ getRegisteredTool: (name: string) => state.tools.get(name), registerTool: (tool: any) => state.tools.set(tool.name, tool) }))
import { initializeTasks, closeTasks } from './index'
import { taskCenter } from '../task-center/service'

afterEach(() => { closeTasks(); vi.useRealTimers(); if (state.dir) rmSync(state.dir, { recursive: true, force: true }); state.dir = ''; state.handlers.clear(); state.tools.clear() })
it('uses one domain for real IPC, tools and date scheduling, and unregisters it on shutdown', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 19, 8))
  state.dir = mkdtempSync(join(tmpdir(), 'chouyu-todo-entry-'))
  initializeTasks({ notificationsEnabled: () => false, openTasksWorkspace: () => {} })
  const task = state.handlers.get('tasks:create')!({}, { title: 'Daily IPC task', recurrence: 'daily', dueAt: new Date(2026, 9, 19, 9).getTime() })
  expect(taskCenter.read({ domain: 'todo', owner: 'user', id: task.id })).toMatchObject({ title: 'Daily IPC task' })
  const tool = state.tools.get('create_task')
  await tool.execute({ title: 'Tool task' }, { sessionId: 'chat' })
  expect(taskCenter.list({ domain: 'todo', owner: 'user' })).toMatchObject({ open: expect.arrayContaining([expect.objectContaining({ title: 'Tool task' })]) })
  vi.setSystemTime(new Date(2026, 9, 20, 10)); await vi.advanceTimersByTimeAsync(60000)
  const result = state.handlers.get('tasks:list')!({}, {})
  expect(result.open.filter((item: { title: string }) => item.title === 'Daily IPC task')).toHaveLength(2)
  closeTasks()
  expect(() => taskCenter.read({ domain: 'todo', owner: 'user', id: task.id })).toThrow(/卸载/)
  initializeTasks({ notificationsEnabled: () => false, openTasksWorkspace: () => {} })
  expect(state.handlers.get('tasks:get')!({}, task.id)).toMatchObject({ title: 'Daily IPC task', status: 'open' })
})
