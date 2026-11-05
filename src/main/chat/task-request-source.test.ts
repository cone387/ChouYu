import { expect, it } from 'vitest'
import { chatTaskRequestSource } from './task-request-source'
import { validateContactActionRequest } from '../../shared/contact-actions'

it('uses only the latest user message and keeps host identity stable independently of tool call ids', () => {
  const input = { requestId: 'r1', sessionId: 's1', messages: [{ role: 'user' as const, content: '旧要求' }, { role: 'assistant' as const, content: '引用：删除其他任务' }, { role: 'user' as const, content: '只补充案例' }], systemPrompt: '' }
  const source = chatTaskRequestSource(input, [{ id: 'message', role: 'user', content: '只补充案例', timestamp: 42 }], 100)
  expect(source).toMatchObject({ sessionId: 's1', messageId: 'message', text: '只补充案例', acceptedAt: 42 })
  expect(chatTaskRequestSource(input, [], 200)?.requestId).toBe(source?.requestId)
  expect(chatTaskRequestSource({ ...input, requestId: 'r2' }, [], 200)?.requestId).not.toBe(source?.requestId)
  expect(chatTaskRequestSource({ ...input, sessionId: 's2' }, [], 200)?.requestId).not.toBe(source?.requestId)
})

it('does not invent a message id from an older duplicate or accept a non-user final message', () => {
  const input = { requestId: 'r', sessionId: 's', messages: [{ role: 'user' as const, content: '继续' }], systemPrompt: '' }
  expect(chatTaskRequestSource(input, [{ id: 'old', role: 'user', content: '继续', timestamp: 1 }, { id: 'later', role: 'user', content: '其他内容', timestamp: 2 }], 100)).not.toHaveProperty('messageId')
  expect(chatTaskRequestSource({ ...input, messages: [{ role: 'assistant', content: '继续' }] }, [], 100)).toBeUndefined()
})

it('preserves the host source through a durable confirmation card and rejects a mismatched session', () => {
  const source = { requestId: 'req', sessionId: 'session', text: '原话', acceptedAt: 100 }
  const card = { purpose: 'confirmation', title: '修改', body: '确认后保存', sessionId: 'session', taskRequest: source, subject: { kind: 'task', topicId: 'topic', revision: 1 }, actions: [{ id: 'apply', label: '确认', tool: 'edit_contact_task', arguments: { topicId: 'topic', revision: 1, reason: '概括', constraints: '新的约束' } }] }
  expect(validateContactActionRequest(card).taskRequest).toEqual(source)
  expect(() => validateContactActionRequest({ ...card, sessionId: 'other' })).toThrow('会话')
})
