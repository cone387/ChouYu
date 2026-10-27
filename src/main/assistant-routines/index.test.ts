import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ values: new Map<string, string>(), handlers: new Map<string, (...args: any[]) => any>(), sent: vi.fn(), inspect: vi.fn(), delivery: vi.fn(), model: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler) } }))
vi.mock('../database', () => ({
  commitApplicationState: (values: Record<string, string>) => { for (const [key, value] of Object.entries(values)) state.values.set(key, value) },
  getState: (key: string) => state.values.get(key), setState: (key: string, value: string) => state.values.set(key, value),
  appendAssistantMessage: state.sent, getConfig: () => ({ aiToolsEnabled: true, soulMd: 'ChouYu', proactiveReturn: true, provider: 'openai', model: 'test', apiKey: 'test', baseUrl: 'https://test.invalid' }),
  getCharacter: () => ({ id: 'chouyu', name: 'ChouYu', builtIn: true, soulMd: '' }),
  getSession: () => ({ characterId: 'chouyu' }), listCharacters: () => [{ id: 'chouyu', name: '丑鱼' }, { id: 'alice', name: '阿笔' }, { id: 'bob', name: '老周' }]
}))
vi.mock('../agents', () => ({ inspectContactWork: state.inspect, inspectContactDelivery: state.delivery, contactAgentsCall: async () => [{ scope: { kind: 'contact' }, revision: 1, preference: { instruction: '先给待处理事项' } }] }))
vi.mock('../harness/native/runner', () => ({ streamNativeChat: state.model }))
vi.mock('../skills', () => ({ contactSkillInstruction: () => '已配置技能：核对依据后简要总结。' }))
vi.mock('../reminder-events', () => ({ notifyReminderChanges: vi.fn() }))
vi.mock('../tools/registry', () => ({ getRegisteredTool: () => null, registerTool: vi.fn() }))
import { initializeAssistantRoutines, closeAssistantRoutines, appendCompanionBriefing, readContactsForAssistant, summaryTaskLinks } from './index'
import { contactCommunicationRules } from '../../shared/contact-communication'

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 30, 8))
  state.values.clear(); state.handlers.clear(); vi.clearAllMocks()
  state.model.mockReset()
  state.sent.mockReturnValue({ sessions: [] })
  state.inspect.mockImplementation(async (id: string) => {
    if (id === 'bob') throw new Error('worker unavailable')
    return { topics: [{ id: 'article', title: '文章', status: 'researching', judgement: '初稿准备中', nextStep: '核查', updatedAt: 1 }], runs: [{ topicId: 'article', status: 'waiting', question: '使用哪个标题？', summary: '', error: '' }], reports: [], queuedTopicIds: [] }
  })
  state.delivery.mockResolvedValue({ version: 2, sections: [{ title: '初稿' }] })
})
afterEach(async () => { await closeAssistantRoutines(); vi.useRealTimers() })
describe('assistant routine integration', () => {
  it('cancels and drains task parsing before storage closes, preserving its original draft', async () => {
    initializeAssistantRoutines()
    let finish!: () => void
    let signal!: AbortSignal
    const deferred = new Promise<void>(resolve => { finish = resolve })
    state.model.mockImplementationOnce(async (_messages, _prompt, _config, chunk, current) => {
      signal = current
      await deferred
      chunk(JSON.stringify({ kind: 'question', question: '晚到的追问' }))
    })
    const result = state.handlers.get('contact-task:request')!({}, { kind: 'create', characterId: 'chouyu' }, '每天提醒我休息').then(() => 'saved', () => 'cancelled')
    await vi.advanceTimersByTimeAsync(0)
    expect(signal).toBeDefined()
    const saved = state.values.get('contact-task-drafts-v1')
    let drained = false
    const closing = closeAssistantRoutines().then(() => { drained = true })
    try {
      expect(signal.aborted).toBe(true)
      await Promise.resolve()
      expect(drained).toBe(false)
    } finally { finish() }
    expect(await result).toBe('cancelled')
    await closing
    expect(state.values.get('contact-task-drafts-v1')).toBe(saved)
  })
  it('module shutdown waits for companion work and leaves no late delivery or checkpoint', async () => {
    initializeAssistantRoutines()
    let finish!: () => void
    const deferred = new Promise<void>(resolve => { finish = resolve })
    state.inspect.mockImplementationOnce(async () => { await deferred; return { topics: [], runs: [], reports: [] } })
    const pending = appendCompanionBriefing('return', 'shutdown')
    await vi.advanceTimersByTimeAsync(0)
    expect(state.inspect).toHaveBeenCalled()
    let drained = false
    const closing = closeAssistantRoutines().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    finish()
    await Promise.all([pending, closing])
    expect(state.sent).not.toHaveBeenCalled()
    expect(state.values.has('companion-work-check-v1')).toBe(false)
    await expect(appendCompanionBriefing('return', 'after-close')).rejects.toThrow('关闭')
  })
  it('includes contact-level cards with no task in inspected facts and actual briefing links', async () => {
    state.inspect.mockResolvedValue({ topics: [], runs: [], reports: [], pendingInteractions: [{ id: 'action:credential', characterId: 'alice', version: 'v1', kind: 'action', status: 'pending', request: { title: '配置搜索密钥', body: '请安全填写新密钥', purpose: 'configuration', subject: { kind: 'contact' }, actions: [{ id: 'save', label: '保存密钥', arguments: { private: 'DO_NOT_COPY' } }] } }] })
    const evidence = await readContactsForAssistant(), text = JSON.stringify(evidence)
    expect(text).toContain('配置搜索密钥')
    expect(text).not.toContain('DO_NOT_COPY')
    expect(summaryTaskLinks(evidence)).toContain('action%3Acredential')
  })
  it('marks saved length and completion criteria as metadata, never as a completed requirements check', async () => {
    state.delivery.mockResolvedValue({ version: 1, latestVersion: 1, savedSectionCount: 1, savedTextLength: 598,
      completionCriteria: '每期300至500字正文', directory: [{ id: 'opening', title: '第一节', characters: 598 }] })
    state.model.mockImplementation(async (_messages, _prompt, _config, chunk, _signal, runtime) => {
      const verified = JSON.parse(await runtime.execute({ name: 'read_contact_delivery', arguments: JSON.stringify({ characterId: 'alice', topicId: 'article' }) }))
      expect(verified.savedTextLength).toBe(598)
      expect(verified.savedTextLengthUnit).toBe('utf16_code_units_including_whitespace_and_punctuation')
      expect(verified.lengthScope).toBe('all_saved_sections')
      expect(verified.verification).toEqual({ scope: 'metadata_only', textRead: false, requirementsChecked: false })
      expect(verified).not.toHaveProperty('section')
      chunk('已保存一节，尚未核对是否符合篇幅要求。')
    })
    initializeAssistantRoutines()
    state.handlers.get('assistant-routines:save')!({}, { title: '晨间总结', instruction: '核实真实交付，不夸大成果', time: '09:00', cadence: 'daily', kind: 'contact-summary', enabled: true })
    vi.setSystemTime(new Date(2026, 8, 30, 9)); await vi.advanceTimersByTimeAsync(15000)
    expect(state.sent).toHaveBeenCalledWith(expect.stringContaining('尚未核对'), undefined, 'notification', expect.anything())
  })
  it('does not revive a paused task question in scheduled briefing links', async () => {
    const evidence = await readContactsForAssistant()
    Object.assign(evidence.contacts[0].topics![0], { status: 'paused', workState: { code: 'paused', label: '已暂停', description: '用户暂停' } })
    const links = summaryTaskLinks(evidence)
    expect(links).toContain('已暂停')
    expect(links).not.toContain('使用哪个标题')
    expect(links).not.toContain('需要你处理')
  })
  it('does not let generated task links disguise an empty model response as a delivered summary', async () => {
    state.model.mockResolvedValue(undefined)
    initializeAssistantRoutines()
    state.handlers.get('assistant-routines:save')!({}, { title: '晨间总结', instruction: '关注进度', time: '09:00', cadence: 'daily', kind: 'contact-summary', enabled: true })
    vi.setSystemTime(new Date(2026, 8, 30, 9)); await vi.advanceTimersByTimeAsync(15000)
    expect(state.sent).not.toHaveBeenCalled()
    expect(state.handlers.get('assistant-routines:list')!()[0].lastError).toContain('没有生成总结正文')
  })
  it('reads real contact state, permits bounded delivery inspection, and sends the generated morning summary', async () => {
    state.model.mockImplementation(async (_messages, _prompt, _config, chunk, _signal, runtime) => {
      expect(_prompt).toContain(contactCommunicationRules)
      expect(_prompt).toContain('已配置技能：核对依据后简要总结。')
      const verified = await runtime.execute({ name: 'read_contact_delivery', arguments: JSON.stringify({ characterId: 'alice', topicId: 'article' }) })
      expect(JSON.parse(verified).version).toBe(2)
      expect(await runtime.execute({ name: 'read_contact_delivery', arguments: JSON.stringify({ characterId: 'chouyu', topicId: 'article' }) })).toContain('不在本次检查范围')
      chunk('阿笔在等你选择标题；老周的状态暂时无法读取。')
    })
    initializeAssistantRoutines()
    state.handlers.get('assistant-routines:save')!({}, { title: '晨间总结', instruction: '关注待答复事项', time: '09:00', cadence: 'daily', kind: 'contact-summary', enabled: true })
    vi.setSystemTime(new Date(2026, 8, 30, 9)); await vi.advanceTimersByTimeAsync(15000)
    expect(state.model).toHaveBeenCalledTimes(1)
    expect(state.sent).toHaveBeenCalledWith(expect.stringContaining('老周的状态暂时无法读取'), undefined, 'notification', { receiptIds: [expect.stringContaining('routine:')], messageId: expect.stringMatching(/^routine-/) })
    const evidence = JSON.parse(state.model.mock.calls[0][0][0].content).工作证据
    expect(evidence.contacts.map((c: { id: string }) => c.id)).toEqual(['alice', 'bob'])
    expect(evidence.contacts[1].unavailable).toBe(true)
    expect(evidence.contacts[0].pendingInteractions).toEqual([])
    expect(state.delivery).toHaveBeenCalledTimes(1)
    expect(state.sent.mock.calls[0][0]).toContain('[阿笔 · 文章](#contact-task?characterId=alice&topicId=article)')
    expect(state.handlers.get('assistant-routines:history')!({}, state.handlers.get('assistant-routines:list')!()[0].id).items[0].status).toBe('completed')
    await vi.advanceTimersByTimeAsync(15000); expect(state.sent).toHaveBeenCalledTimes(1)
  })
  it('honors a disabled inspection tool without calling a model or reporting false success', async () => {
    state.values.set('tool:inspect_contacts:enabled', 'false')
    initializeAssistantRoutines()
    state.handlers.get('assistant-routines:save')!({}, { title: '晨间总结', instruction: '检查状态', time: '09:00', cadence: 'daily', kind: 'contact-summary', enabled: true })
    vi.setSystemTime(new Date(2026, 8, 30, 9)); await vi.advanceTimersByTimeAsync(15000)
    expect(state.model).not.toHaveBeenCalled(); expect(state.sent).not.toHaveBeenCalled()
    expect(state.handlers.get('assistant-routines:list')!()[0].lastError).toContain('关闭')
  })
  it('reports unavailable contacts individually instead of treating them as idle', async () => {
    const result = await readContactsForAssistant()
    expect(result.contacts).toHaveLength(2)
    expect(result.contacts[1]).toMatchObject({ id: 'bob', unavailable: true })
  })
  it('passes the shared pending decisions through read-only inspection', async () => {
    const inspect = state.inspect.getMockImplementation()!
    const item = { id: 'decision', topicId: 'article', kind: 'question', question: '写给谁看？', budgets: [] }
    state.inspect.mockImplementationOnce(async (id: string) => ({ ...await inspect(id), pendingInteractions: [item] }))
    const result = await readContactsForAssistant()
    expect(result.contacts[0]).toMatchObject({ pendingInteractions: [item] })
    expect(summaryTaskLinks(result)).toContain('#contact-interaction?characterId=alice&id=decision')
    expect(summaryTaskLinks(result)).not.toContain('#contact-task?')
    expect(state.model).not.toHaveBeenCalled()
  })
  it('stops a companion inspection before reading the next contact if permission is revoked', async () => {
    const inspect = state.inspect.getMockImplementation()!
    state.inspect.mockImplementationOnce(async (id: string) => {
      const result = await inspect(id)
      state.values.set('tool:inspect_contacts:enabled', 'false')
      return result
    })
    await expect(readContactsForAssistant(new AbortController().signal)).rejects.toThrow('权限已关闭')
    expect(state.inspect).toHaveBeenCalledTimes(1)
  })
})
