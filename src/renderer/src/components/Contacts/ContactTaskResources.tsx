import { useEffect, useState } from 'react'
import { agentUsesPlanner, type AgentOverview, type AgentTopic } from '../../../../shared/agents'

export default function ContactTaskResources({ topic, data, editable = false, busy = false, onAction }: {
  topic: AgentTopic; data: AgentOverview; editable?: boolean; busy?: boolean
  onAction?: (action: () => Promise<unknown>) => Promise<void>
}) {
  const used = data.topicMetrics?.[topic.id]?.calls ?? 0
  const budget = topic.resourceBudget
  const dailyRemaining = Math.max(0, data.settings.dailyCalls - data.callsToday)
  const reserved = data.topics.filter(t => t.id !== topic.id && t.resourceBudget && !['completed', 'abandoned'].includes(t.status))
    .reduce((sum, t) => sum + Math.max(0, t.resourceBudget!.modelCalls - (data.topicMetrics?.[t.id]?.calls ?? 0)), 0)
  const available = Math.max(0, dailyRemaining - reserved)
  const active = data.runs.some(r => r.topicId === topic.id && ['queued', 'running', 'waiting', 'interrupted'].includes(r.status))
  const [calls, setCalls] = useState(budget?.modelCalls ?? Math.max(1, used + available))
  useEffect(() => { setCalls(topic.resourceBudget?.modelCalls ?? Math.max(1, used + available)) }, [topic.id, topic.resourceBudget?.modelCalls])
  const needed = agentUsesPlanner(data.settings) ? 2 : 1
  return <section className="topic-resources" aria-label="任务资源预算">
    <div className="topic-heading"><h4>任务资源预算</h4><span className="agent-caption">跨天累计，不自动重置</span></div>
    <p>{budget ? <>已用 <strong>{used} / {budget.modelCalls}</strong> 次模型调用 · 剩余 {Math.max(0, budget.modelCalls - used)} 次</> : '尚未分配任务预算，当前沿用联系人资源上限；后续规划会要求补充分配，也可在本任务设置中指定。'}</p>
    {budget && <p className="agent-caption">分配理由：{budget.reason}</p>}
    <p className="agent-caption">联系人今日已用 {data.callsToday} / {data.settings.dailyCalls} 次；其他任务预留 {reserved} 次，当前可分配 {available} 次。规划、执行、失败重试及修订均计入任务消耗。</p>
    {budget && budget.modelCalls - used < needed && <p role="status">本任务剩余额度不足下一轮，已有成果保留。请在本任务设置中调整预算后继续。</p>}
    {dailyRemaining < needed && <p role="status">联系人今日资源不足，可等明日恢复或在顶部工作设置中调整总上限。</p>}
    {editable && <form onSubmit={event => { event.preventDefault(); void onAction?.(() => window.electronAPI.agents.setTaskBudget(topic.characterId, topic.id, topic.revision, { modelCalls: calls })) }}>
      <label>任务累计调用上限<input data-task-budget-calls type="number" min={Math.max(1, used)} max={Math.max(1, used + available, budget?.modelCalls ?? 0)} required value={calls} onChange={event => setCalls(Number(event.target.value))} /></label>
      <button data-task-budget-save type="submit" disabled={busy || active}>保存任务预算</button>
      {active && <p className="agent-caption">请先暂停本任务，再调整预算。</p>}
    </form>}
  </section>
}
