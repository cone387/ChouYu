import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ values: new Map<string, string>(), handlers: new Map<string, (...args: any[]) => any>(), sent: vi.fn(), inspect: vi.fn(), delivery: vi.fn(), model: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler) } }))
vi.mock('../database', () => ({
  getState: (key: string) => state.values.get(key), setState: (key: string, value: string) => state.values.set(key, value),
  appendAssistantMessage: state.sent, getConfig: () => ({ aiToolsEnabled: true, soulMd: 'ChouYu' }),
  getSession: () => ({ characterId: 'chouyu' }), listCharacters: () => [{ id: 'chouyu', name: '丑鱼' }, { id: 'alice', name: '阿笔' }, { id: 'bob', name: '老周' }]
}))
vi.mock('../agents', () => ({ inspectContactWork: state.inspect, inspectContactDelivery: state.delivery }))
vi.mock('../ai', () => ({ streamAIChat: state.model }))
vi.mock('../reminder-events', () => ({ notifyReminderChanges: vi.fn() }))
vi.mock('../tools/registry', () => ({ getRegisteredTool: () => null, registerTool: vi.fn() }))
import { initializeAssistantRoutines, closeAssistantRoutines, readContactsForAssistant } from './index'

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 30, 8))
  state.values.clear(); state.handlers.clear(); vi.clearAllMocks()
  state.inspect.mockImplementation(async (id: string) => {
    if (id === 'bob') throw new Error('worker unavailable')
    return { topics: [{ id: 'article', title: '文章', status: 'researching', judgement: '初稿准备中', nextStep: '核查', updatedAt: 1 }], runs: [{ topicId: 'article', status: 'waiting', question: '使用哪个标题？', summary: '', error: '' }], reports: [], queuedTopicIds: [] }
  })
  state.delivery.mockResolvedValue({ version: 2, sections: [{ title: '初稿' }] })
})
afterEach(() => { closeAssistantRoutines(); vi.useRealTimers() })
describe('assistant routine integration', () => {
  it('reads real contact state, permits bounded delivery inspection, and sends the generated morning summary', async () => {
    state.model.mockImplementation(async (_messages, _prompt, _config, chunk, _signal, runtime) => {
      const verified = await runtime.execute({ name: 'read_contact_delivery', arguments: JSON.stringify({ characterId: 'alice', topicId: 'article' }) })
      expect(JSON.parse(verified).version).toBe(2)
      expect(await runtime.execute({ name: 'read_contact_delivery', arguments: JSON.stringify({ characterId: 'chouyu', topicId: 'article' }) })).toContain('不在本次检查范围')
      chunk('阿笔在等你选择标题；老周的状态暂时无法读取。')
    })
    initializeAssistantRoutines()
    state.handlers.get('assistant-routines:save')!({}, { title: '晨间总结', instruction: '关注待答复事项', time: '09:00', cadence: 'daily', kind: 'contact-summary', enabled: true })
    vi.setSystemTime(new Date(2026, 8, 30, 9)); await vi.advanceTimersByTimeAsync(15000)
    expect(state.model).toHaveBeenCalledTimes(1)
    expect(state.sent).toHaveBeenCalledWith(expect.stringContaining('老周的状态暂时无法读取'), undefined, 'notification', { receiptIds: [expect.stringContaining('routine:')] })
    const evidence = JSON.parse(state.model.mock.calls[0][0][0].content).evidence
    expect(evidence.contacts.map((c: { id: string }) => c.id)).toEqual(['alice', 'bob'])
    expect(evidence.contacts[1].unavailable).toBe(true)
    expect(state.delivery).toHaveBeenCalledTimes(1)
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
})
