import type { RegisteredTool } from '../tools/registry'
import type { TaskCreateInput, TaskRecord } from '../../shared/tasks'

export function createTaskTool(create: (input: TaskCreateInput) => TaskRecord, session: (id: string) => { title: string } | null): RegisteredTool {
  return {
    name: 'create_task', displayName: '创建任务', risk: 'write', source: 'builtin', requiresConfirmation: true, alwaysConfirm: true,
    description: '仅在用户明确希望加入待办时提议创建任务；必须等待用户确认。不要将普通建议自动加入任务。返回任务标识。时间使用含时区的 ISO 8601 格式；没有指定的时间不要猜测。',
    inputSchema: { type: 'object', properties: {
      title: { type: 'string', description: '任务名称', maxLength: 200 },
      note: { type: 'string', description: '任务说明', maxLength: 2000 },
      priority: { type: 'string', description: 'high、medium 或 low；默认 medium' },
      startAt: { type: 'string', description: '可选开始时间，含时区的 ISO 8601' },
      dueAt: { type: 'string', description: '可选截止时间，含时区的 ISO 8601' }
    }, required: ['title'], additionalProperties: false },
    execute(args, context) {
      const origin = context.sessionId ? session(context.sessionId) : null
      if (!origin || !context.sessionId) throw new Error('来源会话不存在，请重新打开会话后创建任务。')
      const timestamp = (value: unknown) => {
        if (value === undefined) return null
        if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('任务时间需要包含日期、时间和时区。')
        return Date.parse(value)
      }
      const task = create({ title: String(args.title ?? ''), note: typeof args.note === 'string' ? args.note : '', priority: args.priority as TaskCreateInput['priority'], startAt: timestamp(args.startAt), dueAt: timestamp(args.dueAt), source: { kind: 'chat', id: context.sessionId, label: origin.title.slice(0, 200) } })
      return { taskId: task.id, content: JSON.stringify({ id: task.id, title: task.title, status: task.status }), summary: `已创建任务：${task.title}` }
    }
  }
}
