import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => environment.directory }, safeStorage: { isEncryptionAvailable: () => false } }))
import { initDatabase, getSession, createChatSession, saveSessionMessages, flushDatabase, markSessionRead, getSessions, deleteChatSession, getState } from '../database'
import { DEFAULT_CHARACTER_ID, PRESET_CHARACTERS } from '../../shared/characters'
import type { ContactActionInteraction } from '../../shared/contact-actions'
import { MessageDeliveryService } from './service'
import { persistDelivery } from './repository'
import type { DeliveryRequest } from './contracts'

let session = ''
beforeEach(() => {
  vi.useFakeTimers()
  environment.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-message-test-'))
  initDatabase()
  session = createChatSession('投递测试', DEFAULT_CHARACTER_ID).activeSession.id
})
afterEach(() => {
  vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers()
  const target = path.resolve(environment.directory), relative = path.relative(os.tmpdir(), target)
  if (path.dirname(relative) !== '.' || !path.basename(relative).startsWith('chouyu-message-test-')) throw new Error('Unexpected cleanup directory')
  fs.rmSync(target, { recursive: true, force: true })
})
function card(): ContactActionInteraction {
  return { id: 'action:1', kind: 'action', version: '1', characterId: DEFAULT_CHARACTER_ID, topicTitle: '回复', status: 'pending', createdAt: 1, budgets: [], request: {
    purpose: 'confirmation', title: '确认修改', body: '保存正文', sessionId: session, subject: { kind: 'contact' },
    actions: [{ id: 'yes', label: '确认', tool: 'edit_contact_profile', arguments: {} }]
  } }
}
function request(kind: DeliveryRequest['kind']): DeliveryRequest {
  if (kind === 'assistant') return { kind, content: '保存正文', messageKind: 'rest', receiptIds: ['test:1'] }
  if (kind === 'interaction') return { kind, card: card() }
  return { kind, notice: { id: 'run:progress', characterId: DEFAULT_CHARACTER_ID, topicId: 'topic', runId: 'run', topicRevision: 1, kind: 'progress', content: '保存正文', createdAt: 1 } }
}

it.each(['assistant', 'agent', 'interaction'] as const)('%s retries a failed write once, persists receipts and never revives cleared messages', kind => {
  const notify = vi.fn(), service = new MessageDeliveryService({ persist: persistDelivery, notify })
  const input = request(kind)
  const fail = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('disk failure') })
  expect(() => service.deliver(input)).toThrow('保存失败')
  expect(notify).not.toHaveBeenCalled()
  expect(getSession(session)!.messages).toHaveLength(1)
  fail.mockRestore()
  expect(service.deliver(input).persisted).toBe(true)
  initDatabase(); service.deliver(input)
  expect(getSession(session)!.messages).toHaveLength(1)
  saveSessionMessages(session, []); flushDatabase(); initDatabase()
  service.deliver(input)
  expect(getSession(session)!.messages).toHaveLength(0)
})

it('rejects mismatched owners and sources, and marks only the displayed message boundary read', () => {
  const service = new MessageDeliveryService({ persist: persistDelivery, notify: () => {} })
  expect(() => service.deliver({ kind: 'interaction', card: { ...card(), characterId: PRESET_CHARACTERS[0].id } })).toThrow('不匹配')
  const input = request('agent') as Extract<DeliveryRequest, { kind: 'agent' }>
  expect(() => service.deliver({ ...input, notice: { ...input.notice, communication: { version: 1, characterId: DEFAULT_CHARACTER_ID, intent: 'status', source: { kind: 'task', topicId: 'foreign', runId: 'run' } } } })).toThrow('不匹配')
  service.deliver(request('assistant'))
  const first = getSession(session)!.messages[0].id
  service.deliver(request('agent')); service.deliver(request('interaction'))
  markSessionRead(session, first)
  expect(getSessions().find(s => s.id === session)!.unreadCount).toBe(2)
})

it('persists an obsolete receipt for an interaction whose original session was deleted', () => {
  const input = request('interaction'), service = new MessageDeliveryService({ persist: persistDelivery, notify: () => {} })
  deleteChatSession(session)
  const fail = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('disk failure') })
  expect(() => service.deliver(input)).toThrow('保存失败')
  fail.mockRestore()
  expect(service.deliver(input)).toMatchObject({ persisted: true, disposition: 'obsolete' })
  initDatabase()
  expect(getState(`contact-action:${DEFAULT_CHARACTER_ID}:action:1`)).toBe('obsolete')
  expect(getSessions().flatMap(s => getSession(s.id)!.messages)).toHaveLength(0)
})
