import { useEffect, useMemo, useState } from 'react'
import type { AgentAnalytics } from '../../../../shared/agent-analytics'
import { Trend } from './ContactAnalytics'
import { workSegments } from './workTimeline'
import WorkTimelineChart from './WorkTimelineChart'
import './ContactDailyOverview.css'

const day = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
const duration = (ms: number) => ms < 60000 ? `${Math.floor(ms / 1000)} 秒` : `${Math.floor(ms / 3600000)} 小时 ${Math.floor(ms / 60000) % 60} 分`

export default function ContactDailyOverview({ characterId, topicId, active = true, timelineOnly = false }: {
  characterId: string; topicId?: string; active?: boolean; timelineOnly?: boolean
}) {
  const [data, setData] = useState<AgentAnalytics | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!active) return
    let alive = true, request = 0
    setData(null); setError('')
    const refresh = async () => {
      const current = ++request
      try {
        const next = await window.electronAPI.agents.analytics(characterId, { date: day(), days: 1, topicId, timeline: true })
        if (alive && current === request) { setData(next); setError('') }
      } catch (reason) { if (alive && current === request) setError(reason instanceof Error ? reason.message : '读取工作记录失败') }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    const dispose = window.electronAPI.agents.onChanged(id => { if (id === characterId) void refresh() })
    return () => { alive = false; window.clearInterval(timer); dispose() }
  }, [characterId, topicId, active])
  const segments = useMemo(() => data ? workSegments(data) : [], [data])
  if (!active) return null
  if (!data) return <p className="agent-caption" role="status">{error || '正在读取今日工作记录…'}</p>
  const title = (id: string | null) => data.tasks.find(task => task.id === id)?.title || '未归属任务'
  const logs = data.logs ?? []
  const totals = data.totals
  return <section className={`contact-daily${timelineOnly ? ' contact-daily-inline' : ''}`} data-contact-daily={topicId || 'all'} aria-label={timelineOnly ? '任务工作时间图' : '联系人今日概览'}>
    {!timelineOnly && <>
      <header className="daily-heading"><div><h3>今日概览</h3><span>{day(new Date(data.start))}</span></div><time>更新于 {clock(data.measuredAt)}</time></header>
      <dl className="daily-metrics">
        <div data-metric="time"><dt>执行时长</dt><dd>{duration(totals.executionMs)}</dd></div>
        <div data-metric="tasks"><dt>参与任务</dt><dd>{new Set([...segments.map(s => s.topicId), ...logs.map(log => log.topicId)].filter(Boolean)).size}<small> 个</small></dd></div>
        <div data-metric="calls"><dt>模型调用</dt><dd>{totals.calls}<small> 次</small></dd></div>
        <div data-metric="reports"><dt>产出成果</dt><dd>{totals.reports}<small> 份</small></dd></div>
      </dl>
    </>}
    {error && <p className="agent-error" role="status">{error}</p>}
    <WorkTimelineChart data={data} timelineOnly={timelineOnly} />

    {!timelineOnly && <>
      <div className="daily-trends"><Trend data={data} time cumulative={false} days={1} onDay={() => {}} /><Trend data={data} cumulative={false} days={1} onDay={() => {}} /></div>
      <section className="daily-logs"><h4>今日任务日志</h4>
        {!logs.length && <p className="agent-empty">今天还没有任务日志。</p>}
        <ol>{logs.slice(0, 120).map(log => <li key={log.id}><time>{clock(log.at)}</time><div><strong>{title(log.topicId)}</strong><p>{log.text || log.kind}</p></div></li>)}</ol>
        {(logs.length > 120 || data.logsTruncated) && <p className="daily-note">显示最近 120 条；各时段执行统计包含今日全部轮次。</p>}
      </section>
    </>}
  </section>
}
