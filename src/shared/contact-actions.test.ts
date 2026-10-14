import { expect, it } from 'vitest'
import { validateContactActionRequest, validateContactActionResponse, contactActionCredential } from './contact-actions'

const request = () => ({ purpose: 'configuration', title: '调整工作时间', body: '只修改当前联系人的时间。', sessionId: 'session', subject: { kind: 'contact' }, actions: [{ id: 'apply', label: '应用', tool: 'edit_contact_work_settings', arguments: { revision: 2, workStart: '20:00', workEnd: '23:00', reason: '晚上工作' } }] })
it('accepts credentials only through an explicit secure card field and never includes them in persisted responses', () => {
  const secure = validateContactActionRequest({ ...request(), actions: [{ id: 'apply', label: '保存凭据', tool: 'set_contact_search_credential', arguments: { revision: 0 } }], input: { label: '搜索密钥', argument: 'credential', maxLength: 8192, required: true } })
  expect(contactActionCredential(secure, { credential: 'private-value' })).toBe('private-value')
  expect(validateContactActionResponse(secure, { actionId: 'apply', credential: 'private-value' })).toEqual({ actionId: 'apply' })
  expect(() => contactActionCredential(validateContactActionRequest(request()), { credential: 'private-value' })).toThrow('安全输入')
  expect(() => contactActionCredential(secure, {})).toThrow('密钥')
  expect(() => validateContactActionRequest({ ...request(), input: secure.input })).toThrow('凭据')
})
it('accepts a contact-only action without inventing a task or run', () => {
  expect(validateContactActionRequest(request())).toEqual(request())
  expect(validateContactActionRequest(request())).not.toHaveProperty('topicId')
})
it.each([
  { ...request(), purpose: 'anything' }, { ...request(), title: '' }, { ...request(), sessionId: '' },
  { ...request(), subject: { kind: 'task', topicId: 't', revision: -1 } },
  { ...request(), subject: { kind: 'delivery', topicId: 't', revision: 1, version: 0 } },
  { ...request(), actions: [] }, { ...request(), actions: Array(9).fill(request().actions[0]) },
  { ...request(), actions: [request().actions[0], request().actions[0]] },
  { ...request(), actions: [{ ...request().actions[0], tool: 'run_shell_command' }] },
  { ...request(), actions: [{ ...request().actions[0], arguments: { nested: { execute: 'something' } } }] },
  { ...request(), input: { label: '密钥', argument: 'apiKey', maxLength: 2000 } }
])('rejects unregistered or malformed actions: %j', value => { expect(() => validateContactActionRequest(value)).toThrow() })
it('validates a selected option and response without silently selecting another option', () => {
  const r = validateContactActionRequest({ ...request(), purpose: 'choice', input: { label: '补充意见', argument: 'reason', maxLength: 2000, required: false } })
  expect(validateContactActionResponse(r, { actionId: 'apply', text: '补充要求' })).toEqual({ actionId: 'apply', text: '补充要求' })
  expect(() => validateContactActionResponse(r, { actionId: 'missing' })).toThrow()
  expect(() => validateContactActionResponse(r, { actionId: 'apply', text: 'x'.repeat(2001) })).toThrow()
  expect(() => validateContactActionResponse(validateContactActionRequest(request()), { actionId: 'apply', text: '未经请求的输入' })).toThrow()
})
it('deep copies tool arguments so the approved proposal cannot be altered by the caller', () => {
  const source = request()
  const validated = validateContactActionRequest(source)
  source.actions[0].arguments.workStart = '00:00'
  expect(validated.actions[0].arguments.workStart).toBe('20:00')
})
