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
    data.runs.push({ status: 'waiting' })
    await expect(tools[1].prepareAsync!(args, context)).rejects.toThrow('回答问题')
  })
})
