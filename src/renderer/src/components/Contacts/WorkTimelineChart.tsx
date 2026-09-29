import { useMemo, useState } from 'react'
import type { AgentAnalytics } from '../../../../shared/agent-analytics'
import { workSegments, workTimelineRows } from './workTimeline'
import './ContactDailyOverview.css'

const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
export default function WorkTimelineChart({ data, timelineOnly = false, onReport }: { data: AgentAnalytics; timelineOnly?: boolean; onReport?: (runId: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const segments = useMemo(() => workSegments(data), [data])
  const rows = useMemo(() => workTimelineRows(data), [data])
  const pick = segments.find(segment => segment.key === selected) ?? segments.at(-1)
  const percent = (at: number) => (at - data.start) / (data.end - data.start) * 100
  return (
    <section className="daily-timeline" aria-label="24 小时工作记录">
      <header><h4>{timelineOnly ? '任务工作时间 · 今天' : '24h 工作记录'}</h4><span>执行 <i className="daily-key-running" />　心跳 / 休息 <i className="daily-key-heartbeat" /></span></header>
      <div className="daily-gantt-scroll" tabIndex={0} aria-label="按工作时段汇总的全天时间图">
        <div className="daily-gantt">
          {rows.map((row, index) => {
            const last = row.ranges.at(-1)!
            const flip = percent(last.end) > 65
            return <div className="daily-lane" key={row.key} data-timeline-row={row.key}>
              <div className="daily-track">
                <div className="daily-future" style={{ left: `${Math.min(100, percent(data.measuredAt))}%` }} />
                {row.ranges.map(segment => {
                  const label = `${row.text} · ${clock(segment.start)}–${clock(segment.end)}`
                  return <button type="button" key={segment.key} className="daily-segment" data-start={segment.start} data-end={segment.end} data-state={row.running ? 'running' : 'heartbeat'} data-color={index % 3}
                    aria-label={label} title={label} aria-pressed={pick?.key === segment.key}
                    style={{ left: `${percent(segment.start)}%`, width: `${percent(segment.end) - percent(segment.start)}%` }}
                    onClick={() => { setSelected(segment.key); if (segment.runId) onReport?.(segment.runId) }}><span aria-hidden="true" /></button>
                })}
                <span className="daily-line-tip" data-flip={flip} title={row.text}
                  style={flip ? { right: `calc(${100 - percent(last.end)}% + 10px)`, top: '10px' } : { left: `calc(${percent(last.end)}% + 18px)`, maxWidth: `calc(${100 - percent(last.end)}% - 18px)` }}>{row.text}</span>
              </div>
            </div>
          })}
          <div className="daily-gantt-heading"><div className="daily-axis">{[0, 4, 8, 12, 16, 20, 24].map(hour => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div></div>
        </div>
      </div>
      {!segments.length && <p className="agent-empty">今天还没有工作时段记录。</p>}

    </section>
  )
}
