import { describe, expect, it } from 'vitest'
import { contactCommunicationInstructions, contactCommunicationRules, sanitizeContactCommunication, validateContactMessage, type ContactCommunication } from './contact-communication'
import { contactWorkInstructions } from './contact-work-instructions'

const communication: ContactCommunication = { version: 1, characterId: 'new-cartographer', intent: 'delivery',
  source: { kind: 'task', topicId: 'atlas', runId: 'run', artifact: { version: 2, sectionId: 'map' } } }
describe('shared contact communication contract', () => {
  it('inherits the same rules in conversation, tasks and briefings without persona-specific dispatch', () => {
    expect(contactWorkInstructions).toContain(contactCommunicationRules)
    for (const channel of ['conversation', 'task', 'briefing'] as const) expect(contactCommunicationInstructions(channel)).toContain(contactCommunicationRules)
    expect(contactCommunicationInstructions('conversation')).not.toContain('delivery.section')
  })
  it('keeps actual technical prose intact and preserves only valid provenance', () => {
    const prose = '## 状态机\n\n```ts\nconst nextStep = "active/done"\n```'
    expect(validateContactMessage(prose, communication, 'new-cartographer')).toEqual(communication)
    expect(prose).toContain('const nextStep = "active/done"')
    expect(sanitizeContactCommunication({ ...communication, privateState: 'never copy' })).toEqual(communication)
  })
  it('refuses false attribution, unsupported intent/source pairs and unsaved deliverables', () => {
    expect(() => validateContactMessage('正文', communication, 'someone-else')).toThrow('不匹配')
    expect(sanitizeContactCommunication({ ...communication, intent: 'reply' })).toBeUndefined()
    expect(sanitizeContactCommunication({ ...communication, source: { kind: 'task', topicId: 'atlas', runId: 'run' } })).toBeUndefined()
    expect(sanitizeContactCommunication({ ...communication, source: { ...communication.source, artifact: { version: 0, sectionId: 'map' } } })).toBeUndefined()
    expect(sanitizeContactCommunication({ ...communication, intent: 'reminder', source: { kind: 'proactive', eventIds: [] } })).toBeUndefined()
  })
  it.each(['', '  \n', '长'.repeat(20001)])('rejects empty or oversized messages without truncating', body => {
    expect(() => validateContactMessage(body, communication, communication.characterId)).toThrow('未')
  })
})
