import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const env = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => env.directory }, safeStorage: { isEncryptionAvailable: () => false } }))
import * as database from '../database'
import { FollowupService } from './followups'
import { reminderSourceVersion } from './source-versions'

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000)
  env.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-followup-'))
  database.initDatabase()
})
afterEach(() => {
  database.closeDatabase(true); vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers()
  const target = path.resolve(env.directory)
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('chouyu-followup-')) throw new Error('Invalid cleanup')
  fs.rmSync(target, { recursive: true, force: true })
})
const items = () => (database as any).getReminderItems?.() ?? []
it('persists a greeting and its pending followup together, retaining explicit acknowledgement after restart', () => {
  database.appendAssistantMessage('早上好', undefined, 'greeting', { receiptIds: ['greeting:day'] })
  expect(items()).toHaveLength(1)
  const item = items()[0]
  expect(item).toMatchObject({ status: 'pending', intervalMinutes: 30, nextAt: 2_800_000, source: { kind: 'message' } })
  const message = database.getSession(item.sessionId)!.messages[0]
  expect(message.reminderIds).toEqual([item.id])
  database.markSessionRead(item.sessionId, message.id)
  expect(items()[0].status).toBe('pending')
  database.initDatabase()
  database.appendAssistantMessage('早上好', undefined, 'greeting', { receiptIds: ['greeting:day'] })
  expect(items()).toHaveLength(1)
  expect(database.getSession(item.sessionId)!.messages).toHaveLength(1)
})
it('coalesces scheduled notices for the same task and keeps different task occurrences independent', () => {
  const send = (taskId: string, at: number) => database.appendAssistantMessage(`任务提醒：${taskId}`, undefined, 'task', { receiptIds: [`${taskId}:${at}`], taskReminder: { taskId, reminderAt: at } })
  send('t1', 100); send('t1', 200); send('t2', 200)
  expect(items()).toHaveLength(2)
  expect(items().find((item: any) => item.source.ref.taskId === 't1').source.ref.reminderAt).toBe(200)
})
it('does not enroll ordinary replies or reconstruct old messages after clearing', () => {
  const session = database.getActiveSession()
  database.saveSessionMessages(session.id, [{ id: 'reply', role: 'assistant', content: '聊天回答', timestamp: 1 }])
  expect(items()).toEqual([])
  database.appendAssistantMessage('休息一下', undefined, 'rest', { receiptIds: ['rest:1'] })
  expect(items()).toHaveLength(1)
  const saved = items()[0]
  database.saveSessionMessages(saved.sessionId, []); database.flushDatabase(); database.initDatabase()
  database.appendAssistantMessage('休息一下', undefined, 'rest', { receiptIds: ['rest:1'] })
  expect(items()).toHaveLength(1)
  expect(database.getSession(saved.sessionId)!.messages).toEqual([])
})
it('preserves reminder ownership against stale renderer autosaves', () => {
  database.appendAssistantMessage('早上好', undefined, 'greeting', { receiptIds: ['greeting:day'] })
  expect(items()).toHaveLength(1)
  const item = items()[0], session = database.getSession(item.sessionId)!
  database.saveSessionMessages(session.id, session.messages.map(message => ({ ...message, reminderIds: ['forged'], reminderFollowup: true })))
  expect(database.getSession(session.id)!.messages[0].reminderIds).toEqual([item.id])
  expect(database.getSession(session.id)!.messages[0].reminderFollowup).toBeUndefined()
})

it('marks one reminder read without consuming unrelated unread messages or processing either', () => {
  database.appendAssistantMessage('早上好', undefined, 'greeting', { receiptIds: ['read:a'] })
  database.appendAssistantMessage('休息一下', undefined, 'rest', { receiptIds: ['read:b'] })
  const [first, second] = items()
  expect(database.getAssistantUnreadCount()).toBe(2)
  ;(database as any).markReminderRead?.(first)
  expect(database.getAssistantUnreadCount()).toBe(1)
  expect(items().every((item: any) => item.status === 'pending')).toBe(true)
  database.initDatabase()
  expect(database.getAssistantUnreadCount()).toBe(1)
  expect(database.getSession(second.sessionId)!.messages).toHaveLength(2)
})

it('commits followup delivery and next deadline together without creating a new item', () => {
  database.appendAssistantMessage('早上好', undefined, 'greeting', { receiptIds: ['a'] })
  const original = items()[0]
  vi.setSystemTime(original.nextAt)
  database.appendReminderFollowup([original], 'receipt')
  expect(items()).toHaveLength(1)
  expect(items()[0].nextAt).toBe(4_600_000)
  database.initDatabase()
  expect(database.getSession(original.sessionId)!.messages).toHaveLength(2)
  expect(items()[0].nextAt).toBe(4_600_000)
})

it('keeps a shared task reminder reachable from both conversations', () => {
  const ref = { taskId: 't', reminderAt: 1 }
  database.appendAssistantMessage('任务提醒', undefined, 'task', { receiptIds: ['first'], taskReminder: ref })
  const first = items()[0]
  vi.setSystemTime(1_001_000)
  const second = database.createChatSession('另一个会话').activeSession
  database.appendAssistantMessage('任务提醒', undefined, 'task', { receiptIds: ['second'], taskReminder: { ...ref, reminderAt: 2 } })
  expect(items()).toHaveLength(1)
  expect(items()[0].sessionId).toBe(second.id)
  expect(items()[0].locations.map((location: any) => location.sessionId)).toEqual([first.sessionId, second.id])
})

it('does not consume the next deadline when followup persistence fails', () => {
  database.appendAssistantMessage('休息一下', undefined, 'rest', { receiptIds: ['first'] })
  const original = items()[0]; vi.setSystemTime(original.nextAt)
  const failure = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('disk full') })
  expect(() => database.appendReminderFollowup([original], 'failed')).toThrow()
  expect(items()[0].nextAt).toBe(original.nextAt)
  failure.mockRestore()
  database.appendReminderFollowup([original], 'failed')
  expect(database.getSession(original.sessionId)!.messages).toHaveLength(2)
})

it('recovers the scheduler after a failed durable delivery without duplicate messages', async () => {
  database.appendAssistantMessage('早上好', undefined, 'greeting', { receiptIds: ['recover'] })
  const original = items()[0]; vi.setSystemTime(original.nextAt)
  const service = new FollowupService({ items: database.getReminderItems, save: database.saveReminderItems,
    source: async () => ({ status: 'pending' }), complete: async () => {}, markRead: database.markReminderRead,
    isRead: () => false, deliver: database.appendReminderFollowup, delivered: database.hasPersistedReminderReceipt, changed: () => {} })
  const failure = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('disk full') })
  await service.tick()
  expect(items()[0].nextAt).toBe(original.nextAt)
  failure.mockRestore()
  await service.tick()
  expect(items()[0].nextAt).toBe(original.nextAt + 30 * 60_000)
  expect(database.getSession(original.sessionId)!.messages).toHaveLength(2)
  database.initDatabase()
  await service.tick()
  expect(database.getSession(original.sessionId)!.messages).toHaveLength(2)
})

it('invalidates todo source checks immediately when the original conversation is cleared', () => {
  database.appendAssistantMessage('任务提醒', undefined, 'task', { receiptIds: ['clear'], taskReminder: { taskId: 'todo', reminderAt: 1 } })
  const original = items()[0], version = reminderSourceVersion(original)
  database.saveSessionMessages(original.sessionId, [])
  expect(reminderSourceVersion(original)).toBeGreaterThan(version)
  expect(() => database.appendReminderFollowup([original], 'cleared')).toThrow('原提醒消息已清除或转移')
})

it('invalidates source checks on both routine persistence paths', () => {
  database.appendAssistantMessage('晨报', undefined, 'notification', { receiptIds: ['routine:r:1'] })
  const original = items()[0], before = reminderSourceVersion(original)
  database.setState('assistant-routines-v1', JSON.stringify([{ id: 'r' }]))
  expect(reminderSourceVersion(original)).toBeGreaterThan(before)
  const saved = reminderSourceVersion(original)
  database.commitApplicationState({ 'assistant-routines-v1': '[]' })
  expect(reminderSourceVersion(original)).toBeGreaterThan(saved)
})

it('does not duplicate a failed followup when another item becomes due during recovery', async () => {
  database.appendAssistantMessage('A', undefined, 'greeting', { receiptIds: ['group:a'] })
  vi.setSystemTime(Date.now() + 15_000)
  database.appendAssistantMessage('B', undefined, 'greeting', { receiptIds: ['group:b'] })
  const [first, second] = items(); vi.setSystemTime(first.nextAt)
  const service = new FollowupService({ items: database.getReminderItems, save: database.saveReminderItems,
    source: async () => ({ status: 'pending' }), complete: async () => {}, markRead: database.markReminderRead,
    isRead: () => false, deliver: database.appendReminderFollowup, delivered: database.hasPersistedReminderReceipt, changed: () => {} })
  const failure = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('disk full') })
  await service.tick(); failure.mockRestore(); vi.setSystemTime(second.nextAt)
  await service.tick()
  const reminders = database.getSession(first.sessionId)!.messages.filter(message => message.reminderFollowup)
  expect(reminders.filter(message => message.reminderIds?.includes(first.id))).toHaveLength(1)
  expect(reminders.filter(message => message.reminderIds?.includes(second.id))).toHaveLength(1)
  expect(reminders).toHaveLength(2)
  expect(reminders.every(message => message.reminderIds?.length === 1)).toBe(true)
  expect(items().every((item: any) => item.nextAt > Date.now())).toBe(true)
})
