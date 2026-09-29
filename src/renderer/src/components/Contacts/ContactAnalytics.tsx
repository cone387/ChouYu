import WorkTimelineChart from './WorkTimelineChart'
import { useEffect, useRef, useState } from 'react'
import type { AgentAnalytics, AnalyticsQuery, UsageBucket, UsageTotals } from '../../../../shared/agent-analytics'
import type { AgentTopic } from '../../../../shared/agents'
import './ContactAnalytics.css'

const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const number = (value: number) => value.toLocaleString('zh-CN')
const duration = (ms: number) => ms <= 0 ? '0 秒' : ms < 1000 ? '不足 1 秒' : ms < 60000 ? `${Math.floor(ms / 1000)} 秒` : `${Math.floor(ms / 3600000) ? `${Math.floor(ms / 3600000)} 小时 ` : ''}${Math.floor(ms / 60000) % 60} 分`
const tokens = (value: UsageTotals) => !value.samples ? '0' : !value.reported ? '未记录' : `${number(value.tokens)}${value.reported < value.samples ? '（部分）' : ''}`
const tokenPart = (value: UsageTotals, part: 'input' | 'output') => !value.samples ? '0' : !value[`${part}Reported`] ? '未记录' : `${number(value[part])}${value[`${part}Reported`] < value.samples ? '（部分）' : ''}`
const stamp = (at: number) => new Date(at).toLocaleString('zh-CN', { hour12: false })


export function Trend({ data, time, cumulative, days, onDay }: { data: AgentAnalytics; time?: boolean; cumulative: boolean; days: number; onDay: (date: string) => void }) {
  const [selected, setSelected] = useState<number | null>(null)
  const chart = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    const observer = new ResizeObserver(entries => { const size = entries[0]?.contentRect.width; if (size > 0) setWidth(Math.max(180, Math.floor(size))) })
    if (chart.current) observer.observe(chart.current)
    return () => observer.disconnect()
  }, [])
  const visible = data.buckets.filter(b => b.start <= data.measuredAt)
  let sum = 0
  const values = visible.map(b => { const n = time ? b.executionMs / 60000 : b.tokens; sum += n; return cumulative ? sum : n })
  const max = Math.max(time ? 1 / 60 : 1, ...values), height = 170, left = 44, base = 136, plot = width - left - 18
  const x = (i: number) => left + (i + .5) * plot / data.buckets.length
  const y = (v: number) => base - v / max * 110
  const label = (b: UsageBucket) => days === 1 ? new Date(b.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : new Date(b.start).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  const pick = selected === null ? undefined : visible[selected]
  return <section className="usage-chart">
    <h4>{time ? '执行时间走势' : 'Token 消耗走势'} <small>{cumulative ? '累计' : days === 1 ? '每小时' : '每天'} · {time ? '分钟' : 'Token'}</small></h4>
    <svg ref={chart} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${time ? '执行时间' : 'Token'}${cumulative ? '累计' : '分时'}趋势图，详细数值可在下方表格查看`}>
      {[0, .5, 1].map(ratio => <g key={ratio}><line x1={left} x2={width - 18} y1={y(max * ratio)} y2={y(max * ratio)} className="usage-grid" /><text x={left - 7} y={y(max * ratio) + 4} textAnchor="end">{new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: time ? 2 : 1 }).format(max * ratio)}</text></g>)}
      {cumulative && <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} className="usage-line" />}
      {visible.map((bucket, i) => <g key={bucket.start}>
        {!time && bucket.samples > bucket.reported && <text x={x(i)} y="128" textAnchor="middle">?</text>}
        {!cumulative && (time ? <rect x={x(i) - plot / data.buckets.length * .32} y={y(values[i])} width={plot / data.buckets.length * .64} height={Math.max(0, base - y(values[i]))} className="usage-time-bar" /> : (() => {
          const input = Math.min(bucket.tokens, bucket.input), output = Math.min(bucket.tokens - input, bucket.output)
          let bottom = 0
          return [input, output, bucket.tokens - input - output].map((value, part) => {
            const previous = bottom; bottom += value
            return <rect key={part} x={x(i) - plot / data.buckets.length * .32} y={y(bottom)} width={plot / data.buckets.length * .64} height={y(previous) - y(bottom)} className={`usage-token-part-${part}`} />
          })
        })())}
        {cumulative && <circle cx={x(i)} cy={y(values[i])} r="2.5" className="usage-token-bar" />}
        <rect x={left + i * plot / data.buckets.length} y="18" width={plot / data.buckets.length} height="124" fill="transparent" tabIndex={0} role="button"
          aria-label={`${label(bucket)}：${time ? `${number(Math.round(values[i]))} 分钟` : tokens(bucket) + ' Token'}${days > 1 ? '，打开当天' : ''}`}
          onFocus={() => setSelected(i)} onMouseEnter={() => setSelected(i)} onClick={() => { setSelected(i); if (days > 1) onDay(localDate(new Date(bucket.start))) }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i); if (days > 1) onDay(localDate(new Date(bucket.start))) } }}>
          <title>{label(bucket)} · {time ? duration(bucket.executionMs) : tokens(bucket)}</title>
        </rect>
      </g>)}
      {data.buckets.map((b, i) => (i % Math.ceil(data.buckets.length / (width < 400 ? 3 : 6)) === 0 || i === data.buckets.length - 1) && <text key={b.start} x={x(i)} y="160" textAnchor="middle">{label(b)}</text>)}
    </svg>
    {!time && !cumulative && <div className="usage-legend"><span className="usage-input-key">■ 输入</span><span className="usage-output-key">■ 输出</span><span>■ 其他 / 未分项</span><span>? 有未记录用量</span></div>}
    <p className="usage-chart-detail">{pick ? `${stamp(pick.start)} · ${cumulative ? '累计已记录' : '本时段'} ${time ? `${number(Math.round(values[selected!] * 10) / 10)} 分钟` : `${cumulative ? number(values[selected!]) : tokens(pick)} Token`} · 本时段输入 ${tokenPart(pick, 'input')} / 输出 ${tokenPart(pick, 'output')}` : '悬停或用键盘选择时段查看数值；尚未到来的时段留空。'}</p>
  </section>
}

export default function ContactAnalytics({ characterId, name, topics, initialTopic, onReport, onBack, active = true, resetKey }: { characterId: string; name: string; topics: AgentTopic[]; initialTopic?: string; onReport: (runId: string) => void; onBack: () => void; active?: boolean; resetKey?: number }) {
  const [query, setQuery] = useState<AnalyticsQuery>({ date: localDate(), days: 1, topicId: initialTopic })
  const [data, setData] = useState<AgentAnalytics | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [cumulative, setCumulative] = useState(false)
  useEffect(() => { setQuery(q => ({ ...q, topicId: initialTopic })) }, [initialTopic, resetKey])
  useEffect(() => { if (query.topicId && !topics.some(t => t.id === query.topicId)) setQuery(q => ({ ...q, topicId: undefined })) }, [topics, query.topicId])
  useEffect(() => {
    if (!active) return
    let alive = true, sequence = 0
    setData(null); setError('')
    const refresh = async () => {
      const current = ++sequence
      try { const result = await window.electronAPI.agents.analytics(characterId, { ...query, timeline: query.days === 1 }); if (alive && current === sequence) { setData(result); setError('') } }
      catch (e) { if (alive && current === sequence) setError(e instanceof Error ? e.message : '统计读取失败') }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 10000)
    const dispose = window.electronAPI.agents.onChanged(id => { if (id === characterId) void refresh() })
    return () => { alive = false; clearInterval(timer); dispose() }
  }, [characterId, query.date, query.days, query.topicId, retry, active])
  const day = (date: string) => setQuery(q => ({ ...q, date, days: 1 }))
  const move = (offset: number) => { const date = new Date(`${query.date}T00:00:00`); date.setDate(date.getDate() + offset); setQuery(q => ({ ...q, date: localDate(date) })) }
  return <section className="contact-analytics" aria-label={`${name}的活动与消耗`}>
    <header><div><h3>活动与消耗</h3><p>{name} · {query.topicId ? topics.find(t => t.id === query.topicId)?.title : '全部任务'} · 本地时区</p></div><button onClick={onBack}>返回任务</button></header>
    <div className="usage-filters">
      <label>任务<select value={query.topicId ?? ''} onChange={e => setQuery(q => ({ ...q, topicId: e.target.value || undefined }))}><option value="">全部任务</option>{topics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      <div className="usage-date"><button aria-label="上一天" onClick={() => move(-1)}>‹</button><input aria-label="统计结束日期" type="date" max={localDate()} value={query.date} onChange={e => { if (e.target.value) setQuery(q => ({ ...q, date: e.target.value })) }} /><button aria-label="下一天" disabled={query.date >= localDate()} onClick={() => move(1)}>›</button></div>
      <div className="usage-range">{([1, 7, 30] as const).map(days => <button key={days} aria-pressed={query.days === days} onClick={() => setQuery(q => ({ ...q, days }))}>{days === 1 ? '单日' : `近 ${days} 天`}</button>)}<button onClick={() => day(localDate())}>今天</button></div>
    </div>
    {error && <p role="alert" className="agent-error">{error}<button onClick={() => setRetry(n => n + 1)}>重试</button></p>}
    {!data && !error && <p role="status">正在读取活动与消耗…</p>}
    {data && <>
      <div className="usage-summary">{[['Token 消耗', tokens(data.totals)], ['执行耗时', duration(data.totals.executionMs)], ['模型调用', `${number(data.totals.calls)} 次`], ['报告 / 失败轮次', `${data.totals.reports} / ${data.totals.failures}`]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p className="usage-note">{new Date(data.start).toLocaleDateString()} — {query.date} · 已记录用量 {data.totals.reported} / {data.totals.samples} 笔 · 排队、等待回复及中断 {duration(data.totals.waitingMs)}</p>
      {query.days === 1 && <WorkTimelineChart data={data} onReport={onReport} />}
      <div className="usage-mode"><span>消耗走势</span><button aria-pressed={!cumulative} onClick={() => setCumulative(false)}>分时</button><button aria-pressed={cumulative} onClick={() => setCumulative(true)}>累计</button></div>
      <Trend data={data} days={query.days} cumulative={cumulative} onDay={day} />
      <Trend data={data} days={query.days} cumulative={cumulative} time onDay={day} />
      <section><h4>任务消耗明细</h4><div className="usage-table"><table><thead><tr><th>任务</th><th>Token</th><th>执行耗时</th><th>调用</th><th>报告 / 失败</th></tr></thead><tbody>{[...data.tasks].sort((a, b) => b.tokens - a.tokens).map(t => <tr key={t.id ?? 'unassigned'}><td>{t.id ? <button onClick={() => setQuery(q => ({ ...q, topicId: t.id! }))}>{t.title}</button> : t.title}</td><td>{tokens(t)}</td><td>{duration(t.executionMs)}</td><td>{t.calls}</td><td>{t.reports} / {t.failures}</td></tr>)}</tbody></table></div></section>
      <details><summary>查看分时数据与统计口径</summary><p className="usage-note">执行时间包含模型响应、工具处理、失败和重试，不含排队、等待回复和中断；轮次之间的调度间隔为空白。任务概览的累计耗时仍是轮次起止总时长，两者口径不同。跨天执行按实际时间拆分。调用次数按发起时间，用量按返回时间，历史 {data.legacyCalls} 笔缺少返回时间的调用按发起时间归属。历史阶段按已有事件推算，无法还原未记录的停机时段。供应商未返回的用量不估算；输入、输出不一定包含缓存等额外 Token。报告数不等于新增 Idea 数。统计范围为当前保留的任务工作记录，不含普通聊天。</p>
        <div className="usage-table"><table><thead><tr><th>时段</th><th>Token</th><th>输入 / 输出</th><th>执行</th><th>等待</th></tr></thead><tbody>{data.buckets.filter(b => b.start <= data.measuredAt).map(b => <tr key={b.start}><td>{stamp(b.start)}</td><td>{tokens(b)}</td><td>{tokenPart(b, 'input')} / {tokenPart(b, 'output')}</td><td>{duration(b.executionMs)}</td><td>{duration(b.waitingMs)}</td></tr>)}</tbody></table></div>
      </details>
    </>}
  </section>
}
