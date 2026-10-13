import { describe, expect, it, vi } from 'vitest'
import { requestContactTask, prepareHandoffWork } from './gateway'
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
  it('asks the model once for a missing schedule kind before saving, preserving the other fields', async () => {
    const { deps, routineService } = fixture()
    const { kind: _kind, ...input } = routineInput
    const model = vi.fn().mockResolvedValueOnce(JSON.stringify({ kind: 'routine', input }))
      .mockResolvedValueOnce(JSON.stringify({ kind: 'contact-summary' }))
    await requestContactTask(createTarget, '每个工作日八点半检查联系人', deps, model)
    expect(model).toHaveBeenCalledTimes(2)
    expect(routineService.list()[0]).toMatchObject(routineInput)
  })
  it('does not guess a schedule kind when its single correction fails', async () => {
    const { deps, routineService } = fixture()
    const { kind: _kind, ...input } = routineInput
    const model = vi.fn().mockResolvedValueOnce(JSON.stringify({ kind: 'routine', input })).mockResolvedValueOnce('{}')
    await expect(requestContactTask(createTarget, '每个工作日八点半检查联系人', deps, model)).rejects.toThrow()
    expect(model).toHaveBeenCalledTimes(2)
    expect(routineService.list()).toEqual([])
  })
  it('prepares handoff work with the same parser without saving a task or routine', async () => {
    const { deps, agents, routineService } = fixture()
    const result = await prepareHandoffWork('alice', '只评审本版，最多 5 万 Token', deps, async (prompt) => {
      expect(prompt).toContain('continuousReview')
      return JSON.stringify({ kind: 'work', description: '评审本版', budget: { tokens: 50000 } })
    })
    expect(result).toMatchObject({ kind: 'work', work: { description: '评审本版', tokens: 50000, continuous: false } })
    expect(agents.mock.calls.every(([, method]) => method === 'get')).toBe(true)
    expect((await prepareHandoffWork('chouyu', '每天评审', deps, async () => JSON.stringify({ kind: 'routine', input: routineInput }))).kind).toBe('question')
    expect(routineService.list()).toEqual([])
    expect(await prepareHandoffWork('alice', '持续评审新版本', deps, async () => JSON.stringify({ kind: 'work', description: '持续评审新版本', continuousReview: true }))).toMatchObject({ kind: 'work', work: { continuous: true } })
  })
  it('passes an explicit creation Token cap separately from the archived description', async () => {
    const { deps, agents } = fixture(async (_id, method) => method === 'get' ? { topics: [] } : {})
    await requestContactTask({ kind: 'create', characterId: 'alice' }, '写文章，最多 30 万 Token', deps,
      async () => JSON.stringify({ kind: 'work', description: '写文章，最多 30 万 Token', budget: { tokens: 300000 } }))
    expect(agents).toHaveBeenCalledWith('alice', 'assignTopic', ['写文章，最多 30 万 Token', expect.stringContaining('30 万'), 300000])
  })
  it('updates a task Token limit through natural language without changing its call budget', async () => {
    const topic = { id: 'task', characterId: 'alice', revision: 1, title: '文章', goal: '写文章', constraints: '' }
    const { deps, agents } = fixture(async (_id, method) => ({ topics: [{ ...topic, revision: method === 'editTopic' ? 2 : 1 }] }))
    const result = await requestContactTask({ kind: 'edit-work', characterId: 'alice', topicId: 'task', topicRevision: 1 }, '累计上限改为 50 万 Token', deps,
      async () => JSON.stringify({ kind: 'work-edit', input: { goal: '写文章', constraints: '' }, budget: { tokens: 500000 } }))
    expect(result).toMatchObject({ kind: 'work-edited', budgetApplied: true })
    expect(agents.mock.calls.some(([, method]) => method === 'setTaskBudget')).toBe(false)
    expect(agents).toHaveBeenCalledWith('alice', 'editTaskFromDescription', ['task', 1, expect.objectContaining({ tokens: 500000 }), undefined, expect.stringContaining('50 万')])
  })
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
  it('appends later edits to the archived chain instead of overwriting it', async () => {
    const { deps, routineService } = fixture()
    await requestContactTask(createTarget, '每个工作日早上汇总', deps, async () => JSON.stringify({ kind: 'question', question: '几点？' }))
    const created = (await requestContactTask(createTarget, '八点半', deps, async () => JSON.stringify({ kind: 'routine', input: routineInput }))) as { routine: { id: string; revision: number } }
    await requestContactTask({ kind: 'edit-routine', characterId: 'chouyu', routineId: created.routine.id, routineRevision: created.routine.revision }, '改成九点', deps, async (_instruction, content) => {
      expect(JSON.parse(content).existing.title).toBe('晨报')
      return JSON.stringify({ kind: 'routine', input: { ...routineInput, times: ['09:00'] } })
    })
    const log = routineService.list().find(item => item.id === created.routine.id)!.requestLog!
    expect(log).toContain('几点？')
    expect(log).toContain('改成九点')
  })
  it('saves an ordinary contact schedule through its own engine', async () => {
    const { deps, drafts, agents, routineService } = fixture(async () => ({ topics: [] }))
    const result = await requestContactTask({ kind: 'create', characterId: 'other' }, '每天八点提醒我喝水', deps, async () => JSON.stringify({ kind: 'routine', input: { ...routineInput, kind: 'reminder' } }))
    expect(result).toMatchObject({ kind: 'work-created' })
    expect(agents).toHaveBeenCalledWith('other', 'assignCalendarTopic', [expect.objectContaining({ times: ['08:30'] }), expect.stringContaining('每天八点')])
    expect(routineService.list()).toEqual([])
    expect(drafts.get('create:other')).toBeUndefined()
  })
  it('keeps the whole edit and draft uncommitted when the atomic goal/budget save fails', async () => {
    const topic = { id: 't1', revision: 4, title: '对照任务', goal: '旧目标', constraints: '', status: 'planned' }
    let revision = 4
    const { deps, agents } = fixture(async (_id, method, args) => {
      if (method === 'get') return { topics: [{ ...topic, revision }] }
      if (method === 'topicDetail') return { topic: { ...topic, revision }, changes: [] }
      if (method === 'editTopic') { revision++; return { topics: [{ ...topic, revision, goal: (args[2] as { goal: string }).goal }] } }
      if (method === 'editTaskFromDescription') throw new Error('预算不能低于已使用的 30 次调用。')
      throw new Error(`unexpected ${method}`)
    })
    await expect(requestContactTask({ kind: 'edit-work', characterId: 'other', topicId: 't1', topicRevision: 4 }, '目标改为验证新方案，预算调到 50 次', deps, async () => JSON.stringify({ kind: 'work-edit', input: { goal: '验证新方案', constraints: '' }, budget: { modelCalls: 50 } }))).rejects.toThrow('预算不能低于')
    expect(agents.mock.calls.some(([, method]) => method === 'editTopic')).toBe(false)
  })
  it('rejects invalid budget or status before saving the goal edit', async () => {
    const topic = { id: 't1', revision: 4, title: '对照任务', goal: '旧目标', constraints: '', status: 'planned' }
    const { deps, agents } = fixture(async (_id, method) => { if (method === 'get') return { topics: [{ ...topic }] }; throw new Error(`unexpected ${method}`) })
    const target = { kind: 'edit-work' as const, characterId: 'other', topicId: 't1', topicRevision: 4 }
    await expect(requestContactTask(target, '预算调到 0 次', deps, async () => JSON.stringify({ kind: 'work-edit', input: { goal: '新目标', constraints: '' }, budget: { modelCalls: 0 } }))).rejects.toThrow('1–10000')
    await expect(requestContactTask(target, '调整这个任务', deps, async () => JSON.stringify({ kind: 'work-edit', input: { goal: '新目标', constraints: '' }, status: 'unknown' }))).rejects.toThrow('状态')
    expect(agents.mock.calls.some(([, method]) => method === 'editTopic')).toBe(false)
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
