import { describe, expect, it, vi } from 'vitest'
import { createContactTools } from './tools'
import type { ToolExecutionContext } from '../tools/registry'
import { shouldConfirmTool } from '../../shared/tools'
import { ASSISTANT_CHARACTER_ID } from '../../shared/characters'

const context = { sessionId: 'chat', mainWindow: {} } as ToolExecutionContext
function fixture() {
  let id: string | undefined = 'alice'
  const topic = { id: 'topic', characterId: 'alice', title: '需求研究', goal: '核对证据', constraints: '预算 500', revision: 2, status: 'needs_evidence' }
  const data = { topics: [topic], runs: [] as any[], revision: 1, settings: { enabled: false }, focusTopicId: topic.id }
  const request = vi.fn(async (method: string, owner: string, args?: unknown[]) => {
    if (owner !== 'alice') throw new Error('wrong owner')
    if (method === 'get') return data
    if (method === 'detail') return { run: { id: 'run', topicId: topic.id, status: 'waiting', question: '你熟悉哪个行业？' } }
    if ((args?.[2] as unknown[])?.[1] !== topic.revision) throw new Error('事项已变化')
    return data
  })
  const tools = createContactTools({ owner: () => id, request })
  return { tools, topic, data, request, owner: (value?: string) => { id = value } }
}
describe('confirmed contact feedback', () => {
  it('reads formal deliverables with the current chat owner and forwards only explicit selection', async () => {
    const request = vi.fn(async () => ({ version: 4, savedSectionCount: 4, directory: [{ id: 'ch02b', title: '第二章下' }] }))
    const tool = createContactTools({ owner: () => 'alice', request }).find(t => t.name === 'get_contact_delivery')!
    expect(shouldConfirmTool(tool, 'full')).toBe(false)
    const result = await tool.execute({ topicId: 'topic', version: 4, sectionId: 'ch02b' }, context)
    expect(request).toHaveBeenCalledWith('inspectDelivery', 'alice', ['topic', 4, 'ch02b'])
    expect(result.content).toContain('savedSectionCount')
  })
  it('prepares a version-bound style revision, reports acceptance instead of completion, and rejects stale or repeated use', async () => {
    const data = { revision: 7, topics: [{ id: 'topic', title: '小说', revision: 8 }], runs: [] as any[] }
    let version = 4, chatOwner = 'alice'
    const request = vi.fn(async (method: string) => method === 'get' ? data : method === 'delivery' ? { version } : { ...data, runs: [{ id: 'run', topicId: 'topic', status: 'queued' }] })
    const tool = createContactTools({ owner: () => chatOwner, request }).find(t => t.name === 'revise_contact_presentation')!
    const args = { topicId: 'topic', revision: 8, deliveryVersion: 4, reason: '亮色主题，与系统一致' }
    const prepared = await tool.prepareAsync!(args, context)
    expect(prepared.preview).toContain('正文、需求、阶段与任务状态保持不变')
    const result = JSON.parse((await prepared.execute()).content)
    expect(result.workCompleted).toBe(false); expect(result.run.status).toBe('queued')
    expect(request).toHaveBeenLastCalledWith('feedback', 'alice', [7, 'reviseTopic', ['topic', 8, args.reason, undefined, 'presentation', 4]])
    await expect(prepared.execute()).rejects.toThrow('重复')
    version = 5; await expect(tool.prepareAsync!(args, context)).rejects.toThrow('版本')
    version = 4; const pending = await tool.prepareAsync!(args, context); chatOwner = 'bob'
    await expect(pending.execute()).rejects.toThrow('归属')
    chatOwner = 'alice'; data.runs.push({ topicId: 'other', status: 'running' })
    await expect(tool.prepareAsync!(args, context)).resolves.toHaveProperty('preview')
    data.runs.push({ topicId: 'topic', status: 'running' })
    await expect(tool.prepareAsync!(args, context)).rejects.toThrow('未完成')
  })
  it('previews revision feedback and keeps the captured topic and profile versions', async () => {
    const { tools, request } = fixture(), tool = tools[1]
    const prepared = await tool.prepareAsync!({ topicId: 'topic', revision: 2, action: 'revise', reason: '第二节改为团队场景，保留证据局限' }, context)
    expect(shouldConfirmTool(tool, 'full')).toBe(true)
    expect(prepared.preview).toContain('保留证据局限')
    expect(request).toHaveBeenCalledTimes(1)
    await prepared.execute()
    expect(request).toHaveBeenLastCalledWith('feedback', 'alice', [1, 'reviseTopic', ['topic', 2, '第二节改为团队场景，保留证据局限']])
  })
  it('assigns one task to the current contact and respects the configured approval mode', async () => {
    const request = vi.fn(async (method: string) => method === 'get' ? { revision: 4, topics: [], runs: [] } : { topics: [{ id: 'new-topic' }], focusTopicId: 'new-topic', runs: [{ id: 'new-run', topicId: 'new-topic', status: 'queued' }] })
    const tool = createContactTools({ owner: () => 'alice', request }).find(tool => tool.name === 'assign_contact_task')!
    expect(shouldConfirmTool(tool, 'confirm')).toBe(false)
    expect(shouldConfirmTool(tool, 'full')).toBe(false)
    expect(shouldConfirmTool(tool, 'auto')).toBe(true)
    const prepared = await tool.prepareAsync!({ description: '每周跟进开发者工具的付费需求' }, context)
    expect(request).toHaveBeenCalledTimes(1)
    const result = await prepared.execute()
    expect(request).toHaveBeenLastCalledWith('feedback', 'alice', [4, 'assignTopic', ['每周跟进开发者工具的付费需求']])
    expect(result.content).toContain('new-topic')
    await expect(prepared.execute()).rejects.toThrow('重复')
  })
  it('does not assign to a changed contact or replace active work', async () => {
    const { tools, owner, data } = fixture(), tool = tools.find(tool => tool.name === 'assign_contact_task')!
    const prepared = await tool.prepareAsync!({ description: '研究需求' }, context)
    owner('bob')
    await expect(prepared.execute()).rejects.toThrow('归属')
    owner('alice'); data.runs.push({ status: 'waiting' })
    expect((await tool.prepareAsync!({ description: '研究需求' }, context)).preview).toContain('先排队')
    await expect(tool.prepareAsync!({ description: '' }, context)).rejects.toThrow('描述')
  })
  it('previews exact constraints and cannot execute twice or bypass confirmation in full mode', async () => {
    const { tools, request } = fixture(), tool = tools[1]
    expect(shouldConfirmTool(tool, 'full')).toBe(true)
    const prepared = await tool.prepareAsync!({ topicId: 'topic', revision: 2, action: 'constraints', constraints: '预算 200', reason: '缩小试验' }, context)
    expect(prepared.preview).toContain('预算 500'); expect(prepared.preview).toContain('预算 200')
    expect(request.mock.calls.every(call => call[0] === 'get')).toBe(true)
    await prepared.execute()
    expect(request).toHaveBeenLastCalledWith('feedback', 'alice', [1, 'editTopic', ['topic', 2, { title: '需求研究', goal: '核对证据', constraints: '预算 200' }, '缩小试验']])
    await expect(prepared.execute()).rejects.toThrow('已执行')
  })
  it('rejects stale confirmation and deleted or reassigned sessions', async () => {
    for (const change of ['revision', 'owner', 'delete']) {
      const { tools, topic, owner } = fixture()
      const prepared = await tools[1].prepareAsync!({ topicId: 'topic', revision: 2, action: 'pause', reason: '等反馈' }, context)
      if (change === 'revision') topic.revision++
      else owner(change === 'delete' ? undefined : 'bob')
      await expect(prepared.execute()).rejects.toThrow()
    }
  })
  it('rejects guessed foreign topics, assistant chat and stale preparation', async () => {
    const { tools, owner } = fixture()
    await expect(tools[1].prepareAsync!({ topicId: 'foreign', revision: 2 }, context)).rejects.toThrow()
    await expect(tools[1].prepareAsync!({ topicId: 'topic', revision: 1 }, context)).rejects.toThrow('变化')
    owner(ASSISTANT_CHARACTER_ID)
    await expect(tools[0].execute({}, context)).rejects.toThrow('具体联系人')
  })
  it('previews an exact pending answer and uses an atomic checked resume', async () => {
    const { tools, request } = fixture()
    const prepared = await tools[2].prepareAsync!({ topicId: 'topic', revision: 2, runId: 'run', answer: '开发者工具' }, context)
    expect(prepared.preview).toContain('你熟悉哪个行业？'); expect(prepared.preview).toContain('开发者工具')
    await prepared.execute()
    expect(request).toHaveBeenLastCalledWith('feedback', 'alice', [1, 'answerChecked', ['topic', 2, 'run', '开发者工具']])
  })
  it('does not replace a waiting question with a new round or silently enable scheduling', async () => {
    const { tools, data } = fixture()
    const args = { topicId: 'topic', revision: 2, action: 'continue', reason: '继续验证' }
    const prepared = await tools[1].prepareAsync!(args, context)
    expect(prepared.preview).toContain('保持关闭')
    data.runs.push({ status: 'waiting', topicId: 'topic' })
    await expect(tools[1].prepareAsync!(args, context)).rejects.toThrow('回答问题')
  })
})
