import { useEffect, useState, type ReactNode } from 'react'
import TaskIcon from '../Tasks/TaskIcon'
import { AGENT_STATUS, TOPIC_STATUS, type AgentOverview, type AgentTopic } from '../../../../shared/agents'

const time = (value: number) => new Date(value).toLocaleString('zh-CN', { hour12: false })
function duration(ms: number) {
  if (ms > 0 && ms < 1000) return '不足 1 秒'
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`
}

export default function ContactTaskOverview({ topic, data, visible, children }: { topic: AgentTopic; data: AgentOverview; visible: boolean; children?: ReactNode }) {
  const metric = data.topicMetrics?.[topic.id]
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!visible || !metric?.activeRuns) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [visible, metric?.activeRuns])
  const latest = metric?.latestRun ?? data.runs.find(run => run.topicId === topic.id)
  const active = latest && ['queued', 'running', 'waiting', 'interrupted'].includes(latest.status)
  const token = (value: number | undefined, reported: number | undefined) => !metric ? '—' : metric.calls === 0 ? '0' : !reported ? '未记录' : `${value!.toLocaleString()}${reported < metric.calls ? '（部分）' : ''}`
  const elapsed = metric ? duration(metric.elapsedMs + Math.max(0, now - metric.measuredAt) * metric.activeRuns) : '—'
  return <div className="topic-overview" data-topic-overview>
    <div className="topic-overview-status"><span className="topic-badge">{active ? AGENT_STATUS[latest.status] : TOPIC_STATUS[topic.status]}</span><span>{active ? '当前轮次进行中' : '当前未执行'}</span></div>
    <dl className="topic-metrics">
      <div className="metric-time"><dt><TaskIcon name="clock" />累计耗时</dt><dd data-topic-elapsed>{elapsed}</dd></div>
      <div className="metric-tokens"><dt><TaskIcon name="all" />消耗 Token</dt><dd data-topic-tokens>{token(metric?.totalTokens, metric?.totalReported)}</dd></div>
      <div className="metric-calls"><dt><TaskIcon name="task" />模型调用</dt><dd data-topic-calls>{metric ? `${metric.calls.toLocaleString()} 次` : '—'}</dd></div>
      <div className="metric-rounds"><dt><TaskIcon name="list" />执行轮次</dt><dd>{metric ? `${metric.runs.toLocaleString()} 轮` : '—'}</dd></div>
      <div className="metric-input"><dt><TaskIcon name="inbox" />输入 Token</dt><dd>{token(metric?.inputTokens, metric?.inputReported)}</dd></div>
      <div className="metric-output"><dt><TaskIcon name="done" />输出 Token</dt><dd>{token(metric?.outputTokens, metric?.outputReported)}</dd></div>
    </dl>
    {children}
    <details className="topic-metric-notes"><summary>统计口径与任务信息</summary>
    <p className="agent-caption">累计耗时为本任务所有轮次的起止时间之和，包含失败、重试、排队和等待回复；运行按钮只显示当前这一轮的耗时。调用次数包含失败和重试。</p>
    {metric && metric.calls > metric.totalReported && <p className="agent-caption">Token 已记录 {metric.totalReported} / {metric.calls} 次调用，历史缺失或供应商未返回的用量未计入。</p>}
    <dl className="topic-overview-meta">
      <div><dt>任务目标</dt><dd>{topic.goal}</dd></div>
      <div><dt>约束与边界</dt><dd>{topic.constraints || '未设置'}</dd></div>
      <div><dt>当前判断</dt><dd>{topic.judgement || '尚未形成判断'}</dd></div>
      <div><dt>下一步</dt><dd>{topic.nextStep || '尚未安排'}</dd></div>
      <div><dt>使用模型</dt><dd>{metric?.models.join('、') || '未记录'}</dd></div>
      <div><dt>搜索调用</dt><dd>{metric ? `${metric.searches.toLocaleString()} 次` : '—'}</dd></div>
      <div><dt>创建时间</dt><dd>{time(topic.createdAt)}</dd></div>
      <div><dt>最近更新</dt><dd>{time(topic.updatedAt)}</dd></div>
      <div><dt>最近一轮</dt><dd>{latest ? `${time(latest.createdAt)} · ${AGENT_STATUS[latest.status]}` : '尚未执行'}</dd></div>
      <div><dt>任务 ID</dt><dd className="topic-metadata-id">{topic.id}</dd></div>
    </dl>
    </details>
  </div>
}
