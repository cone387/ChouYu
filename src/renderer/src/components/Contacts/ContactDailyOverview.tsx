import { useEffect, useMemo, useState } from 'react'
import type { AgentAnalytics } from '../../../../shared/agent-analytics'
import { Trend } from './ContactAnalytics'
import { timelineStates, workSegments } from './workTimeline'
import './ContactDailyOverview.css'

const day = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
const minute = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
const duration = (ms: number) => ms < 60000 ? `${Math.floor(ms / 1000)} 秒` : `${Math.floor(ms / 3600000)} 小时 ${Math.floor(ms / 60000) % 60} 分`

export default function ContactDailyOverview({ characterId, topicId, active = true, timelineOnly = false }: {
  characterId: string; topicId?: string; active?: boolean; timelineOnly?: boolean
}) {
  const [data, setData] = useState<AgentAnalytics | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    if (!active) return
    let alive = true, request = 0
    setData(null); setError(''); setSelected(null)
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
  const pick = segments.find(segment => segment.key === selected) ?? segments.at(-1)
  const percent = (at: number) => (at - data.start) / (data.end - data.start) * 100
  const logs = data.logs ?? []
  const totals = data.totals
  return <section className={`contact-daily${timelineOnly ? ' contact-daily-inline' : ''}`} data-contact-daily={topicId || 'all'} aria-label={timelineOnly ? '任务工作时间图' : '联系人今日概览'}>
    {!timelineOnly && <>
      <header className="daily-heading"><div><h3>今日概览</h3><span>{day(new Date(data.start))}</span></div><time>更新于 {clock(data.measuredAt)}</time></header>
      <dl className="daily-metrics">
        <div><dt>执行时长</dt><dd>{duration(totals.executionMs)}</dd></div>
        <div><dt>参与任务</dt><dd>{new Set([...segments.map(s => s.topicId), ...logs.map(log => log.topicId)].filter(Boolean)).size}<small> 个</small></dd></div>
        <div><dt>模型调用</dt><dd>{totals.calls}<small> 次</small></dd></div>
        <div><dt>产出成果</dt><dd>{totals.reports}<small> 份</small></dd></div>
      </dl>
    </>}
    {error && <p className="agent-error" role="status">{error}</p>}
    <section className="daily-timeline" aria-label="24 小时工作记录">
      <header><h4>{timelineOnly ? '任务工作时间 · 今天' : '24h 工作记录'}</h4><span>执行 <i className="daily-key-running" />　心跳 <i className="daily-key-heartbeat" /></span></header>
      <div className="daily-gantt-scroll" tabIndex={0} aria-label="按工作时段汇总的全天时间图">
        <div className="daily-gantt">
          {segments.map((segment, index) => {
              const label = `${clock(segment.start)}–${clock(segment.end)} · ${timelineStates[segment.state]} · ${segment.text}${segment.approximate ? '（历史推算）' : ''}`
              return <div className="daily-lane" key={segment.key} data-selected={pick?.key === segment.key}>
                <div className="daily-lane-name" title={`${title(segment.topicId)} · ${label}`}>
                  <strong>{segment.state === 'running' ? segment.text : timelineStates[segment.state]}</strong>
                  <time>{minute(segment.start)}–{minute(segment.end)}</time>
                </div>
                <div className="daily-track">
                  <div className="daily-future" style={{ left: `${Math.min(100, percent(data.measuredAt))}%` }} />
                  <button type="button" className="daily-segment" data-state={segment.state} data-color={index % 3} aria-label={`${title(segment.topicId)} · ${label}`} title={label} aria-pressed={pick?.key === segment.key}
                style={{ left: `min(${percent(segment.start)}%, calc(100% - 16px))`, width: `${percent(segment.end) - percent(segment.start)}%` }} onClick={() => setSelected(segment.key)}>
                    <span aria-hidden="true" />
                  </button>
                </div>
              </div>
          })}
          <div className="daily-gantt-heading"><span>时间</span><div className="daily-axis">{[0, 4, 8, 12, 16, 20, 24].map(hour => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div></div>
        </div>
      </div>
      {!segments.length && <p className="agent-empty">今天还没有工作时段记录。</p>}
      {pick && <div className="daily-selection" aria-live="polite"><time>{clock(pick.start)}–{clock(pick.end)}</time><strong>{timelineStates[pick.state]} · {title(pick.topicId)}</strong><p>{pick.text}{pick.approximate ? '（历史记录推算时段）' : ''}</p></div>}
      <p className="daily-note">连续工作汇总为一个时段，心跳单独画线；悬停查看起止时间。</p>
    </section>
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
