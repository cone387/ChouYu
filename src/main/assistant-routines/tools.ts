import { DEFAULT_CHARACTER_ID } from '../../shared/characters'
import type { RegisteredTool } from '../tools/registry'
import type { AssistantRoutineService } from './service'

export function createAssistantTools(service: AssistantRoutineService, owner: (sessionId?: string) => string | undefined, readContacts: () => Promise<unknown>): RegisteredTool[] {
  const base = { source: 'builtin' as const, risk: 'read' as const, requiresConfirmation: false }
  const check = (sessionId?: string) => { if (owner(sessionId) !== DEFAULT_CHARACTER_ID) throw new Error('请在 ChouYu 的聊天中管理助手安排。') }
  return [
    { ...base, name: 'inspect_contacts', displayName: '检查各联系人状态', description: 'ChouYu 读取各联系人的真实任务、执行进展和待答复问题。只读；失败不等于没有任务，不把已结束当作成果已验证。用户询问需要处理什么时，读取 pendingInteractions 并原样使用 cardLink 生成 Markdown 链接，客户端会展示同一张可操作卡片。不得自编 ID 或替用户提交。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async execute(_args, context) { check(context.sessionId); return { content: JSON.stringify(await readContacts()), summary: '已检查联系人状态' } } },
    { ...base, name: 'list_assistant_routines', displayName: '查看助手长期安排', description: '读取 ChouYu 的长期安排、ID、版本、下次执行时间及最近结果。修改或暂停之前先读取。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute(_args, context) { check(context.sessionId); return { content: JSON.stringify(service.list()), summary: '已读取助手安排' } } },
    { ...base, risk: 'write', name: 'save_assistant_routine', displayName: '保存助手长期安排',
      description: '仅在用户明确交代长期安排时使用。支持定时提醒和读取各联系人状态后调用模型总结。使用设备本地时间。修改、暂停须先读取真实 ID/revision 并传入完整内容；不重复新建。时间不明确时先询问。',
      inputSchema: { type: 'object', properties: {
        id: { type: 'string', description: '修改已有安排时填写真实 ID' }, revision: { type: 'number', description: '修改已有安排时填写版本' },
        title: { type: 'string', maxLength: 100 }, instruction: { type: 'string', maxLength: 2000, description: '保留用户的安排与关注重点；仅支持提醒或联系人状态总结' },
        time: { type: 'string', description: 'HH:mm，本地时间' }, cadence: { type: 'string', description: 'daily / weekdays / weekly' }, weekday: { type: 'number', description: 'weekly 时必填，0 周日至 6 周六' },
        kind: { type: 'string', description: 'reminder 直接提醒；contact-summary 先查联系人再由模型总结' }, enabled: { type: 'boolean', description: 'false 暂停，true 启用' }
      }, required: ['title', 'instruction', 'time', 'cadence', 'kind', 'enabled'], additionalProperties: false },
      execute(args, context) { check(context.sessionId); const items = service.save(args, args.id as string | undefined, args.revision as number | undefined); return { content: JSON.stringify({ saved: true, routines: items }), summary: '助手安排已保存' } } }
  ]
}
