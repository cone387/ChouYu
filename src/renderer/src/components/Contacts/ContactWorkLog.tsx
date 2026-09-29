import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AGENT_STATUS, type AgentEvent, type AgentOverview, type AgentRun, type AgentRunDetail } from '../../../../shared/agents'
import { workLogActivity } from './workLogActivity'
import './ContactWorkLog.css'

const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
const labels: Record<string, string> = {
  'contact-discovery': '正在检索共享成果', 'contact-source': '已读取联系人成果',
  'plan-repair': '正在修正章节引用',
  checking: '正在核对成果与阶段状态', continuing: '正文已保存，准备继续创作',
  queued: '已安排本轮工作', briefing: '正在整理任务方向', planning: '正在安排本轮工作',
  drafting: '开始直接创作', analysis: '等待模型生成本轮成果', 'format-repair': '成果格式异常，尝试修复',
  'format-repaired': '成果格式已修复', completed: '本轮工作已完成', failed: '本轮执行失败',
  interrupted: '执行中断，等待恢复', waiting: '需要你补充信息', cancelled: '本轮已停止',
  source: '已读取网页', 'source-failed': '网页读取失败', searched: '已完成搜索', 'search-failed': '搜索未成功',
}
const summary = (event: AgentEvent) => labels[event.kind] || event.text.split('\n')[0].slice(0, 70)

export default function ContactWorkLog({ characterId, run, data, busy, canRetry, onReport, onRetry, onReply }: {
  characterId: string; run: AgentRun; data: AgentOverview; busy: boolean; canRetry: boolean
  onReport(): void; onRetry(): void; onReply(): void
}) {
  const [detail, setDetail] = useState<AgentRunDetail | null>(null)
  const [error, setError] = useState(''), [now, setNow] = useState(Date.now())
  const [unread, setUnread] = useState(0)
  const [isFollowing, setIsFollowing] = useState(true)
  const autoScrolling = useRef(false)
  const viewport = useRef<HTMLDivElement>(null), following = useRef(true), seen = useRef(0)
  useEffect(() => {
    let alive = true, request = 0
    const refresh = async () => {
      const current = ++request
      try {
        const next = await window.electronAPI.agents.detail(characterId, run.id)
        if (alive && current === request) { setDetail(next); setError('') }
      } catch { if (alive && current === request) setError('日志读取失败，正在重新连接。') }
    }
    void refresh()
    const dispose = window.electronAPI.agents.onChanged(id => { if (id === characterId) void refresh() })
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => { alive = false; dispose(); window.clearInterval(timer) }
  }, [characterId, run.id])
  const events = detail?.events ?? []
  const lastId = events.at(-1)?.id ?? 0
  const pauseFollowing = () => {
    following.current = false; autoScrolling.current = false; setIsFollowing(false)
    const node = viewport.current
    if (node) node.scrollTo({ top: node.scrollTop, behavior: 'instant' })
  }
  const follow = () => {
    const initial = seen.current === 0
    following.current = true; setIsFollowing(true); seen.current = lastId; setUnread(0)
    const node = viewport.current
    if (node) {
      autoScrolling.current = node.scrollHeight - node.clientHeight - node.scrollTop >= 16
      node.scrollTo({ top: node.scrollHeight, behavior: initial || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
  }
  useLayoutEffect(() => {
    if (following.current) follow()
    else setUnread(events.filter(event => event.id > seen.current).length)
  }, [lastId, now])
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    // A hidden task tab has no scrollable height. Restore following when it opens.
    const observer = new ResizeObserver(() => {
      if (following.current && node.clientHeight > 0) node.scrollTo({ top: node.scrollHeight, behavior: 'instant' })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  // Use the newer snapshot so a late detail response cannot revive a finished run.
  const current = detail && detail.run.updatedAt > run.updatedAt ? detail.run : run
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [current.status])
  const last = events.at(-1)
  const activity = workLogActivity(current, data, last, now, error)
  const rows = [
    ...events.map(event => ({ key: `event-${event.id}`, at: event.at, event, text: '' })),
    ...(activity.moving ? [{ key: 'heartbeat', at: now, event: null, text: activity.text }] : [])
  ]
  const seconds = Math.max(0, Math.floor((now - (last?.at ?? current.updatedAt)) / 1000))
  return <section className="agent-work-log" aria-label="实时工作日志" data-agent-work-log>
    <header><strong>活动日志</strong><span>{error ? '连接中断' : AGENT_STATUS[current.status]}</span><button type="button" className="agent-log-follow" aria-pressed={isFollowing} onClick={() => isFollowing ? pauseFollowing() : follow()}>{isFollowing ? '暂停滚动' : '继续滚动 ↓'}</button></header>
    <div className="agent-log-live" data-active={activity.moving}><i aria-hidden="true" /><strong>{activity.label}</strong><span>{activity.text}</span><time>{clock(now)}</time></div>
    <div className="agent-work-log-scroll" ref={viewport} tabIndex={0} role="log" aria-label="本轮执行记录" aria-live="off"
      onWheel={event => { if (event.deltaY < 0) pauseFollowing() }} onTouchStart={pauseFollowing}
      onPointerDown={() => { if (autoScrolling.current) pauseFollowing() }}
      onKeyDown={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pauseFollowing() }} onScroll={() => {
      const node = viewport.current!
      const atBottom = node.scrollHeight - node.clientHeight - node.scrollTop < 16
      if (autoScrolling.current && !atBottom) return
      autoScrolling.current = false
      if (following.current) { seen.current = lastId; setUnread(0) }
    }}>
      {!detail && <p className="agent-caption">正在读取日志…</p>}
      {detail && !events.length && <p className="agent-caption">本轮尚无执行记录。</p>}
      <ol>{rows.map(row => <li key={row.key} data-kind={row.event?.kind ?? 'heartbeat'}>
        <time dateTime={new Date(row.at).toISOString()} title={new Date(row.at).toLocaleString()}>{clock(row.at)}</time>
        {row.event ? <details onToggle={e => { if (e.currentTarget.open) pauseFollowing() }}>
          <summary>{summary(row.event)}</summary><p>{row.event.text}</p>
        </details> : <span className="agent-log-heartbeat"><b>心跳</b>{row.text}</span>}
      </li>)}</ol>
    </div>
    {unread > 0 && <button className="agent-log-new" type="button" onClick={follow}>有 {unread} 条新记录 ↓</button>}
    <footer>
      {error ? <span role="status">{error}</span> : activity.moving && current.status !== 'running' ? <span>每秒刷新状态 · 心跳不计入工作成果</span> : current.status === 'running' ? <span>
        {last && ['briefing', 'planning', 'analysis', 'format-repair'].includes(last.kind) ? '等待模型返回' : '距上次步骤更新'} · {seconds} 秒
        {seconds >= 60 && '，暂未收到新步骤记录'}
      </span> : <span>{last ? `最后更新 ${clock(last.at)}` : '等待执行记录'}</span>}
      {detail?.report && <button type="button" disabled={busy} onClick={onReport}>查看成果</button>}
      {current.status === 'failed' && <button type="button" disabled={busy || !canRetry} onClick={onRetry}>{current.revisionScope === 'presentation' ? '重试样式修改' : '重试本任务'}</button>}
      {current.status === 'waiting' && <button type="button" disabled={busy} onClick={onReply}>去回复</button>}
    </footer>
  </section>
}
