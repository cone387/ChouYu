import { useEffect, useState, type ReactNode } from 'react'
import TaskIcon from '../Tasks/TaskIcon'
import ContactDailyOverview from './ContactDailyOverview'
import { AGENT_STATUS, TOPIC_STATUS, agentUsesPlanner, type AgentOverview, type AgentTopic } from '../../../../shared/agents'

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
  const queued = data.queuedTopicIds?.includes(topic.id)
  const firstRoundCalls = agentUsesPlanner(data.settings) ? 3 : 2
  const token = (value: number | undefined, reported: number | undefined) => !metric ? '—' : metric.calls === 0 ? '0' : !reported ? '未记录' : `${value!.toLocaleString()}${reported < metric.calls ? '（部分）' : ''}`
  const elapsed = metric ? duration(metric.elapsedMs + Math.max(0, now - metric.measuredAt) * metric.activeRuns) : '—'
  return <ContactTaskOverviewBody
    status={queued ? '排队中' : active ? AGENT_STATUS[latest.status] : TOPIC_STATUS[topic.status]}
    statusDescription={queued ? '已接单，尚未开始执行' : active ? latest.status === 'waiting' ? '等待你的回复，其他任务可继续' : '当前轮次进行中' : '当前未执行'}
    values={[elapsed, token(metric?.totalTokens, metric?.totalReported), metric ? `${metric.calls.toLocaleString()} 次` : '—', metric ? `${metric.runs.toLocaleString()} 轮` : '—', token(metric?.inputTokens, metric?.inputReported), token(metric?.outputTokens, metric?.outputReported)]}
    notices={<>{queued && <p className="agent-caption" role="status">按接单顺序等待，当前任务完成、暂停或等待回复时接续。今日额度不足时保留安排，额度恢复后执行；排队不消耗调用。</p>}
      {queued && data.settings.dailyCalls < firstRoundCalls && <p role="status">首轮需要预留 {firstRoundCalls} 次调用，当前每日上限为 {data.settings.dailyCalls} 次。请在工作设置中提高上限，等待次日不会解决此限制。</p>}</>}
    notes={<><p className="agent-caption">累计耗时为本任务所有轮次的起止时间之和，包含失败、重试、排队和等待回复；运行按钮只显示当前这一轮的耗时。调用次数包含失败和重试。</p>
      {metric && metric.calls > metric.totalReported && <p className="agent-caption">Token 已记录 {metric.totalReported} / {metric.calls} 次调用，历史缺失或供应商未返回的用量未计入。</p>}</>}
    fields={[
      ['任务目标', topic.goal], ['约束与边界', topic.constraints || '未设置'], ['当前判断', topic.judgement || '尚未形成判断'], ['下一步', topic.nextStep || '尚未安排'],
      ['使用模型', metric?.models.join('、') || '未记录'], ['搜索调用', metric ? `${metric.searches.toLocaleString()} 次` : '—'],
      ['创建时间', time(topic.createdAt)], ['最近更新', time(topic.updatedAt)], ['最近一轮', latest ? `${time(latest.createdAt)} · ${AGENT_STATUS[latest.status]}` : '尚未执行'], ['任务 ID', topic.id]
    ]}>
    <ContactDailyOverview characterId={topic.characterId} topicId={topic.id} active={visible} timelineOnly />
    {children}
  </ContactTaskOverviewBody>
}

export function ContactTaskFacts({ fields }: { fields: [string, ReactNode][] }) {
  return <dl className="topic-overview-meta">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

/** The single overview renderer; callers supply facts, never a second layout. */
export function ContactTaskOverviewBody({ status, statusDescription, values = ['—', '—', '—', '—', '—', '—'], notices, notes, fields, children }: {
  status: string; statusDescription: string; values?: string[]; notices?: ReactNode; notes?: ReactNode; fields: [string, ReactNode][]; children?: ReactNode
}) {
  return <div className="topic-overview" data-topic-overview>
    <div className="topic-overview-status"><span className="topic-badge">{status}</span><span>{statusDescription}</span></div>
    {notices}
    <dl className="topic-metrics">
      <div className="metric-time"><dt><TaskIcon name="clock" />累计耗时</dt><dd data-topic-elapsed>{values[0]}</dd></div>
      <div className="metric-tokens"><dt><TaskIcon name="all" />消耗 Token</dt><dd data-topic-tokens>{values[1]}</dd></div>
      <div className="metric-calls"><dt><TaskIcon name="task" />模型调用</dt><dd data-topic-calls>{values[2]}</dd></div>
      <div className="metric-rounds"><dt><TaskIcon name="list" />执行轮次</dt><dd>{values[3]}</dd></div>
      <div className="metric-input"><dt><TaskIcon name="inbox" />输入 Token</dt><dd>{values[4]}</dd></div>
      <div className="metric-output"><dt><TaskIcon name="done" />输出 Token</dt><dd>{values[5]}</dd></div>
    </dl>
    {children}
    <details className="topic-metric-notes"><summary>统计口径与任务信息</summary>{notes}<ContactTaskFacts fields={fields} /></details>
  </div>
}
