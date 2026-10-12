import type { AgentOverview } from '../../shared/agents'

/** Existing work is a normal state, not a failed request to create another round. */
export function pendingContinuation(data: AgentOverview, topicId: string): string | undefined {
  const runs = data.runs.filter(r => r.topicId === topicId)
  const run = runs.find(r => r.status === 'waiting') ?? runs.find(r => ['running', 'queued', 'interrupted'].includes(r.status))
  if (!run) return
  const title = data.topics.find(t => t.id === topicId)?.title ?? '这项任务'
  if (run.status === 'waiting') return run.question?.trim()
    ? `「${title}」正在等你回复：\n\n${run.question}\n\n请直接回复这个问题，或在任务的待处理卡片中回答。回复前保留当前工作。`
    : `「${title}」正在等待回复，但暂未读取到问题正文。请打开任务的待处理卡片核对；当前工作保持等待。`
  if (run.status === 'running') return `「${title}」正在执行，会沿当前工作继续；已有成果保留。`
  if (run.status === 'queued') return `「${title}」已经排队，获得执行名额后会继续；已有成果保留。`
  return `「${title}」的未完成工作已保留，当前等待恢复。请在任务详情查看恢复条件或阻塞原因。`
}
