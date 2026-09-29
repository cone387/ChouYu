import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AgentDashboard } from '../../../../shared/agents'
import type { CharacterStats } from '../../../../shared/characters'
import { workLogActivity } from './workLogActivity'

type Row = { key: string; at: number; characterId: string; text: string; kind: string; topicTitle?: string }
const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false })

export default function ContactsActivityLog({ data, error, characters, active, onDetail }: {
  data?: AgentDashboard; error: string; characters: CharacterStats[]; active: boolean; onDetail(character: CharacterStats): void
}) {
  const [now, setNow] = useState(Date.now())
  const [beats, setBeats] = useState<Row[]>([])
  const viewport = useRef<HTMLDivElement>(null)
  const rotation = useRef(0)
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
  useEffect(() => {
    if (!active || !monitors.length || document.hidden) return
    const monitor = monitors[rotation.current++ % monitors.length]
    setBeats(previous => [...previous, { key: `beat-${now}`, at: now, characterId: monitor.characterId, text: monitor.text, kind: 'heartbeat' }].slice(-60))
  }, [now, active])
  const rows: Row[] = [
    ...(data?.events.map(event => ({ key: `event-${event.id}`, ...event })) ?? []), ...beats
  ].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
  const latest = rows.at(-1)?.key
  useLayoutEffect(() => {
    if (!active) return
    const node = viewport.current
    node?.scrollTo({ top: node.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }, [latest, now, active])
  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const observer = new ResizeObserver(() => node.scrollTo({ top: node.scrollHeight, behavior: 'instant' }))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
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
    <footer>{error || '所有联系人 · 最近 120 条工作日志 · 每秒轮播状态心跳，心跳不计入成果'}</footer>
  </section>
}
