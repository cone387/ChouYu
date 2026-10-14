import { randomUUID } from 'node:crypto'
import { validateContactActionRequest, type ContactActionOption, type ContactActionRequest } from '../../shared/contact-actions'
import type { PreparedTool, RegisteredTool, ToolExecutionContext } from '../tools/registry'

export function createInteractionTools(access: {
  owner(sessionId?: string): string | undefined
  prepare(option: ContactActionOption, context: ToolExecutionContext): Promise<PreparedTool>
  offer(owner: string, sourceKey: string, request: ContactActionRequest): Promise<{ id: string }>
}): RegisteredTool[] {
  return [{ name: 'request_contact_action', displayName: '发送处理卡片', source: 'builtin', risk: 'safe', requiresConfirmation: false,
    description: '需要用户选择方案、补充回复、确认配置或反馈成果时，发送可直接操作的持久卡片。只发卡片，不执行其中操作。request是JSON：purpose(permission/configuration/choice/material/feedback/confirmation)、title、body、subject({kind:contact}或{kind:task,topicId,revision}或{kind:delivery,topicId,revision,version})、actions(1–8项{id,label,tool,arguments})、可选input({label,argument:answer或reason,maxLength<=2000,required})。只使用已读取的真实工具和版本，操作来自当前联系人；来源与会话由系统绑定。选择不得包含批量操作；用户选一个方案只执行一个操作。需要正文反馈时绑定成果固定版本，用revise_contact_presentation或update_contact_topic；不得用进度卡代替正文。',
    inputSchema: { type: 'object', properties: { request: { type: 'string', description: '最多100000字符的交互请求JSON。不得含凭据。' } }, required: ['request'], additionalProperties: false },
    async execute(args, context) {
      const owner = access.owner(context.sessionId)
      if (!owner || !context.sessionId) throw new Error('请在具体联系人的会话中发送卡片。')
      if (typeof args.request !== 'string' || args.request.length > 100000) throw new Error('交互请求无效或过长。')
      const request = validateContactActionRequest({ ...JSON.parse(args.request), sessionId: context.sessionId })
      const previews: string[] = []
      for (const option of request.actions) {
        const prepared = await access.prepare(option, context)
        previews.push(`${option.label}：${prepared.preview || prepared.noOpResult?.summary || '按卡片中所列操作执行。'}`)
      }
      const validated = validateContactActionRequest({ ...request, body: `${request.body}\n\n${previews.join('\n\n')}` })
      const saved = await access.offer(owner, `proposal:${randomUUID()}`, validated)
      return { content: JSON.stringify({ pendingInteraction: true, interactionId: saved.id, message: '处理卡片已发送，等待你的选择。' }), summary: '处理卡片已发送，尚未执行其中操作' }
    }
  }]
}
