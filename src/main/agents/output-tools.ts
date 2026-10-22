import { contactCommandDispatcher, type UnknownContactDispatch } from '../task-center/command-boundary'
import { outputKinds, validateOutputPreference, type ContactOutputScope, type ContactOutputPreferenceRecord } from '../../shared/contact-output'
import { containsSecret } from '../../shared/memory'
import type { RegisteredTool, ToolExecutionContext } from '../tools/registry'

export function createOutputTools(access: {
  owner(sessionId?: string): string | undefined
  dispatchUnknown: UnknownContactDispatch
}): RegisteredTool[] {
  const request = contactCommandDispatcher(access.dispatchUnknown)
  const owner = (context: ToolExecutionContext) => {
    const id = access.owner(context.sessionId)
    if (!id) throw new Error('请在具体联系人的聊天中修改阅读偏好。')
    return id
  }
  const scopeFields = { scope: { type: 'string' as const, enum: ['contact', 'task', 'delivery'] }, topicId: { type: 'string' as const }, deliveryVersion: { type: 'number' as const } }
  const scope = (args: Record<string, unknown>): ContactOutputScope => {
    if (args.scope === 'contact' && args.topicId === undefined && args.deliveryVersion === undefined) return { kind: 'contact' }
    if (typeof args.topicId === 'string' && args.topicId.trim()) {
      if (args.scope === 'task' && args.deliveryVersion === undefined) return { kind: 'task', topicId: args.topicId }
      if (args.scope === 'delivery' && Number.isSafeInteger(args.deliveryVersion) && Number(args.deliveryVersion) > 0) return { kind: 'delivery', topicId: args.topicId, version: Number(args.deliveryVersion) }
    }
    throw new Error('阅读偏好范围无效，请指定联系人、任务或实际成果版本。')
  }
  const read = async (id: string, target: ContactOutputScope) => {
    const records: ContactOutputPreferenceRecord[] = await request('outputPreferences', id, target.kind === 'contact' ? [] : [target.topicId, target.kind === 'delivery' ? target.version : undefined])
    const record = records.find(record => JSON.stringify(record.scope) === JSON.stringify(target))
    if (!record) throw new Error('尚未读取实际阅读偏好。')
    return record
  }
  return [
    { name: 'get_contact_output_preferences', displayName: '读取阅读偏好', source: 'builtin', risk: 'read', requiresConfirmation: false,
      description: '读取阅读偏好与真实版本。scope=contact为联系人长期偏好；task需真实topicId；delivery还需实际deliveryVersion，只适用于此版本。',
      inputSchema: { type: 'object', properties: scopeFields, required: ['scope'], additionalProperties: false },
      async execute(args, context) { return { content: JSON.stringify(await read(owner(context), scope(args))), summary: '已读取阅读偏好' } } },
    { name: 'set_contact_output_preference', displayName: '修改阅读偏好', source: 'builtin', risk: 'write', requiresConfirmation: true, alwaysConfirm: true,
      description: '保存阅读偏好。仅此次用delivery绑定已保存版本，此任务以后用task，联系人今后所有成果用contact；范围不确定先追问。kind选择排版，auto恢复自动；instruction保留完整表达要求。已有正文不会重写，不改变任务、权限、状态或额度。',
      inputSchema: { type: 'object', properties: { ...scopeFields, revision: { type: 'number' }, reason: { type: 'string' }, kind: { type: 'string', enum: [...outputKinds, 'auto'] }, density: { type: 'string', enum: ['comfortable', 'compact'] }, instruction: { type: 'string' } }, required: ['scope', 'revision', 'reason'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context), target = scope(args), before = await read(id, target)
        const { scope: _scope, topicId: _topic, deliveryVersion: _version, revision, reason, ...fields } = args
        if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000 || containsSecret(reason)) throw new Error('阅读偏好修改说明无效。')
        const patch = validateOutputPreference(fields)
        if (target.kind === 'delivery' && patch.instruction !== undefined) throw new Error('单次表达调整请用 submit_contact_delivery_feedback 提交固定版本正文修订；阅读偏好仅调整样式与间距。')
        if (!Object.keys(patch).length) throw new Error('没有要修改的阅读偏好。')
        if (!Number.isSafeInteger(revision) || revision !== before.revision) throw new Error('阅读偏好已变化，请重新读取。')
        const labels = { writing: '正文阅读', ideas: '想法', review: '评审', research: '调研', plan: '行动计划', briefing: '简报', plain: '普通正文', auto: '自动选择' }
        const changes = [patch.kind && `阅读样式：${labels[patch.kind]}`, patch.density && `行文间距：${patch.density === 'compact' ? '紧凑' : '舒适'}`, patch.instruction !== undefined && `后续表达要求：${patch.instruction || '清空'}`].filter(Boolean).join('\n')
        const range = target.kind === 'contact' ? '这个联系人的全部成果' : target.kind === 'task' ? '这项任务的成果' : `仅此成果版本 ${target.version}`
        let consumed = false
        return { preview: `生效范围：${range}\n${changes}\n已保存正文保持完整；表达要求在后续生成时使用。`, execute: async () => {
          if (consumed) throw new Error('此修改已执行，请重新发起。')
          consumed = true
          if (owner(context) !== id) throw new Error('聊天归属已变化，请重新确认。')
          const saved = await request('setOutputPreference', id, [target, before.revision, patch, reason]) as ContactOutputPreferenceRecord
          if (saved.revision !== before.revision + 1 || JSON.stringify(saved.scope) !== JSON.stringify(target)) throw new Error('未取得有效的阅读偏好保存回执。')
          const message = `已保存阅读偏好，范围为${range}。已有正文保持完整。`
          return { content: JSON.stringify({ saved: true, revision: saved.revision, scope: saved.scope, message }), summary: message }
        } }
      }, execute() { throw new Error('请先准备阅读偏好修改。') } }
  ]
}
