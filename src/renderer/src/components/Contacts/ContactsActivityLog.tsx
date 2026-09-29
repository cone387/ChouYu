import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AgentDashboard } from '../../../../shared/agents'
import type { CharacterStats } from '../../../../shared/characters'
import { workLogActivity } from './workLogActivity'
import { advanceLogScroll } from './logScroll'

type Row = { key: string; at: number; characterId: string; text: string; kind: string; topicTitle?: string }
const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false })

export default function ContactsActivityLog({ data, error, characters, active, onDetail }: {
  data?: AgentDashboard; error: string; characters: CharacterStats[]; active: boolean; onDetail(character: CharacterStats): void
}) {
  const [now, setNow] = useState(Date.now())
  const viewport = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)
  const wakeScroll = useRef<() => void>(() => {})
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  const monitors = characters.flatMap(character => {
    const contact = data?.contacts[character.id]
    if (!contact?.run) return []
    const activity = workLogActivity(contact.run, contact, contact.latestActivity, now, error)
    return activity.moving ? [{ characterId: character.id, ...activity }] : []
  })
  // Each contact has one live row. Clock/countdown changes update it in place;
  // only persisted work events add history rows.
  const rows: Row[] = [
    ...(data?.events.map(event => ({ key: `event-${event.id}`, ...event })) ?? []),
    ...monitors.map(monitor => ({ key: `heartbeat-${monitor.characterId}`, at: now, characterId: monitor.characterId, text: monitor.text, kind: 'heartbeat' }))
  ]
  const revision = rows.map(row => row.key).join('|')
  useLayoutEffect(() => {
    if (!active) { initialized.current = false; return }
    const node = viewport.current
    if (!node?.clientHeight) return
    if (!initialized.current && rows.length) {
      node.scrollTop = node.scrollHeight
      initialized.current = true
    }
    wakeScroll.current()
  }, [active, revision])
  useLayoutEffect(() => {
    const node = viewport.current
    if (!active || !node) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0, previous = 0, position = node.scrollTop, previousHeight = node.clientHeight
    const follow = (at: number) => {
      frame = 0
      if (!node.clientHeight) return
      const elapsed = previous ? Math.min(at - previous, 100) : 16
      previous = at
      const target = Math.max(0, node.scrollHeight - node.clientHeight)
      position = reducedMotion.matches ? target : advanceLogScroll(position, target, elapsed)
      node.scrollTop = position
      if (Math.abs(target - position) > 0.5) frame = requestAnimationFrame(follow)
    }
    const wake = () => {
      cancelAnimationFrame(frame)
      position = node.scrollTop; previous = 0
      frame = requestAnimationFrame(follow)
    }
    wakeScroll.current = wake
    const observer = new ResizeObserver(() => {
      if (!previousHeight && node.clientHeight) node.scrollTop = node.scrollHeight
      previousHeight = node.clientHeight
      wake()
    })
    observer.observe(node)
    const content = node.querySelector('ol')
    if (content) observer.observe(content)
    wake()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); wakeScroll.current = () => {} }
  }, [active])
  const running = monitors.filter(monitor => monitor.label === 'RUNNING').length
  return <section className="contacts-activity" data-contacts-activity aria-label="所有联系人活动日志">
    <header><strong><i aria-hidden="true" data-live={Boolean(monitors.length && !error)} />全员活动</strong>
      <span>{error ? '正在重连' : `${running} 执行 · ${monitors.length - running} 等待`}</span>
      <time aria-live="off">{clock(now)}</time>
    </header>
    <div ref={viewport} className="contacts-activity-viewport" role="log" aria-label="全员最近活动与状态心跳" aria-live="off">
      {!data && <p>{error || '正在读取所有联系人的活动…'}</p>}
      {data && !rows.length && <p>暂无工作日志，联系人开始任务后会自动出现在这里。</p>}
      <ol>{rows.map(row => {
        const character = characters.find(item => item.id === row.characterId)
        if (!character) return null
        return <li key={row.key} data-kind={row.kind}>
          <time dateTime={new Date(row.at).toISOString()} title={new Date(row.at).toLocaleString()}>{clock(row.at)}</time>
          <button type="button" onClick={() => onDetail(character)} title={`查看${character.name}的详情`}>{character.name}</button>
          <span title={`${row.topicTitle ? `${row.topicTitle}\n` : ''}${row.text}`}>
            {row.kind === 'heartbeat' && <b>心跳</b>}{row.text.split('\n')[0]}
          </span>
        </li>
      })}</ol>
    </div>
    <footer>{error || '最近 120 条工作日志 · 当前状态每秒更新，同一联系人不重复刷屏'}</footer>
  </section>
}
