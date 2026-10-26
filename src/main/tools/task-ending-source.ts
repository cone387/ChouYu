import type { ToolExecutionContext } from './registry'
import type { TaskEndingRequest } from '../../shared/task-ending'
export const taskEndingToolSchema = { type: 'string' as const, description: '仅用户明确要求时提供JSON：deadline={kind:date|instant|duration,value:YYYY-MM-DD或带偏移ISO时刻或毫秒整数,source:逐字用户原话}；count={mode:produced|delivered,amount:成功期次数,fromNow:是否明确从现在再做,source:逐字原话}。助手只用delivered。仅限日历成功期次，不能把调用、尝试、章节数量算入；裸执行次数或交付含义不清先询问。24h持续工作不等于24小时后停止。未改项省略，明确取消用null；改名/额度/周期不能重置。' }
export function endingRequestFromTool(raw: unknown, context: ToolExecutionContext): TaskEndingRequest | undefined {
  if (raw === undefined) return
  if (typeof raw !== 'string' || raw.length > 4000 || !context.taskSource) throw new Error('结束条件缺少本次用户原话来源，未保存。')
  const patch = JSON.parse(raw)
  const quoted = patch?.deadline?.source
  const original = typeof quoted === 'string' ? context.taskSource.turns.findLast(turn => turn.text.includes(quoted)) : undefined
  return { patch, text: context.taskSource.text, acceptedAt: original?.at ?? context.taskSource.acceptedAt, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}
