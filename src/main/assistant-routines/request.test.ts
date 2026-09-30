import { describe, expect, it, vi } from 'vitest'
import { AssistantRoutineService } from './service'
import { requestAssistantTask } from './request'

function fixture() {
  let value = ''
  const service = new AssistantRoutineService({ read: () => value, write: text => { value = text }, generate: async () => '', deliver: () => {} })
  const input = { title: '晨报', instruction: '汇总联系人进展', cadence: 'weekdays', time: '08:30', kind: 'contact-summary', enabled: true }
  return { service, input }
}
describe('natural language assistant tasks', () => {
  it('saves the parsed schedule and returns the persisted identity', async () => {
    const { service, input } = fixture()
    const model = vi.fn(async (_instruction: string, _content: string) => JSON.stringify({ kind: 'routine', input }))
    const result = await requestAssistantTask('每个工作日八点半汇总联系人进展', service, model)
    expect(result).toEqual({ kind: 'routine', routine: service.list()[0] })
    expect(service.list()[0]).toMatchObject({ cadence: 'weekdays', time: '08:30' })
    expect(JSON.parse(model.mock.calls[0][1] as string).description).toContain('八点半')
  })
  it('asks for missing time without persisting or pretending it is scheduled', async () => {
    const { service } = fixture()
    expect(await requestAssistantTask('每天早上汇总', service, async () => '{"kind":"question","question":"每天几点？"}')).toEqual({ kind: 'question', question: '每天几点？' })
    expect(service.list()).toEqual([])
  })
  it('routes ordinary work without creating an unrelated schedule', async () => {
    const { service } = fixture()
    expect(await requestAssistantTask('研究新产品', service, async () => '{"kind":"work","description":"研究新产品"}')).toEqual({ kind: 'work', description: '研究新产品' })
    expect(service.list()).toEqual([])
  })
  it('rejects malformed model output and invalid schedule times', async () => {
    const { service, input } = fixture()
    await expect(requestAssistantTask('提醒我', service, async () => '已安排')).rejects.toThrow('尚未创建')
    await expect(requestAssistantTask('提醒我', service, async () => JSON.stringify({ kind: 'routine', input: { ...input, time: '25:00' } }))).rejects.toThrow('HH:mm')
    expect(service.list()).toEqual([])
  })
  it('updates the same task and rejects a revision changed during parsing', async () => {
    const { service, input } = fixture()
    const [first] = service.save(input)
    await requestAssistantTask('改成九点', service, async () => JSON.stringify({ kind: 'routine', input: { ...input, time: '09:00' } }), first.id, first.revision)
    expect(service.list()).toHaveLength(1)
    const [current] = service.list()
    expect(current).toMatchObject({ id: first.id, time: '09:00' })
    await expect(requestAssistantTask('改成十点', service, async () => {
      service.save({ ...current, enabled: false }, current.id, current.revision)
      return JSON.stringify({ kind: 'routine', input: { ...input, time: '10:00' } })
    }, current.id, current.revision)).rejects.toThrow('变化')
    expect(service.list()[0]).toMatchObject({ time: '09:00', enabled: false })
  })
})
