import type { PreparedTool, RegisteredTool, ToolExecutionContext } from '../tools/registry'
import { validateMemoryInput, type ContactMemory, type MemoryInput } from '../../shared/contact-memories'
type Access = { owner(sessionId?: string): string | undefined; request(method: string, owner: string, args?: unknown[]): Promise<any> }
export function createMemoryTools(access: Access): RegisteredTool[] {
  const owner = (context: ToolExecutionContext) => { const id = access.owner(context.sessionId); if (!id) throw new Error('请在联系人的会话中操作记忆。'); return id }
  const prepare = async (action: 'remember' | 'update' | 'forget', args: Record<string, unknown>, context: ToolExecutionContext): Promise<PreparedTool> => {
    const id = owner(context)
    let current: ContactMemory | undefined
    if (action !== 'remember') {
      current = ((await access.request('memoryList', id)) as ContactMemory[]).find(m => m.id === args.id)
      if (!current || current.revision !== args.revision) throw new Error('请先读取这条记忆的真实 ID 和当前版本，不能猜测。')
    }
    let input: MemoryInput | undefined
    if (action !== 'forget') input = validateMemoryInput({ content: args.content, kind: current?.kind ?? args.kind ?? 'preference',
      scope: current?.scope ?? (args.topicId ? { kind: 'task', topicId: args.topicId } : args.sessionOnly ? { kind: 'session', sessionId: context.sessionId } : { kind: 'contact' }),
      source: args.sourceMessageId ? { kind: 'conversation', sessionId: context.sessionId, messageId: args.sourceMessageId } : { kind: 'user', at: Date.now() } })
    let used = false
    return { preview: action === 'forget' ? `忘记这条记忆及其历史正文：\n${current!.content}` : `${current ? `原记忆：${current.content}\n` : ''}${input!.source.kind === 'user' ? '确认记住' : '保存待确认经历'}：${input!.content}`, execute: async () => {
      if (used || owner(context) !== id) throw new Error('会话归属已变化或此操作已执行，请重新读取。')
      used = true
      const value = await access.request(action === 'forget' ? 'forgetMemory' : action === 'update' ? 'updateMemory' : 'createMemory', id,
        action === 'forget' ? [current!.id, current!.revision] : action === 'update' ? [current!.id, current!.revision, input] : [input])
      return { content: JSON.stringify(value ?? { forgotten: true }), summary: action === 'forget' ? '已忘记此条记忆' : '记忆已保存' }
    } }
  }
  const common = { source: 'builtin' as const, risk: 'write' as const, requiresConfirmation: true }
  return [
    { ...common, name: 'list_contact_memories', displayName: '读取独立记忆', risk: 'read', requiresConfirmation: false,
      description: '读取当前联系人在本次会话范围内的真实记忆和版本。仅用户明确指定任务时提供 topicId。纠正或忘记前必须先读取；指代含糊时询问。',
      inputSchema: { type: 'object', properties: { topicId: { type: 'string', maxLength: 128 } }, additionalProperties: false },
      async execute(args, context) {
        const items = (await access.request('memoryList', owner(context)) as ContactMemory[]).filter(m => m.scope.kind === 'contact' || m.scope.kind === 'session' && m.scope.sessionId === context.sessionId || m.scope.kind === 'task' && m.scope.topicId === args.topicId)
        return { content: JSON.stringify(items), summary: `读取 ${items.length} 条独立记忆` }
      } },
    ...(['remember', 'update', 'forget'] as const).map(action => ({ ...common, name: `${action}_contact_memory`, displayName: ({ remember: '记住一件事', update: '纠正独立记忆', forget: '忘记一件事' })[action],
      description: action === 'remember' ? '用户明确要求记住时保存事实。共同经历或模型推测必须提供实际 sourceMessageId，保存为待确认候选，不能冒充用户确认。范围不清时询问。' : '仅在用户明确要求纠正或忘记时操作，先 list_contact_memories 读取真实 id/revision。保留原范围，纠正原记录，不追加替代旧记忆。',
      inputSchema: { type: 'object' as const, properties: { id: { type: 'string' as const, maxLength: 128 }, revision: { type: 'number' as const }, content: { type: 'string' as const, maxLength: 2000 }, kind: { type: 'string' as const, description: 'preference/project/experience/research' }, topicId: { type: 'string' as const, maxLength: 128 }, sessionOnly: { type: 'boolean' as const }, sourceMessageId: { type: 'string' as const, maxLength: 128 } }, required: action === 'remember' ? ['content'] : action === 'forget' ? ['id', 'revision'] : ['id', 'revision', 'content'], additionalProperties: false },
      prepareAsync: (args: Record<string, unknown>, context: ToolExecutionContext) => prepare(action, args, context),
      async execute(args: Record<string, unknown>, context: ToolExecutionContext) { return (await prepare(action, args, context)).execute() }
    }))
  ]
}
