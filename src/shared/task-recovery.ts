import { contactFailure } from './contact-failure'

export interface TaskRecoveryInfo {
  topicId?: string; revision?: number; runId?: string
  reason: 'network' | 'permission' | 'budget' | 'checkpoint' | 'paused' | 'answer' | 'unknown-result' | 'failure'
  message: string; conditions: string[]; retryAt?: number; automatic: boolean; unknownExternalResult: boolean
  allowedActions: ('retry' | 'continue' | 'answer' | 'adjust-budget' | 'settings' | 'inspect')[]
}
export interface TaskRecoveryInput {
  topicId?: string; revision?: number; runId?: string
  state: { code: string; description: string }; error?: string; retryAt?: number; automatic?: boolean; unknownExternalResult?: boolean
}
/** Read-only explanation of the existing domain state, never a replacement state machine. */
export function taskRecovery(input: TaskRecoveryInput): TaskRecoveryInfo | undefined {
  const { state, topicId, revision, runId } = input
  const base = { topicId, revision, runId, message: state.description, automatic: false, unknownExternalResult: false }
  if (input.unknownExternalResult) return { ...base, reason: 'unknown-result', unknownExternalResult: true,
    message: '上次操作已开始，但结果尚未确认。请先核对实际状态；不会自动重复执行。', conditions: ['核对外部实际结果后关闭该事项；原操作不会补执行。'], allowedActions: ['inspect'] }
  if (state.code === 'paused') return { ...base, reason: 'paused', conditions: ['需要你在原任务中明确继续。开启自动工作不会解除暂停。'], allowedActions: ['continue'] }
  if (state.code === 'waiting') return { ...base, reason: 'answer', conditions: ['回复原问题后，从原任务继续。'], allowedActions: ['answer'] }
  if (['task-budget', 'daily-limit', 'daily-budget'].includes(state.code)) return { ...base, reason: 'budget', automatic: state.code === 'daily-budget' && Boolean(input.automatic),
    conditions: [state.code === 'daily-budget' ? '等待次日额度恢复或调整上限；仍需满足工作时间和原任务状态。' : '调整当前不足的额度；任务累计额度不会按日重置。'], allowedActions: ['adjust-budget'] }
  if (state.code === 'interrupted') return { ...base, reason: 'checkpoint', automatic: Boolean(input.automatic),
    conditions: ['原轮次检查点与来源保留，当前权限、额度和执行名额仍需满足。'], allowedActions: ['inspect'] }
  if (!['failed', 'retry'].includes(state.code)) return undefined
  const failure = contactFailure(input.error ?? '')
  const permission = failure.kind === 'permission'
  return { ...base, reason: permission ? 'permission' : failure.kind === 'network' ? 'network' : 'failure',
    message: state.description || failure.message, ...(input.retryAt === undefined ? {} : { retryAt: input.retryAt }),
    automatic: Boolean(input.automatic && input.retryAt !== undefined),
    conditions: [permission ? '恢复所需权限后重新核对当前来源；不会自动扩大授权。' : '按原任务的退避时间、权限、工作时间和额度接续；排队不代表已有新成果。'],
    allowedActions: permission || failure.settings ? ['settings', 'retry'] : ['retry'] }
}
