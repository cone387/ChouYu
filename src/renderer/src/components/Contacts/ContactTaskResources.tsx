import { useEffect, useState } from 'react'
import { agentUsesPlanner, type AgentOverview, type AgentTopic } from '../../../../shared/agents'

export default function ContactTaskResources({ topic, data, editable = false, busy = false, onAction }: {
  topic: AgentTopic; data: AgentOverview; editable?: boolean; busy?: boolean
  onAction?: (action: () => Promise<unknown>) => Promise<void>
}) {
  const used = data.topicMetrics?.[topic.id]?.calls ?? 0
  const budget = topic.resourceBudget
  const dailyRemaining = Math.max(0, data.settings.dailyCalls - data.callsToday)
  const available = Math.max(0, Math.min(10000, data.settings.dailyCalls) - used)
  const active = data.runs.some(r => r.topicId === topic.id && ['queued', 'running', 'waiting', 'interrupted'].includes(r.status))
  const [calls, setCalls] = useState(budget?.modelCalls ?? Math.max(1, used + available))
  useEffect(() => { setCalls(topic.resourceBudget?.modelCalls ?? Math.max(1, used + available)) }, [topic.id, topic.resourceBudget?.modelCalls])
  const needed = agentUsesPlanner(data.settings) ? 2 : 1
  return <section className="topic-resources" aria-label="任务资源预算">
    <div className="topic-heading"><h4>任务资源预算</h4><span className="agent-caption">跨天累计，不自动重置</span></div>
    {data.tokenUsage && <p>累计工作 Token：{(data.tokenUsage.tasks[topic.id] ?? 0).toLocaleString()} / {topic.tokenLimit?.toLocaleString() ?? '未设置上限'}（含未知用量的保守预留）</p>}
    <p>{budget ? <>已用 <strong>{used} / {budget.modelCalls}</strong> 次模型调用 · 剩余 {Math.max(0, budget.modelCalls - used)} 次</> : '尚未设置累计调用次数上限；联系人可在任务规划中分配调用预算。'}</p>
    {budget && <p className="agent-caption">分配理由：{budget.reason}</p>}
    <p className="agent-caption">联系人今日已用 {data.callsToday} / {data.settings.dailyCalls} 次，今日剩余 {dailyRemaining} 次。所有任务共用每日额度；本任务的调用同时计入累计预算。两项都有剩余才能推进，规划、执行、失败重试及修订均计入。</p>
    {budget && budget.modelCalls - used < needed && <p role="status">本任务剩余额度不足下一轮，已有成果保留。请在任务描述中说明需要调整的预算与范围。</p>}
    {dailyRemaining < needed && <p role="status">联系人今日共用额度不足，可等明日恢复或在联系人工作设置中提高每日上限。</p>}
    {editable && <form onSubmit={event => { event.preventDefault(); void onAction?.(() => window.electronAPI.agents.setTaskBudget(topic.characterId, topic.id, topic.revision, { modelCalls: calls })) }}>
      <label>任务累计调用上限<input data-task-budget-calls type="number" min={Math.max(1, used)} max={10000} required value={calls} onChange={event => setCalls(Number(event.target.value))} /></label>
      <button data-task-budget-save type="submit" disabled={busy || active}>保存任务预算</button>
      {active && <p className="agent-caption">请先暂停本任务，再调整预算。</p>}
    </form>}
  </section>
}
