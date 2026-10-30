import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ChartValue } from './appDashboardModel'

const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
export function ChartPanel({ title, caption, action, children, className = '' }: { title: string; caption: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`dashboard-panel ${className}`} aria-label={title}>
    <header className="dashboard-panel-heading"><div><h3>{title}</h3><p>{caption}</p></div>{action}</header>{children}
  </section>
}
export function TimeChart({ points, unit, label, bars = false, format = number, axisFormat = number, missingLabel = '读取失败', emptyLabel = '这段时间还没有记录。' }: { points: ChartValue[]; unit: string; label: string; bars?: boolean; format?: (value: number) => string; axisFormat?: (value: number) => string; missingLabel?: string; emptyLabel?: string }) {
  const [selected, setSelected] = useState<string>()
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setWidth(entry.contentRect.width) })
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  const plotWidth = Math.max(1, width - 54)
  const values = points.filter(point => point.value !== null)
  const maximum = Math.max(1, ...values.map(point => point.value!))
  const max = maximum <= 5 ? Math.ceil(maximum) : Math.ceil(maximum / 5) * 5
  const x = (index: number) => 42 + (index + .5) * plotWidth / points.length
  const y = (value: number) => 160 - value / max * 130
  const segments: string[][] = [[]]
  points.forEach((point, index) => { if (point.value === null) segments.push([]); else segments.at(-1)!.push(`${x(index)},${y(point.value)}`) })
  const pick = points.find(point => point.id === selected)
  const describe = (point: ChartValue) => point.value === null ? point.note || missingLabel : `${format(point.value)} ${unit}${point.note ? `（${point.note}）` : ''}`
  return <div ref={root} className={`dashboard-time-chart${bars ? ' dashboard-time-bars' : ''}`}>
    <svg viewBox={`0 0 ${width} 190`} role="group" aria-label={`${label}，单位${unit}，下方可查看数据表`}>
      {[0, .5, 1].map(ratio => <g key={ratio}><line x1="42" x2={width - 12} y1={y(max * ratio)} y2={y(max * ratio)} className="dashboard-gridline" /><text x="34" y={y(max * ratio) + 4} textAnchor="end">{axisFormat(max * ratio)}</text></g>)}
      {!bars && segments.filter(segment => segment.length).map((segment, index) => <g key={index}>
        <polygon points={`${segment[0].split(',')[0]},160 ${segment.join(' ')} ${segment.at(-1)!.split(',')[0]},160`} className="dashboard-area" />
        <polyline points={segment.join(' ')} className="dashboard-line" />
      </g>)}
      {points.map((point, index) => <g key={point.id} tabIndex={0} role="img" aria-label={`${point.id}：${describe(point)}`} onFocus={() => setSelected(point.id)} onMouseEnter={() => setSelected(point.id)}>
        <rect x={x(index) - plotWidth / 2 / points.length} y="20" width={plotWidth / points.length} height="144" fill="transparent" />
        {point.value === null ? <text x={x(index)} y="154" textAnchor="middle">?</text> : bars
          ? <rect x={x(index) - plotWidth * .32 / points.length} y={y(point.value)} width={plotWidth * .64 / points.length} height={160 - y(point.value)} rx="2" className="dashboard-column" />
          : <circle cx={x(index)} cy={y(point.value)} r={selected === point.id ? 4 : 2.5} className="dashboard-point" />}
        {(index % Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / 42)))) === 0) && <text x={x(index)} y="182" textAnchor="middle">{point.label}</text>}
        <title>{point.id}：{describe(point)}</title>
      </g>)}
    </svg>
    <div className="dashboard-chart-caption">{pick ? `${pick.id} · ${describe(pick)}` : values.every(point => !point.value) && values.length === points.length ? emptyLabel : `悬停或用键盘选择日期 · ${unit}`}</div>
    <details className="dashboard-data-table"><summary>查看每日数据</summary><table><thead><tr><th>日期</th><th>{unit}</th></tr></thead><tbody>{points.map(point => <tr key={point.id}><td>{point.id}</td><td>{describe(point)}</td></tr>)}</tbody></table></details>
  </div>
}
export function DonutChart({ items, label, centerLabel }: { items: ChartValue[]; label: string; centerLabel: string }) {
  const total = items.reduce((sum, item) => sum + (item.value ?? 0), 0)
  let offset = 0
  return <div className="dashboard-donut" role="group" aria-label={label}>
    <svg viewBox="0 0 160 160" aria-hidden="true"><circle className="dashboard-donut-track" cx="80" cy="80" r="60" />
      {items.map((item, index) => { const size = total ? (item.value ?? 0) / total * 100 : 0; const start = offset; offset += size
        return <circle key={item.id} cx="80" cy="80" r="60" pathLength="100" strokeDasharray={`${size} ${100 - size}`} strokeDashoffset={-start} transform="rotate(-90 80 80)" className={`dashboard-slice chart-color-${index % 5}`} /> })}
      <text x="80" y="80" textAnchor="middle" className="dashboard-donut-total">{number(total)}</text><text x="80" y="101" textAnchor="middle">{centerLabel}</text>
    </svg>
    <ul className="dashboard-legend">{items.map((item, index) => <li key={item.id}><i className={`chart-color-${index % 5}`} /><span>{item.label}</span><strong>{item.value === null ? '未记录' : number(item.value)}</strong></li>)}</ul>
  </div>
}
export function HorizontalBars({ items, unit, onSelect, format = number, limit = 5 }: { items: ChartValue[]; unit: string; onSelect?: (id: string) => void; format?: (value: number) => string; limit?: number }) {
  const max = Math.max(1, ...items.map(item => item.value ?? 0))
  const row = (item: ChartValue, index: number) => <><span className="dashboard-bar-label">{item.label}</span><strong>{item.value === null ? '未记录' : `${format(item.value)} ${unit}`}{item.note && <small>{item.note}</small>}</strong><span className="dashboard-bar-track"><i className={`chart-color-${index % 5}`} style={{ width: `${(item.value ?? 0) / max * 100}%` }} /></span></>
  if (!items.length) return <p className="dashboard-empty">暂无记录</p>
  return <><div className="dashboard-bars">{items.slice(0, limit).map((item, index) => onSelect
    ? <button key={item.id} data-chart-id={item.id} type="button" className="dashboard-bar" onClick={() => onSelect(item.id)}>{row(item, index)}</button>
    : <div key={item.id} className="dashboard-bar">{row(item, index)}</div>)}</div>
    {items.length > limit && <details className="dashboard-data-table"><summary>查看全部（{items.length}）</summary><table><thead><tr><th>名称</th><th>{unit}</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{onSelect ? <button type="button" onClick={() => onSelect(item.id)}>{item.label}</button> : item.label}</td><td>{item.value === null ? '未记录' : format(item.value)}{item.note}</td></tr>)}</tbody></table></details>}</>
}
