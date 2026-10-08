import { describe, expect, it, vi } from 'vitest'
import { requestContactTask } from './gateway'
import { AssistantRoutineService } from './service'
import { ContactTaskDraftStore } from './drafts'

const routineInput = { title: '晨报', instruction: '汇总联系人进展', times: ['08:30'], cadence: 'weekdays' as const, kind: 'contact-summary' as const, enabled: true }
function fixture(agentsImpl?: (id: string, method: string, args: unknown[]) => Promise<unknown>, configValue: Record<string, unknown> = {}) {
  let routineState = ''
  const routineService = new AssistantRoutineService({ readHistory: () => undefined, writeHistory: () => {}, read: () => routineState, write: text => { routineState = text }, generate: async () => '', deliver: () => {} })
  let draftState = ''
  const drafts = new ContactTaskDraftStore({ read: () => draftState, write: text => { draftState = text } })
  const agents = vi.fn(agentsImpl ?? (async (_id: string, method: string) => { if (method === 'get') return { topics: [] }; throw new Error(`unexpected ${method}`) }))
  const saveConfig = vi.fn()
  const deps = {
    routineService, drafts, agents,
    config: () => ({ proactiveReturnAwayMinutes: 10, proactiveRestMinutes: 60, proactiveCooldownMinutes: 60, ...configValue }),
    saveConfig, defaultCharacterId: 'chouyu'
  }
  return { deps, routineService, drafts, agents, saveConfig }
}
const createTarget = { kind: 'create' as const, characterId: 'chouyu' }

describe('contact task gateway', () => {
  it('asks follow-up questions and keeps the draft chain', async () => {
    const { deps, drafts } = fixture()
    const model = vi.fn(async () => JSON.stringify({ kind: 'question', question: '每个工作日早上几点汇报？' }))
    await requestContactTask(createTarget, '每个工作日早上汇总', deps, model)
    expect(drafts.get('create:chouyu')?.turns).toHaveLength(2)
    const result = await requestContactTask(createTarget, '八点半', deps, async (_i, content) => {
      expect(content).toContain('八点半')
      return JSON.stringify({ kind: 'routine', input: routineInput })
    })
    expect(result.kind).toBe('routine')
    expect(drafts.get('create:chouyu')).toBeUndefined() // archived & cleared
  })
  it('archives the clarification chain into the saved routine requestLog', async () => {
    const { deps, routineService } = fixture()
    await requestContactTask(createTarget, '每个工作日早上汇总', deps, async () => JSON.stringify({ kind: 'question', question: '几点？' }))
    await requestContactTask(createTarget, '八点半', deps, async () => JSON.stringify({ kind: 'routine', input: routineInput }))
    expect(routineService.list()[0].requestLog).toContain('几点？')
  })
  it('honestly refuses scheduled requests for non-scheduled contacts', async () => {
    const { deps } = fixture()
    const result = await requestContactTask({ kind: 'create', characterId: 'other' }, '每天八点提醒我喝水', deps, async () => JSON.stringify({ kind: 'routine', input: { ...routineInput, kind: 'reminder' } }))
    expect(result).toMatchObject({ kind: 'question' })
    expect((result as { question: string }).question).toContain('定点')
  })
  it('edits work topics through the model parse: goal, budget, status with honest partial failure', async () => {
    const topic = { id: 't1', revision: 4, title: '对照任务', goal: '旧目标', constraints: '', status: 'planned' }
    let revision = 4
    const { deps, agents } = fixture(async (_id, method, args) => {
      if (method === 'get') return { topics: [{ ...topic, revision }] }
      if (method === 'topicDetail') return { topic: { ...topic, revision }, changes: [] }
      if (method === 'editTopic') { revision++; return { topics: [{ ...topic, revision, goal: (args[2] as { goal: string }).goal }] } }
      if (method === 'setTaskBudget') throw new Error('预算不能低于已使用的 30 次调用。')
      throw new Error(`unexpected ${method}`)
    })
    const result = await requestContactTask({ kind: 'edit-work', characterId: 'other', topicId: 't1', topicRevision: 4 }, '目标改为验证新方案，预算调到 50 次', deps, async () => JSON.stringify({ kind: 'work-edit', input: { goal: '验证新方案', constraints: '' }, budget: { modelCalls: 50 } }))
    expect(result).toMatchObject({ kind: 'work-edited', budgetApplied: false })
    expect((result as { budgetError?: string }).budgetError).toContain('预算不能低于')
    expect(agents.mock.calls.some(([, method]) => method === 'editTopic')).toBe(true)
  })
  it('applies duty parameter edits with range validation and unknown-key rejection', async () => {
    const { deps, saveConfig } = fixture()
    await requestContactTask({ kind: 'edit-duty', characterId: 'chouyu', dutyKey: 'proactiveReturn' }, '离开 15 分钟才算回来', deps, async () => JSON.stringify({ kind: 'duty', params: { proactiveReturnAwayMinutes: 15 } }))
    expect(saveConfig).toHaveBeenCalledWith({ proactiveReturnAwayMinutes: 15 })
    await expect(requestContactTask({ kind: 'edit-duty', characterId: 'chouyu', dutyKey: 'proactiveReturn' }, '改成 999 分钟', deps, async () => JSON.stringify({ kind: 'duty', params: { proactiveReturnAwayMinutes: 999 } }))).rejects.toThrow('1–120')
    await expect(requestContactTask({ kind: 'edit-duty', characterId: 'chouyu', dutyKey: 'proactiveGreeting' }, '改一下', deps, async () => JSON.stringify({ kind: 'duty', params: { proactiveRestMinutes: 30 } }))).rejects.toThrow('没有可调参数')
  })
  it('rejects malformed model output without any write', async () => {
    const { deps, agents } = fixture()
    await expect(requestContactTask(createTarget, '研究新产品', deps, async () => '已安排')).rejects.toThrow('没有解析出')
    expect(agents).not.toHaveBeenCalled()
  })
  it('rejects a stale revision before calling the model', async () => {
    const { deps } = fixture(async (_id, method) => { if (method === 'get') return { topics: [{ id: 't1', revision: 5, title: 'x', goal: 'y', constraints: '', status: 'planned' }] }; throw new Error('x') })
    const model = vi.fn()
    await expect(requestContactTask({ kind: 'edit-work', characterId: 'other', topicId: 't1', topicRevision: 4 }, '改目标', deps, model)).rejects.toThrow('已变化')
    expect(model).not.toHaveBeenCalled()
  })
})
