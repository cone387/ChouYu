import type { AgentOverview, AgentRunDetail } from '../../shared/agents'
import { TOPIC_STATUS } from '../../shared/agents'
import { ASSISTANT_CHARACTER_ID } from '../../shared/characters'
import { containsSecret } from '../../shared/memory'
import type { PreparedTool, RegisteredTool, ToolExecutionContext } from '../tools/registry'

interface Access {
  owner(sessionId?: string): string | undefined
  request(method: string, id: string, args?: unknown[]): Promise<any>
}
export function createContactTools(access: Access): RegisteredTool[] {
  const owner = (context: ToolExecutionContext) => {
    const id = access.owner(context.sessionId)
    if (!id || id === ASSISTANT_CHARACTER_ID) throw new Error('请在具体联系人的聊天中操作其事项。')
    return id
  }
  const common = { source: 'builtin' as const, risk: 'write' as const, requiresConfirmation: true, alwaysConfirm: true }
  const prepare = async (args: Record<string, unknown>, context: ToolExecutionContext, answer: boolean): Promise<PreparedTool> => {
    const id = owner(context), topicId = String(args.topicId), revision = args.revision as number
    const overview = await access.request('get', id) as AgentOverview
    const topic = overview.topics.find(t => t.id === topicId)
    if (!topic || !Number.isInteger(revision) || topic.revision !== revision) throw new Error('事项已变化，请重新读取后再确认。')
    let method: string, values: unknown[], preview: string
    if (answer) {
      const detail = await access.request('detail', id, [args.runId]) as AgentRunDetail
      if (detail.run.topicId !== topicId || detail.run.status !== 'waiting') throw new Error('这项工作已不在等待回复。')
      const text = String(args.answer || '').trim()
      if (!text || containsSecret(text)) throw new Error('回复不能为空或包含密钥。')
      method = 'answerChecked'; values = [topicId, revision, detail.run.id, text]
      preview = `事项：${topic.title}\n待确认：${detail.run.question}\n你的回复：${text}\n确认后从本轮检查点继续。`
    } else {
      const reason = String(args.reason || '').trim()
      if (!reason || containsSecret(reason)) throw new Error('请说明调整原因，不要包含密钥。')
      if (args.action === 'pause') {
        method = 'topicStatus'; values = [topicId, revision, 'paused', reason]
        preview = `事项：${topic.title}\n状态：${TOPIC_STATUS[topic.status]} → 已暂停\n停止此事项未完成的工作。\n原因：${reason}`
      } else if (args.action === 'continue') {
        if (overview.runs.some(r => ['queued', 'running', 'waiting', 'interrupted'].includes(r.status))) throw new Error('联系人仍有未完成工作；若正在等你回复，请使用回答问题工具。')
        method = 'continueTopic'; values = [topicId, revision, reason]
        preview = `事项：${topic.title}\n设为当前事项，并立即运行一轮。\n持续工作：${overview.settings.enabled ? '保持开启' : '保持关闭'}\n按现有来源与调用预算执行。\n原因：${reason}`
      } else if (args.action === 'constraints') {
        if (typeof args.constraints !== 'string' || containsSecret(args.constraints)) throw new Error('请提供完整的新约束，不要包含密钥。')
        method = 'editTopic'; values = [topicId, revision, { title: topic.title, goal: topic.goal, constraints: args.constraints }, reason]
        preview = `事项：${topic.title}\n原约束：${topic.constraints || '无'}\n新约束：${args.constraints || '无'}\n本事项未完成的轮次会停止，后续按新约束工作。\n原因：${reason}`
      } else throw new Error('操作应为 continue、pause 或 constraints。')
    }
    let consumed = false
    return { preview, execute: async () => {
      if (consumed) throw new Error('此操作已执行，请重新发起。')
      consumed = true
      if (owner(context) !== id) throw new Error('聊天归属已变化，请重新确认。')
      // The worker checks the captured revision atomically with the mutation.
      await access.request('feedback', id, [overview.revision, method, values])
      return { content: `操作已完成。\n${preview}`, summary: answer ? '已回复，继续本轮工作' : '已调整联系人事项' }
    } }
  }
  const topicProperties = {
    topicId: { type: 'string' as const, description: '从 get_contact_topics 获取的事项 ID', maxLength: 128 },
    revision: { type: 'number' as const, description: '当前事项 revision，禁止猜测' }
  }
  return [
    { ...common, name: 'get_contact_topics', displayName: '读取联系人事项', risk: 'read', requiresConfirmation: false, alwaysConfirm: false,
      description: '读取当前聊天联系人的真实事项及待回复问题。只能操作当前联系人，用户指代不明确时先询问；更新前必须读取版本。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async execute(_args, context) {
        const data = await access.request('get', owner(context)) as AgentOverview
        return { content: JSON.stringify({ topics: data.topics, focusTopicId: data.focusTopicId, pending: data.runs.filter(r => ['waiting', 'queued', 'running', 'interrupted'].includes(r.status)), settings: data.settings }), summary: `已读取 ${data.topics.length} 个事项` }
      } },
    { ...common, name: 'update_contact_topic', displayName: '调整联系人事项',
      description: '用户明确要求时继续、暂停或修改当前联系人事项约束。先读取事项，展示变更并确认后才执行；不能凭聊天文字声称执行成功。不修改个人任务。',
      inputSchema: { type: 'object', properties: { ...topicProperties,
        action: { type: 'string', description: '只接受 continue（继续）、pause（暂停）、constraints（替换约束）', maxLength: 20 },
        constraints: { type: 'string', description: 'constraints 操作时必填，完整新约束；空串表示移除约束', maxLength: 2000 },
        reason: { type: 'string', description: '用户要求的调整原因', maxLength: 2000 }
      }, required: ['topicId', 'revision', 'action', 'reason'], additionalProperties: false },
      prepareAsync: (args, context) => prepare(args, context, false), execute: () => { throw new Error('必须先预览确认。') } },
    { ...common, name: 'answer_contact_question', displayName: '回复联系人待确认问题',
      description: '将用户的明确答复交给当前联系人正在等待的事项，先读取待确认问题与版本，展示答复并确认后继续工作。',
      inputSchema: { type: 'object', properties: { ...topicProperties,
        runId: { type: 'string', description: '正在 waiting 的轮次 ID', maxLength: 128 },
        answer: { type: 'string', description: '用户对该问题的明确答复', maxLength: 2000 }
      }, required: ['topicId', 'revision', 'runId', 'answer'], additionalProperties: false },
      prepareAsync: (args, context) => prepare(args, context, true), execute: () => { throw new Error('必须先预览确认。') } }
  ]
}
