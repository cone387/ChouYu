import { describe, expect, it } from 'vitest'
import { AssistantRoutineService } from './service'
import { createAssistantTools } from './tools'
import type { ToolExecutionContext } from '../tools/registry'

describe('assistant conversation tools', () => {
  const context = { sessionId: 'chat' } as ToolExecutionContext
  function fixture(owner = 'chouyu') {
    let raw = ''
    const service = new AssistantRoutineService({ readHistory: () => undefined, writeHistory: () => {}, read: () => raw, write: value => { raw = value }, generate: async () => 'summary', deliver: () => {} })
    const tools = createAssistantTools(service, () => owner, async () => ({ contacts: [{ name: '阿笔', unavailable: true }] }))
    return { service, get: (name: string) => tools.find(t => t.name === name)! }
  }
  it('creates, lists and pauses the same routine with a real revision', async () => {
    const f = fixture()
    const args = { title: '每日总结', instruction: '检查所有联系人状态', cadence: 'daily', kind: 'contact-summary', time: '09:00', enabled: true }
    await f.get('save_assistant_routine').execute(args, context)
    const listed = await f.get('list_assistant_routines').execute({}, context)
    const [item] = JSON.parse(listed.content)
    await f.get('save_assistant_routine').execute({ ...args, id: item.id, revision: item.revision, enabled: false }, context)
    expect(f.service.list()).toHaveLength(1); expect(f.service.list()[0].enabled).toBe(false)
    expect(() => f.get('save_assistant_routine').execute({ ...args, id: item.id, revision: item.revision }, context)).toThrow('已变化')
  })
  it('rejects another contact and does not fabricate unavailable data', async () => {
    expect(() => fixture('alice').get('list_assistant_routines').execute({}, context)).toThrow('ChouYu')
    const result = await fixture().get('inspect_contacts').execute({}, context)
    expect(JSON.parse(result.content).contacts[0].unavailable).toBe(true)
  })
})
