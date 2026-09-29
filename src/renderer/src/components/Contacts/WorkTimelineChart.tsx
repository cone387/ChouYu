import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentAnalytics } from '../../../../shared/agent-analytics'
import { workTimelineBlocks, workTimelineScale } from './workTimeline'
import './ContactDailyOverview.css'

const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
export default function WorkTimelineChart({ data, timelineOnly = false, onReport }: { data: AgentAnalytics; timelineOnly?: boolean; onReport?: (runId: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const chart = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width - 12)))
    if (chart.current) observer.observe(chart.current)
    return () => observer.disconnect()
  }, [])
  const segments = useMemo(() => workTimelineBlocks(data), [data])
  const { percent, expanded } = useMemo(() => workTimelineScale(data, segments, width), [data, segments, width])
  const ticks = useMemo(() => {
    const result = [{ at: data.start, label: '00:00', left: 0 }]
    for (let hour = 1; hour < 24; hour++) {
      const at = data.start + hour * 3600000, left = percent(at)
      if ((left - result.at(-1)!.left) * width / 100 >= 48 && (100 - left) * width / 100 >= 48) result.push({ at, label: `${String(hour).padStart(2, '0')}:00`, left })
    }
    result.push({ at: data.end, label: '24:00', left: 100 })
    return result
  }, [data.start, data.end, percent, width])
  const rows = useMemo(() => {
    const grouped = new Map<string, { key: string; text: string; running: boolean; ranges: typeof segments }>()
    for (const block of segments) {
      const key = block.running ? `task:${JSON.stringify(block.topicIds)}` : 'heartbeat'
      const text = block.running ? data.tasks.find(task => task.id === block.topicIds[0])?.title || '处理任务' : '心跳 / 休息'
      const row = grouped.get(key) ?? { key, text, running: block.running, ranges: [] }
      row.ranges.push(block); grouped.set(key, row)
    }
    return [...grouped.values()].sort((a, b) => Number(b.running) - Number(a.running))
  }, [segments, data.tasks])
  const pick = segments.find(segment => segment.key === selected) ?? segments.at(-1)
  return (
    <section className="daily-timeline" aria-label="24 小时工作记录">
      <header><h4>{timelineOnly ? '任务工作时间 · 今天' : '24h 工作记录'}</h4><span>任务汇总 <i className="daily-key-running" />　心跳 / 休息 <i className="daily-key-heartbeat" /></span></header>
      <div className="daily-gantt-scroll" tabIndex={0} aria-label="按工作时段汇总的全天时间图">
        <div className="daily-gantt" ref={chart} data-expanded-time={expanded}>
          {rows.map((row, index) => {
            const last = row.ranges.find(segment => segment.key === hovered) ?? row.ranges.find(segment => segment.key === selected) ?? row.ranges.at(-1)!
            const description = row.running ? last.text : row.text
            const flip = percent(last.end) > 65
            return <div className="daily-lane" key={row.key} data-timeline-row={row.key}>
              <div className="daily-track">
                {ticks.map(tick => <i className="daily-grid-line" key={tick.at} style={{ left: `${tick.left}%` }} />)}
                <div className="daily-future" style={{ left: `${Math.min(100, percent(data.measuredAt))}%` }} />
                {row.ranges.map(segment => {
                  const label = `${segment.text}\n${clock(segment.start)}–${clock(segment.end)}\n实际执行 ${Math.round(segment.executionMs / 1000)} 秒 · 实际休息 ${Math.round(segment.restMs / 1000)} 秒${row.running ? `\n所属任务：${row.text}` : ''}`
                  return <button type="button" key={segment.key} className="daily-segment" data-start={segment.start} data-end={segment.end} data-state={row.running ? 'running' : 'heartbeat'} data-color={index % 3}
                    aria-label={label} title={label} aria-pressed={pick?.key === segment.key}
                    style={{ left: `${percent(segment.start)}%`, width: `${percent(segment.end) - percent(segment.start)}%` }}
                    onMouseEnter={() => setHovered(segment.key)} onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(segment.key)} onBlur={() => setHovered(null)}
                    onClick={() => { setSelected(segment.key); if (segment.runId) onReport?.(segment.runId) }}><span aria-hidden="true" /></button>
                })}
                <span className="daily-line-tip" data-flip={flip} title={description}
                  style={flip ? { right: `calc(${100 - percent(last.end)}% + 10px)`, top: '10px' } : { left: `calc(${percent(last.end)}% + 18px)`, maxWidth: `calc(${100 - percent(last.end)}% - 18px)`, top: '10px' }}>{description}</span>
              </div>
            </div>
          })}
          <div className="daily-gantt-heading"><div className="daily-axis">{ticks.map(tick => <span key={tick.at} style={{ left: `${tick.left}%` }}>{tick.label}</span>)}</div></div>
        </div>
      </div>
      {!segments.length && <p className="agent-empty">今天还没有工作时段记录。</p>}
      <p className="daily-note">{expanded ? '短时段已展开，时间轴非等比例；悬停查看真实起止时间与时长。' : '悬停查看起止时间与时长。'} 空白为未记录时段。</p>

    </section>
  )
}
