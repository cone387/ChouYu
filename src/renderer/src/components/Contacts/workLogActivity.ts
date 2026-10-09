import { agentUsesPlanner, type AgentEvent, type AgentActivityContext, type AgentRun } from '../../../../shared/agents'

export function workLogActivity(run: AgentRun, data: AgentActivityContext, last: AgentEvent | undefined, now: number, error: string) {
  if (error) return { label: 'RECONNECTING', text: '日志连接中断，正在重新连接', moving: true }
  const seconds = Math.max(0, Math.floor((now - (last?.at ?? run.updatedAt)) / 1000))
  if (run.status === 'running') return { label: 'RUNNING', text: `正在执行 · ${last?.text.split('\n')[0].slice(0, 90) || '处理本轮任务'} · 当前步骤 ${seconds} 秒`, moving: true }
  if (run.status === 'waiting') return { label: 'WAITING', text: `等待你的回复 · 已等待 ${seconds} 秒`, moving: true }
  if (run.status === 'queued' || run.status === 'interrupted') return { label: 'PENDING', text: `${run.status === 'queued' ? '等待调度执行' : '执行中断，等待恢复'} · ${seconds} 秒`, moving: true }
  const topic = data.topics.find(item => item.id === run.topicId)
  const continuous = data.settings.enabled && data.focusTopicId === run.topicId && topic && ['planned', 'researching', 'needs_evidence'].includes(topic.status)
  if (!continuous) return { label: 'STOPPED', text: '当前未执行', moving: false }
  if (data.callsToday + (agentUsesPlanner(data.settings) ? 2 : 1) > data.settings.dailyCalls) return { label: 'WAITING', text: '今日模型额度不足，等待明日恢复', moving: true }
  const remaining = Math.max(0, Math.ceil((data.nextAt - now) / 1000))
  return { label: 'WAITING', text: remaining ? `持续工作待命 · 距下轮检查 ${Math.floor(remaining / 60)} 分 ${remaining % 60} 秒` : '持续工作待命 · 等待调度检查', moving: true }
}
